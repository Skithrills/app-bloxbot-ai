import { Schema } from "effect";
import { COMPOSER_SHORTCUTS, DEFAULT_COMPOSER_SHORTCUTS } from "../lib/composerDelivery";
import type {
  ExplorerDetailsRequest,
  ExplorerEdit,
  ExplorerEditResult,
  ExplorerNodeDetails,
  ExplorerSyncRequest,
  ExplorerSyncResult,
  ExplorerTreeUpdate,
} from "../lib/explorer";
import { OPENAI_SERVICE_TIERS } from "../lib/openAiProfiles";
import type { AppUpdateCheck } from "./appUpdate";
import type { SkillImportList, SkillImportResult } from "./skillImport";
import {
  type StudioTargetDiscovery,
  StudioTargetSchema,
  type StudioTargetSelection,
} from "./studioTarget";
import type { SubscriptionProvider, SubscriptionUsageResult } from "./subscriptionUsage";

const MutableStrings = Schema.mutable(Schema.Array(Schema.String));
const ProjectFolderSchema = Schema.Struct({
  directory: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  studio: Schema.NullOr(StudioTargetSchema),
});

export type ProjectFolder = typeof ProjectFolderSchema.Type;

export const ThemePreferenceSchema = Schema.Literal("light", "dark", "system");
// Saved in the config file, so an ID here is never renamed or removed: a value the schema
// stops accepting would make the whole file read as invalid.
export const ACCENT_COLORS = [
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
] as const;
export const AccentColorSchema = Schema.Literal(...ACCENT_COLORS);
export const DEFAULT_ACCENT_COLOR: AccentColor = "blue";
const EffortControlSchema = Schema.Literal("slider", "dropdown");
const ContextChartSchema = Schema.Literal("bar", "pie");
const ModelCatalogOrderSchema = Schema.Literal("name", "newest");
const ComposerShortcutSchema = Schema.Literal(...COMPOSER_SHORTCUTS);
const ComposerShortcutsSchema = Schema.Struct({
  steer: ComposerShortcutSchema,
  queue: ComposerShortcutSchema,
}).pipe(Schema.filter(({ steer, queue }) => steer === "disabled" || steer !== queue));

export type ThemePreference = typeof ThemePreferenceSchema.Type;
export type AccentColor = typeof AccentColorSchema.Type;
export type EffortControl = typeof EffortControlSchema.Type;
export type ContextChart = typeof ContextChartSchema.Type;
export type ModelCatalogOrder = typeof ModelCatalogOrderSchema.Type;

const ChatModelSelectionSchema = Schema.Struct({
  key: Schema.String,
  variant: Schema.NullOr(Schema.String),
});
export type ChatModelSelection = typeof ChatModelSelectionSchema.Type;

export const NotificationKindsSchema = Schema.Struct({
  finished: Schema.Boolean,
  waiting: Schema.Boolean,
  failed: Schema.Boolean,
  app: Schema.Boolean,
});

export type NotificationKinds = typeof NotificationKindsSchema.Type;

export const ModelSettingsSchema = Schema.Struct({
  hideFreeModels: Schema.Boolean,
  openAiApiServiceTier: Schema.Literal(...OPENAI_SERVICE_TIERS),
  subagentModels: Schema.Record({
    key: Schema.String.pipe(Schema.pattern(/^[a-z][a-z-]{0,63}$/)),
    value: Schema.String.pipe(Schema.pattern(/^[^\s/]+\/[^\s]+$/), Schema.maxLength(512)),
  }),
  subagentEfforts: Schema.optional(
    Schema.Record({
      key: Schema.String.pipe(Schema.pattern(/^[a-z][a-z-]{0,63}$/)),
      value: Schema.String.pipe(Schema.pattern(/^[^\s]+$/), Schema.maxLength(128)),
    }),
  ),
});

export const ModelSettingsPatchSchema = Schema.partial(ModelSettingsSchema);
export type ModelSettings = typeof ModelSettingsSchema.Type;
export type ModelSettingsPatch = typeof ModelSettingsPatchSchema.Type;

