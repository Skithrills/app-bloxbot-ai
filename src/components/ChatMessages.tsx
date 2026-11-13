import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  Brain,
  Check,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Code2,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  type LucideIcon,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import {
  type ComponentProps,
  createContext,
  isValidElement,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import { AudioSpectrum } from "@/components/AudioVisualizer";
import {
  ActivityGallery,
  ImageLightboxProvider,
  ImageThumbnails,
  type LightboxImage,
  ReplyImage,
} from "@/components/ImageLightbox";
import { REMARK_PLUGINS } from "@/components/MarkdownPreview";
import { MessageRail, type RailEntry } from "@/components/MessageRail";
import { ModelCard } from "@/components/ModelCard";
import { PermissionPrompt } from "@/components/PermissionPrompt";
import { MessageReference, ReferenceText } from "@/components/ReferenceChip";
import { SubagentToolCard } from "@/components/SubagentToolCard";
import type { HighlightLanguage } from "@/components/SyntaxHighlightedOutput";
import { useAudioVisualizer } from "@/lib/audioVisualizer";
import {
  instanceReferenceLabels,
  type MessageReferenceSource,
  splitInstanceReferences,
} from "@/lib/instanceReferences";
import { formatModelCost } from "@/lib/modelCost";
import { modelLinksIn } from "@/lib/modelLinks";
import { toAppProviderID } from "@/lib/openAiProfiles";
import type { Part, QuestionAnswer, QuestionRequest, SessionStatus } from "@/lib/opencode/types";
import { isStudioTool } from "@/lib/studioMcp";
import {
  type AddComposerImage,
  imageDataUrlMime,
  isCaptureId,
  toolImageMime,
} from "@/lib/toolImages";
import { useExplorerReference } from "@/providers/ExplorerReferenceProvider";

const SyntaxHighlightedOutput = lazy(() => import("@/components/SyntaxHighlightedOutput"));
const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, HighlightLanguage> = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  diff: "diff",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  lua: "lua",
  luau: "lua",
  shellsession: "shellsession",
  console: "shellsession",
  typescript: "typescript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "tsx",
};

import { useAnswerQuestion, useRejectQuestion } from "@/hooks/mutations/useAnswerQuestion";
import { useReplyPermission } from "@/hooks/mutations/useReplyPermission";
import { useMessageIds, useTranscript } from "@/hooks/useMessages";
import { useActivePermission } from "@/hooks/usePermissions";
import { useProviderList } from "@/hooks/useProviders";
import { useActiveQuestion } from "@/hooks/useQuestions";
import { useSessionError } from "@/hooks/useSessionError";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { type ModelChoice, pickFreeModel } from "@/lib/modelChoice";
import {
  freeLimitEndsAt,
  isFreeUsageLimit,
  type ModelError,
  type ModelErrorPresentation,
  presentModelError,
} from "@/lib/modelError";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { MessageWithParts } from "@/types";

// ── Inline BloxBot thinking indicator ────────────────────────────────────

function StudLoader() {
  return (
    <span className="stud-loader" aria-hidden="true">
      {STUDS.map((stud) => (
        <span key={stud} />
      ))}
    </span>
  );
}

const STUDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function BloxBotThinking({ label = "Thinking", detail }: { label?: string; detail?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <output className="flex min-h-[21px] min-w-0 items-center gap-2 text-sm">
      <StudLoader />
      <span className="text-shimmer">{label}</span>
      {seconds > 0 && (
        <span className="text-xs tabular-nums text-muted-foreground/70">{seconds}s</span>
      )}
      {detail && <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>}
    </output>
  );
}

// ── Constants ───────────────────────────────────────────────────────────

// ── Helpers ─────────────────────────────────────────────────────────────

function baseToolName(tool: string): string {
  return tool.replace(/^mcp_[^_]+_/, "");
}

function inputField(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val === "string") return val;
  if (val !== undefined && val !== null) return JSON.stringify(val);
  return "";
}

// ── Tool rows ───────────────────────────────────────────────────────────
// Every tool call is one quiet line saying what happened. Details open on click.

const ToolImagesContext = createContext<LightboxImage[]>([]);

