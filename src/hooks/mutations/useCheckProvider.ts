import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProviderListResponse } from "@/lib/opencode/types";
import { canChat, checkFailure, type ProviderCheckResult } from "@/lib/providerCheck";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export type CheckProviderInput = { providerID: string; modelID: string };

/**
 * Sends one short message through the chat model the user picked, the same
 * way a chat would, to show whether the provider's key or sign-in works with
 * it. Only runs when the user asks: checking on save would spend their
 * credits unasked.
 */
export function useCheckProvider() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      providerID,
      modelID,
    }: CheckProviderInput): Promise<ProviderCheckResult> => {
      if (!client) throw new Error("No client");
      const providers = queryClient.getQueryData<ProviderListResponse>(qk.providers);
      const provider = providers?.all.find((p) => p.id === providerID);
      const model = provider?.models[modelID];
      if (!model || !canChat(model)) {
        return {
          ok: false,
          message: "This model can't be tested. Pick one that can chat.",
          keyRejected: false,
        };
      }

      const created = await client.session.create(
        {
          title: "BloxBot connection check",
          metadata: { bloxbotHidden: true, purpose: "provider-check" },
        },
        { throwOnError: true },
      );
      const sessionID = created.data.id;
      try {
        const response = await client.session.prompt(
          {
            sessionID,
            model: { providerID, modelID: model.id },
            parts: [{ type: "text", text: "Connection check. Reply with OK and nothing else." }],
          },
          { throwOnError: true },
        );
        const error = response.data.info.error;
        return error
          ? { ...checkFailure(error), modelName: model.name }
          : { ok: true, modelName: model.name };
      } finally {
        await client.session.delete({ sessionID }, { throwOnError: true }).catch(() => undefined);
      }
    },
  });
}
