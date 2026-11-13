import type { SessionMessageInfo } from "@opencode/client";
import { toAppProviderID } from "@/lib/openAiProfiles";
import type { MessagesCache } from "@/lib/sseDispatch";

export function lastCompaction(entries: readonly SessionMessageInfo[]) {
  return [...entries].reverse().find((entry) => entry.type === "compaction");
}

/** OpenCode reports token classes for a model call, and which messages survive compaction. */
export function summarizeSessionContext(
  entries: readonly SessionMessageInfo[],
  beforeMessageID?: string,
) {
  const boundary = beforeMessageID ? entries.findIndex(({ id }) => id === beforeMessageID) : -1;
  const visible = boundary === -1 ? entries : entries.slice(0, boundary);
  const latestCompaction = lastCompaction(visible);
  const reversed = [...visible].reverse();
  const compactedAt = reversed.findIndex(
    (entry) => entry.type === "compaction" && entry.status === "completed",
  );
  const current = compactedAt === -1 ? reversed : reversed.slice(0, compactedAt);
  const assistant = current.find(
    (entry) =>
      entry.type === "assistant" &&
      entry.time.completed !== undefined &&
      !entry.error &&
      !!entry.tokens,
  );
  const measurement =
    assistant?.type === "assistant" && assistant.tokens
      ? {
          modelKey: `${toAppProviderID(assistant.model.providerID)}/${assistant.model.id}`,
          tokens: assistant.tokens,
        }
      : null;

  return {
    measurement,
    hasCompacted: compactedAt !== -1,
    canCompact:
      latestCompaction?.status !== "running" &&
      current.some((entry) => entry.type === "user" && (!!entry.text || !!entry.files?.length)),
  };
}

export type SessionContextSummary = ReturnType<typeof summarizeSessionContext>;

/** Use a model that actually answered in this chat, even when the next selection changes. */
export function selectChatModel(cache: MessagesCache) {
  let modelKey: string | undefined;
  let completedTurn: string | undefined;
  for (let index = cache.messageIds.length - 1; index >= 0; index--) {
    const info = cache.messagesById[cache.messageIds[index]]?.info;
    if (info?.role !== "assistant" || !info.modelID || !info.providerID) continue;
    modelKey ??= `${toAppProviderID(info.providerID)}/${info.modelID}`;
    if (info.time.completed !== undefined && !info.error && info.finish !== "tool-calls") {
      completedTurn = `${info.sessionID}/${info.id}`;
      break;
    }
  }
  return { modelKey, completedTurn };
}
