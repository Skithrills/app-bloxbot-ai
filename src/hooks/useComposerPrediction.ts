import { useEffect, useMemo, useState } from "react";
import { useProviderList } from "@/hooks/useProviders";
import {
  canPredictDraft,
  createPredictionCache,
  pickComposerPredictionModel,
} from "@/lib/composerPredictions";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export const COMPOSER_PREDICTION_DELAY_MS = 750;
const PREDICTION_TIMEOUT_MS = 12_000;

/** Shared by every composer, and gone when BloxBot closes. */
export const composerPredictionCache = createPredictionCache();

/**
 * A continuation of the draft. An empty draft gets a whole next message instead, read from
 * `context`, the end of the chat. Without that there is nothing to suggest for it.
 */
export function useComposerPrediction(
  candidate: { draft: string } | null,
  context: string | null = null,
) {
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
    key: string;
    suffix: string;
  } | null>(null);
  const blank = candidate?.draft === "";
  // A whole-message suggestion belongs to the reply it was read from, and to no other chat.
  const nextMessageKey = modelID && context ? `${modelID}\n${context}` : null;
  const draftKey = modelID && candidate && canPredictDraft(candidate.draft) ? modelID : null;
  const key = blank ? nextMessageKey : draftKey;
  const cached = useMemo(() => {
    if (!candidate) return null;
    const continued = draftKey ? composerPredictionCache.get(draftKey, candidate.draft) : null;
    // Typing along a whole-message suggestion keeps the rest of it too.
    return (
      continued ??
      (nextMessageKey ? composerPredictionCache.get(nextMessageKey, candidate.draft) : null)
    );
  }, [candidate, draftKey, nextMessageKey]);

  useEffect(() => {
    if (!client || !modelID || !candidate || !key || cached) return;
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(PREDICTION_TIMEOUT_MS)]);
      try {
        const suffix = await client.composer.predict(
          { draft: candidate.draft, modelID, ...(blank && context && { context }) },
          { signal },
        );
        if (signal.aborted || !suffix) return;
        composerPredictionCache.set(key, candidate.draft, suffix);
        setPrediction({ candidate, client, modelID, key, suffix });
      } catch {
        // A prediction is optional. Keep typing if the provider can't supply one.
      }
    }, COMPOSER_PREDICTION_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [client, modelID, candidate, cached, blank, context, key]);

  if (cached) return cached;
  return prediction?.candidate === candidate &&
    prediction.client === client &&
    prediction.modelID === modelID &&
    prediction.key === key
    ? prediction.suffix
    : null;
}