function ToolRow({
  icon: Icon,
  label,
  detail,
  running = false,
  failed = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  running?: boolean;
  failed?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const images = useContext(ToolImagesContext);
  const expandable = Boolean(children);
  const tone = failed ? "text-destructive" : "text-muted-foreground";
  const summary = (
    <>
      <Icon aria-hidden="true" size={13} className="shrink-0 opacity-70" />
      <span className={`min-w-0 truncate ${running ? "text-shimmer" : ""}`} title={label}>
        {label}
      </span>
      {detail && (
        <span className="min-w-0 truncate opacity-70" title={detail}>
          {detail}
        </span>
      )}
    </>
  );
  return (
    <div data-preserve-scroll className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className={`flex min-w-0 items-center gap-1.5 rounded py-0.5 text-left text-sm transition-colors hover:text-foreground ${tone}`}
          >
            {summary}
            <ChevronRight
              aria-hidden="true"
              size={12}
              className={`shrink-0 opacity-70 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <div className={`flex min-w-0 items-center gap-1.5 py-0.5 text-sm ${tone}`}>
            {summary}
          </div>
        )}
        {images.length > 0 && <ActivityGallery images={images} />}
      </div>
      {open && expandable && (
        <div className="animate-disclosure-expand mb-1 ml-1.5 mt-1 min-w-0 space-y-2 border-l pl-3">
          {children}
        </div>
      )}
    </div>
  );
}

function ToolText({ text, language }: { text: string; language?: HighlightLanguage }) {
  const body = (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
      {text}
    </pre>
  );
  return (
    <div className="app-scrollbar max-h-72 overflow-auto rounded-md bg-muted/50 px-2.5 py-2 text-xs">
      {language ? (
        <Suspense fallback={body}>
          <SyntaxHighlightedOutput code={text} language={language} />
        </Suspense>
      ) : (
        body
      )}
    </div>
  );
}

function shortPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

interface ToolViewProps {
  input: Record<string, unknown>;
  output?: string;
  status: string;
}

function BashToolView({ input, output, status }: ToolViewProps) {
  const command = inputField(input, "command");
  return (
    <ToolRow
      icon={SquareTerminal}
      label={status === "completed" ? "Ran" : "Running"}
      detail={inputField(input, "description") || command}
      running={status === "running"}
    >
      <ToolText
        text={output ? `$ ${command}\n${output.slice(0, 3000)}` : `$ ${command}`}
        language="shellsession"
      />
    </ToolRow>
  );
}

function EditToolView({ input, status }: ToolViewProps) {
  const filePath = inputField(input, "filePath");
  const oldString = inputField(input, "oldString");
  const newString = inputField(input, "newString");
  const diff = [
    ...(oldString ? oldString.split("\n").map((line) => `-${line}`) : []),
    ...(newString ? newString.split("\n").map((line) => `+${line}`) : []),
  ].join("\n");
  return (
    <ToolRow
      icon={FilePen}
      label={status === "completed" ? "Edited" : "Editing"}
      detail={shortPath(filePath)}
      running={status === "running"}
    >
      {diff ? <ToolText text={diff} language="diff" /> : undefined}
    </ToolRow>
  );
}

/** GPT models edit through a patch that can touch several files. */
function PatchToolView({ input, status }: ToolViewProps) {
  const patch = inputField(input, "patchText");
  const files = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) =>
    shortPath(match[1] ?? ""),
  );
  return (
    <ToolRow
      icon={FilePen}
      label={status === "completed" ? "Edited" : "Editing"}
      detail={files.join(", ")}
      running={status === "running"}
    >
      {patch ? <ToolText text={patch} language="diff" /> : undefined}
    </ToolRow>
  );
}

function ReadToolView({ input, status }: ToolViewProps) {
  return (
    <ToolRow
      icon={FileText}
      label={status === "completed" ? "Read" : "Reading"}
      detail={shortPath(inputField(input, "filePath"))}
      running={status === "running"}
    />
  );
}

function WriteToolView({ input, status }: ToolViewProps) {
  const content = inputField(input, "content");
  return (
    <ToolRow
      icon={FilePlus}
      label={status === "completed" ? "Created" : "Creating"}
      detail={shortPath(inputField(input, "filePath"))}
      running={status === "running"}
    >
      {content ? <ToolText text={content.slice(0, 3000)} /> : undefined}
    </ToolRow>
  );
}

function SearchToolView({ input, status, field }: ToolViewProps & { field: string }) {
  return (
    <ToolRow
      icon={Search}
      label={status === "completed" ? "Searched" : "Searching"}
      detail={inputField(input, field)}
      running={status === "running"}
    />
  );
}

function WebFetchToolView({ input, status }: ToolViewProps) {
  return (
    <ToolRow
      icon={Globe}
      label={status === "completed" ? "Fetched" : "Fetching"}
      detail={inputField(input, "url")}
      running={status === "running"}
    />
  );
}

/** What a Code Mode script did, from the tools it calls: "Inspect instance, Search game tree". */
function toolsInCode(code: string): string {
  const names = [...code.matchAll(/\btools(?:\.[\w$]+|\[["'][^"']+["']\])\.([\w$]+)\(/g)].map(
    (match) => toolTitle(match[1] ?? ""),
  );
  return [...new Set(names)].join(", ");
}

/** OpenCode's Code Mode: the script a model ran against its tools, and what it returned. */
function ExecuteToolView({ input, output, status }: ToolViewProps) {
  const code = inputField(input, "code");
  return (
    <ToolRow
      icon={Code2}
      label={status === "completed" ? "Ran code" : "Running code"}
      detail={toolsInCode(code)}
      running={status === "running"}
    >
      <div className="space-y-1.5">
        {code && <ToolText text={code} language="javascript" />}
        {output && <ToolText text={output.slice(0, 3000)} />}
      </div>
    </ToolRow>
  );
}

/** "roblox-studio_search_game_tree" reads as "Search game tree". */
function toolTitle(tool: string): string {
  const words = tool
    .replace(/^roblox-studio_/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function DefaultToolView({ tool, input, output, status }: ToolViewProps & { tool: string }) {
  const title = "title" in input ? inputField(input, "title") : "";
  return (
    <ToolRow icon={Wrench} label={toolTitle(tool)} detail={title} running={status === "running"}>
      {output ? <ToolText text={output.slice(0, 2000)} /> : undefined}
    </ToolRow>
  );
}

// ── Part renderers ─────────────────────────────────────────────────────

const INLINE_CODE = "rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground";

/** Inline code that names an object in the place opens it in the Explorer. */
function InlineCode({ children }: { children?: ReactNode }) {
  const { objectIndex, focusObject } = useExplorerReference();
  const object = typeof children === "string" ? objectIndex.get(children.trim()) : null;
  if (!object) return <code className={INLINE_CODE}>{children}</code>;
  return (
    <button
      type="button"
      title={`Show ${object.path} in the Explorer`}
      onClick={() => {
        focusObject(object.path);
      }}
      className="cursor-pointer"
    >
      <code
        className={`${INLINE_CODE} underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground`}
      >
        {children}
      </code>
    </button>
  );
}

/** Capture references are resolved against the current turn's tool attachments. */
const keepFileLinks: UrlTransform = (url, key) =>
  (key === "href" && url.startsWith("file:")) ||
  (key === "src" && url.startsWith("capture:") && isCaptureId(url.slice(8)))
    ? url
    : defaultUrlTransform(url);

const markdownComponents: Components = {
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-4 first:mt-0 text-lg font-medium">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-3 first:mt-0 text-base font-medium">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-1.5 mt-2.5 first:mt-0 text-sm font-medium">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mb-1 mt-2 first:mt-0 text-sm font-medium">{children}</h4>;
  },
  ul({ children }) {
    return <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>;
  },
  li({ children }) {
    return <li className="pl-0.5">{children}</li>;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-text underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
      >
        {children}
      </a>
    );
  },
  strong({ children }) {
    return <strong className="font-medium">{children}</strong>;
  },
  em({ children }) {
    return <em>{children}</em>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-3 border-border" />;
  },
  code({ children }) {
    return <InlineCode>{children}</InlineCode>;
  },
  pre({ children }) {
    if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
      return <pre className="app-scrollbar max-w-full overflow-x-auto">{children}</pre>;
    }
    const lang = children.props.className?.match(/\blanguage-(\S+)/)?.[1];
    const language = lang ? HIGHLIGHT_LANGUAGE_ALIASES[lang.toLowerCase()] : undefined;
    const code = String(children.props.children ?? "").replace(/\n$/, "");
    return (
      <div className="mb-2 min-w-0 max-w-full pl-3 last:mb-0">
        {lang && <div className="mb-1 text-xs font-medium text-muted-foreground/60">{lang}</div>}
        <pre className="app-scrollbar max-w-full overflow-x-auto overscroll-x-contain whitespace-pre font-mono text-sm leading-relaxed wrap-normal text-muted-foreground/80">
          {language ? (
            <span className="block in-[[data-chat-scroll=subagent]]:w-max in-[[data-chat-scroll=subagent]]:min-w-full">
              <Suspense fallback={<code>{code}</code>}>
                <SyntaxHighlightedOutput code={code} language={language} />
              </Suspense>
            </span>
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    );
  },
  table({ children }) {
    return (
      <div className="app-scrollbar mb-2 max-w-full overflow-x-auto overscroll-x-contain last:mb-0">
        <table className="min-w-full border-collapse text-sm wrap-normal">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-border bg-muted">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-2 py-1 text-left font-medium text-foreground">{children}</th>;
  },
  td({ children }) {
    return <td className="border-t border-border px-2 py-1 text-foreground">{children}</td>;
  },
};

export function MessageText({
  text,
  captures,
  source,
}: {
  text: string;
  captures?: ReadonlyMap<string, LightboxImage>;
  source?: MessageReferenceSource;
}) {
  const components: Components = {
    ...markdownComponents,
    img({ node: _node, src, alt, ...props }) {
      if (typeof src === "string" && src.startsWith("capture:")) {
        const image = captures?.get(src.slice(8));
        return image ? <ReplyImage image={image} caption={alt ?? ""} /> : (alt ?? null);
      }
      return src ? <img {...props} src={src} alt={alt ?? ""} /> : (alt ?? null);
    },
  };
  return splitInstanceReferences(text).map((part, index) =>
    part.type === "instance" ? (
      <MessageReference
        key={`${part.path}:${index}`}
        reference={part}
        action="explorer"
        source={source}
      />
    ) : (
      <Markdown
        key={index}
        remarkPlugins={REMARK_PLUGINS}
        components={components}
        urlTransform={keepFileLinks}
      >
        {part.value}
      </Markdown>
    ),
  );
}

const TextPartView = memo(
  function TextPartView({
    part,
    captures,
  }: {
    part: Extract<Part, { type: "text" }>;
    captures: ReadonlyMap<string, LightboxImage>;
  }) {
    return (
      <div className="text-sm leading-relaxed">
        <MessageText
          text={part.text}
          captures={captures}
          source={{ sessionID: part.sessionID, partID: part.id }}
        />
      </div>
    );
  },
  (prev, next) =>
    prev.part.text === next.part.text &&
    prev.part.sessionID === next.part.sessionID &&
    prev.part.id === next.part.id &&
    (!prev.part.text.includes("capture:") || prev.captures === next.captures),
);

const ReasoningPartView = memo(function ReasoningPartView({
  part,
}: {
  part: Extract<Part, { type: "reasoning" }>;
}) {
  if (!part.text) return null;
  const thinking = !part.time?.end;
  return (
    <ToolRow icon={Brain} label={thinking ? "Thinking" : "Thought"} running={thinking}>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {part.text}
      </p>
    </ToolRow>
  );
});

const ToolPartView = memo(function ToolPartView({
  part,
  images,
  onOpenSubagent,
}: {
  part: Extract<Part, { type: "tool" }>;
  images: LightboxImage[];
  onOpenSubagent?: (sessionID: string) => void;
}) {
  const status = part.state.status;
  const input = part.state.input ?? {};
  const output = status === "completed" && "output" in part.state ? part.state.output : undefined;
  const errorMsg =
    status === "error" && "error" in part.state ? String(part.state.error) : undefined;
  const tool = baseToolName(part.tool);

  if (tool === "task") {
    return (
      <>
        <SubagentToolCard part={part} onOpen={onOpenSubagent} />
        {images.length > 0 && <ActivityGallery images={images} />}
      </>
    );
  }

  if (errorMsg) {
    return (
      <ToolImagesContext.Provider value={images}>
        <ToolRow icon={CircleAlert} label={`${toolTitle(tool)} failed`} failed>
          <ToolText text={errorMsg} />
        </ToolRow>
      </ToolImagesContext.Provider>
    );
  }

  function renderToolContent() {
    switch (tool) {
      case "bash":
        return <BashToolView input={input} output={output} status={status} />;
      case "edit":
        return <EditToolView input={input} output={output} status={status} />;
      case "patch":
        return <PatchToolView input={input} status={status} />;
      case "read":
        return <ReadToolView input={input} status={status} />;
      case "write":
        return <WriteToolView input={input} status={status} />;
      case "glob":
        return <SearchToolView input={input} status={status} field="pattern" />;
      case "grep":
        return <SearchToolView input={input} status={status} field="pattern" />;
      case "webfetch":
        return <WebFetchToolView input={input} status={status} />;
      case "execute":
        return <ExecuteToolView input={input} output={output} status={status} />;
      default:
        return <DefaultToolView tool={tool} input={input} output={output} status={status} />;
    }
  }

  return (
    <ToolImagesContext.Provider value={images}>
      <div className="min-w-0 max-w-full overflow-hidden">{renderToolContent()}</div>
    </ToolImagesContext.Provider>
  );
});

function imagesInToolPart(part: Extract<Part, { type: "tool" }>): LightboxImage[] {
  const { state } = part;
  if ((state.status !== "completed" && state.status !== "error") || !state.attachments?.length) {
    return [];
  }
  const tool = baseToolName(part.tool);
  const calls = tool === "execute" ? state.metadata?.toolCalls : undefined;
  const call: unknown = Array.isArray(calls) && calls.length === 1 ? calls[0] : undefined;
  const nestedCapture =
    call !== null &&
    typeof call === "object" &&
    "tool" in call &&
    typeof call.tool === "string" &&
    /(?:^|[._:/])screen_capture$/.test(call.tool);
  let input: unknown = state.input;
  if (nestedCapture) input = "input" in call ? call.input : {};
  else if (Array.isArray(calls) && calls.length > 0) input = { ...state.input, toolCalls: calls };
  const arguments_ =
    input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(Object.entries(input))
      : state.input;
  const capture = nestedCapture || /(?:^|[._:/])screen_capture$/.test(tool);
  const label = capture ? "Studio screen capture" : toolTitle(tool);
  return state.attachments.flatMap((file, index) => {
    const mime = toolImageMime(file.mime);
    if (!mime || imageDataUrlMime(file.url) !== mime) return [];
    return [
      {
        id: `${part.id}:${index}`,
        src: file.url,
        label,
        name: file.filename || `${label || "Tool"} image ${index + 1}`,
        captureId:
          capture && state.attachments?.length === 1 && isCaptureId(arguments_.capture_id)
            ? arguments_.capture_id
            : undefined,
        capture: { timestamp: state.time.end, arguments: arguments_ },
      },
    ];
  });
}

const CompactionPartView = memo(function CompactionPartView() {
  return (
    <div className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
        <line x1="14" y1="10" x2="21" y2="3" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
      Context compacted
    </div>
  );
});

const OPENCODE_GO_URL = "https://opencode.ai/go";

/**
 * For a model that can't answer here, region-locked or retired: another free model to move the
 * chat to, through the same preference the model picker sets.
 */
function ModelSwitchCard({
  presentation,
  model,
  isLatest,
}: {
  presentation: ModelErrorPresentation;
  /** The model that failed, as "provider/model". */
  model?: string;
  isLatest: boolean;
}) {
  const providerList = useProviderList();
  const {
    selectedModel,
    hiddenModels,
    hideFreeModels,
    unavailableModels,
    setSelectedModel,
    markModelUnavailable,
  } = usePreferences();
  const [switchedTo, setSwitchedTo] = useState<ModelChoice | null>(null);
  const isRegion = presentation.kind === "region";

  useEffect(() => {
    if (isRegion && model) markModelUnavailable(model);
  }, [isRegion, model, markModelUnavailable]);

  if (!isLatest) {
    return <p className="my-1 text-xs text-muted-foreground">{presentation.title}.</p>;
  }
  const target =
    !hideFreeModels &&
    providerList &&
    pickFreeModel(providerList, {
      avoid: [model, selectedModel],
      unavailable: unavailableModels,
      hidden: hiddenModels,
    });

  return (
    <div role="alert" className="my-1 rounded-xl border bg-card px-3.5 py-3">
      <div className="text-sm font-medium">{presentation.title}</div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {switchedTo
          ? `Now using ${switchedTo.name}. Send your message again to keep going.`
          : presentation.description}
      </p>
      {target && !switchedTo ? (
        <button
          type="button"
          onClick={() => {
            setSelectedModel(target.key);
            setSwitchedTo(target);
          }}
          className="mt-2.5 inline-flex h-7 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          Switch to another free model
        </button>
      ) : null}
    </div>
  );
}

const ModelErrorCard = memo(function ModelErrorCard({
  error,
  hitAt,
  model,
  isLatest = true,
  allowModelSwitch = true,
}: {
  error: ModelError;
  /** When the error happened, for a free limit that has since lifted. */
  hitAt?: number;
  /** The model that failed, as "provider/model", when the error came on its reply. */
  model?: string;
  isLatest?: boolean;
  allowModelSwitch?: boolean;
}) {
  const { hideFreeModels } = usePreferences();
  const isLimit = !hideFreeModels && isFreeUsageLimit(error);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!isLimit) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [isLimit]);
  const presentation = presentModelError(error, hitAt, now);

  if (presentation.kind === "usage") {
    if (hideFreeModels) return null;
    // Once the limit has lifted or the chat has moved on, it's just history.
    const limitOver = hitAt !== undefined && now >= freeLimitEndsAt(error, hitAt);
    if (limitOver || !isLatest) {
      return <p className="my-1 text-xs text-muted-foreground">You reached the free limit here.</p>;
    }
    return (
      <div role="alert" className="my-1 rounded-xl border bg-card px-3.5 py-3">
        <div className="text-sm font-medium">{presentation.title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {presentation.description}
        </p>
        <a
          href={OPENCODE_GO_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex h-7 items-center rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          See OpenCode Go
        </a>
      </div>
    );
  }

  if (allowModelSwitch && (presentation.kind === "region" || presentation.kind === "unavailable")) {
    return <ModelSwitchCard presentation={presentation} model={model} isLatest={isLatest} />;
  }

  return (
    <div role="alert" className="my-1 text-[#cf222e]/75 dark:text-[#ff7b72]/70">
      <div className="flex min-w-0 items-start gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="min-w-0">
          <div className="text-sm font-medium leading-relaxed">{presentation.title}</div>
          <div className="text-sm leading-relaxed opacity-80">{presentation.description}</div>
          {presentation.detail && presentation.detail !== presentation.description && (
            <details className="mt-1">
              <summary className="cursor-pointer text-sm opacity-55 transition-opacity hover:opacity-100">
                Provider details
              </summary>
              <div className="mt-1 break-words pl-3 font-mono text-sm leading-relaxed opacity-70">
                {presentation.detail.slice(0, 1000)}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
});

type ActivityPart = Extract<Part, { type: "tool" | "reasoning" | "compaction" }>;
type ToolImages = ReadonlyMap<string, LightboxImage[]>;
const NO_IMAGES: LightboxImage[] = [];

const ActivityPartView = memo(function ActivityPartView({
  part,
  images = NO_IMAGES,
  onOpenSubagent,
}: {
  part: ActivityPart;
  images?: LightboxImage[];
  onOpenSubagent?: (sessionID: string) => void;
}) {
  switch (part.type) {
    case "reasoning":
      return <ReasoningPartView part={part} />;
    case "tool":
      return <ToolPartView part={part} images={images} onOpenSubagent={onOpenSubagent} />;
    case "compaction":
      return <CompactionPartView />;
  }
});

function ActivityGroup({ parts, images }: { parts: ActivityPart[]; images: ToolImages }) {
  if (parts.length === 1) {
    return <ActivityPartView part={parts[0]} images={images.get(parts[0].id)} />;
  }
  const tools = parts.filter((part) => part.type === "tool");
  const running = parts.some(
    (part) =>
      (part.type === "tool" && ["pending", "running"].includes(part.state.status)) ||
      (part.type === "reasoning" && !part.time?.end),
  );
  const allStudio =
    tools.length > 0 && tools.every((tool) => isStudioTool(tool.tool, tool.state.input));
  const label = running
    ? "Thinking"
    : allStudio
      ? `Used Roblox Studio ${tools.length === 1 ? "once" : `${tools.length} times`}`
      : tools.length
        ? `Used ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`
        : "Thought";
  return (
    <ToolImagesContext.Provider value={parts.flatMap((part) => images.get(part.id) ?? [])}>
      <ToolRow
        icon={Brain}
        label={label}
        running={running}
        failed={tools.some((tool) => tool.state.status === "error")}
      >
        <ToolImagesContext.Provider value={NO_IMAGES}>
          {parts.map((part) => (
            <ActivityPartView key={part.id} part={part} />
          ))}
        </ToolImagesContext.Provider>
      </ToolRow>
    </ToolImagesContext.Provider>
  );
}

// ── Inline todo panel ───────────────────────────────────────────────────

// ── Question prompt ─────────────────────────────────────────────────────

const QuestionPrompt = memo(function QuestionPrompt({
  question,
  onAnswer,
  onReject,
}: {
  question: QuestionRequest;
  onAnswer: (requestID: string, answers: QuestionAnswer[]) => void;
  onReject: (requestID: string) => void;
}) {
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});

  function toggleOption(qIdx: number, label: string, multiple?: boolean) {
    setSelected((prev) => {
      const current = prev[qIdx] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        if (!multiple) next.clear();
        next.add(label);
      }
      return { ...prev, [qIdx]: next };
    });
  }

  function submit() {
    const answers: QuestionAnswer[] = question.questions.map((_q, idx) => {
      const sel = selected[idx] ?? new Set<string>();
      const arr = [...sel];
      const custom = customInputs[idx]?.trim();
      if (custom) arr.push(custom);
      return arr;
    });
    onAnswer(question.id, answers);
  }

  return (
    <div className="animate-fade-in-up my-2 rounded-lg border bg-card p-3">
      {question.questions.map((q, qIdx) => (
        <div key={qIdx} className={qIdx > 0 ? "mt-3 border-t pt-3" : ""}>
          <div className="text-sm font-medium text-foreground">{q.header}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{q.question}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {q.options.map((opt) => {
              const isSelected = selected[qIdx]?.has(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => toggleOption(qIdx, opt.label, q.multiple)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${isSelected ? "border-foreground/40 bg-accent text-foreground" : "text-foreground hover:bg-accent"}`}
                  title={opt.description}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {q.custom !== false && (
            <input
              type="text"
              placeholder="Type your own answer..."
              value={customInputs[qIdx] ?? ""}
              onChange={(e) => setCustomInputs((prev) => ({ ...prev, [qIdx]: e.target.value }))}
              className="mt-2 w-full rounded-md border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-brand/60"
            />
          )}
        </div>
      ))}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          Submit
        </button>
        <button
          type="button"
          onClick={() => onReject(question.id)}
          className="rounded-md px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
});

