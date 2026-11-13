import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SerializedEditorState } from "lexical";
import { Paperclip, Plus } from "lucide-react";
import {
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { EffortPicker } from "@/components/EffortPicker";
import GoalPill from "@/components/GoalPill";
import ModelStatusBadge from "@/components/ModelStatusBadge";
import PromptEditor, { type PromptEditorHandle } from "@/components/PromptEditor";
import { QueuedMessages } from "@/components/QueuedMessages";
import TodoPill, { hasOpenTodos } from "@/components/TodoPill";
import { MENU_TRIGGER, MenuChevron, MenuItem, MenuLabel, MenuSearch } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAbort } from "@/hooks/mutations/useAbort";
import { sendMessageMutationKey, useSendMessage } from "@/hooks/mutations/useSendMessage";
import { useComposerCommands } from "@/hooks/useComposerCommands";
import { useEligibleModels } from "@/hooks/useEligibleModels";
import { useAllModels } from "@/hooks/useProviders";
import { useSessionGoal } from "@/hooks/useSessionGoal";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import { useTodos } from "@/hooks/useTodos";
import {
  type ComposerDelivery,
  composerShortcutLabel,
  DEFAULT_COMPOSER_SHORTCUTS,
  getComposerDelivery,
} from "@/lib/composerDelivery";
import {
  type ComposerDraft,
  type DraftAttachment,
  EMPTY_COMPOSER_DRAFT,
  readComposerDraft,
  saveComposerDraft,
} from "@/lib/composerDrafts";
import { loadConfig } from "@/lib/config";
import {
  EXPLORER_WAIT_NOTICES,
  OBJECT_DRAG_CLASS_TYPE,
  OBJECT_DRAG_NAME_TYPE,
  OBJECT_DRAG_TYPE,
} from "@/lib/explorer";
import { compareCatalogModels, fastModelPairs } from "@/lib/modelChoice";
import { notify } from "@/lib/notifications";
import { OPENAI_API_PROVIDER, OPENAI_OAUTH_PROVIDER } from "@/lib/openAiProfiles";
import { needsStudio, parseSlashCommand } from "@/lib/promptSuggestions";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import {
  type AddComposerImage,
  COMPOSER_IMAGE_TYPES,
  MAX_COMPOSER_IMAGE_BYTES,
  MAX_COMPOSER_IMAGES,
} from "@/lib/toolImages";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useExplorerReference } from "@/providers/ExplorerReferenceProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";
import type { ModelInfo } from "@/types";

// ── Image attachment helpers ────────────────────────────────────────────

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ── Lightbox overlay ────────────────────────────────────────────────────