export const AppConfigSchema = Schema.mutable(
  Schema.Struct({
    ...ModelSettingsSchema.fields,
    lastModel: Schema.NullOr(Schema.String),
    lastModelVariant: Schema.NullOr(Schema.String),
    chatModels: Schema.Record({ key: Schema.String, value: ChatModelSelectionSchema }),
    modelCatalogOrder: ModelCatalogOrderSchema,
    paidDefaultModel: Schema.NullOr(Schema.String),
    lastPaidModel: Schema.NullOr(Schema.String),
    hiddenModels: MutableStrings,
    // Models refused in the user's region, so they aren't picked again.
    unavailableModels: MutableStrings,
    theme: ThemePreferenceSchema,
    accentColor: AccentColorSchema,
    effortControl: EffortControlSchema,
    // How the Context panel draws token usage.
    contextChart: ContextChartSchema,
    composerShortcuts: ComposerShortcutsSchema,
    composerPredictions: Schema.Boolean,
    // Explicit opt-in to reading the separately signed-in Codex CLI account.
    codexCliUsageEnabled: Schema.Boolean,
    audioVisualizerEnabled: Schema.Boolean,
    studioTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
    // Chats someone chose to use for work that has nothing to do with Studio.
    chatsWithoutStudio: MutableStrings,
    // Places someone picked by hand, as opposed to whichever Studio happened to be open.
    chatsWithChosenPlace: MutableStrings,
    // The Studio a chat's latest message was sent to, which says which one it used if it did.
    routedTargetsBySession: Schema.Record({ key: Schema.String, value: StudioTargetSchema }),
    projectFolders: Schema.optional(Schema.Array(ProjectFolderSchema)),
    studioSetupSkipped: Schema.Boolean,
    // Only for people who haven't chosen kinds yet: off here means every kind starts off.
    systemNotifications: Schema.Boolean,
    notificationKinds: Schema.NullOr(NotificationKindsSchema),
    notificationSound: Schema.Boolean,
    notificationsOffered: Schema.Boolean,
    // What the user wrote in Settings; null follows BloxBot's default as it changes.
    systemPrompt: Schema.NullOr(Schema.String),
    promptsSent: Schema.Number,
    starCalloutShown: Schema.Boolean,
  }),
);

export type AppConfig = typeof AppConfigSchema.Type;

export const DEFAULT_APP_CONFIG: AppConfig = {
  lastModel: null,
  lastModelVariant: null,
  chatModels: {},
  modelCatalogOrder: "name",
  paidDefaultModel: null,
  lastPaidModel: null,
  hideFreeModels: false,
  openAiApiServiceTier: "auto",
  subagentModels: {},
  subagentEfforts: {},
  hiddenModels: [],
  unavailableModels: [],
  theme: "system",
  accentColor: DEFAULT_ACCENT_COLOR,
  effortControl: "slider",
  contextChart: "bar",
  composerShortcuts: DEFAULT_COMPOSER_SHORTCUTS,
  composerPredictions: false,
  codexCliUsageEnabled: false,
  audioVisualizerEnabled: false,
  studioTargetsBySession: {},
  chatsWithoutStudio: [],
  chatsWithChosenPlace: [],
  routedTargetsBySession: {},
  studioSetupSkipped: false,
  systemNotifications: true,
  notificationKinds: null,
  notificationSound: true,
  notificationsOffered: false,
  systemPrompt: null,
  promptsSent: 0,
  starCalloutShown: false,
};

export const AppConfigPatchSchema = Schema.partial(AppConfigSchema);

export const OpenCodeInfoSchema = Schema.mutable(
  Schema.Struct({
    authorization: Schema.String,
    port: Schema.Number.pipe(Schema.int(), Schema.between(1, 65_535)),
    workspace: Schema.String,
  }),
);

export type OpenCodeInfo = typeof OpenCodeInfoSchema.Type;

