import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SerializedEditorState } from "lexical";
import { Check, Film, History, Loader2, Paperclip, Plus, TriangleAlert } from "lucide-react";
import { ContextMenu } from "radix-ui";
import {
  memo,
  type ReactElement,
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
import { ImageContextMenu } from "@/components/ImageLightbox";
import ModelStatusBadge from "@/components/ModelStatusBadge";
import PromptEditor, { type PromptEditorHandle } from "@/components/PromptEditor";
import { QueuedMessages } from "@/components/QueuedMessages";
import TodoPill, { hasOpenTodos } from "@/components/TodoPill";
import {
  MENU_SURFACE,
  MENU_TRIGGER,
  MenuChevron,
  MenuItem,
  MenuLabel,
  MenuSearch,
} from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VideoPlayer } from "@/components/VideoPlayer";
import { useAbort } from "@/hooks/mutations/useAbort";
import { sendMessageMutationKey, useSendMessage } from "@/hooks/mutations/useSendMessage";
import { COMPACT_MUTATION_KEY } from "@/hooks/useChatContext";
import { useComposerCommands } from "@/hooks/useComposerCommands";
import { useEligibleModels } from "@/hooks/useEligibleModels";
import { useTranscript } from "@/hooks/useMessages";
import { useAllModels, useProviderList } from "@/hooks/useProviders";
import { useSessionGoal } from "@/hooks/useSessionGoal";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import { useTodos } from "@/hooks/useTodos";
import {
  type ComposerDelivery,
  type ComposerShortcuts,
  composerShortcutLabel,
  DEFAULT_COMPOSER_SHORTCUTS,
  getComposerDelivery,
  isPendingInboxMessage,
} from "@/lib/composerDelivery";
import {
  type ComposerDraft,
  type DraftAttachment,
  EMPTY_COMPOSER_DRAFT,
  onComposerText,
  readComposerDraft,
  saveComposerDraft,
} from "@/lib/composerDrafts";
import { composerPredictionContext } from "@/lib/composerPredictions";
import {
  attachmentsToSend,
  formatVideoLength,
  isVideoFile,
  localVideoUrl,
  MAX_COMPOSER_VIDEO_BYTES,
  MAX_COMPOSER_VIDEOS,
  readVideoFrames,
  videoPoster,
} from "@/lib/composerVideos";
import { loadConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import {
  EXPLORER_WAIT_NOTICES,
  OBJECT_DRAG_CLASS_TYPE,
  OBJECT_DRAG_NAME_TYPE,
  OBJECT_DRAG_TYPE,
} from "@/lib/explorer";
import { compareCatalogModels, fastModelPairs, listedModel } from "@/lib/modelChoice";
import { notify } from "@/lib/notifications";
import { OPENAI_API_PROVIDER, OPENAI_OAUTH_PROVIDER, toAppProviderID } from "@/lib/openAiProfiles";
import { needsStudio, parseSlashCommand } from "@/lib/promptSuggestions";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type { MessagesCache } from "@/lib/sseDispatch";
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

/** One thing the composer's viewer shows: a picture, or a video that plays from its file. */
interface LightboxItem {
  url: string;
  video?: { src: string; name: string };
}

const LightboxOverlay = memo(function LightboxOverlay({
  items,
  index,
  slideDir,
  animKey,
  onClose,
  onPrev,
  onNext,
}: {
  items: readonly LightboxItem[];
  index: number;
  slideDir: "left" | "right" | null;
  animKey: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const hasMultiple = items.length > 1;
  const item = items[index];
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
      {item.video ? (
        // Clicks on the player stay in it. Escape closes, from the window.
        <div
          key={animKey}
          className={`w-[min(90vw,64rem)] shadow-2xl ${slideClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          <VideoPlayer
            src={item.video.src}
            name={item.video.name}
            poster={item.url}
            autoPlay
            videoClassName="max-h-[78vh]"
          />
        </div>
      ) : (
        <img
          key={animKey}
          src={item.url}
          alt={`Attachment ${index + 1} of ${items.length}`}
          className={`max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl ${slideClass}`}
          onClick={(e) => e.stopPropagation()}
        />
      )}
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
          {index + 1} / {items.length}
        </div>
      )}
    </div>
  );
});

/** Right-click an attachment that hasn't been sent yet: a picture copies or saves, a video saves. */
function AttachmentMenu({
  attachment,
  children,
}: {
  attachment: DraftAttachment;
  children: ReactElement;
}) {
  const path = attachment.video?.path;
  if (!attachment.video) {
    return (
      <ImageContextMenu
        image={{ id: attachment.id, src: attachment.dataUrl, name: attachment.filename }}
      >
        {children}
      </ImageContextMenu>
    );
  }
  if (!path) return children;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={8} className={`z-[120] min-w-40 ${MENU_SURFACE}`}>
          <ContextMenu.Item
            className="flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            onSelect={() =>
              desktop.saveVideo(localVideoUrl(path)).then(
                (saved) => saved && notify.success("Video saved"),
                () => notify.error("Couldn't save the video. Its file may have moved."),
              )
            }
          >
            <Film size={14} aria-hidden /> Save Video As…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const tokenCount = new Intl.NumberFormat(undefined, { notation: "compact" });

/** The model that wrote this chat's latest reply, as "provider/model". */
function lastModelUsed({ messageIds, messagesById }: MessagesCache): string | null {
  for (let index = messageIds.length - 1; index >= 0; index -= 1) {
    const info = messagesById[messageIds[index]]?.info;
    if (info?.role === "assistant" && info.providerID && info.modelID) {
      return `${toAppProviderID(info.providerID)}/${info.modelID}`;
    }
  }
  return null;
}

/** Whether the chat's latest step is a compaction still under way. Queued messages sit after it. */
function compactionRunning({ messageIds, messagesById }: MessagesCache): boolean {
  for (let index = messageIds.length - 1; index >= 0; index -= 1) {
    const message = messagesById[messageIds[index]];
    if (!message || isPendingInboxMessage(message.info)) continue;
    return message.parts.some((part) => part.type === "compaction" && part.status === "running");
  }
  return false;
}

// ── Send/Abort button ───────────────────────────────────────────────────

const SEND_BUTTON =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity disabled:opacity-30 aria-disabled:opacity-30";

function SendArrow() {
  return (
    <svg
      aria-hidden="true"
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
  );
}

function StopSquare() {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

const QUEUE_ONLY = ["queue"] as const;
const STEER_OR_QUEUE = ["steer", "queue"] as const;

const DELIVERY_ACTIONS = {
  steer: { label: "Steer", when: "At the next step", action: "Steer at the next step" },
  queue: { label: "Queue", when: "After the current turn", action: "Queue after the current turn" },
} as const;

/**
 * While a turn runs, the arrow sends what's written into it: clicking does what Enter does, and
 * pointing at it or focusing it lists both ways to deliver with their shortcuts. Stop is in the
 * list too, because the arrow has taken its place.
 */
function DeliveryButton({
  shortcuts,
  isSending,
  stopping,
  queueOnly,
  onDeliver,
  onStop,
}: {
  shortcuts: ComposerShortcuts;
  isSending: boolean;
  stopping: boolean;
  /** A compaction has no next step to steer into, so a message can only wait for it. */
  queueOnly: boolean;
  onDeliver: (delivery: ComposerDelivery) => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const primary: ComposerDelivery =
    queueOnly || (shortcuts.queue === "enter" && shortcuts.steer !== "enter") ? "queue" : "steer";
  const shortcutLabel = (delivery: ComposerDelivery) =>
    shortcuts[delivery] === "disabled" ? null : composerShortcutLabel(shortcuts[delivery]);
  // Enter queues while compacting, whatever it is set to do in a turn.
  const primaryShortcut = queueOnly ? "Enter" : shortcutLabel(primary);
  const primaryAction = queueOnly
    ? "Queue until compacting is done"
    : DELIVERY_ACTIONS[primary].action;
  return (
    // The wrapper only follows the pointer and focus, to open and close its menu.
    <div
      className="relative flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {open && !isSending && (
        // The padding joins the menu to the button, so the pointer can cross to it.
        <div className="absolute bottom-full right-0 z-50 pb-1.5">
          <div role="menu" aria-label="Send while working" className={`${MENU_SURFACE} w-56`}>
            {(queueOnly ? QUEUE_ONLY : STEER_OR_QUEUE).map((delivery) => {
              const shortcut = queueOnly ? "Enter" : shortcutLabel(delivery);
              return (
                <MenuItem
                  key={delivery}
                  role="menuitem"
                  description={queueOnly ? "After compacting" : DELIVERY_ACTIONS[delivery].when}
                  trailing={
                    shortcut ? (
                      <kbd className="shrink-0 font-sans text-xs text-muted-foreground">
                        {shortcut}
                      </kbd>
                    ) : undefined
                  }
                  onClick={() => {
                    setOpen(false);
                    onDeliver(delivery);
                  }}
                >
                  {DELIVERY_ACTIONS[delivery].label}
                </MenuItem>
              );
            })}
            <div className="my-1 border-t" />
            <MenuItem role="menuitem" disabled={stopping} onClick={onStop}>
              <StopSquare />
              Stop
            </MenuItem>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open && !isSending}
        aria-label={primaryShortcut ? `${primaryAction} (${primaryShortcut})` : primaryAction}
        disabled={isSending}
        onClick={() => onDeliver(primary)}
        className={SEND_BUTTON}
      >
        <SendArrow />
      </button>
    </div>
  );
}

const SendButton = memo(function SendButton({
  text,
  hasAttachments,
  isBusy,
  isSending,
  blockedReason,
  shortcuts,
  queueOnly,
  onSend,
  onDeliver,
}: {
  queueOnly: boolean;
  text: string;
  hasAttachments: boolean;
  isBusy: boolean;
  isSending: boolean;
  /** Why sending is off, shown on the button. */
  blockedReason?: string | null;
  shortcuts: ComposerShortcuts;
  onSend: () => void;
  /** Sends what's written into the turn that is running. */
  onDeliver: (delivery: ComposerDelivery) => void;
}) {
  const abort = useAbort();
  const hasContent = Boolean(text.trim()) || hasAttachments;
  const stop = () =>
    abort.mutate(undefined, {
      onError: (error) => {
        notify.error("Couldn't stop the session", {
          description: error.message,
        });
      },
    });
  if (isBusy && hasContent) {
    return (
      <DeliveryButton
        shortcuts={shortcuts}
        isSending={isSending}
        stopping={abort.isPending}
        queueOnly={queueOnly}
        onDeliver={onDeliver}
        onStop={stop}
      />
    );
  }
  // With nothing written there is nothing to send into the turn, so the button stops it.
  if (isBusy) {
    return (
      <button
        type="button"
        onClick={stop}
        disabled={abort.isPending}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Stop"
      >
        <StopSquare />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={!hasContent || isSending}
      aria-disabled={!!blockedReason}
      className={SEND_BUTTON}
      title={blockedReason ?? "Send"}
    >
      <SendArrow />
    </button>
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
  const providerList = useProviderList();
  const eligibleModels = useEligibleModels({ includeUnavailable: true });
  const { activeSessionId, activeSessionIdRef } = useActiveSession();
  const compactRequests = useIsMutating({
    mutationKey: COMPACT_MUTATION_KEY,
    predicate: ({ state }) => state.variables === activeSessionId,
  });
  // A compaction asked for from the context panel is under way before the chat shows it.
  const compacting =
    compactRequests > 0 || (useTranscript(activeSessionId, compactionRunning) ?? false);
  const isBusy = useIsBusy(activeSessionId) || compacting;
  const { data: predictionsEnabled } = useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
    select: (config) => config.composerPredictions === true,
  });
  // Read only while the chat waits for a message, so a streaming reply doesn't redraw the composer.
  const predictionContext =
    useTranscript(
      predictionsEnabled && !isBusy ? activeSessionId : null,
      composerPredictionContext,
    ) ?? null;
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
  /** Videos still being turned into frames. They aren't in the draft until that's done. */
  const [readingVideos, setReadingVideos] = useState(0);
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

  useEffect(
    () =>
      onComposerText((sessionId, written) => {
        if (activeSessionIdRef.current !== sessionId || editorSessionRef.current !== sessionId) {
          return;
        }
        promptEditorRef.current?.insertText(written);
        requestAnimationFrame(() => promptEditorRef.current?.focus());
      }),
    [activeSessionIdRef],
  );

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

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const sessionId = editorSessionRef.current;
      if (!sessionId) return;
      const draftNow = () =>
        editorSessionRef.current === sessionId ? draftRef.current : readComposerDraft(sessionId);
      let videoSlots =
        MAX_COMPOSER_VIDEOS - draftNow().attachments.filter(({ video }) => video).length;
      const toAdd: File[] = [];
      for (const file of Array.from(files)) {
        const video = isVideoFile(file);
        if (!video && !COMPOSER_IMAGE_TYPES.includes(file.type)) {
          notify.error(
            "That file isn't an image or video. Try a PNG, JPEG, GIF, WebP, MP4, or WebM instead.",
          );
          triggerRejectShake();
          continue;
        }
        if (file.size > (video ? MAX_COMPOSER_VIDEO_BYTES : MAX_COMPOSER_IMAGE_BYTES)) {
          notify.error(
            video
              ? "That video is too large. Please use one under 1 GB."
              : "That image is too large. Please use one under 20 MB.",
          );
          triggerRejectShake();
          continue;
        }
        if (video && videoSlots <= 0) {
          notify.error(`Maximum ${MAX_COMPOSER_VIDEOS} videos per message`);
          triggerRejectShake();
          continue;
        }
        if (video) videoSlots -= 1;
        toAdd.push(file);
      }
      if (toAdd.length === 0) return;
      const videos = toAdd.filter(isVideoFile).length;
      setReadingVideos((count) => count + videos);
      const results = await Promise.allSettled(
        toAdd.map(async (file) => {
          if (!isVideoFile(file)) {
            const dataUrl = await fileToDataURL(file);
            return { dataUrl, mime: file.type, filename: file.name };
          }
          const frames = await readVideoFrames(file);
          const path = desktop.getFilePath(file);
          const video = path ? { ...frames, path } : frames;
          return {
            dataUrl: videoPoster(video),
            mime: file.type || "video/mp4",
            filename: file.name,
            video,
          };
        }),
      );
      setReadingVideos((count) => count - videos);
      const succeeded: DraftAttachment[] = [];
      for (const [index, r] of results.entries()) {
        if (r.status === "fulfilled") {
          succeeded.push({ ...r.value, id: crypto.randomUUID() });
        } else {
          notify.error(
            isVideoFile(toAdd[index])
              ? "Couldn't read that video. Try an MP4 or WebM."
              : "Failed to read an image file",
          );
          triggerRejectShake();
        }
      }
      if (succeeded.length === 0) return;
      const stillOpen = editorSessionRef.current === sessionId && promptEditorRef.current;
      const current = stillOpen ? draftRef.current : readComposerDraft(sessionId);
      const remaining = MAX_COMPOSER_IMAGES - current.attachments.length;
      if (remaining <= 0) {
        notify.error(`Maximum ${MAX_COMPOSER_IMAGES} attachments allowed`);
        triggerRejectShake();
        return;
      }
      if (succeeded.length > remaining) {
        notify.error(`Only ${remaining} more attachment(s) allowed`);
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
  // One viewer for every attachment. A video on disk plays in it. One without a file to play
  // opens on its first frame, with the rest of its frames after it.
  const lightbox = useMemo(() => {
    const items: LightboxItem[] = [];
    const starts = attachments.map((a) => {
      const start = items.length;
      if (a.video?.path) {
        items.push({
          url: a.dataUrl,
          video: { src: localVideoUrl(a.video.path), name: a.filename },
        });
      } else if (a.video) {
        items.push(...a.video.frames.map((frame) => ({ url: frame.dataUrl })));
      } else {
        items.push({ url: a.dataUrl });
      }
      return start;
    });
    return { items, starts };
  }, [attachments]);
  const lightboxCount = lightbox.items.length;
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const lightboxPrev = useCallback(() => {
    setLbSlideDir("right");
    setLbAnimKey((k) => k + 1);
    setLightboxIndex((i) => (i !== null ? (i - 1 + lightboxCount) % lightboxCount : null));
  }, [lightboxCount]);
  const lightboxNext = useCallback(() => {
    setLbSlideDir("left");
    setLbAnimKey((k) => k + 1);
    setLightboxIndex((i) => (i !== null ? (i + 1) % lightboxCount : null));
  }, [lightboxCount]);

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
      else if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles, objectIndex, referenceObject],
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

  function handleSubmit(requested?: ComposerDelivery) {
    // Nothing can be steered into a compaction, so whatever is sent waits for it to end.
    const delivery = compacting ? "queue" : requested;
    if (!activeSessionId || activeSessionIdRef.current !== activeSessionId) return;
    if (editorSessionRef.current !== activeSessionId) return;
    const editorText = promptEditorRef.current?.getText() ?? text;
    const trimmed = editorText.trim();
    // Sending now would leave the video behind, to turn up in the next draft.
    if (readingVideos > 0) {
      notify.message("Still reading the video. Send once it's attached.");
      return;
    }
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
    const sendable = attachmentsToSend(attachments);
    const images = sendable.images.length > 0 ? sendable.images : undefined;
    // A video goes as frames, so the text says which images they are.
    const outgoing = [trimmed, ...sendable.notes].filter(Boolean).join("\n\n");
    const ranCommand = runCommand(outgoing, {
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
        text: outgoing || " ",
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
    const normalEnter = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    const chosen = isBusy ? getComposerDelivery(event, composerShortcuts) : undefined;
    const delivery = compacting && (chosen || normalEnter) ? "queue" : chosen;
    if (isBusy ? !delivery && !normalEnter : event.shiftKey) return false;
    if (isBusy && !delivery) {
      const command = parseSlashCommand((promptEditorRef.current?.getText() ?? text).trim());
      if (!command || !commands.some(({ name }) => name === command.name)) return false;
    }
    if (!event.repeat) handleSubmit(delivery);
    return true;
  }

  // Changing models partway through makes the new one read the whole chat afresh, and one that
  // holds less may have to compact it. The picker keeps the way back one click away.
  const lastUsedKey = useTranscript(activeSessionId, lastModelUsed) ?? null;
  const lastUsedListed =
    lastUsedKey && providerList ? listedModel(providerList, lastUsedKey) : undefined;
  // A model that can't answer any more isn't one to go back to.
  const lastUsed =
    lastUsedKey && !unavailableModels.has(lastUsedKey) && lastUsedListed?.status !== "deprecated"
      ? lastUsedListed
      : undefined;
  const switchedFrom = lastUsedKey && lastUsed && selectedModel && selectedModel !== lastUsedKey;
  const selectedLimit =
    selectedModel && providerList ? listedModel(providerList, selectedModel)?.limit?.context : 0;
  const holdsLess =
    switchedFrom && selectedLimit && lastUsed.limit?.context
      ? selectedLimit < lastUsed.limit.context
      : false;
  const switchWarning = switchedFrom
    ? `This chat has been using ${lastUsed.name}. A different model reads the whole chat again from the start, which costs more${
        holdsLess
          ? `, and this one holds less (${tokenCount.format(selectedLimit || 0)} against ${tokenCount.format(lastUsed.limit?.context ?? 0)} tokens), so the chat may be compacted`
          : ""
      }.`
    : null;

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
          accept="image/png,image/jpeg,image/gif,image/webp,video/*,.mkv"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
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
          {(attachments.length > 0 || readingVideos > 0) && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1">
              {attachments.map((a, idx) => (
                <div key={a.id} className="group relative shrink-0">
                  <AttachmentMenu attachment={a}>
                    <button
                      type="button"
                      onClick={() => {
                        setLightboxIndex(lightbox.starts[idx]);
                        setLbSlideDir(null);
                        setLbAnimKey((k) => k + 1);
                      }}
                      title={
                        a.video
                          ? `${a.video.path ? "Play. " : ""}Sent as ${a.video.frames.length} still frames, without sound`
                          : undefined
                      }
                      className="relative block cursor-zoom-in overflow-hidden rounded-lg border transition-opacity hover:opacity-80"
                    >
                      <img src={a.dataUrl} alt={a.filename} className="h-16 w-16 object-cover" />
                      {a.video && (
                        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/60 px-1 py-0.5 text-[10px] tabular-nums text-white">
                          <Film aria-hidden="true" size={10} className="shrink-0" />
                          {formatVideoLength(a.video.duration)}
                        </span>
                      )}
                    </button>
                  </AttachmentMenu>
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
              {readingVideos > 0 && (
                <output className="shrink-0">
                  <span className="flex h-16 w-16 items-center justify-center rounded-lg border text-muted-foreground">
                    <Loader2 aria-hidden="true" size={16} className="animate-spin" />
                  </span>
                  <span className="mt-0.5 block max-w-[64px] truncate text-center text-xs text-muted-foreground">
                    Reading video
                  </span>
                </output>
              )}
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
                predictionsEnabled &&
                !isBusy &&
                !isSending &&
                !isDragging &&
                attachments.length === 0 &&
                readingVideos === 0
                  ? activeSessionId
                  : null
              }
              predictionContext={predictionContext}
              onChange={handleEditorChange}
              onSubmit={handleSubmit}
              onEnter={handleEnter}
              onPaste={(e) => {
                const items = e.clipboardData.items;
                const pasted: File[] = [];
                for (const item of Array.from(items)) {
                  if (item.kind !== "file") continue;
                  const file = item.getAsFile();
                  if (file && (COMPOSER_IMAGE_TYPES.includes(file.type) || isVideoFile(file))) {
                    pasted.push(file);
                  }
                }
                if (pasted.length > 0) {
                  e.preventDefault();
                  addFiles(pasted);
                }
              }}
              placeholder={
                isDragging
                  ? isDraggingObject
                    ? "Drop to reference this object..."
                    : "Drop images or videos here..."
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
                title="Attach images or videos"
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
                  <button type="button" className={MENU_TRIGGER} title={switchWarning ?? undefined}>
                    {/* The dot draws the eye, and the button's description says what it means. */}
                    {switchWarning && (
                      <span
                        aria-hidden="true"
                        data-model-switched=""
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                      />
                    )}
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
                  {lastUsedKey && lastUsed && !modelSearch && (
                    <div className="shrink-0 border-b p-1.5">
                      <button
                        type="button"
                        aria-pressed={selectedModel === lastUsedKey}
                        title={
                          selectedModel === lastUsedKey
                            ? "This chat's model"
                            : `Go back to ${lastUsed.name}`
                        }
                        onClick={() => {
                          if (selectedModel !== lastUsedKey) setSelectedModel(lastUsedKey);
                          setShowModelPicker(false);
                        }}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <History
                          aria-hidden="true"
                          size={14}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Last used
                          </span>
                          <span className="block truncate text-sm">{lastUsed.name}</span>
                        </span>
                        {selectedModel === lastUsedKey && (
                          <Check aria-hidden="true" size={14} className="shrink-0" />
                        )}
                      </button>
                      {switchWarning && (
                        <p className="mt-1.5 flex gap-1.5 px-1 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                          <TriangleAlert aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
                          <span>{switchWarning}</span>
                        </p>
                      )}
                    </div>
                  )}
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
              <SendButton
                text={text}
                hasAttachments={attachments.length > 0}
                isBusy={isBusy}
                isSending={isSending}
                blockedReason={
                  readingVideos > 0
                    ? "Reading the video..."
                    : (modelSendBlock ?? (needsStudio(text.trim()) ? sendBlock : null))
                }
                shortcuts={composerShortcuts}
                queueOnly={compacting}
                onSend={() => handleSubmit()}
                onDeliver={handleSubmit}
              />
            </div>
          </div>
        </div>
      </div>

      {lightboxIndex !== null && lightbox.items[lightboxIndex] && (
        <LightboxOverlay
          items={lightbox.items}
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