// ── User message parts ──────────────────────────────────────────────────

const UserPartsView = memo(
  function UserPartsView({ parts }: { parts: Part[] }) {
    const fileParts: Extract<Part, { type: "file" }>[] = [];
    const textParts: Extract<Part, { type: "text" }>[] = [];
    for (const p of parts) {
      if (p.type === "file") fileParts.push(p as Extract<Part, { type: "file" }>);
      else if (p.type === "text") textParts.push(p as Extract<Part, { type: "text" }>);
    }
    const images = fileParts.map((part) => ({
      id: part.id,
      src: part.url,
      name: part.filename ?? "Attachment",
    }));
    return (
      <div className="text-sm leading-relaxed">
        {images.length > 0 && (
          <div className="mb-1.5">
            <ImageThumbnails images={images} />
          </div>
        )}
        {textParts.map((p) => (
          <span key={p.id} className="whitespace-pre-wrap">
            <ReferenceText
              text={p.text}
              focusable
              source={{ sessionID: p.sessionID, partID: p.id }}
            />
          </span>
        ))}
        {parts.length === 0 && <span className="italic opacity-50">...</span>}
      </div>
    );
  },
  (prev, next) => prev.parts === next.parts,
);

// ── Message bubble ─────────────────────────────────────────────────────

const messageClock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const speedFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function MessageTime({ timestamp }: { timestamp: number }) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const time = new Date(timestamp);
  if (Number.isNaN(time.getTime())) return null;
  return (
    <time dateTime={time.toISOString()} title={time.toLocaleString()}>
      {messageClock.format(time)}
    </time>
  );
}