export type OpenCodeStartupProgress =
  | { phase: "checking" }
  | {
      phase: "downloading";
      downloadedBytes: number;
      totalBytes: number | null;
      bytesPerSecond: number;
    }
  | { phase: "verifying" }
  | { phase: "installing" }
  | { phase: "starting" };

/**
 * Whether BloxBot could start Roblox Studio's MCP helper. `not_installed` means Studio isn't on
 * this computer, `helper_missing` that Studio is but hasn't installed its helper yet, and
 * `unavailable` that the helper started but closed before it connected.
 */
export const StudioMcpStatusSchema = Schema.Struct({
  state: Schema.Literal("starting", "connected", "not_installed", "helper_missing", "unavailable"),
});

export type StudioMcpStatus = typeof StudioMcpStatusSchema.Type;

export const SystemNotificationSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
});

export type SystemNotification = typeof SystemNotificationSchema.Type;

export const ToolImageExportSchema = Schema.Struct({
  action: Schema.Literal("copy", "save"),
  png: Schema.Uint8ArrayFromSelf,
  filename: Schema.String,
});

export type ToolImageExport = typeof ToolImageExportSchema.Type;

export interface DesktopApi {
  /** Brings the tree up to date, sending the parts that changed to `onExplorerTreeUpdate`. */
  syncExplorerTree(studioId: string, request: ExplorerSyncRequest): Promise<ExplorerSyncResult>;
  onExplorerTreeUpdate(listener: (update: ExplorerTreeUpdate) => void): () => void;
  /** Null when reading it in the background would have to run a script. */
  getExplorerNodeDetails(
    studioId: string,
    request: ExplorerDetailsRequest,
  ): Promise<ExplorerNodeDetails | null>;
  editExplorerObject(studioId: string, edit: ExplorerEdit): Promise<ExplorerEditResult>;
  discoverStudioTargets(): Promise<StudioTargetDiscovery>;
  selectStudioTarget(targetKey: string): Promise<StudioTargetSelection>;
  getOpenCodeInfo(): Promise<OpenCodeInfo>;
  /** The folder OpenCode installs into, for antivirus exclusions. Null outside the desktop app. */
  getOpenCodeInstallFolder(): Promise<string | null>;
  chooseProjectFolder(): Promise<string | null>;
  getSubscriptionUsage(provider: SubscriptionProvider): Promise<SubscriptionUsageResult>;
  getStudioMcpStatus(): Promise<StudioMcpStatus>;
  onOpenCodeStartupProgress(listener: (progress: OpenCodeStartupProgress) => void): () => void;
  getVersion(): Promise<string>;
  /** BloxBot's AGENTS.md, which is empty until the user writes something. */
  readInstructions(): Promise<string>;
  saveInstructions(text: string): Promise<void>;
  /** The skills in the user's Codex and Claude Code folders, and the ones BloxBot has. */
  listImportableSkills(): Promise<SkillImportList>;
  /** Copies them into BloxBot's own folder: all of them, as a sync, or only the named ones. */
  importSkills(names?: readonly string[]): Promise<SkillImportResult>;
  openUrl(url: string): Promise<void>;
  showSystemNotification(notification: SystemNotification): Promise<boolean>;
  onSystemNotificationClick(listener: (id: string) => void): () => void;
  /** Opens the page where the system lets people allow BloxBot's notifications. */
  openNotificationSettings(): Promise<void>;
  exportToolImage(image: ToolImageExport): Promise<boolean>;
  /** Asks where to save a copy of a video the chat plays from disk. False when cancelled. */
  saveVideo(url: string): Promise<boolean>;
  /** Where a chosen, dropped or pasted file is on disk. Empty for one that was never a file. */
  getFilePath(file: File): string;
  loadConfig(): Promise<AppConfig>;
  patchConfig(patch: Partial<AppConfig>): Promise<void>;
  setModelSettings(patch: ModelSettingsPatch): Promise<void>;
  setSystemPrompt(systemPrompt: string | null): Promise<void>;
  checkForUpdate(): Promise<AppUpdateCheck>;
  installUpdate(): Promise<void>;
  relaunch(): Promise<void>;
  getBlenderToolsState(): Promise<BlenderToolsState>;
  /** Resolves once setup has finished, and rejects if it can't, with a BlenderFailureReason in its message. */
  installBlenderTools(): Promise<void>;
  cancelBlenderTools(): Promise<void>;
  openBlender(): Promise<void>;
  removeBlenderTools(): Promise<void>;
  onBlenderSetupProgress(listener: (progress: BlenderSetupProgress) => void): () => void;
  /** What this Studio can do about uploads. Runs no script, so it can be asked in the background. */
  getUploadAccess(studioKey: string | null, modelUrl: string | null): Promise<UploadAccess>;
  /** Null when the link isn't a model file BloxBot can read. */
  readModelFile(url: string): Promise<ModelFileInfo | null>;
  /** `hash` is the file the person looked at, and nothing else gets sent. */
  /** With addOnly, it only adds what's already on Roblox for this game's owner, and never uploads. */
  uploadModelToPlace(
    url: string,
    studioKey: string,
    hash: string,
    addOnly?: boolean,
  ): Promise<ModelUploadResult>;
  onModelUploadStep(listener: (url: string, step: ModelUploadStep) => void): () => void;
  /**
   * Receives errors from the main process so the renderer can report them. Subscribing
   * tells the main process the window is ready, which flushes errors buffered until then.
   */
}

