import { useMutation, useQueryClient } from "@tanstack/react-query";
import posthog from "posthog-js/dist/module.full.no-external.js";
import {
  aiTracer,
  analyticsProperties,
  detailedAnalyticsProperties,
  errorAnalyticsProperties,
} from "@/lib/analytics";
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
    mutationFn: async ({ text, images, studioTargetReference, studioTargetID, delivery }) => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      if (!delivery && modelSelectionMessage) throw new Error(modelSelectionMessage);

      const [provider, model] = !delivery && selectedModel ? splitModelKey(selectedModel) : [];
      if (!delivery) {
        aiTracer.beginTurn({
          sessionID: activeSessionId,
          text,
          imageCount: images?.length ?? 0,
          provider,
          model,
          variant: selectedVariant ?? undefined,
        });
      }
      try {
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
                ...(selectedVariant && { variant: selectedVariant }),
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
      } catch (error) {
        if (!delivery) aiTracer.cancelTurn(activeSessionId);
        throw error;
      }
      posthog.capture(
        "message_sent",
        analyticsProperties(
          "chat",
          detailedAnalyticsProperties({
            outcome: "success",
            has_images: Boolean(images?.length),
            has_studio_target: Boolean(studioTargetReference),
            provider,
            model,
          }),
        ),
      );
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
    onError: (error, input, context) => {
      posthog.capture(
        "message_send_failed",
        errorAnalyticsProperties("chat", "send_message", error, {
          has_images: Boolean(input.images?.length),
          has_studio_target: Boolean(input.studioTargetReference),
        }),
      );
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
