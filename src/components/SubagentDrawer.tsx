import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Bot, ChevronRight, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import ChatMessages from "@/components/ChatMessages";
import { QueuedMessages } from "@/components/QueuedMessages";
import { SubagentIcon, SubagentStatusBadge } from "@/components/SubagentToolCard";
import { useEligibleModels } from "@/hooks/useEligibleModels";
import { useProviderList } from "@/hooks/useProviders";
import { useSessionStatus, useSessionStatuses } from "@/hooks/useSessionStatuses";
import {
  type SubagentStatus,
  subagentStatus,
  useSubagentMetrics,
  useSubagentModelLabel,
  useSubagentStatus,
} from "@/hooks/useSubagentSession";
import { type ComposerDelivery, getComposerDelivery } from "@/lib/composerDelivery";
import { loadConfig } from "@/lib/config";
import { effortLabel } from "@/lib/effort";
import { isPaidModel } from "@/lib/modelChoice";
import { notify } from "@/lib/notifications";
import { toAppProviderID, toEngineProviderID } from "@/lib/openAiProfiles";
import type { Session } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { subagentProfileName } from "@/lib/subagentProfiles";
import { type AddComposerImage, type ComposerImage, MAX_COMPOSER_IMAGES } from "@/lib/toolImages";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

type SubagentAttachment = ComposerImage & { id: number };
type Draft = { text: string; images: SubagentAttachment[]; delivery: ComposerDelivery };
type UpdateDraft = (update: (draft: Draft) => Draft) => void;

const EMPTY_DRAFT: Draft = { text: "", images: [], delivery: "queue" };

export const SUBAGENT_LIST_TITLE_ID = "subagent-list-title";
export const SUBAGENT_ROW_ID_PREFIX = "subagent-row-";
export const SUBAGENT_COMPOSER_ID = "subagent-composer";

function displayRole(session: Session): string {
  return session.agent ? subagentProfileName(session.agent) : "Subagent";
}

function modelKey(model: Session["model"]): string | undefined {
  return model && `${toAppProviderID(model.providerID)}/${model.id}`;
}

