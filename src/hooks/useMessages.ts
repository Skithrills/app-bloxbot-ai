import { hashKey, type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useSessions } from "@/hooks/useSessions";
import { isPendingInboxMessage } from "@/lib/composerDelivery";
import type { OpencodeClient } from "@/lib/opencode/client";
import { hasPlaytestContext } from "@/lib/playtestPlan";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { isStudioTool } from "@/lib/studioMcp";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { MessageWithParts } from "@/types";

const NOOP_KEY = ["__noop__"] as const;
const EMPTY_IDS: string[] = [];
const EMPTY_CACHE: MessagesCache = { messageIds: [], messagesById: {} };

export function mergeMessagesSnapshot(
  before: MessagesCache | undefined,
  fetched: MessagesCache,
  after: MessagesCache | undefined,
  observedChanges?: ReadonlySet<string>,
): MessagesCache {
  const changedIds =
    observedChanges ??
    new Set(
      [...(before?.messageIds ?? []), ...(after?.messageIds ?? [])].filter(
        (messageID) => before?.messagesById[messageID] !== after?.messagesById[messageID],
      ),
    );
  if (changedIds.size === 0) return fetched;

  const messagesById = { ...fetched.messagesById };
  const deletedIds = new Set(
    [...changedIds].filter((messageID) => !after?.messagesById[messageID]),
  );
  for (const messageID of deletedIds) delete messagesById[messageID];

  const concurrentlyUpdatedIds: string[] = [];
  const deliveredIds = new Set<string>();
  for (const messageID of after?.messageIds ?? []) {
    const updatedMessage = after?.messagesById[messageID];
    if (changedIds.has(messageID) && updatedMessage) {
      if (
        isPendingInboxMessage(fetched.messagesById[messageID]?.info) &&
        !isPendingInboxMessage(updatedMessage.info)
      ) {
        deliveredIds.add(messageID);
      }
      messagesById[messageID] = updatedMessage;
      concurrentlyUpdatedIds.push(messageID);
    }
  }

  const messageIds = fetched.messageIds.filter(
    (messageID) => !deletedIds.has(messageID) && !deliveredIds.has(messageID),
  );
  const knownIds = new Set(messageIds);
  for (const messageID of concurrentlyUpdatedIds) {
    if (!knownIds.has(messageID)) messageIds.push(messageID);
  }
  return { messageIds, messagesById };
}

export async function fetchMessages(
  client: OpencodeClient,
  queryClient: QueryClient,
  sessionID: string,
  includePending = true,
): Promise<MessagesCache> {
  const queryKey = qk.messages(sessionID);
  const before = queryClient.getQueryData<MessagesCache>(queryKey);
  let observed = before;
  const observedChanges = new Set<string>();
  const queryHash = hashKey(queryKey);
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== queryHash) return;
    const next = event.query.state.data as MessagesCache | undefined;
    if (next === observed) return;
    const messageIds = new Set([...(observed?.messageIds ?? []), ...(next?.messageIds ?? [])]);
    for (const messageID of messageIds) {
      if (observed?.messagesById[messageID] !== next?.messagesById[messageID]) {
        observedChanges.add(messageID);
      }
    }
    observed = next;
  });
  let res: Awaited<ReturnType<OpencodeClient["session"]["messages"]>>;
  try {
    const input = includePending ? { sessionID, includePending: true } : { sessionID };
    res = await client.session.messages(input, { throwOnError: true });
  } finally {
    unsubscribe();
  }
  const messageIds: string[] = [];
  const messagesById: Record<string, MessageWithParts> = {};
  for (const msg of res.data ?? []) {
    messageIds.push(msg.info.id);
    messagesById[msg.info.id] = { info: msg.info, parts: msg.parts };
  }
  return mergeMessagesSnapshot(
    before,
    { messageIds, messagesById },
    queryClient.getQueryData<MessagesCache>(queryKey),
    observedChanges,
  );
}

