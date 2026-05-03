import { ClipboardList, Hourglass, Play, X, Zap } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import AgentIcon from "@/components/AgentIcon";
import ApprovalModeSwitcher from "@/components/ApprovalModeSwitcher";
import type { useAbort } from "@/hooks/mutations/useAbort";
import { useAllAgents } from "@/hooks/useCustomAgents";
import { useAllModels, useConnectedProviders } from "@/hooks/useProviders";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import type { SendMode } from "@/lib/config";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo } from "@/types";

interface QueuedMessage {
  text: string;
  images?: Array<{ mime: string; url: string; filename?: string }>;
}

// ── Image attachment helpers ────────────────────────────────────────────

interface ImageAttachment {
  id: string;
  dataUrl: string;
  mime: string;
  filename: string;
}

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_MENTIONS = 5;
const MAX_SKILL_MENTIONS = 3;

let attachmentCounter = 0;
let mentionCounter = 0;
let skillMentionCounter = 0;

// ── File mention helpers ─────────────────────────────────────

interface FileMention {
  id: string;
  fileName: string;
  filePath: string;
  content: string;
}

// ── Skill mention helpers ────────────────────────────────────

interface SkillMention {
  id: string;
  skillName: string;
  skillPath: string;
  content: string;
}

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
  hasFileMentions,
  onSend,
  queueCount,
  abort,
}: {
  text: string;
  hasAttachments: boolean;
  hasFileMentions: boolean;
  onSend: () => void;
  queueCount: number;
  abort: ReturnType<typeof useAbort>;
}) {
  const { activeSessionId } = useActiveSession();
  const isBusy = useIsBusy(activeSessionId);
  // Show stop button only when busy AND there's nothing to send/queue
  const showStop = isBusy && !text.trim() && !hasAttachments && !hasFileMentions && queueCount === 0;

  if (showStop) {
    return (
      <button
        onClick={() => abort.mutate()}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Stop"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
    );
  }

  const isEmpty = !text.trim() && !hasAttachments && queueCount === 0;

  return (
    <button
      onClick={onSend}
      disabled={isEmpty}
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-opacity disabled:opacity-30 ${
        isBusy
          ? "border border-dashed border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100"
          : "bg-foreground text-background"
      }`}
      title={isBusy ? "Send (interrupts)" : "Send"}
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
  );
});

const StatusHint = memo(function StatusHint({
  queue,
  sendMode,
  onSendNow,
  onCancel,
}: {
  queue: Array<{ text: string }>;
  sendMode: SendMode;
  onSendNow: (index: number) => void;
  onCancel: (index: number) => void;
}) {
  if (queue.length > 0) {
    return (
      <div className="mt-1.5 space-y-1">
        <div className="text-center text-[10px] text-amber-500/80">
          {queue.length} message{queue.length > 1 ? "s" : ""} queued
          {sendMode === "wait" ? " — will send when model is idle" : " — sending one at a time"}
        </div>
        <div className="max-h-24 space-y-0.5 overflow-y-auto">
          {queue.map((msg, i) => (
            <div key={i} className="flex items-center gap-1 rounded-md border bg-card px-2 py-1">
              <span className="flex-1 truncate text-[10px] text-muted-foreground">
                {msg.text || "(image only)"}
              </span>
              <button
                onClick={() => onSendNow(i)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-emerald-500"
                title="Send now"
              >
                <Play size={9} />
              </button>
              <button
                onClick={() => onCancel(i)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-red-500"
                title="Cancel"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
      Shift+Enter for new line
    </div>
  );
});

function ChatInput({
  messageQueue,
  onQueueSubmit,
  onSendNow,
  onCancel,
  abort,
  onAutoApproveRequested,
}: {
  messageQueue: QueuedMessage[];
  onQueueSubmit: (message: QueuedMessage) => void;
  onSendNow: (index: number) => void;
  onCancel: (index: number) => void;
  abort: ReturnType<typeof useAbort>;
  onAutoApproveRequested?: () => void;
}) {
  const allModels = useAllModels();
  const connectedProviders = useConnectedProviders();
  const allAgents = useAllAgents();
  const {
    selectedModel,
    selectedAgent,
    selectedVariant,
    sendMode,
    hiddenModels,
    setSelectedModel,
    setSelectedAgent,
    setSelectedVariant,
    setSendMode,
  } = usePreferences();
  // Available variants for the currently selected model
  const availableVariants = useMemo(() => {
    if (!selectedModel) return [];
    const [, modelId] = splitModelKey(selectedModel);
    const model = allModels.find((m) => m.id === modelId);
    return model?.variants ? Object.keys(model.variants) : [];
  }, [selectedModel, allModels]);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [fileMentions, setFileMentions] = useState<FileMention[]>([]);
  const [skillMentions, setSkillMentions] = useState<SkillMention[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lbSlideDir, setLbSlideDir] = useState<"left" | "right" | null>(null);
  const [lbAnimKey, setLbAnimKey] = useState(0);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [rejectShake, setRejectShake] = useState(false);
  const [showSendModePicker, setShowSendModePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const sendModePickerRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      const toAdd: File[] = [];
      for (const file of Array.from(files)) {
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          toast.error("That file isn't an image. Try a PNG, JPEG, GIF, or WebP instead.");
          triggerRejectShake();
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error("That image is too large. Please use one under 20 MB.");
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
      const succeeded: { dataUrl: string; mime: string; filename: string }[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") {
          succeeded.push(r.value);
        } else {
          toast.error("Failed to read an image file");
          triggerRejectShake();
        }
      }
      if (succeeded.length === 0) return;
      setAttachments((prev) => {
        const remaining = MAX_ATTACHMENTS - prev.length;
        if (remaining <= 0) {
          toast.error(`Maximum ${MAX_ATTACHMENTS} images allowed`);
          triggerRejectShake();
          return prev;
        }
        const allowed = succeeded.slice(0, remaining);
        if (succeeded.length > remaining) {
          toast.error(`Only ${remaining} more image(s) allowed`);
          triggerRejectShake();
        }
        return [
          ...prev,
          ...allowed.map((s) => ({
            id: `img-${++attachmentCounter}`,
            dataUrl: s.dataUrl,
            mime: s.mime,
            filename: s.filename,
          })),
        ];
      });
    },
    [triggerRejectShake],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
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
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      if (e.dataTransfer.files.length > 0) addImageFiles(e.dataTransfer.files);
    },
    [addImageFiles],
  );

  function resizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  // ── File mention parsing ──────────────────────────────────────────

  function parseFileMentions(text: string): string[] {
    const mentionPattern = /@\[([^\]]+)\]/g;
    const matches: string[] = [];
    let match;
    while ((match = mentionPattern.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  async function processFileMentions(text: string): Promise<FileMention[]> {
    const fileNames = parseFileMentions(text);
    if (fileNames.length === 0) return [];

    // Check if adding these would exceed the limit
    const remaining = MAX_FILE_MENTIONS - fileMentions.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_FILE_MENTIONS} file mentions allowed`);
      return [];
    }
    const toProcess = fileNames.slice(0, remaining);
    if (toProcess.length < fileNames.length) {
      toast.error(`Only ${remaining} more file mention(s) allowed`);
    }

    const mentions: FileMention[] = [];
    for (const fileName of toProcess) {
      try {
        const result = await invoke<[string, string] | null>("file_system_find_and_read", {
          fileName,
          folderPath: null,
        });
        if (result) {
          const [filePath, content] = result;
          mentions.push({
            id: `mention-${++mentionCounter}`,
            fileName,
            filePath,
            content,
          });
        } else {
          toast.error(`File "${fileName}" not found in open folders`);
        }
      } catch (error) {
        console.error(`Failed to read file "${fileName}":`, error);
        toast.error(`Failed to read file "${fileName}"`);
      }
    }
    return mentions;
  }

  function removeFileMention(id: string) {
    setFileMentions((prev) => prev.filter((m) => m.id !== id));
  }

  // ── Skill mention parsing ────────────────────────────────────

  function parseSkillMentions(text: string): string[] {
    const mentionPattern = /@skill:([a-zA-Z0-9_-]+)/g;
    const matches: string[] = [];
    let match;
    while ((match = mentionPattern.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  async function processSkillMentions(text: string): Promise<SkillMention[]> {
    const skillNames = parseSkillMentions(text);
    if (skillNames.length === 0) return [];

    // Check if adding these would exceed the limit
    const remaining = MAX_SKILL_MENTIONS - skillMentions.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_SKILL_MENTIONS} skill mentions allowed`);
      return [];
    }
    const toProcess = skillNames.slice(0, remaining);
    if (toProcess.length < skillNames.length) {
      toast.error(`Only ${remaining} more skill mention(s) allowed`);
    }

    const mentions: SkillMention[] = [];
    for (const skillName of toProcess) {
      try {
        const result = await invoke<[string, string] | null>("file_system_find_skill", {
          skillName,
        });
        if (result) {
          const [skillPath, content] = result;
          mentions.push({
            id: `skill-${++skillMentionCounter}`,
            skillName,
            skillPath,
            content,
          });
        } else {
          toast.error(`Skill "${skillName}" not found`);
        }
      } catch (error) {
        console.error(`Failed to read skill "${skillName}":`, error);
        toast.error(`Failed to read skill "${skillName}"`);
      }
    }
    return mentions;
  }

  function removeSkillMention(id: string) {
    setSkillMentions((prev) => prev.filter((m) => m.id !== id));
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
        setModelSearch("");
      }
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
      if (sendModePickerRef.current && !sendModePickerRef.current.contains(e.target as Node)) {
        setShowSendModePicker(false);
      }
    }
    if (showModelPicker || showAgentPicker || showSendModePicker) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showModelPicker, showAgentPicker, showSendModePicker]);

  const modelsByProvider = useMemo(() => {
    const POPULAR = [
      "opencode",
      "anthropic",
      "github-copilot",
      "openai",
      "google",
      "openrouter",
      "vercel",
    ];
    const query = modelSearch.toLowerCase().trim();
    const groups: Record<string, { providerName: string; models: ModelInfo[] }> = {};
    for (const model of allModels) {
      if (!connectedProviders.includes(model.providerId)) continue;
      const modelKey = `${model.providerId}/${model.id}`;
      if (hiddenModels.has(modelKey)) continue;
      if (query) {
        const haystack = `${model.name} ${model.id} ${model.providerName}`.toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      if (!groups[model.providerId])
        groups[model.providerId] = { providerName: model.providerName, models: [] };
      groups[model.providerId].models.push(model);
    }
    for (const group of Object.values(groups))
      group.models.sort((a, b) => a.name.localeCompare(b.name));
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
  }, [allModels, connectedProviders, hiddenModels, modelSearch]);

  // Show all agents — built-in agents come from the SDK (already filtered
  // for hidden/mode), custom agents are always visible.
  const visibleAgents = useMemo(() => allAgents, [allAgents]);

  // Group agents for display: built-in first, then custom
  const builtinAgents = useMemo(() => visibleAgents.filter((a) => a.isBuiltin), [visibleAgents]);
  const customAgents = useMemo(() => visibleAgents.filter((a) => !a.isBuiltin), [visibleAgents]);

  // Find the currently selected agent for display
  const currentAgent = useMemo(
    () => allAgents.find((a) => a.id === selectedAgent),
    [allAgents, selectedAgent],
  );

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0 && fileMentions.length === 0 && skillMentions.length === 0) return;

    // Process any new @[filename] mentions in the text
    const newFileMentions = await processFileMentions(trimmed);
    const allFileMentions = [...fileMentions, ...newFileMentions];

    // Process any new @skill:name mentions in the text
    const newSkillMentions = await processSkillMentions(trimmed);
    const allSkillMentions = [...skillMentions, ...newSkillMentions];

    // Build file context from file mentions
    let fileContext = "";
    if (allFileMentions.length > 0) {
      fileContext = "\n\n--- File Attachments ---\n";
      for (const mention of allFileMentions) {
        fileContext += `\n[File: ${mention.fileName}]\n\`\`\`lua\n${mention.content}\n\`\`\`\n`;
      }
    }

    // Build skill context from skill mentions
    let skillContext = "";
    if (allSkillMentions.length > 0) {
      skillContext = "\n\n--- Skill References ---\n";
      for (const mention of allSkillMentions) {
        skillContext += `\n[Skill: ${mention.skillName}]\n\`\`\`markdown\n${mention.content}\n\`\`\`\n`;
      }
    }

    // Remove @[filename] and @skill:name patterns from text for cleaner display
    const cleanText = trimmed
      .replace(/@\[[^\]]+\]/g, "")
      .replace(/@skill:[a-zA-Z0-9_-]+/g, "")
      .trim();

    const message = {
      text: cleanText + fileContext + skillContext || " " + fileContext + skillContext,
      images:
        attachments.length > 0
          ? attachments.map((a) => ({ mime: a.mime, url: a.dataUrl, filename: a.filename }))
          : undefined,
    };

    onQueueSubmit(message);
    setText("");
    setAttachments([]);
    setFileMentions([]);
    setSkillMentions([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleModelClick(model: ModelInfo) {
    const fullId = `${model.providerId}/${model.id}`;
    setSelectedModel(fullId);
    setShowModelPicker(false);
    setModelSearch("");
  }

  const modelDisplay = selectedModel
    ? (selectedModel.split("/").pop() ?? selectedModel)
    : "Select model";
  const agentDisplay = currentAgent?.name ?? selectedAgent ?? "Default agent";

  function statusBadge(status?: string) {
    if (status === "beta")
      return (
        <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700">
          beta
        </span>
      );
    if (status === "alpha")
      return (
        <span className="shrink-0 rounded bg-purple-100 px-1 text-[9px] font-medium text-purple-700">
          alpha
        </span>
      );
    if (status === "deprecated")
      return (
        <span className="shrink-0 rounded bg-stone-100 px-1 text-[9px] font-medium text-stone-500">
          deprecated
        </span>
      );
    return null;
  }

  function renderProviderGroup(
    providerId: string,
    group: { providerName: string; models: ModelInfo[] },
  ) {
    return (
      <div key={providerId}>
        <div className="flex items-center gap-1.5 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.providerName}
          </span>
        </div>
        {group.models.map((model) => {
          const fullId = `${model.providerId}/${model.id}`;
          const isSelected = selectedModel === fullId;
          return (
            <button
              key={fullId}
              onClick={() => handleModelClick(model)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${isSelected ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            >
              <span className="truncate">{model.name}</span>
              {statusBadge(model.status)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      <div className="relative mb-2 flex items-center gap-1">
        <div className="relative" ref={modelPickerRef}>
          <button
            onClick={() => {
              setShowModelPicker(!showModelPicker);
              setShowAgentPicker(false);
              if (showModelPicker) {
                setModelSearch("");
              }
            }}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
            {modelDisplay}
          </button>
          {showModelPicker && (
            <div className="absolute bottom-full left-0 z-50 mb-1 flex max-h-80 w-80 flex-col rounded-lg border bg-popover shadow-lg">
              <div className="shrink-0 border-b px-2 py-1.5">
                <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-muted-foreground/50"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    ref={modelSearchRef}
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder="Search models..."
                    className="h-7 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                    autoFocus
                  />
                  {modelSearch && (
                    <button
                      onClick={() => {
                        setModelSearch("");
                        modelSearchRef.current?.focus();
                      }}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
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
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-1">
                {modelsByProvider.map(([id, group]) => renderProviderGroup(id, group))}
                {modelsByProvider.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No models matching "{modelSearch}"
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {visibleAgents.length > 1 && (
          <div className="relative" ref={agentPickerRef}>
            <button
              onClick={() => {
                setShowAgentPicker(!showAgentPicker);
                setShowModelPicker(false);
              }}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <AgentIcon agentId={currentAgent?.id ?? "studio"} size={14} />
              {agentDisplay}
            </button>
            {showAgentPicker && (
              <div className="absolute bottom-full left-0 z-50 mb-1 w-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
                {builtinAgents.length > 0 && (
                  <div>
                    <div className="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Built-in
                    </div>
                    {builtinAgents.map((agent) => {
                      const isSelected = selectedAgent === agent.id;
                      return (
                        <button
                          key={agent.id}
                          onClick={() => {
                            setSelectedAgent(agent.id);
                            setShowAgentPicker(false);
                          }}
                          className={`flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                        >
                          <AgentIcon agentId={agent.id} size={14} className="mt-px shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium">{agent.name}</span>
                            </div>
                            {agent.description && (
                              <div className="truncate text-[10px] text-muted-foreground">
                                {agent.description}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="mt-0.5 shrink-0 text-emerald-500"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {customAgents.length > 0 && (
                  <div>
                    {builtinAgents.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
                    <div className="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Custom
                    </div>
                    {customAgents.map((agent) => {
                      const isSelected = selectedAgent === agent.id;
                      return (
                        <button
                          key={agent.id}
                          onClick={() => {
                            setSelectedAgent(agent.id);
                            setShowAgentPicker(false);
                          }}
                          className={`flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors ${isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                        >
                          <AgentIcon agentId={agent.id} size={14} className="mt-px shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium">{agent.name}</span>
                              {agent.version && (
                                <span className="rounded bg-muted px-0.5 py-px text-[9px] text-muted-foreground">
                                  v{agent.version}
                                </span>
                              )}
                            </div>
                            {agent.description && (
                              <span className="line-clamp-1 text-[10px] text-muted-foreground">
                                {agent.description}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="mt-0.5 shrink-0 text-emerald-500"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {visibleAgents.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No agents available
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <ApprovalModeSwitcher onAutoApproveRequested={onAutoApproveRequested} />

        {availableVariants.length > 0 && (
          <button
            onClick={() => {
              if (!selectedVariant) setSelectedVariant(availableVariants[0]);
              else {
                const idx = availableVariants.indexOf(selectedVariant);
                if (idx === -1 || idx === availableVariants.length - 1) setSelectedVariant(null);
                else setSelectedVariant(availableVariants[idx + 1]);
              }
            }}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] capitalize text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={`Click to cycle variant (${["default", ...availableVariants].join(" → ")})`}
          >
            {selectedVariant ?? "default"}
          </button>
        )}
      </div>

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
        className={`rounded-xl border bg-background transition-shadow focus-within:ring-2 ring-ring/20 ${isDragging ? "ring-2 ring-blue-400 border-blue-300 bg-blue-50/30" : ""}`}
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
                <div className="mt-0.5 max-w-[64px] truncate text-center text-[9px] text-muted-foreground">
                  {a.filename}
                </div>
              </div>
            ))}
          </div>
        )}

        {fileMentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-1.5 pb-0.5">
            {fileMentions.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1 rounded-md border bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="max-w-[120px] truncate">{m.fileName}</span>
                <button
                  onClick={() => removeFileMention(m.id)}
                  className="ml-0.5 rounded-full hover:bg-blue-200 hover:text-blue-900"
                  title="Remove file"
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
              </div>
            ))}
          </div>
        )}

        {skillMentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-1.5 pb-0.5">
            {skillMentions.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-1 rounded-md border bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span className="max-w-[120px] truncate">@{m.skillName}</span>
                <button
                  onClick={() => removeSkillMention(m.id)}
                  className="ml-0.5 rounded-full hover:bg-purple-200 hover:text-purple-900"
                  title="Remove skill"
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
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-1 px-3 py-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`mt-0.5 shrink-0 p-0.5 transition-colors hover:text-foreground ${rejectShake ? "animate-reject-shake text-red-500" : "text-muted-foreground/60"}`}
            title="Attach images"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <button
            onClick={() => {
              const textarea = textareaRef.current;
              if (!textarea) return;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const newText = text.substring(0, start) + "@[]" + text.substring(end);
              setText(newText);
              // Set cursor position between brackets
              setTimeout(() => {
                textarea.selectionStart = start + 2;
                textarea.selectionEnd = start + 2;
                textarea.focus();
              }, 0);
            }}
            className="mt-0.5 shrink-0 p-0.5 text-muted-foreground/60 transition-colors hover:text-blue-500"
            title="Mention a file using @[filename]"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </button>
          <button
            onClick={() => {
              const textarea = textareaRef.current;
              if (!textarea) return;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const newText = text.substring(0, start) + "@skill:" + text.substring(end);
              setText(newText);
              // Set cursor position after the colon
              setTimeout(() => {
                textarea.selectionStart = start + 7;
                textarea.selectionEnd = start + 7;
                textarea.focus();
              }, 0);
            }}
            className="mt-0.5 shrink-0 p-0.5 text-muted-foreground/60 transition-colors hover:text-purple-500"
            title="Mention a skill using @skill:name"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              resizeTextarea(e.target);
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const items = e.clipboardData.items;
              const imageFiles: File[] = [];
              for (const item of Array.from(items)) {
                if (item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
                  const file = item.getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                addImageFiles(imageFiles);
              }
            }}
            placeholder={isDragging ? "Drop images here..." : "Describe what you want to build... (use @[filename] or @skill:name)"}
            rows={1}
            className="max-h-40 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <div className="relative" ref={sendModePickerRef}>
            <button
              onClick={() => setShowSendModePicker(!showSendModePicker)}
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:text-foreground"
              title={
                sendMode === "instant"
                  ? "Send mode: Instant (interrupts)"
                  : sendMode === "wait"
                    ? "Send mode: Wait for idle"
                    : "Send mode: Queue"
              }
            >
              {sendMode === "instant" ? (
                <Zap size={12} />
              ) : sendMode === "wait" ? (
                <Hourglass size={12} />
              ) : (
                <ClipboardList size={12} />
              )}
            </button>
            {showSendModePicker && (
              <div className="absolute bottom-full right-0 z-50 mb-1 w-40 rounded-lg border bg-popover p-1 shadow-lg">
                {[
                  {
                    value: "instant" as SendMode,
                    icon: <Zap size={13} />,
                    label: "Instant",
                    desc: "Interrupts if busy",
                  },
                  {
                    value: "wait" as SendMode,
                    icon: <Hourglass size={13} />,
                    label: "Wait",
                    desc: "Auto-sends when idle",
                  },
                  {
                    value: "queue" as SendMode,
                    icon: <ClipboardList size={13} />,
                    label: "Queue",
                    desc: "Auto-sends one by one",
                  },
                ].map((mode) => (
                  <button
                    key={mode.value}
                    onClick={() => {
                      setSendMode(mode.value);
                      setShowSendModePicker(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      sendMode === mode.value
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <span className="text-[13px]">{mode.icon}</span>
                    <div className="flex flex-col items-start">
                      <span>{mode.label}</span>
                      <span className="text-[9px] text-muted-foreground/50">{mode.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <SendButton
            text={text}
            hasAttachments={attachments.length > 0}
            hasFileMentions={fileMentions.length > 0}
            onSend={handleSubmit}
            queueCount={messageQueue.length}
            abort={abort}
          />
        </div>
      </div>

      <StatusHint
        queue={messageQueue}
        sendMode={sendMode}
        onSendNow={onSendNow}
        onCancel={onCancel}
      />

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