function SubagentListItem({
  session,
  threadAgents,
  status,
  onSelect,
}: {
  session: Session;
  threadAgents: readonly Session[];
  status: SubagentStatus;
  onSelect: (id: string) => void;
}) {
  const role = displayRole(session);
  const title = session.title || role;
  return (
    <button
      id={`${SUBAGENT_ROW_ID_PREFIX}${session.id}`}
      type="button"
      className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      aria-label={`${title}, ${status}`}
      title={title}
      onClick={() => onSelect(session.id)}
    >
      <SubagentIcon session={session} threadAgents={threadAgents} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {session.agent && title !== role && (
          <span className="block truncate text-xs text-muted-foreground">{role}</span>
        )}
      </span>
      <SubagentStatusBadge status={status} />
      <ChevronRight aria-hidden="true" size={13} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

function SubagentList({ sessions, onOpen }: { sessions: Session[]; onOpen: (id: string) => void }) {
  const { data: statuses } = useSessionStatuses();
  const groups: Record<"Active" | "Done", Array<{ session: Session; status: SubagentStatus }>> = {
    Active: [],
    Done: [],
  };
  for (const session of sessions) {
    const status = subagentStatus(session, statuses?.[session.id]);
    groups[status === "Waiting" || status === "Running" ? "Active" : "Done"].push({
      session,
      status,
    });
  }

  return (
    <div className="app-scrollbar min-h-0 min-w-0 overflow-y-auto px-2.5 py-3">
      {sessions.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          Subagent chats will appear here when the main chat delegates a task.
        </p>
      )}
      {(["Active", "Done"] as const).map(
        (label) =>
          groups[label].length > 0 && (
            <section aria-label={label} key={label} className="mb-3 last:mb-0">
              <h3 className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">{label}</h3>
              <ul className="space-y-0.5">
                {groups[label].map(({ session, status }) => (
                  <li key={session.id}>
                    <SubagentListItem
                      session={session}
                      threadAgents={sessions}
                      status={status}
                      onSelect={onOpen}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
    </div>
  );
}

function SubagentConversation({
  session,
  threadAgents,
  root,
  draft,
  updateDraft,
  nextImageId,
  onOpen,
  onBack,
  onClose,
}: {
  session: Session;
  threadAgents: readonly Session[];
  root: Session;
  draft: Draft;
  updateDraft: UpdateDraft;
  nextImageId: () => number;
  onOpen: (id: string) => void;
  onBack: (id: string) => void;
  onClose: () => void;
}) {
  const { client } = useOpenCodeClient();
  const { composerShortcuts, hideFreeModels, selectedModel } = usePreferences();
  const providers = useProviderList();
  const eligibleModels = useEligibleModels();
  const { data: config } = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const runStatus = useSessionStatus(session.id);
  const active = runStatus?.type === "busy" || runStatus?.type === "retry";
  const status = useSubagentStatus(session);
  const metrics = useSubagentMetrics(session);
  const modelLabel = useSubagentModelLabel(metrics.model);
  const effort = metrics.model ? `${effortLabel(metrics.model.variant ?? null)} effort` : undefined;
  const { text, images, delivery } = draft;
  const composer = useRef<HTMLTextAreaElement>(null);
  const addImage: AddComposerImage = (image) => {
    if (images.length >= MAX_COMPOSER_IMAGES) {
      notify.error(`Maximum ${MAX_COMPOSER_IMAGES} images allowed`);
      return false;
    }
    const attachment = { ...image, id: nextImageId() };
    updateDraft((current) =>
      current.images.length < MAX_COMPOSER_IMAGES
        ? { ...current, images: [...current.images, attachment] }
        : current,
    );
    requestAnimationFrame(() => composer.current?.focus());
    return true;
  };

  const send = useMutation({
    mutationFn: async (message: {
      text: string;
      images: SubagentAttachment[];
      delivery: ComposerDelivery;
      wasActive: boolean;
    }) => {
      if (!client) throw new Error("OpenCode is not ready.");
      let model: { providerID: string; modelID: string } | undefined;
      const current = modelKey(session.model);
      if (hideFreeModels && (!current || !providers || !isPaidModel(providers, current))) {
        const configured = session.agent ? config?.subagentModels?.[session.agent] : undefined;
        const replacement = [configured, modelKey(root.model), selectedModel].find((key) =>
          eligibleModels.some((item) => `${item.providerId}/${item.id}` === key),
        );
        if (!replacement) throw new Error("Connect a provider or show free models to continue.");
        const [providerID, modelID] = splitModelKey(replacement);
        model = { providerID: toEngineProviderID(providerID), modelID };
      }
      await client.session.promptInbox(
        {
          sessionID: session.id,
          text: message.text || " ",
          ...(message.images.length > 0 && {
            files: message.images.map((image) => ({ uri: image.dataUrl, name: image.filename })),
          }),
          delivery: message.delivery,
          model,
        },
        { throwOnError: true },
      );
      return { queued: message.wasActive && message.delivery === "queue" };
    },
    onSuccess: (_result, sent) => {
      const sentIDs = new Set(sent.images.map(({ id }) => id));
      updateDraft((current) => ({
        ...current,
        text: current.text.trim() === sent.text ? "" : current.text,
        images: current.images.filter(({ id }) => !sentIDs.has(id)),
      }));
    },
  });

  const summary = useMutation({
    mutationFn: async (latestReply: string) => {
      if (!client) throw new Error("OpenCode is not ready.");
      const rootModel = modelKey(root.model);
      if (hideFreeModels && (!rootModel || !providers || !isPaidModel(providers, rootModel))) {
        throw new Error(
          "Send a message in the main chat with a paid model before forwarding a summary.",
        );
      }
      const excerpt =
        latestReply.length > 10_000 ? `${latestReply.slice(0, 10_000)}\n[…]` : latestReply;
      await client.session.promptInbox(
        {
          sessionID: root.id,
          delivery: "queue",
          text: `I’m forwarding the latest completed reply from ${displayRole(session)} for “${session.title || "Subagent task"}”.\n\n${excerpt}`,
        },
        { throwOnError: true },
      );
    },
  });

  const canSend = Boolean(text.trim() || images.length > 0) && !send.isPending;
  function sendMessage(selectedDelivery: ComposerDelivery) {
    if (canSend)
      send.mutate({ text: text.trim(), images, delivery: selectedDelivery, wasActive: active });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    sendMessage(active ? delivery : "queue");
  }

  const role = displayRole(session);
  const title = session.title || role;
  return (
    <>
      <header className="min-w-0 border-b px-3 pb-2.5 pt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <button
            type="button"
            className="-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onBack(session.id)}
          >
            <ArrowLeft aria-hidden="true" size={14} /> Back
          </button>
          <CloseDrawerButton onClose={onClose} />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <SubagentIcon session={session} threadAgents={threadAgents} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>
            {title}
          </h2>
          {status && <SubagentStatusBadge status={status} />}
        </div>
        {modelLabel && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 truncate" title={modelLabel}>
              {modelLabel}
            </span>
            {effort && (
              <span className="max-w-[50%] shrink-0 truncate" title={effort}>
                · {effort}
              </span>
            )}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
          {session.agent && title !== role && `${role} · `}
          {metrics.tokens.toLocaleString()} tokens · {metrics.steps}{" "}
          {metrics.steps === 1 ? "step" : "steps"}
        </p>
      </header>
      <ChatMessages sessionID={session.id} onOpenSubagent={onOpen} onAddImage={addImage} />
      <form onSubmit={submit} className="min-w-0 space-y-2 border-t p-3 wrap-anywhere">
        <QueuedMessages sessionID={session.id} />
        {images.length > 0 && (
          <div className="app-scrollbar flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain">
            {images.map((image) => (
              <div key={image.id} className="relative shrink-0">
                <img
                  src={image.dataUrl}
                  alt={image.filename}
                  className="h-12 w-16 rounded border object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${image.filename}`}
                  className="absolute right-0.5 top-0.5 rounded bg-background/90 p-0.5"
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      images: current.images.filter(({ id }) => id !== image.id),
                    }))
                  }
                >
                  <X aria-hidden size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={composer}
          id={SUBAGENT_COMPOSER_ID}
          aria-label="Message subagent"
          className="block max-h-[min(8rem,25dvh)] min-h-16 w-full resize-y rounded-md border bg-background px-2.5 py-2 text-sm"
          placeholder="Message subagent…"
          rows={2}
          value={text}
          onChange={(event) => {
            const nextText = event.target.value;
            updateDraft((current) => ({ ...current, text: nextText }));
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229)
              return;
            const keyDelivery = active
              ? getComposerDelivery(event, composerShortcuts)
              : !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
                ? "queue"
                : undefined;
            if (!keyDelivery) return;
            event.preventDefault();
            sendMessage(keyDelivery);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {active ? (
            <select
              aria-label="Subagent message delivery"
              className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              value={delivery}
              onChange={(event) => {
                const nextDelivery = event.target.value === "steer" ? "steer" : "queue";
                updateDraft((current) => ({ ...current, delivery: nextDelivery }));
              }}
            >
              <option value="queue">Queue after current turn</option>
              <option value="steer">Steer at next step</option>
            </select>
          ) : (
            <button
              type="button"
              title="Forward the latest completed reply to the main chat"
              disabled={!metrics.latestReply || summary.isPending}
              className="rounded px-1.5 py-1 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-50"
              onClick={() => summary.mutate(metrics.latestReply)}
            >
              Send Summary Back to Main Agent
            </button>
          )}
          <button
            type="submit"
            disabled={!canSend}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            <ArrowUp aria-hidden="true" size={13} />{" "}
            {active && delivery === "queue" ? "Queue" : "Send"}
          </button>
        </div>
        {(send.error || summary.error) && (
          <p role="alert" className="text-xs text-destructive">
            {(send.error ?? summary.error)?.message || "OpenCode could not accept the message."}
          </p>
        )}
        {send.isSuccess && !text && (
          <output className="text-xs text-muted-foreground">
            {send.data.queued ? "Message queued." : "Message sent."}
          </output>
        )}
        {summary.isSuccess && (
          <output className="text-xs text-muted-foreground">Summary sent to the main chat.</output>
        )}
      </form>
    </>
  );
}

function CloseDrawerButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close subagent chats"
      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onClose}
    >
      <X aria-hidden="true" size={15} />
    </button>
  );
}

export default function SubagentDrawer({
  root,
  sessions,
  selected,
  onOpen,
  onBack,
  onClose,
}: {
  root: Session;
  sessions: Session[];
  selected: string | null;
  onOpen: (id: string) => void;
  onBack: (id: string) => void;
  onClose: () => void;
}) {
  const current = sessions.find((session) => session.id === selected);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const nextImageID = useRef(0);

  function updateDraft(id: string, update: Parameters<UpdateDraft>[0]) {
    setDrafts((previous) => ({ ...previous, [id]: update(previous[id] ?? EMPTY_DRAFT) }));
  }

  return (
    <aside
      id="subagent-drawer"
      aria-label="Subagent chats"
      className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-clip border-l bg-sidebar"
    >
      {current ? (
        <SubagentConversation
          key={current.id}
          session={current}
          threadAgents={sessions}
          root={root}
          draft={drafts[current.id] ?? EMPTY_DRAFT}
          updateDraft={(update) => updateDraft(current.id, update)}
          nextImageId={() => ++nextImageID.current}
          onOpen={onOpen}
          onBack={onBack}
          onClose={onClose}
        />
      ) : (
        <>
          <header className="flex min-w-0 items-center justify-between gap-2 border-b px-3 py-2.5">
            <h2
              id={SUBAGENT_LIST_TITLE_ID}
              tabIndex={-1}
              className="flex items-center gap-1.5 text-sm font-semibold"
            >
              <Bot aria-hidden="true" size={16} /> Subagents
            </h2>
            <CloseDrawerButton onClose={onClose} />
          </header>
          <SubagentList sessions={sessions} onOpen={onOpen} />
        </>
      )}
    </aside>
  );
}