function AssistantFooter({ messages }: { messages: MessageWithParts[] }) {
  let cost = 0;
  let tokens = 0;
  let elapsed = 0;
  for (const { info } of messages) {
    if (info.role !== "assistant" || !info.time.completed) continue;
    if (Number.isFinite(info.cost) && info.cost > 0) cost += info.cost;
    const duration = info.time.completed - info.time.created;
    const output = (info.tokens?.output ?? 0) + (info.tokens?.reasoning ?? 0);
    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(output) && output > 0) {
      tokens += output;
      elapsed += duration;
    }
  }
  const { time } = messages[messages.length - 1].info;
  const completed = "completed" in time ? time.completed : undefined;
  return (
    <div className="mt-1 flex min-h-4 flex-wrap gap-x-2 text-[11px] tabular-nums text-muted-foreground transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:hover)]:opacity-0">
      <MessageTime timestamp={completed ?? time.created} />
      {cost > 0 && <span title="Reported cost in US dollars">{formatModelCost(cost)}</span>}
      {elapsed > 0 && (
        <span title="Average generated tokens per second across timed steps, including tool time">
          {speedFormat.format((tokens * 1000) / elapsed)} tok/s
        </span>
      )}
    </div>
  );
}

function AssistantTurn({
  messages,
  isLatest,
  sessionID,
  onOpenSubagent,
}: {
  messages: MessageWithParts[];
  isLatest: boolean;
  sessionID?: string;
  onOpenSubagent?: (sessionID: string) => void;
}) {
  const images = new Map<string, LightboxImage[]>();
  const captures = new Map<string, LightboxImage>();
  const duplicateIds = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      const media = imagesInToolPart(part);
      if (!media.length) continue;
      images.set(part.id, media);
      for (const image of media) {
        if (!image.captureId || duplicateIds.has(image.captureId)) continue;
        if (captures.has(image.captureId)) {
          duplicateIds.add(image.captureId);
          captures.delete(image.captureId);
        } else {
          captures.set(image.captureId, image);
        }
      }
    }
  }

  const content: ReactNode[] = [];
  let activity: ActivityPart[] = [];
  const flushActivity = () => {
    if (activity.length === 0) return;
    content.push(<ActivityGroup key={activity[0].id} parts={activity} images={images} />);
    activity = [];
  };
  for (const [index, message] of messages.entries()) {
    const { info, parts } = message;
    if (info.role !== "assistant") continue;
    for (const part of parts) {
      if (part.type === "tool") {
        const name = baseToolName(part.tool);
        if (name === "todowrite" && part.state.status !== "error") continue;
        if (name === "task") {
          flushActivity();
          content.push(
            <ActivityPartView
              key={part.id}
              part={part}
              images={images.get(part.id)}
              onOpenSubagent={onOpenSubagent}
            />,
          );
        } else {
          activity.push(part);
        }
      } else if ((part.type === "reasoning" && part.text) || part.type === "compaction") {
        activity.push(part);
      } else if (part.type === "text" && part.text) {
        flushActivity();
        content.push(<TextPartView key={part.id} part={part} captures={captures} />);
      }
    }
    if (info.time.completed) {
      const models = new Set(
        parts.flatMap((part) => (part.type === "text" ? modelLinksIn(part.text) : [])),
      );
      for (const url of models) {
        flushActivity();
        content.push(<ModelCard key={`${info.id}:${url}`} url={url} />);
      }
    }
    if (info.error && info.error.name !== "MessageAbortedError") {
      flushActivity();
      content.push(
        <ModelErrorCard
          key={`${info.id}:error`}
          error={info.error}
          hitAt={info.time.completed ?? info.time.created}
          model={`${toAppProviderID(info.providerID)}/${info.modelID}`}
          isLatest={isLatest && index === messages.length - 1}
          allowModelSwitch={!sessionID}
        />,
      );
    } else if (parts.length === 0 && !info.error && !info.time.completed) {
      flushActivity();
      content.push(<BloxBotThinking key={info.id} />);
    }
  }
  flushActivity();
  return (
    <div className={`group/message w-full space-y-1 pb-4 ${sessionID ? "" : "max-w-[85%]"}`}>
      {content}
      <AssistantFooter messages={messages} />
    </div>
  );
}

