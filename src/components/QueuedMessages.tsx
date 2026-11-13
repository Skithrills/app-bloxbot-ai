import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, ListOrdered, Trash2 } from "lucide-react";
import { ReferenceText } from "@/components/ReferenceChip";
import { useTranscript } from "@/hooks/useMessages";
import { splitVideoNotes } from "@/lib/composerVideos";
import { instanceReferenceLabels } from "@/lib/instanceReferences";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

function selectQueuedMessages({ messageIds, messagesById }: MessagesCache) {
  return messageIds.flatMap((id) => {
    const message = messagesById[id];
    const info = message?.info;
    return info?.role === "user" &&
      info.inbox?.delivery === "queue" &&
      info.inbox.state === "pending"
      ? [message]
      : [];
  });
}

export function QueuedMessages({ sessionID }: { sessionID: string | null }) {
  const messages = useTranscript(sessionID, selectQueuedMessages);
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { mutate, isPending } = useMutation({
    mutationKey: ["queued-message", sessionID],
    mutationFn: async ({
      sessionID,
      inboxID,
      action,
    }: {
      sessionID: string;
      inboxID: string;
      action: "steer" | "cancel";
    }) => {
      if (!client) throw new Error("Chat is unavailable.");
      const input = { sessionID, inboxID };
      const options = { throwOnError: true } as const;
      if (action === "steer") {
        await client.session.inbox.update({ ...input, delivery: "steer" }, options);
      } else {
        await client.session.inbox.cancel(input, options);
      }
    },
    onSettled: (_, __, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.messages(input.sessionID) });
    },
    onError: (error) =>
      notify.error("Couldn't update queued message", { description: error.message }),
  });

  if (!sessionID || !messages?.length) return null;

  return (
    <ul
      aria-label="Queued messages"
      className="app-scrollbar mb-1 max-h-32 divide-y overflow-y-auto rounded-lg border bg-card"
    >
      {messages.map(({ info, parts }) => {
        const text = parts
          .flatMap((part) => (part.type === "text" ? [splitVideoNotes(part.text).text] : []))
          .join(" ");
        const files = parts.filter((part) => part.type === "file").length;
        const attachmentLabel = files === 1 ? "1 attachment" : `${files} attachments`;
        const preview = text.trim() || (files > 0 ? attachmentLabel : "Queued message");
        return (
          <li key={info.id} className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-xs">
            <ListOrdered aria-hidden="true" size={13} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={instanceReferenceLabels(preview)}>
              <ReferenceText text={preview} />
            </span>
            <button
              type="button"
              aria-label="Steer queued message"
              title="Steer at the next step"
              disabled={!client || isPending}
              onClick={() => mutate({ sessionID, inboxID: info.id, action: "steer" })}
              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <CornerDownRight aria-hidden="true" size={13} />
              Steer
            </button>
            <button
              type="button"
              aria-label="Remove queued message"
              title="Remove queued message"
              disabled={!client || isPending}
              onClick={() => mutate({ sessionID, inboxID: info.id, action: "cancel" })}
              className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" size={13} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