const LightboxOverlay = memo(function LightboxOverlay({
  urls,
  index,
  slideDir,
  animKey,
  onClose,
  onPrev,
  onNext,
}: {
  urls: string[];
  index: number;
  slideDir: "left" | "right" | null;
  animKey: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const hasMultiple = urls.length > 1;
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (hasMultiple && (e.key === "ArrowRight" || e.key === "ArrowDown")) onNext();
      if (hasMultiple && (e.key === "ArrowLeft" || e.key === "ArrowUp")) onPrev();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onPrev, onNext, hasMultiple]);

  const slideClass =
    slideDir === "left"
      ? "animate-lightbox-slide-left"
      : slideDir === "right"
        ? "animate-lightbox-slide-right"
        : "animate-lightbox-image";

  return (
    <div
      className="animate-lightbox-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {hasMultiple && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      <img
        key={animKey}
        src={urls[index]}
        alt={`Attachment ${index + 1} of ${urls.length}`}
        className={`max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl ${slideClass}`}
        onClick={(e) => e.stopPropagation()}
      />
      {hasMultiple && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-110 hover:bg-white/20"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      {hasMultiple && (
        <div className="animate-fade-in-up absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  );
});

// ── Send/Abort button ───────────────────────────────────────────────────

const SendButton = memo(function SendButton({
  text,
  hasAttachments,
  isBusy,
  isSending,
  blockedReason,
  onSend,
}: {
  text: string;
  hasAttachments: boolean;
  isBusy: boolean;
  isSending: boolean;
  /** Why sending is off, shown on the button. */
  blockedReason?: string | null;
  onSend: () => void;
}) {
  const abort = useAbort();
  return (
    <>
      {isBusy ? (
        <button
          type="button"
          onClick={() =>
            abort.mutate(undefined, {
              onError: (error) => {
                notify.error("Couldn't stop the session", {
                  description: error.message,
                });
              },
            })
          }
          disabled={abort.isPending}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Stop"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={onSend}
          disabled={(!text.trim() && !hasAttachments) || isSending}
          aria-disabled={!!blockedReason}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity disabled:opacity-30 aria-disabled:opacity-30"
          title={blockedReason ?? "Send"}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      )}
    </>
  );
});

/** What was in the message box when something else took over the screen, by chat. */
function mergeDrafts(failed: ComposerDraft, current: ComposerDraft): ComposerDraft {
  const failedIDs = new Set(failed.attachments.map(({ id }) => id));
  const attachments = [
    ...failed.attachments,
    ...current.attachments.filter(({ id }) => !failedIDs.has(id)),
  ];
  if (!current.text.trim() || (failed.editorState && failed.editorState === current.editorState)) {
    return { ...failed, attachments };
  }
  if (!failed.text.trim()) return { ...current, attachments };
  const failedRoot = failed.editorState?.root;
  const currentRoot = current.editorState?.root;
  return {
    text: `${failed.text}\n\n${current.text}`,
    attachments,
    editorState:
      failedRoot && currentRoot
        ? { root: { ...currentRoot, children: [...failedRoot.children, ...currentRoot.children] } }
        : undefined,
  };
}

function ChatInput({
  onOpenSettings,
  focusOnMount = false,
  attachImageRef,
  contextControl,
}: {
  onOpenSettings?: () => void;
  focusOnMount?: boolean;
  attachImageRef?: Ref<AddComposerImage>;
  contextControl?: ReactNode;
}) {
  const {
    pendingReference,
    consumeReference,
    referenceObject,
    objects,
    objectIndex,
    objectsLoading,
    objectsFailed,
    objectsWaiting,
    requestSync,
  } = useExplorerReference();
  const allModels = useAllModels();
  const eligibleModels = useEligibleModels({ includeUnavailable: true });
  const { activeSessionId, activeSessionIdRef } = useActiveSession();
  const isBusy = useIsBusy(activeSessionId);
  const { data: predictionsEnabled } = useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
    select: (config) => config.composerPredictions === true,
  });
  const {
    composerShortcuts = DEFAULT_COMPOSER_SHORTCUTS,
    selectedModel,
    selectedVariant,
    modelSelectionMessage,
    modelCatalogOrder,
    effortControl,
    hideFreeModels,
    savingModelSettings,
    unavailableModels,
    setHideFreeModels,
    setSelectedModel,
    setSelectedVariant,
    setModelCatalogOrder,
  } = usePreferences();
  const fastPairs = useMemo(
    () => fastModelPairs(eligibleModels, unavailableModels),
    [eligibleModels, unavailableModels],
  );
  const fastPair = selectedModel ? fastPairs.get(selectedModel) : undefined;
  const fastEnabled =
    fastPair && selectedModel === `${fastPair.fast.providerId}/${fastPair.fast.id}`;
  const displayModelKey = fastPair
    ? `${fastPair.standard.providerId}/${fastPair.standard.id}`
    : selectedModel;
  const studioTarget = useStudioTargetOptional();
  const studioTargetReference = studioTarget?.promptReference ?? null;
  const studioId = studioTarget?.selected?.key ?? null;
  const sendBlock = studioTarget?.sendBlock ?? null;
  const goal = useSessionGoal();
  const todos = useTodos();
  const showTodos = isBusy && hasOpenTodos(todos);
  const { commands, run: runCommand } = useComposerCommands({
    chooseModel: () => setShowModelPicker(true),
    openSettings: () => onOpenSettings?.(),
    restoreDraft: (draft, sessionID) => {
      if (activeSessionIdRef.current === sessionID) promptEditorRef.current?.insertText(draft);
    },
  });
  // Replies link to these objects, and a turn can add some, so stay current without the Explorer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different Studio needs reading too
  useEffect(() => {
    if (!isBusy) requestSync();
  }, [isBusy, requestSync, studioId]);

  // Available variants for the currently selected model
  const availableVariants = useMemo(() => {
    if (!selectedModel) return [];
    const [providerId, modelId] = splitModelKey(selectedModel);
    const model = allModels.find((m) => m.providerId === providerId && m.id === modelId);
    return model?.variants ? Object.keys(model.variants) : [];
  }, [selectedModel, allModels]);

  const [draft, setDraft] = useState(EMPTY_COMPOSER_DRAFT);
  const { text, attachments } = draft;
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingObject, setIsDraggingObject] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lbSlideDir, setLbSlideDir] = useState<"left" | "right" | null>(null);
  const [lbAnimKey, setLbAnimKey] = useState(0);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [rejectShake, setRejectShake] = useState(false);
  const promptEditorRef = useRef<PromptEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const editorSessionRef = useRef<string | null>(null);
  const sendMessage = useSendMessage();
  const queryClient = useQueryClient();
  const sendFilter = { mutationKey: sendMessageMutationKey(activeSessionId), exact: true };
  const isSending = useIsMutating(sendFilter) > 0;

  const draftRef = useRef(EMPTY_COMPOSER_DRAFT);
  const restoringRef = useRef(false);
  const replaceDraft = useCallback((next: ComposerDraft) => {
    draftRef.current = next;
    setDraft(next);
    if (editorSessionRef.current) saveComposerDraft(editorSessionRef.current, next);
  }, []);
  const handleEditorChange = useCallback(
    (nextText: string, state: SerializedEditorState) => {
      if (restoringRef.current) return;
      replaceDraft({ ...draftRef.current, text: nextText, editorState: state });
    },
    [replaceDraft],
  );
  const restoreDraft = useCallback((next: ComposerDraft) => {
    // Restoring can synchronously emit a Lexical change while switching sessions.
    restoringRef.current = true;
    const editor = promptEditorRef.current;
    try {
      if (next.editorState) editor?.restore(next.editorState);
      else {
        editor?.clear();
        if (next.text) editor?.insertText(next.text);
      }
    } catch (error) {
      console.error("[chat-input] couldn't restore a draft", error);
      editor?.clear();
      if (next.text) editor?.insertText(next.text);
    } finally {
      restoringRef.current = false;
    }
    draftRef.current = next;
    setDraft(next);
  }, []);
  useImperativeHandle(
    attachImageRef,
    () => (image) => {
      const current = draftRef.current;
      if (current.attachments.length >= MAX_COMPOSER_IMAGES) {
        notify.error(`Maximum ${MAX_COMPOSER_IMAGES} images allowed`);
        return false;
      }
      const attachment = { ...image, id: crypto.randomUUID() };
      replaceDraft({ ...current, attachments: [...current.attachments, attachment] });
      requestAnimationFrame(() => promptEditorRef.current?.focus());
      return true;
    },
    [replaceDraft],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: honor only the mount-time focus request
  useEffect(() => {
    if (focusOnMount) requestAnimationFrame(() => promptEditorRef.current?.focus());
  }, []);

  useEffect(() => {
    editorSessionRef.current = activeSessionId;
    restoreDraft(activeSessionId ? readComposerDraft(activeSessionId) : EMPTY_COMPOSER_DRAFT);
  }, [activeSessionId, restoreDraft]);

  useEffect(() => {
    if (!pendingReference) return;
    promptEditorRef.current?.insertObject(pendingReference);
    consumeReference();
    requestAnimationFrame(() => promptEditorRef.current?.focus());
  }, [pendingReference, consumeReference]);

  const triggerRejectShake = useCallback(() => {
    setRejectShake(true);
    clearTimeout(rejectTimerRef.current);
    rejectTimerRef.current = setTimeout(() => setRejectShake(false), 600);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(rejectTimerRef.current);
    };
  }, []);

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const sessionId = editorSessionRef.current;
      if (!sessionId) return;
      const toAdd: File[] = [];
      for (const file of Array.from(files)) {
        if (!COMPOSER_IMAGE_TYPES.includes(file.type)) {
          notify.error("That file isn't an image. Try a PNG, JPEG, GIF, or WebP instead.");
          triggerRejectShake();
          continue;
        }
        if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
          notify.error("That image is too large. Please use one under 20 MB.");
          triggerRejectShake();
          continue;
        }
        toAdd.push(file);
      }
      if (toAdd.length === 0) return;
      const results = await Promise.allSettled(
        toAdd.map(async (file) => {
          const dataUrl = await fileToDataURL(file);
          return { dataUrl, mime: file.type, filename: file.name };
        }),
      );
      const succeeded: DraftAttachment[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          succeeded.push({ ...r.value, id: crypto.randomUUID() });
        } else {
          notify.error("Failed to read an image file");
          triggerRejectShake();
        }
      }
      if (succeeded.length === 0) return;
      const stillOpen = editorSessionRef.current === sessionId && promptEditorRef.current;
      const current = stillOpen ? draftRef.current : readComposerDraft(sessionId);
      const remaining = MAX_COMPOSER_IMAGES - current.attachments.length;
      if (remaining <= 0) {
        notify.error(`Maximum ${MAX_COMPOSER_IMAGES} images allowed`);
        triggerRejectShake();
        return;
      }
      if (succeeded.length > remaining) {
        notify.error(`Only ${remaining} more image(s) allowed`);
        triggerRejectShake();
      }
      const next = {
        ...current,
        attachments: [...current.attachments, ...succeeded.slice(0, remaining)],
      };
      if (stillOpen) replaceDraft(next);
      else saveComposerDraft(sessionId, next);
    },
    [replaceDraft, triggerRejectShake],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const current = draftRef.current;
      replaceDraft({ ...current, attachments: current.attachments.filter((a) => a.id !== id) });
    },
    [replaceDraft],
  );
  const lightboxUrls = useMemo(() => attachments.map((a) => a.dataUrl), [attachments]);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const lightboxPrev = useCallback(() => {
    setLbSlideDir("right");
    setLbAnimKey((k) => k + 1);
    setLightboxIndex((i) =>
      i !== null ? (i - 1 + attachments.length) % attachments.length : null,
    );
  }, [attachments.length]);
  const lightboxNext = useCallback(() => {
    setLbSlideDir("left");
    setLbAnimKey((k) => k + 1);
    setLightboxIndex((i) => (i !== null ? (i + 1) % attachments.length : null));
  }, [attachments.length]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
      setIsDraggingObject(e.dataTransfer.types.includes(OBJECT_DRAG_TYPE));
    }
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const path = e.dataTransfer.getData(OBJECT_DRAG_TYPE);
      // The panel can be ahead of this list while a big place loads, and the path is what counts.
      if (path)
        referenceObject(
          objectIndex.get(path) ?? {
            name: e.dataTransfer.getData(OBJECT_DRAG_NAME_TYPE),
            path,
            className: e.dataTransfer.getData(OBJECT_DRAG_CLASS_TYPE),
          },
        );
      else if (e.dataTransfer.files.length > 0) addImageFiles(e.dataTransfer.files);
    },
    [addImageFiles, objectIndex, referenceObject],
  );

  const modelsByProvider = useMemo(() => {
    const POPULAR = [
      "opencode",
      "anthropic",
      "github-copilot",
      OPENAI_OAUTH_PROVIDER,
      OPENAI_API_PROVIDER,
      "google",
      "openrouter",
      "vercel",
    ];
    const query = modelSearch.toLowerCase().trim();
    const groups: Record<string, { providerName: string; models: ModelInfo[] }> = {};
    for (const model of eligibleModels) {
      const pair = fastPairs.get(`${model.providerId}/${model.id}`);
      if (pair?.fast === model) continue;
      if (query) {
        const haystack =
          `${model.name} ${model.id} ${model.providerName} ${model.billingLabel ?? ""} ${pair?.fast.name ?? ""} ${pair?.fast.id ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      if (!groups[model.providerId])
        groups[model.providerId] = { providerName: model.providerName, models: [] };
      groups[model.providerId].models.push(model);
    }
    for (const group of Object.values(groups))
      group.models.sort((a, b) => compareCatalogModels(a, b, modelCatalogOrder));
    // Sort provider groups: popular first, then alphabetical
    const entries = Object.entries(groups);
    entries.sort(([aId], [bId]) => {
      const aIdx = POPULAR.indexOf(aId);
      const bIdx = POPULAR.indexOf(bId);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return groups[aId].providerName.localeCompare(groups[bId].providerName);
    });
    return entries;
  }, [eligibleModels, fastPairs, modelCatalogOrder, modelSearch]);

  const paidModelRequired = hideFreeModels && !selectedModel;
  const paidModelMessage = "Connect a paid provider or turn off Hide free models.";
  const modelSendBlock = modelSelectionMessage ?? (paidModelRequired ? paidModelMessage : null);

  function handleSubmit(delivery?: ComposerDelivery) {
    if (!activeSessionId || activeSessionIdRef.current !== activeSessionId) return;
    if (editorSessionRef.current !== activeSessionId) return;
    const editorText = promptEditorRef.current?.getText() ?? text;
    const trimmed = editorText.trim();
    if (!trimmed && attachments.length === 0) return;
    if (sendBlock && needsStudio(trimmed)) {
      if (studioTarget?.status === "loading") notify.message(sendBlock);
      else notify.error(sendBlock);
      return;
    }
    const submittedDraft = { ...draftRef.current, text: editorText };
    function restoreFailedDraft(sessionId: string) {
      const stillOpen =
        activeSessionIdRef.current === sessionId && editorSessionRef.current === sessionId
          ? promptEditorRef.current
          : null;
      const current = stillOpen
        ? { ...draftRef.current, text: stillOpen.getText() }
        : readComposerDraft(sessionId);
      const restored = mergeDrafts(submittedDraft, current);
      saveComposerDraft(sessionId, restored);
      if (stillOpen) restoreDraft(restored);
    }
    const images =
      attachments.length > 0
        ? attachments.map((a) => ({ mime: a.mime, url: a.dataUrl, filename: a.filename }))
        : undefined;
    const ranCommand = runCommand(trimmed, {
      images,
      system: studioTargetReference,
      onFailed: (error) => {
        notify.error("Command failed", { description: error.message });
        restoreFailedDraft(activeSessionId);
      },
    });
    if (ranCommand) {
      replaceDraft(EMPTY_COMPOSER_DRAFT);
      promptEditorRef.current?.clear();
      return;
    }
    // A second request must wait for the first one's model, routing and prompt to reach OpenCode.
    if ((isBusy && !delivery) || queryClient.isMutating(sendFilter) > 0) return;
    if (!delivery && modelSendBlock) {
      notify.error(modelSendBlock);
      return;
    }
    if (!delivery && needsStudio(trimmed)) studioTarget?.noteRouted?.();
    replaceDraft(EMPTY_COMPOSER_DRAFT);
    promptEditorRef.current?.clear();
    void sendMessage
      .mutateAsync({
        text: trimmed || " ",
        images,
        studioTargetReference,
        studioTargetID: studioTarget ? studioId : undefined,
        delivery,
      })
      .catch((error: Error) => {
        if (activeSessionIdRef.current === activeSessionId) {
          notify.error("Message not sent", { description: error.message });
        }
        restoreFailedDraft(activeSessionId);
      });
  }

  function handleEnter(event: KeyboardEvent) {
    const delivery = isBusy ? getComposerDelivery(event, composerShortcuts) : undefined;
    const normalEnter = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (isBusy ? !delivery && !normalEnter : event.shiftKey) return false;
    if (isBusy && !delivery) {
      const command = parseSlashCommand((promptEditorRef.current?.getText() ?? text).trim());
      if (!command || !commands.some(({ name }) => name === command.name)) return false;
    }
    if (!event.repeat) handleSubmit(delivery);
    return true;
  }

  function handleModelClick(model: ModelInfo) {
    const fullId = `${model.providerId}/${model.id}`;
    if (!fastEnabled || fullId !== displayModelKey) setSelectedModel(fullId);
    setShowModelPicker(false);
    setModelSearch("");
  }

  const [selectedProviderId, selectedModelId] = selectedModel
    ? splitModelKey(selectedModel)
    : [undefined, undefined];
  const selected = allModels.find(
    (model) => model.providerId === selectedProviderId && model.id === selectedModelId,
  );
  const modelDisplay =
    fastPair?.standard.name ?? selected?.name ?? selectedModelId ?? "Select model";

  function renderProviderGroup(
    providerId: string,
    group: { providerName: string; models: ModelInfo[] },
  ) {
    return (
      <div key={providerId}>
        <MenuLabel>{group.providerName}</MenuLabel>
        {group.models.map((model) => {
          const fullId = `${model.providerId}/${model.id}`;
          const refused = unavailableModels.has(fullId);
          return (
            <MenuItem
              key={fullId}
              checked={displayModelKey === fullId}
              disabled={refused}
              description={refused ? "Not offered in your region" : undefined}
              className={refused ? "opacity-60" : undefined}
              onClick={() => handleModelClick(model)}
            >
              <span className="truncate">{model.name}</span>
              {model.billingLabel?.endsWith("Ultrafast") && (
                <span className="shrink-0 text-xs text-muted-foreground">Ultrafast</span>
              )}
              <ModelStatusBadge status={model.status} />
            </MenuItem>
          );
        })}
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 pb-3 pt-1">
      <div className="mx-auto max-w-2xl">
        {goal || showTodos ? (
          <div className="mb-1 flex min-w-0 items-center gap-1">
            {goal ? (
              <GoalPill
                goal={goal}
                onCommand={(command) => {
                  if (sendBlock && needsStudio(`/goal ${command}`)) {
                    notify.error(sendBlock);
                    return false;
                  }
                  return runCommand(`/goal ${command}`, {
                    system: studioTargetReference,
                    onFailed: (error) =>
                      notify.error("Command failed", { description: error.message }),
                  });
                }}
              />
            ) : null}
            {showTodos ? <TodoPill todos={todos} /> : null}
          </div>
        ) : null}
        <QueuedMessages sessionID={activeSessionId} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addImageFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          data-composer=""
          className={`relative rounded-xl border bg-card transition-colors focus-within:border-foreground/20 ${isDragging ? "border-brand/60 bg-brand/5 ring-2 ring-brand" : ""}`}
        >
          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1">
              {attachments.map((a, idx) => (
                <div key={a.id} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setLightboxIndex(idx);
                      setLbSlideDir(null);
                      setLbAnimKey((k) => k + 1);
                    }}
                    className="block cursor-zoom-in overflow-hidden rounded-lg border transition-opacity hover:opacity-80"
                  >
                    <img src={a.dataUrl} alt={a.filename} className="h-16 w-16 object-cover" />
                  </button>
                  <button
                    onClick={() => removeAttachment(a.id)}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
                    title="Remove"
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                  <div className="mt-0.5 max-w-[64px] truncate text-center text-xs text-muted-foreground">
                    {a.filename}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex min-h-10 items-start px-2 pt-1.5">
            <PromptEditor
              ref={promptEditorRef}
              commands={commands}
              objects={objects}
              objectsLoading={objectsLoading}
              objectsUnavailable={
                !studioId
                  ? (studioTarget?.targets.length ?? 0) > 0
                    ? "Choose a Studio to reference its objects."
                    : "Open a place in Studio to reference its objects."
                  : objectsWaiting
                    ? EXPLORER_WAIT_NOTICES[objectsWaiting]
                    : objectsFailed
                      ? "Couldn't read this place in Studio. Type @ again to retry."
                      : null
              }
              onObjectsWanted={requestSync}
              noStudio={!studioId}
              predictionScope={
                predictionsEnabled && !isBusy && !isSending && attachments.length === 0
                  ? activeSessionId
                  : null
              }
              onChange={handleEditorChange}
              onSubmit={handleSubmit}
              onEnter={handleEnter}
              onPaste={(e) => {
                const items = e.clipboardData.items;
                const imageFiles: File[] = [];
                for (const item of Array.from(items)) {
                  if (item.kind === "file" && COMPOSER_IMAGE_TYPES.includes(item.type)) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                  }
                }
                if (imageFiles.length > 0) {
                  e.preventDefault();
                  addImageFiles(imageFiles);
                }
              }}
              placeholder={
                isDragging
                  ? isDraggingObject
                    ? "Drop to reference this object..."
                    : "Drop images here..."
                  : "Describe what you want to build..."
              }
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="relative flex min-w-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${rejectShake ? "animate-reject-shake text-destructive" : ""}`}
                title="Attach images"
              >
                <Paperclip aria-hidden="true" size={14} />
              </button>

              <Popover
                open={showModelPicker}
                onOpenChange={(open) => {
                  setShowModelPicker(open);
                  if (!open) setModelSearch("");
                }}
              >
                <PopoverTrigger asChild>
                  <button type="button" className={MENU_TRIGGER}>
                    <span className="truncate">{modelDisplay}</span>
                    {selected?.billingLabel && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {selected.billingLabel}
                      </span>
                    )}
                    <MenuChevron />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="flex max-h-80 w-80 flex-col p-0!"
                >
                  <MenuSearch
                    inputRef={modelSearchRef}
                    value={modelSearch}
                    onChange={setModelSearch}
                    placeholder="Search models..."
                  />
                  <label className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs">
                    Hide free models
                    <input
                      type="checkbox"
                      checked={hideFreeModels}
                      disabled={savingModelSettings}
                      onChange={(event) => setHideFreeModels(event.target.checked)}
                    />
                  </label>
                  <label className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs">
                    Model order
                    <select
                      value={modelCatalogOrder}
                      onChange={(event) =>
                        setModelCatalogOrder(event.target.value === "newest" ? "newest" : "name")
                      }
                      className="rounded-md border bg-background px-2 py-1"
                    >
                      <option value="name">Name (A–Z)</option>
                      <option value="newest">Newest first</option>
                    </select>
                  </label>
                  <div className="min-h-0 flex-1 overflow-y-auto p-1">
                    {modelsByProvider.map(([id, group]) => renderProviderGroup(id, group))}
                    {modelsByProvider.length === 0 && (
                      <MenuLabel className="text-center">
                        {modelSearch
                          ? `No models matching "${modelSearch}"`
                          : hideFreeModels
                            ? "No paid models connected"
                            : "No models yet"}
                      </MenuLabel>
                    )}
                  </div>
                  {onOpenSettings ? (
                    <div className="shrink-0 border-t p-1">
                      <MenuItem
                        role="button"
                        onClick={() => {
                          setShowModelPicker(false);
                          setModelSearch("");
                          onOpenSettings();
                        }}
                      >
                        <Plus aria-hidden="true" size={14} className="shrink-0" />
                        Add providers and models
                      </MenuItem>
                    </div>
                  ) : null}
                </PopoverContent>
              </Popover>

              <EffortPicker
                variants={availableVariants}
                value={selectedVariant}
                control={effortControl}
                onChange={setSelectedVariant}
                fast={
                  fastPair && {
                    enabled: Boolean(fastEnabled),
                    onToggle: () => {
                      const next = fastEnabled ? fastPair.standard : fastPair.fast;
                      const variant =
                        selectedVariant &&
                        Object.keys(next.variants ?? {}).includes(selectedVariant)
                          ? selectedVariant
                          : null;
                      setSelectedModel(`${next.providerId}/${next.id}`, variant);
                    },
                  }
                }
              />
              {contextControl}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isBusy &&
                (["steer", "queue"] as const).map((delivery) => {
                  const label = delivery === "steer" ? "Steer" : "Queue";
                  const action =
                    delivery === "steer"
                      ? "Steer at the next step"
                      : "Queue after the current turn";
                  const shortcut = composerShortcuts[delivery];
                  return (
                    <button
                      key={delivery}
                      type="button"
                      title={
                        shortcut === "disabled"
                          ? action
                          : `${action} (${composerShortcutLabel(shortcut)})`
                      }
                      className="h-7 rounded-md px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
                      disabled={(!text.trim() && attachments.length === 0) || isSending}
                      onClick={() => handleSubmit(delivery)}
                    >
                      {label}
                    </button>
                  );
                })}
              <SendButton
                text={text}
                hasAttachments={attachments.length > 0}
                isBusy={isBusy}
                isSending={isSending}
                blockedReason={modelSendBlock ?? (needsStudio(text.trim()) ? sendBlock : null)}
                onSend={() => handleSubmit()}
              />
            </div>
          </div>
        </div>
      </div>

      {lightboxIndex !== null && attachments[lightboxIndex] && (
        <LightboxOverlay
          urls={lightboxUrls}
          index={lightboxIndex}
          slideDir={lbSlideDir}
          animKey={lbAnimKey}
          onClose={closeLightbox}
          onPrev={lightboxPrev}
          onNext={lightboxNext}
        />
      )}
    </div>
  );
}

export default ChatInput;