const MessageBubble = memo(function MessageBubble(props: ComponentProps<typeof AssistantTurn>) {
  const [message] = props.messages;
  if (message.info.role === "assistant") return <AssistantTurn {...props} />;
  const steer = message.info.inbox?.delivery === "steer" ? message.info.inbox.state : undefined;
  const receipt =
    steer &&
    {
      pending: "Waiting for the next model step",
      delivered: "Steer delivered to the conversation",
      read: "Model received this steer",
    }[steer];
  const ReceiptIcon = steer === "read" ? CheckCheck : Check;
  return (
    <div className="flex flex-col items-end pb-4">
      <div className="min-w-0 max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-foreground wrap-anywhere">
        <UserPartsView parts={message.parts} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 pr-1 text-[11px] tabular-nums text-muted-foreground">
        <MessageTime timestamp={message.info.time.created} />
        {receipt && (
          <span
            role="img"
            aria-label={receipt}
            title={receipt}
            className={steer === "read" ? "text-sky-600 dark:text-sky-400" : undefined}
          >
            <ReceiptIcon size={14} aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
});

function groupTranscript(cache: MessagesCache, ids: string[]) {
  const groups: MessageWithParts[][] = [];
  for (const id of ids) {
    const message = cache.messagesById[id];
    if (!message) continue;
    if (
      message.info.role === "user" &&
      message.info.inbox?.delivery === "queue" &&
      message.info.inbox.state === "pending"
    )
      continue;
    const group = groups[groups.length - 1];
    const first = group?.[0]?.info;
    if (
      group &&
      first?.role === "assistant" &&
      message.info.role === "assistant" &&
      first.parentID === message.info.parentID
    ) {
      group.push(message);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

function railPreview(group: MessageWithParts[]) {
  let fallback = "Message";
  for (const { parts } of group) {
    for (const part of parts) {
      if (part.type === "text" && !part.ignored && part.text.trim()) {
        const text = instanceReferenceLabels(part.text.slice(0, 2000))
          .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, (_, alt) => alt || "Image")
          // Keep line breaks so the rail card can render the markdown structure.
          .replace(/[^\S\n]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return text.length > 600 ? `${text.slice(0, 599)}…` : text;
      }
      if (part.type === "file") fallback = part.filename || "Attachment";
      if (part.type === "tool") fallback = "Tool activity";
      if (part.type === "reasoning" && fallback === "Message") fallback = "Thinking";
    }
  }
  return fallback;
}

function ChatTranscriptRail({
  sessionId,
  entries,
  activeIndex,
  visibleRange,
  onJump,
}: {
  sessionId: string;
  entries: readonly RailEntry[];
  activeIndex?: number;
  visibleRange?: { startIndex: number; endIndex: number } | null;
  onJump: (index: number) => void;
}) {
  const audio = useAudioVisualizer();
  return (
    <MessageRail
      entries={entries}
      sessionId={sessionId}
      activeIndex={activeIndex}
      visibleRange={visibleRange}
      onJump={onJump}
      renderAudio={
        audio.status === "active"
          ? (viewport) => <AudioSpectrum analyser={audio.analyser} viewport={viewport} />
          : undefined
      }
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────

const BusyThinkingIndicator = memo(function BusyThinkingIndicator({
  status,
  lastMessage,
}: {
  status: SessionStatus | undefined;
  lastMessage: MessageWithParts | undefined;
}) {
  if (status?.type === "retry") {
    return <BloxBotThinking label="Waiting to retry" detail={status.message} />;
  }
  if (status?.type !== "busy" || !lastMessage || lastMessage.info.role !== "user") return null;
  return <BloxBotThinking />;
});

const ESTIMATED_MESSAGE_HEIGHT = 80;
const LATEST_SCROLL_THRESHOLD = 48;

function distanceFromLatest(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight - element.scrollTop;
}

function ChatMessages({
  sessionID,
  onOpenSubagent,
}: {
  sessionID?: string;
  onOpenSubagent?: (sessionID: string) => void;
}) {
  const messageIds = useMessageIds(sessionID);
  const sessionError = useSessionError(sessionID);
  const { activeSessionId } = useActiveSession();
  const messages =
    useTranscript(
      sessionID ?? activeSessionId,
      useCallback((cache: MessagesCache) => groupTranscript(cache, messageIds), [messageIds]),
      sessionID ? { includePending: true } : undefined,
    ) ?? [];
  const lastGroup = messages[messages.length - 1];
  const lastMessage = lastGroup?.[lastGroup.length - 1];
  const sessionStatus = useSessionStatus(sessionID ?? activeSessionId);
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";
  const activeQuestion = useActiveQuestion(sessionID);
  const activePermission = useActivePermission(sessionID);
  const lastMessageHasError =
    lastMessage?.info.role === "assistant" && Boolean(lastMessage.info.error);
  const answerQuestion = useAnswerQuestion(sessionID);
  const rejectQuestion = useRejectQuestion(sessionID);
  const replyPermission = useReplyPermission(sessionID);

  const containerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const railJumpFrame = useRef<number | null>(null);
  const lastScrollTop = useRef(0);
  const [showLatest, setShowLatest] = useState(false);
  const hasTranscript = Boolean(
    messages.length || isBusy || sessionError || activeQuestion || activePermission,
  );

  const virtualizer = useVirtualizer({
    count: messages.length,
    enabled: messages.length > 0,
    getItemKey: (index) => messages[index][0].info.id,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    initialOffset: () => messages.length * ESTIMATED_MESSAGE_HEIGHT,
    overscan: 5,
  });
  // When a row above the viewport is measured, the virtualizer corrects scrollTop by the size
  // delta before the new total height reaches the DOM. Rows shorter than the estimate make that
  // correction look like the reader scrolling up, which turned followLatest off and left a newly
  // opened session stranded above the bottom. While following, the ResizeObserver below re-pins
  // to the true bottom instead, so skip the correction. Otherwise this is the library's own
  // rule, including the corrections it has queued but not yet scrolled to (a private field).
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (followLatest.current) return false;
    const queued = (instance as unknown as { scrollAdjustments?: number }).scrollAdjustments ?? 0;
    return item.start < (instance.scrollOffset ?? 0) + queued;
  };
  const virtualItems = virtualizer.getVirtualItems();
  const railEntries = useMemo<RailEntry[]>(
    () =>
      sessionID
        ? []
        : messages.flatMap((group, index) => {
            const { info } = group[0];
            if (info.role !== "user") return [];
            const next = messages[index + 1];
            return [
              {
                id: info.id,
                label: "You",
                preview: railPreview(group),
                reply: next?.[0].info.role === "assistant" ? railPreview(next) : undefined,
                index,
              },
            ];
          }),
    [messages, sessionID],
  );
  const cancelRailJump = useCallback(() => {
    if (railJumpFrame.current === null) return;
    cancelAnimationFrame(railJumpFrame.current);
    railJumpFrame.current = null;
  }, []);
  useEffect(() => cancelRailJump, [cancelRailJump]);

  const jumpToMessage = (index: number) => {
    cancelRailJump();
    followLatest.current = false;
    const element = containerRef.current;
    if (!element) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      virtualizer.scrollToIndex(index, { align: "start" });
      return;
    }
    const started = performance.now();
    let previous = 0;
    const animate = (now: number) => {
      // Remeasure the destination as earlier virtual rows become visible.
      const offset = virtualizer.getOffsetForIndex(index, "start")?.[0];
      if (offset === undefined) {
        railJumpFrame.current = null;
        return;
      }
      const progress = Math.min(1, (now - started) / 420);
      const eased = 1 - (1 - progress) ** 3;
      element.scrollTop += ((offset - element.scrollTop) * (eased - previous)) / (1 - previous);
      previous = eased;
      railJumpFrame.current = progress < 1 ? requestAnimationFrame(animate) : null;
    };
    railJumpFrame.current = requestAnimationFrame(animate);
  };
  const nextEntry = railEntries.findIndex(
    (entry) => entry.index > (virtualizer.range?.startIndex ?? 0),
  );
  const activeRailEntry =
    followLatest.current || nextEntry === -1
      ? railEntries[railEntries.length - 1]
      : railEntries[nextEntry - 1];
  const rail =
    !sessionID && activeSessionId ? (
      <ChatTranscriptRail
        sessionId={activeSessionId}
        entries={railEntries}
        activeIndex={activeRailEntry?.index}
        visibleRange={virtualizer.range}
        onJump={jumpToMessage}
      />
    ) : null;

  const scrollToLatest = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
    setShowLatest(false);
  }, []);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const away = distanceFromLatest(element) > LATEST_SCROLL_THRESHOLD;
    // An increase in content height must not count as the reader scrolling up.
    if (railJumpFrame.current === null && (!away || element.scrollTop < lastScrollTop.current)) {
      followLatest.current = !away;
    }
    lastScrollTop.current = element.scrollTop;
    setShowLatest(away && !followLatest.current);
  }, []);

  useLayoutEffect(() => {
    const element = containerRef.current;
    const content = contentRef.current;
    if (!hasTranscript || !element || !content) return;
    followLatest.current = true;
    scrollToLatest();
    if (typeof ResizeObserver === "undefined") return;

    const updateScroll = () => {
      if (followLatest.current) scrollToLatest();
      else setShowLatest(distanceFromLatest(element) > LATEST_SCROLL_THRESHOLD);
    };
    const observer = new ResizeObserver(updateScroll);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasTranscript, scrollToLatest]);

  const handleAnswer = useCallback(
    (requestID: string, answers: QuestionAnswer[]) => answerQuestion.mutate({ requestID, answers }),
    [answerQuestion],
  );
  const handleReject = useCallback(
    (requestID: string) => rejectQuestion.mutate(requestID),
    [rejectQuestion],
  );
  const handleReplyPermission = useCallback(
    (requestID: string, reply: "once" | "always" | "reject") =>
      replyPermission.mutate({ requestID, reply }),
    [replyPermission],
  );

  if (!hasTranscript) {
    if (sessionID) {
      return (
        <p className="min-h-0 min-w-0 overflow-y-auto px-3 py-4 text-sm text-muted-foreground">
          Waiting for the first message.
        </p>
      );
    }
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        {rail}
        <div className="animate-fade-in-up text-center">
          <h2 className="text-lg font-medium text-foreground">What would you like to build?</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Ask me to work on your Roblox game, build a small website, or anything else.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {rail}
      <section
        ref={containerRef}
        aria-label={sessionID ? "Subagent transcript" : "Chat transcript"}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The transcript needs native keyboard scrolling.
        tabIndex={0}
        data-chat-scroll={sessionID ? "subagent" : ""}
        data-away-from-latest={showLatest || undefined}
        onScroll={handleScroll}
        onWheel={cancelRailJump}
        onPointerDown={cancelRailJump}
        onKeyDown={cancelRailJump}
        onClickCapture={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest('[data-preserve-scroll] button[aria-expanded="false"]')
          ) {
            followLatest.current = false;
          }
        }}
        className={`app-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto outline-none [overflow-anchor:none] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring overflow-x-hidden ${sessionID ? "wrap-anywhere" : ""}`}
      >
        <div
          ref={contentRef}
          className={`mx-auto max-w-2xl px-4 py-4 ${railEntries.length ? "w-[calc(100%-3.5rem)]" : ""}`}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((virtualItem) => (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div>
                  <MessageBubble
                    messages={messages[virtualItem.index]}
                    isLatest={virtualItem.index === messages.length - 1}
                    sessionID={sessionID}
                    onOpenSubagent={onOpenSubagent}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {activeQuestion && (
              <QuestionPrompt
                question={activeQuestion}
                onAnswer={handleAnswer}
                onReject={handleReject}
              />
            )}
            {activePermission && (
              <PermissionPrompt permission={activePermission} onReply={handleReplyPermission} />
            )}
            <BusyThinkingIndicator status={sessionStatus} lastMessage={lastMessage} />
            {sessionError && !lastMessageHasError && (
              <ModelErrorCard error={sessionError} allowModelSwitch={!sessionID} />
            )}
          </div>
        </div>
      </section>
      {showLatest && (
        <button
          type="button"
          aria-label={isBusy ? "Go to latest, model is working" : "Go to latest"}
          title="Go to latest"
          onClick={() => {
            cancelRailJump();
            followLatest.current = true;
            scrollToLatest();
            containerRef.current?.focus({ preventScroll: true });
          }}
          className="absolute bottom-3 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {isBusy ? <StudLoader /> : <ArrowDown aria-hidden="true" size={17} />}
        </button>
      )}
    </div>
  );
}

export default function ChatMessagesWithImages({
  onAddImage,
  ...props
}: ComponentProps<typeof ChatMessages> & { onAddImage?: AddComposerImage }) {
  const { activeSessionId } = useActiveSession();
  return (
    <ImageLightboxProvider onAddImage={onAddImage}>
      <ChatMessages key={props.sessionID ?? activeSessionId} {...props} />
    </ImageLightboxProvider>
  );
}
