import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComposerDelivery } from "@/lib/composerDelivery";
import { offerNotificationsOnce } from "@/lib/notificationOffer";
import type { SessionStatus } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { recordPromptSent } from "@/lib/starCallout";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface SendMessageInput {
  text: string;
  images?: Array<{ mime: string; url: string; filename?: string }>;
  studioTargetReference?: string | null;
  studioTargetID?: string | null;
  delivery?: ComposerDelivery;
  /** Sends with this model and effort instead of the selected ones, which may not have caught up. */
  model?: string;
  variant?: string | null;
}

interface SendMessageContext {
  sessionID: string;
  previousStatus: SessionStatus | undefined;
}

export const sendMessageMutationKey = (sessionID: string | null) =>
  ["sendMessage", sessionID] as const;

export function useSendMessage() {
  const { client } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const { selectedModel, selectedVariant, hideFreeModels, modelSelectionMessage } =
    usePreferences();
  const queryClient = useQueryClient();
  return useMutation<void, Error, SendMessageInput, SendMessageContext | undefined>({
    mutationKey: sendMessageMutationKey(activeSessionId),
    mutationFn: async ({
      text,
      images,
      studioTargetReference,
      studioTargetID,
      delivery,
      ...use
    }) => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      if (!delivery && modelSelectionMessage) throw new Error(modelSelectionMessage);

      const modelKey = use.model ?? selectedModel;
      const variant = use.variant === undefined ? selectedVariant : use.variant;
      const [provider, model] = !delivery && modelKey ? splitModelKey(modelKey) : [];
      const accepted = delivery
        ? client.session.promptInbox(
            {
              sessionID: activeSessionId,
              text,
              delivery,
              ...(images?.length && {
                files: images.map(({ url, filename }) => ({ uri: url, name: filename })),
              }),
              ...(studioTargetID !== undefined && { studioTargetID }),
            },
            { throwOnError: true },
          )
        : client.session.promptAsync(
            {
              sessionID: activeSessionId,
              parts: [
                { type: "text", text },
                ...(images ?? []).map((image) => ({ type: "file", ...image })),
              ],
              ...(studioTargetReference && { system: studioTargetReference }),
              ...(hideFreeModels && { requirePaidModel: true }),
              ...(provider && model && { model: { providerID: provider, modelID: model } }),
              ...(variant && { variant }),
            },
            { throwOnError: true },
          );
      // Waiting on a reply is when a ping starts to sound useful.
      offerNotificationsOnce().catch((error) => {
        console.warn("Failed to offer notifications:", error);
      });
      recordPromptSent(accepted).catch((error) => {
        console.warn("Failed to count the prompt:", error);
      });
      await accepted;
    },
    onMutate: ({ delivery }) => {
      if (!activeSessionId || delivery) return undefined;
      const statuses = queryClient.getQueryData<Record<string, SessionStatus>>(qk.statuses);
      const context: SendMessageContext = {
        sessionID: activeSessionId,
        previousStatus: statuses?.[activeSessionId],
      };
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => ({
        ...previous,
        [activeSessionId]: { type: "busy" },
      }));
      return context;
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => {
        if (previous?.[context.sessionID]?.type !== "busy") return previous;
        const next = { ...previous };
        if (context.previousStatus) {
          next[context.sessionID] = context.previousStatus;
        } else {
          delete next[context.sessionID];
        }
        return next;
      });
    },
  });
}
