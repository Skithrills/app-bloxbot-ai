import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useAllModels, useProviderList } from "@/hooks/useProviders";
import {
  type ComposerPredictionContext,
  type ComposerPredictionRequestStatus,
  canPredictDraft,
  composerNextMessageKey,
  createPredictionCache,
  isTextPredictionModel,
  pickComposerPredictionModel,
  storedNextMessages,
} from "@/lib/composerPredictions";
import { fastModelPairs } from "@/lib/modelChoice";
import { OPENAI_API_PROVIDER, OPENAI_OAUTH_PROVIDER } from "@/lib/openAiProfiles";
import { splitModelKey } from "@/lib/splitModelKey";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export const COMPOSER_PREDICTION_DELAY_MS = 750;
const PREDICTION_TIMEOUT_MS = 12_000;
const FREE_NEXT_MESSAGE_TIMEOUT_MS = 25_000;

export const composerPredictionCache = createPredictionCache();
const savedSuggestions = storedNextMessages();

export interface ComposerPredictionOptions {
  sessionID: string | null;
  context: ComposerPredictionContext | undefined;
  nextMessageEnabled: boolean;
  nextMessageSource: "free" | "chat";
  autocompleteEnabled: boolean;
  debug: boolean;
  paused: string | null;
}

const requestStatuses: Record<ComposerPredictionRequestStatus | "timeout", string> = {
  waiting: "Waiting for the previous request to finish",
  requesting: "Checking model availability",
  generating: "Requesting a suggestion",
  attempted: "The chat model already attempted a prediction for this turn",
  "storage-unavailable": "Chat-model predictions need a local suggestion cache",
  "free-limit": "The OpenCode Zen free limit was reached. Try again after it resets",
  cooldown: "Cooling down after a provider error",
  ineligible: "The model is no longer eligible for predictions",
  empty: "The model returned no usable suggestion",
  "request-failed": "The suggestion request failed",
  timeout: "The prediction request timed out",
};