export function useTranscript<T>(
  sessionID: string | null,
  select: (cache: MessagesCache) => T,
  options?: { includePending?: boolean; refreshOnMount?: boolean },
) {
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<MessagesCache, Error, T>({
    queryKey: sessionID ? qk.messages(sessionID) : NOOP_KEY,
    queryFn: () =>
      client && sessionID
        ? fetchMessages(client, queryClient, sessionID, options?.includePending)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!sessionID,
    refetchOnMount: options?.refreshOnMount ? "always" : true,
    select,
  }).data;
}

const selectMessageIds = (cache: MessagesCache) => cache.messageIds;

export function useMessageIds(sessionID?: string): string[] {
  const { activeSessionId } = useActiveSession();
  const id = sessionID ?? activeSessionId;
  const data = useTranscript(
    id,
    selectMessageIds,
    sessionID ? { includePending: true, refreshOnMount: true } : undefined,
  );
  // Undo hides a message and everything after it until it's redone or made final.
  const { data: sessions } = useSessions();
  const revertedId = sessions?.find((session) => session.id === id)?.revert?.messageID;
  const ids = data ?? EMPTY_IDS;
  return useMemo(() => {
    const boundary = revertedId ? ids.indexOf(revertedId) : -1;
    return boundary === -1 ? ids : ids.slice(0, boundary);
  }, [ids, revertedId]);
}

export function useMessage(messageId: string, sessionID?: string): MessageWithParts | undefined {
  const { activeSessionId } = useActiveSession();
  return useTranscript(
    sessionID ?? activeSessionId,
    useCallback((d: MessagesCache) => d.messagesById[messageId], [messageId]),
    sessionID ? { includePending: true } : undefined,
  );
}

/**
 * Whether the active chat has any text a playtest plan can be built from.
 * Undefined until its messages load.
 */
/** Looking at what's open isn't working in any of it, however it's called. */
export function worksInStudio(tool: string, input?: Record<string, unknown>): boolean {
  if (tool.endsWith("list_roblox_studios") || !isStudioTool(tool, input)) return false;
  if (tool !== "execute" || typeof input?.code !== "string") return true;
  return (
    input.code.replace(/roblox[-_]studio\W+list_roblox_studios/g, "").match(/roblox[-_]studio/) !==
    null
  );
}

/** Whether this chat is under way, and whether the agent has used Studio in it. */
export function useChatStudioUse(): { started: boolean; usedStudio: boolean } | null {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return (
    useQuery<MessagesCache, Error, { started: boolean; usedStudio: boolean }>({
      queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
      queryFn: () =>
        client && activeSessionId
          ? fetchMessages(client, queryClient, activeSessionId)
          : Promise.resolve(EMPTY_CACHE),
      enabled: ready && !!client && !!activeSessionId,
      select: useCallback(
        (d: MessagesCache) => ({
          started: d.messageIds.some((id) => !isPendingInboxMessage(d.messagesById[id]?.info)),
          usedStudio: d.messageIds.some((id) =>
            d.messagesById[id]?.parts.some(
              (part) =>
                part.type === "tool" &&
                worksInStudio(part.tool, part.state.input as Record<string, unknown> | undefined),
            ),
          ),
        }),
        [],
      ),
    }).data ?? null
  );
}

export function useHasPlaytestContext(): boolean | undefined {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useQuery<MessagesCache, Error, boolean>({
    queryKey: activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY,
    queryFn: () =>
      client && activeSessionId
        ? fetchMessages(client, queryClient, activeSessionId)
        : Promise.resolve(EMPTY_CACHE),
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback(
      (d: MessagesCache) =>
        hasPlaytestContext(
          d.messageIds.flatMap((id) => {
            const message = d.messagesById[id];
            return message && !isPendingInboxMessage(message.info) ? [message] : [];
          }),
        ),
      [],
    ),
  }).data;
}
