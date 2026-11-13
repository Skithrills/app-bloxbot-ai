import { useEffect, useMemo, useState } from "react";
import { useProviderList } from "@/hooks/useProviders";
import { createPredictionCache, pickComposerPredictionModel } from "@/lib/composerPredictions";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export const COMPOSER_PREDICTION_DELAY_MS = 750;
const PREDICTION_TIMEOUT_MS = 12_000;

/** Shared by every composer, and gone when BloxBot closes. */
export const composerPredictionCache = createPredictionCache();

export function useComposerPrediction(candidate: { draft: string } | null) {
  const { client } = useOpenCodeClient();
  const { hiddenModels, unavailableModels } = usePreferences();
  const providers = useProviderList();
  // Hiding free models is about which models chats can use. Predictions are switched on separately
  // and only ever use a free model, so that setting doesn't turn them off.
  const modelID = useMemo(
    () =>
      providers
        ? pickComposerPredictionModel(providers, hiddenModels, unavailableModels)
        : undefined,
    [providers, hiddenModels, unavailableModels],
  );
  const [prediction, setPrediction] = useState<{
    candidate: NonNullable<typeof candidate>;
    client: NonNullable<typeof client>;
    modelID: string;
    suffix: string;
  } | null>(null);
  const cached = useMemo(
    () => (candidate && modelID ? composerPredictionCache.get(modelID, candidate.draft) : null),
    [candidate, modelID],
  );

  useEffect(() => {
    if (!client || !modelID || !candidate || cached) return;
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(PREDICTION_TIMEOUT_MS)]);
      try {
        const suffix = await client.composer.predict(
          { draft: candidate.draft, modelID },
          { signal },
        );
        if (signal.aborted || !suffix) return;
        composerPredictionCache.set(modelID, candidate.draft, suffix);
        setPrediction({ candidate, client, modelID, suffix });
      } catch {
        // A prediction is optional. Keep typing if the provider can't supply one.
      }
    }, COMPOSER_PREDICTION_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [client, modelID, candidate, cached]);

  if (cached) return cached;
  return prediction?.candidate === candidate &&
    prediction.client === client &&
    prediction.modelID === modelID
    ? prediction.suffix
    : null;
}