export type UploadAccessState =
  | "no_studio"
  /** Several Studios are open and this chat hasn't picked one. */
  | "choose_studio"
  /** This Studio was open before Roblox's update, and doesn't have Open Cloud until it's reopened. */
  | "reopen_studio"
  /** Permissions are per game, so a place that isn't published can't have any. */
  | "not_published"
  | "needs_permission"
  /** Studio only uploads from folders someone has approved. */
  | "needs_folder"
  /** Uploads send a copy saved next to the model, and BloxBot can't save in its folder. */
  | "folder_unwritable"
  /** Studio couldn't get a sign-in Roblox accepts, which no permission fixes. */
  | "refused"
  | "ready";

export interface UploadAccess {
  state: UploadAccessState;
  readOn: boolean;
  writeOn: boolean;
  /** The folder to approve in Studio: where this model is, or where the AI exports models. */
  folder: string;
  folderUrl: string;
}

export interface ModelFileInfo {
  name: string;
  fileName: string;
  path: string;
  folder: string;
  data: Uint8Array;
  kind: "fbx" | "glb";
  sizeBytes: number;
  hash: string;
  /** What already happened to exactly these bytes. */
  sent: { assetId: string | null; moderation: "approved" | "rejected" | "checking" } | null;
}

export type ModelUploadStep = "uploading" | "checking" | "adding";

export type ModelUploadFailure =
  | "no_file"
  | "file_changed"
  | "refused"
  | "rate_limited"
  | "file_rejected"
  | "folder_unwritable"
  | "other_owner"
  | "place_changed"
  | "studio_error";

/** Why an approved model wasn't put in the place, when BloxBot can tell. */
export type NotAddedReason = "place_changed" | "playtest";

export type ModelUploadResult =
  | { status: "added"; assetId: string; path: string }
  | { status: "rejected"; assetId: string }
  | { status: "checking"; assetId: string }
  | { status: "not_added"; assetId: string; reason?: NotAddedReason }
  | { status: "needs_setup"; access: UploadAccessState }
  | { status: "needs_folder"; folder: string }
  | { status: "failed"; reason: ModelUploadFailure };

export type BlenderSetupStep = "downloading" | "unpacking" | "connecting";

export interface BlenderSetupProgress {
  step: BlenderSetupStep;
  downloadedBytes: number;
  totalBytes: number;
}

export type BlenderFailureReason = "disk_full" | "network" | "blocked" | "corrupt" | "other";

export type BlenderToolsState =
  | { state: "unsupported" }
  | { state: "not_installed" }
  | { state: "installing"; progress: BlenderSetupProgress | null }
  | { state: "ready"; running: boolean };
