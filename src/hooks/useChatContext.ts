import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranscript } from "@/hooks/useMessages";
import { useProviderList } from "@/hooks/useProviders";
import { useSubscriptionUsageForModel } from "@/hooks/useSubscriptionUsage";
import { qk } from "@/lib/queryKeys";
import { selectChatModel } from "@/lib/sessionContext";
import { splitModelKey } from "@/lib/splitModelKey";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export const COMPACT_MUTATION_KEY = ["compact-session"] as const;

export function useChatContext(sessionID: string | null, beforeMessageID?: string) {
  const { client, ready } = useOpenCodeClient();
  const { selectedModel, selectedVariant, hideFreeModels, modelSelectionMessage } =
    usePreferences();
  const queryClient = useQueryClient();
  const model = useTranscript(sessionID, selectChatModel);
  const providerList = useProviderList();
  const modelKey = model?.modelKey ?? selectedModel ?? undefined;
  const subscription = useSubscriptionUsageForModel(modelKey, model?.completedTurn);
  const contextKey = qk.sessionContext(sessionID ?? "");
  const context = useQuery({
    queryKey: beforeMessageID ? [...contextKey, beforeMessageID] : contextKey,
    queryFn: async ({ signal }) => {
      if (!client || !sessionID) throw new Error("Chat is unavailable.");
      const result = await client.session.context(
        { sessionID, beforeMessageID },
        { signal, throwOnError: true },
      );
      return result.data;
    },
    enabled: ready && !!client && !!sessionID,
    retry: false,
  });
  const measuredModelKey = context.data?.measurement?.modelKey ?? modelKey;
  const [providerID, modelID] = measuredModelKey ? splitModelKey(measuredModelKey) : [];
  const contextModel = providerList?.all.find(({ id }) => id === providerID)?.models[modelID ?? ""];
  const limit = contextModel?.limit?.context;

  const { mutate: compact } = useMutation({
    mutationKey: COMPACT_MUTATION_KEY,
    mutationFn: async (id: string) => {
      if (!client) throw new Error("OpenCode is unavailable.");
      if (modelSelectionMessage) throw new Error(modelSelectionMessage);
      const [providerID, modelID] = selectedModel ? splitModelKey(selectedModel) : [];
      await client.session.compact(
        {
          sessionID: id,
          waitForCompletion: true,
          ...(hideFreeModels && { requirePaidModel: true }),
          model: providerID && modelID ? { providerID, modelID } : undefined,
          variant: selectedVariant ?? undefined,
        },
        { throwOnError: true },
      );
    },
    onSettled: async (_, __, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.sessionContext(id) }),
        queryClient.invalidateQueries({ queryKey: qk.messages(id) }),
      ]);
    },
  });
  const compactions = useMutationState({ filters: { mutationKey: COMPACT_MUTATION_KEY } });
  const latestCompaction = [...compactions]
    .reverse()
    .find(({ variables }) => variables === sessionID);

  return {
    context,
    limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined,
    modelName: contextModel?.name ?? modelID,
    subscription,
    compactStatus: latestCompaction?.status ?? "idle",
    compactError: latestCompaction?.error,
    compact: () => {
      if (
        sessionID &&
        queryClient.isMutating({
          mutationKey: COMPACT_MUTATION_KEY,
          predicate: ({ state }) => state.variables === sessionID,
        }) === 0
      ) {
        compact(sessionID);
      }
    },
  };
}

export type ChatContext = ReturnType<typeof useChatContext>;