export function useComposerPrediction(
  candidate: { draft: string } | null,
  idleReason: string,
  {
    sessionID,
    context,
    nextMessageEnabled,
    nextMessageSource,
    autocompleteEnabled,
    paused,
  }: ComposerPredictionOptions,
) {
  const { client, ready } = useOpenCodeClient();
  const { hiddenModels, unavailableModels, selectedModel, modelSelectionMessage } =
    usePreferences();
  const providers = useProviderList();
  const allModels = useAllModels();
  const freeModelID = useMemo(
    () => providers && pickComposerPredictionModel(providers, hiddenModels, unavailableModels),
    [providers, hiddenModels, unavailableModels],
  );
  const blank = candidate?.draft === "";
  const useChatModel = blank && nextMessageSource === "chat";
  const [chatProvider, chatModel] = useMemo(() => {
    if (!useChatModel || !providers || !selectedModel || modelSelectionMessage) return [];
    const [providerID, selectedID] = splitModelKey(selectedModel);
    if (
      !providers.connected.includes(providerID) ||
      unavailableModels.has(selectedModel) ||
      hiddenModels.has(selectedModel)
    ) {
      return [];
    }
    const provider = providers.all.find(({ id }) => id === providerID);
    const selected = provider?.models[selectedID];
    if (!selected || !isTextPredictionModel(selected)) return [];
    const standard =
      providerID === OPENAI_API_PROVIDER || providerID === OPENAI_OAUTH_PROVIDER
        ? fastModelPairs(allModels, unavailableModels).get(selectedModel)?.standard.id
        : undefined;
    const standardModel =
      standard && !hiddenModels.has(`${providerID}/${standard}`) && provider?.models[standard];
    const model = standardModel && isTextPredictionModel(standardModel) ? standardModel : selected;
    return [providerID, model.id];
  }, [
    allModels,
    hiddenModels,
    modelSelectionMessage,
    providers,
    selectedModel,
    unavailableModels,
    useChatModel,
  ]);
  const modelID = useChatModel ? chatModel : freeModelID;
  const turnScope =
    sessionID && context?.status === "ready"
      ? JSON.stringify([sessionID, context.turnID, context.text])
      : null;
  const nextScope = nextMessageEnabled ? turnScope : null;
  const [persisted, setPersisted] = useState<{
    scope: string;
    key: string | null;
    suggestion: string | null;
  } | null>(null);
  useEffect(() => {
    if (!nextScope || paused) return;
    let stale = false;
    void composerNextMessageKey(nextScope).then((key) => {
      if (stale) return;
      setPersisted({
        scope: nextScope,
        key,
        suggestion: (key && savedSuggestions.get(key)) || null,
      });
    });
    return () => {
      stale = true;
    };
  }, [nextScope, paused]);

  const stored = nextScope && persisted?.scope === nextScope ? persisted : null;
  const nextReading = !!nextScope && !stored;
  const nextKey = nextScope ? `next\n${nextScope}` : null;
  const draftKey =
    sessionID && freeModelID
      ? JSON.stringify(["draft", sessionID, freeModelID, turnScope, context?.status])
      : null;
  const blockedReason =
    !nextMessageEnabled && !autocompleteEnabled
      ? "Composer suggestions are off"
      : (paused ??
        (context?.status === "pending"
          ? "Waiting for the queued message"
          : context?.status === "streaming"
            ? "Waiting for the reply to finish"
            : null));
  const eligible =
    !blockedReason &&
    !!candidate &&
    (blank ? nextMessageEnabled && !!nextKey : autocompleteEnabled);
  const cached = useMemo(() => {
    if (!eligible || !candidate) return null;
    const next = (nextKey ? composerPredictionCache.get(nextKey, "") : null) ?? stored?.suggestion;
    const continuation = next?.startsWith(candidate.draft)
      ? next.slice(candidate.draft.length)
      : "";
    if (continuation.trim()) return continuation;
    return !blank && draftKey ? composerPredictionCache.get(draftKey, candidate.draft) : null;
  }, [blank, candidate, draftKey, eligible, nextKey, stored]);
  const draftEligible = !!candidate && !blank && canPredictDraft(candidate.draft);
  const key = blank ? nextKey : draftKey;
  const promptContext = blank && context?.status === "ready" ? context.text : undefined;
  const request = useMemo(
    () =>
      eligible &&
      !cached &&
      !nextReading &&
      ready &&
      client &&
      modelID &&
      candidate &&
      key &&
      (promptContext || draftEligible)
        ? { candidate, client, modelID, key, promptContext, storageKey: stored?.key, chatProvider }
        : null,
    [
      cached,
      candidate,
      chatProvider,
      client,
      draftEligible,
      eligible,
      key,
      modelID,
      nextReading,
      promptContext,
      ready,
      stored?.key,
    ],
  );
  const [result, setResult] = useState<{
    request: NonNullable<typeof request>;
    suffix?: string;
    status: string;
  } | null>(null);

  useLayoutEffect(() => {
    if (!request) return;
    const { candidate, chatProvider, client, modelID, key, promptContext, storageKey } = request;
    const abort = new AbortController();
    let timeout: number | undefined;
    const timer = window.setTimeout(async () => {
      // Don't start another potentially billable generation for this turn on a remount.
      const recent = storageKey ? savedSuggestions.get(storageKey) : undefined;
      if (recent) {
        setResult({
          request,
          suffix: recent,
          status: "Reusing a saved suggestion",
        });
        return;
      }
      if (chatProvider && !storageKey) {
        setResult({ request, status: requestStatuses["storage-unavailable"] });
        return;
      }
      if (chatProvider && recent === null) {
        setResult({ request, status: requestStatuses.attempted });
        return;
      }
      let lastStatus: ComposerPredictionRequestStatus = "requesting";
      const startTimeout = (duration: number, status: string) => {
        window.clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          abort.abort();
          setResult({ request, status });
        }, duration);
      };
      const updateStatus = (status: ComposerPredictionRequestStatus) => {
        if (abort.signal.aborted) return;
        lastStatus = status;
        setResult({ request, status: requestStatuses[status] });
        if (status === "generating") {
          const freeNextMessage = promptContext && !chatProvider;
          startTimeout(
            freeNextMessage ? FREE_NEXT_MESSAGE_TIMEOUT_MS : PREDICTION_TIMEOUT_MS,
            freeNextMessage
              ? "The free model timed out generating a suggestion"
              : requestStatuses.timeout,
          );
        }
      };
      updateStatus("requesting");
      startTimeout(PREDICTION_TIMEOUT_MS, "Timed out preparing the prediction");
      try {
        const suffix = await client.composer.predict(
          {
            draft: candidate.draft,
            modelID,
            ...(promptContext && { context: promptContext }),
            ...(chatProvider && { chatProviderID: chatProvider }),
          },
          {
            signal: abort.signal,
            onStatus: updateStatus,
            ...(chatProvider &&
              storageKey && {
                beforeGenerate: () => {
                  if (abort.signal.aborted || savedSuggestions.get(storageKey) !== undefined) {
                    return "attempted";
                  }
                  return savedSuggestions.set(storageKey, null) ? undefined : "storage-unavailable";
                },
              }),
          },
        );
        if (abort.signal.aborted) return;
        if (suffix) {
          composerPredictionCache.set(key, candidate.draft, suffix);
          if (promptContext && storageKey) savedSuggestions.set(storageKey, suffix);
          setResult({ request, suffix, status: "Suggestion ready" });
        } else if (
          lastStatus === "requesting" ||
          lastStatus === "waiting" ||
          lastStatus === "generating"
        ) {
          updateStatus("empty");
        }
      } catch {
        updateStatus("request-failed");
      } finally {
        window.clearTimeout(timeout);
      }
    }, COMPOSER_PREDICTION_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      abort.abort();
    };
  }, [request]);

  if (blockedReason) return { suffix: null, status: blockedReason };
  if (!candidate) return { suffix: null, status: idleReason };
  if (blank ? !nextMessageEnabled : !autocompleteEnabled) {
    return {
      suffix: null,
      status: blank ? "Next-message predictions are off" : "Autocomplete is off",
    };
  }
  if (cached) return { suffix: cached, status: "Reusing a saved suggestion" };
  if (request) {
    return result?.request === request ? result : { suffix: null, status: "Waiting for a pause" };
  }
  if (blank && !context) return { suffix: null, status: "Loading the chat transcript" };
  if (blank && !nextKey) return { suffix: null, status: "A completed reply is needed" };
  if (nextReading) return { suffix: null, status: "Looking for a saved suggestion" };
  if (!blank && !draftEligible) {
    return { suffix: null, status: "Continue typing a plain-text draft" };
  }
  if (!client || !ready) return { suffix: null, status: "Waiting for OpenCode to connect" };
  if (useChatModel && providers) {
    return { suffix: null, status: "Choose an available chat model that supports text" };
  }
  return {
    suffix: null,
    status: providers ? "No eligible free OpenCode Zen model" : "Loading available models",
  };
}
