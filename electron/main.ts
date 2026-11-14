import { copyFile, mkdir, rename, readFile, rm, writeFile } from "node:fs/promises";
import { networkDriveLetters, onNetworkDrive } from "./networkDrives";
import { isOpenableUrl } from "./openableUrl";
import {
  getUploadAccess,
  modelFolder,
  readModelFile,
  readSentModel,
  sendModelToPlace,
  sentModelsFile,
} from "./services/ModelUpload";
import {
  blenderMcpServerConfig,
  getBlenderToolsState,
  installBlenderTools,
  isBlenderInstalled,
  openBlender,
  removeBlenderTools,
} from "./services/BlenderTools";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  screen,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import { Cause, Data, Effect, Layer, ManagedRuntime, Schema } from "effect";

import {
  BlenderSetupProgress,
  type AppConfig,
  AppConfigPatchSchema,
  AppConfigSchema,
  DEFAULT_APP_CONFIG,
  ModelSettingsPatchSchema,
  type OpenCodeStartupProgress,
  SystemNotificationSchema,
  ToolImageExportSchema,
  ModelUploadResult,
} from "../src/types/desktop";
import { OPENAI_ENGINE_OAUTH_PROVIDER } from "../src/lib/openAiProfiles";
import { SubscriptionProviderSchema } from "../src/types/subscriptionUsage";
import {
  isActiveRojoServer,
  rojoManifestKey,
  rojoProjectFilesFor,
  ROJO_STANDALONE_PROJECT,
} from "../src/types/rojo";
import {
  ExplorerDetailsRequestSchema,
  ExplorerEditSchema,
  ExplorerNodeDetailsSchema,
  ExplorerSyncRequestSchema,
} from "../src/lib/explorer";
import {
  StudioTargetDiscoverySchema,
  StudioTargetSelectionSchema,
} from "../src/types/studioTarget";
import { handleLastWindowClosed } from "./appLifecycle";
import { checkForAppUpdate, installAppUpdate, listReleaseHistory } from "./appUpdater";
import { blenderToolsFolder, engineFolder } from "./machineFolders";
import { syncExplorerTree } from "./explorerTree";
import {
  createStudioIconResolver,
  STUDIO_ICON_SCHEME,
  studioIconProtocolHandler,
} from "./studioIconResolver";
import { readInstructions, saveInstructions } from "./instructionFiles";
import { defaultSkillSources, importSkills, listImportableSkills } from "./skillImport";
import {
  type CallStudioTool,
  discoverStudioTargets,
  editExplorerObject,
  inspectExplorerNode,
  readStudioRojoConnection,
  selectStudioTarget,
} from "./studioQueries";
import { withBlender, withModelSettings, withSystemPrompt } from "./opencodeConfig";
import { channels } from "./channels";
import {
  LOCAL_VIDEO_SCHEME,
  localVideoPath,
  serveLocalVideo,
  videoSaveOptions,
} from "./localVideo";
import { makeOpenCodeLayer, OpenCode } from "./services/OpenCode";
import { isRojoManifestPath, RojoServers } from "./services/Rojo";
import { createSubscriptionUsageReader } from "./services/SubscriptionUsage";
import { createSystemNotifier, notificationSettingsUrl } from "./systemNotifications";
import { makeStudioMcpBrokerLayer, StudioMcpBroker } from "./services/StudioMcpBroker";
import { loadWindowState, minimumWindowSize, saveWindowState, type WindowMode } from "./windowState";

protocol.registerSchemesAsPrivileged([
  { scheme: STUDIO_ICON_SCHEME, privileges: { standard: true, secure: true } },
  {
    scheme: LOCAL_VIDEO_SCHEME,
    privileges: { standard: true, secure: true, stream: true, corsEnabled: true },
  },
]);

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const defaultConfig: AppConfig = DEFAULT_APP_CONFIG;
const configMutex = Effect.unsafeMakeSemaphore(1);
const rojoServers = new RojoServers();

function configPath(): string {
  return join(app.getPath("userData"), "bloxbot-store.json");
}

let mainWindow: BrowserWindow | null = null;
let quitting = false;
let shuttingDown = false;

const showSystemNotification = createSystemNotifier({
  isSupported: () => Notification.isSupported(),
  // BloxBot plays its own sound, if the user wants one.
  create: (content) => new Notification({ ...content, silent: true }),
  onClick: (id) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(channels.systemNotificationClicked, id);
  },
});

function reportMainError(source: string, error: unknown): void {
  console.error(`[${source}]`, error);
}

// A monitor observes without replacing Electron's own uncaught-exception handling.
process.on("uncaughtExceptionMonitor", (error) => reportMainError("main_uncaught_exception", error));
process.on("unhandledRejection", (reason) => reportMainError("main_unhandled_rejection", reason));

const reportLayerFailure = (source: string) => (cause: Cause.Cause<unknown>) =>
  Effect.sync(() => {
    if (!Cause.isInterruptedOnly(cause)) reportMainError(source, Cause.squash(cause));
  });

class DesktopMainError extends Data.TaggedError("DesktopMainError")<{
  message: string;
  cause?: unknown;
}> {}

const studioMcpBrokerLayer = makeStudioMcpBrokerLayer({
  workspace: join(app.getPath("home"), "BloxBot"),
  // What Studio's helper and the broker report, kept so a dropped connection can be traced later.
  logFile: join(app.getPath("userData"), "logs", "studio-mcp.log"),
  localAppData: process.env.LOCALAPPDATA,
  comSpec: process.env.ComSpec,
  systemRoot: process.env.SystemRoot,
  // Reported once per launch, after the startup retries, and not when Studio isn't installed.
  onStartFailure: (error) => reportMainError("studio_mcp_broker_start", error),
}).pipe(Layer.tapErrorCause(reportLayerFailure("studio_mcp_broker_start")));

const machineFolderOptions = {
  platform: process.platform,
  userData: app.getPath("userData"),
  localAppData: process.env.LOCALAPPDATA,
};
const openCodeBinaryDirectory = engineFolder(machineFolderOptions);
const blenderToolsRoot = () => blenderToolsFolder(machineFolderOptions);

const openCodeRuntime = ManagedRuntime.make(
  makeOpenCodeLayer({
      binaryCacheDirectory: openCodeBinaryDirectory,
      // Chromium's network stack, which trusts the certificates installed on the system.
      fetchWithSystemCertificates: (url, init) => net.fetch(url, init),
      workspace: join(app.getPath("home"), "BloxBot"),
      loadSystemPrompt: () =>
        loadConfig.pipe(
          Effect.map((config) => config.systemPrompt),
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      loadModelSettings: () => loadConfig.pipe(Effect.orElseSucceed(() => defaultConfig)),
      onOpenAiProfileMigrated: (providerID) =>
        migrateOpenAiPreferences(providerID).pipe(
          Effect.catchAll(() => Effect.logWarning("[opencode] Could not migrate OpenAI model preferences")),
        ),
      loadBlenderServer: () =>
        Effect.promise(async () =>
          (await isBlenderInstalled(blenderToolsRoot())) ? blenderMcpServerConfig(blenderToolsRoot()) : null,
        ),
      onStartupProgress: (progress: OpenCodeStartupProgress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(channels.openCodeStartupProgress, progress);
        }
      },
    }).pipe(
    Layer.tapErrorCause(reportLayerFailure("opencode_start")),
    Layer.provideMerge(studioMcpBrokerLayer),
  ),
);

function isMissingFile(cause: unknown): boolean {
  return (
    cause !== null &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}

function parseExternalUrl(rawUrl: string) {
  return Effect.try({
    try: () => new URL(rawUrl),
    catch: (cause) =>
      new DesktopMainError({ message: "Only web, email and local file links can be opened", cause }),
  }).pipe(
    Effect.flatMap((url) =>
      isOpenableUrl(url)
        ? Effect.succeed(url)
        : Effect.fail(
            new DesktopMainError({ message: "Only web, email and local file links can be opened" }),
          ),
    ),
  );
}

function openLink(url: URL) {
  return Effect.tryPromise({
    try: async () => {
      if (url.protocol === "file:") {
        const path = fileURLToPath(url);
        // Showing it opens Explorer on the share, which sends the person's sign-in there.
        if (onNetworkDrive(path, await networkDriveLetters())) {
          throw new Error("Files on network drives can't be opened from a link");
        }
        shell.showItemInFolder(path);
        return;
      }
      await shell.openExternal(url.href);
    },
    catch: (cause) => new DesktopMainError({ message: "Failed to open URL", cause }),
  });
}

const loadConfig = Effect.gen(function* () {
  const contents = yield* Effect.tryPromise({
    try: () => readFile(configPath(), "utf8"),
    catch: (cause) => new DesktopMainError({ message: "Failed to read app configuration", cause }),
  }).pipe(
    Effect.catchAll((error) =>
      isMissingFile(error.cause) ? Effect.succeed(null) : Effect.fail(error),
    ),
  );
  if (contents === null) return defaultConfig;

  return yield* Effect.gen(function* () {
    const stored = yield* Effect.try({
      try: () => JSON.parse(contents) as unknown,
      catch: (cause) => new DesktopMainError({ message: "App configuration is invalid", cause }),
    });
    const candidate =
      stored !== null && typeof stored === "object" ? { ...defaultConfig, ...stored } : defaultConfig;
    return yield* Schema.decodeUnknown(AppConfigSchema)(candidate).pipe(
      Effect.mapError(
        (cause) => new DesktopMainError({ message: "App configuration is invalid", cause }),
      ),
    );
  }).pipe(
    Effect.tapError((error) => Effect.logWarning(error.message, error.cause)),
    Effect.catchAll(() => Effect.succeed(defaultConfig)),
  );
});

function patchConfig(input: unknown) {
  return Effect.gen(function* () {
    const patch = yield* Schema.decodeUnknown(AppConfigPatchSchema)(input).pipe(
      Effect.mapError(
        (cause) => new DesktopMainError({ message: "App configuration patch is invalid", cause }),
      ),
    );
    const current = yield* loadConfig;
    const next = { ...current, ...patch };
    yield* Effect.tryPromise({
      try: () => writeConfigFile(configPath(), JSON.stringify(next, null, 2)),
      catch: (cause) =>
        new DesktopMainError({ message: "Failed to write app configuration", cause }),
    });
  }).pipe(configMutex.withPermits(1));
}

async function writeConfigFile(destination: string, contents: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, destination);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

function migrateOpenAiPreferences(providerID: string) {
  const prefix = `${OPENAI_ENGINE_OAUTH_PROVIDER}/`;
  const migrate = (key: string) =>
    key.startsWith(prefix) ? `${providerID}/${key.slice(prefix.length)}` : key;
  return Effect.gen(function* () {
    const { lastModel, lastPaidModel, paidDefaultModel, chatModels, hiddenModels, unavailableModels } =
      yield* loadConfig;
    const patch: Partial<AppConfig> = {};
    if (lastModel?.startsWith(prefix)) patch.lastModel = migrate(lastModel);
    if (lastPaidModel?.startsWith(prefix)) patch.lastPaidModel = migrate(lastPaidModel);
    if (paidDefaultModel?.startsWith(prefix)) patch.paidDefaultModel = migrate(paidDefaultModel);
    const chatSelections = Object.entries(chatModels);
    if (chatSelections.some(([, selection]) => selection.key.startsWith(prefix))) {
      patch.chatModels = Object.fromEntries(
        chatSelections.map(([sessionID, selection]) => [
          sessionID,
          { ...selection, key: migrate(selection.key) },
        ]),
      );
    }
    if (hiddenModels.some((key) => key.startsWith(prefix))) patch.hiddenModels = hiddenModels.map(migrate);
    if (unavailableModels.some((key) => key.startsWith(prefix))) {
      patch.unavailableModels = unavailableModels.map(migrate);
    }
    if (Object.keys(patch).length > 0) yield* patchConfig(patch);
  });
}

const runMain = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

function requireRojoProject(config: AppConfig, projectId: string) {
  if (
    projectId !== ROJO_STANDALONE_PROJECT &&
    !config.projectFolders?.some((folder) => folder.directory === projectId)
  ) {
    throw new Error("This project folder is no longer in BloxBot.");
  }
}

function registerRojoHandlers() {
  const projectId = Schema.decodeUnknownSync(
    Schema.String.pipe(Schema.filter((id) => id === ROJO_STANDALONE_PROJECT || isAbsolute(id))),
  );
  const projectFile = Schema.decodeUnknownSync(Schema.String.pipe(Schema.filter(isRojoManifestPath)));

  function updateManifestFiles(
    id: string,
    update: (files: readonly string[]) => readonly string[],
  ): Promise<readonly string[]> {
    return runMain(
      Effect.gen(function* () {
        const config = yield* loadConfig;
        return yield* Effect.tryPromise({
          try: async () => {
            requireRojoProject(config, id);
            const files = update(rojoProjectFilesFor(config, id));
            // Older review builds can still read the first manifest.
            const legacy = { ...config.rojoProjectFiles };
            if (files[0]) legacy[id] = files[0];
            else delete legacy[id];
            await writeConfigFile(
              configPath(),
              JSON.stringify(
                {
                  ...config,
                  rojoProjectFiles: legacy,
                  rojoManifests: { ...config.rojoManifests, [id]: files },
                },
                null,
                2,
              ),
            );
            return files;
          },
          catch: (cause) =>
            cause instanceof Error ? cause : new Error("Could not save the Rojo project files."),
        });
      }).pipe(configMutex.withPermits(1)),
    );
  }

  ipcMain.handle(channels.addRojoProjectFiles, async (event, rawId: unknown) => {
    const id = projectId(rawId);
    const config = await runMain(loadConfig);
    requireRojoProject(config, id);
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Choose Rojo project files",
      defaultPath: id || rojoProjectFilesFor(config, id)[0],
      filters: [{ name: "Rojo project files", extensions: ["json", "jsonc"] }],
      properties: ["openFile", "multiSelections"],
    };
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    if (result.canceled || !result.filePaths.length) return [];
    if (!result.filePaths.every(isRojoManifestPath)) {
      throw new Error("Choose files ending in .project.json or .project.jsonc.");
    }
    return updateManifestFiles(id, (files) => {
      const unique = new Map(files.map((file) => [rojoManifestKey(id, file), file]));
      for (const file of result.filePaths) {
        const key = rojoManifestKey(id, file);
        if (!unique.has(key)) unique.set(key, file);
      }
      return [...unique.values()];
    });
  });

  ipcMain.handle(channels.removeRojoProjectFile, async (_event, rawId: unknown, rawFile: unknown) => {
    const id = projectId(rawId);
    const file = projectFile(rawFile);
    const key = rojoManifestKey(id, file);
    await updateManifestFiles(id, (files) => {
      const server = rojoServers.list().find(
        (run) => rojoManifestKey(run.projectId, run.projectFile) === key,
      );
      if (isActiveRojoServer(server)) {
        throw new Error("Stop this Rojo server before removing its file.");
      }
      return files.filter((saved) => rojoManifestKey(id, saved) !== key);
    });
  });

  ipcMain.handle(channels.listRojoServers, () => rojoServers.list());
  ipcMain.handle(channels.startRojoServer, async (_event, rawId: unknown, rawFile: unknown) => {
    const id = projectId(rawId);
    const file = projectFile(rawFile);
    const key = rojoManifestKey(id, file);
    const { started } = await runMain(
      configMutex.withPermits(1)(
        loadConfig.pipe(
          Effect.map((config) => {
            requireRojoProject(config, id);
            const saved = rojoProjectFilesFor(config, id).find(
              (candidate) => rojoManifestKey(id, candidate) === key,
            );
            if (!saved) throw new Error("Add the Rojo project file before starting it.");
            return { started: rojoServers.start(id, saved) };
          }),
        ),
      ),
    );
    return started;
  });
  ipcMain.handle(channels.stopRojoServer, (_event, rawId: unknown, rawFile: unknown) =>
    rojoServers.stop(projectId(rawId), projectFile(rawFile)),
  );
}
const StudioKeySchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512));
// Left out, it means every skill, which is also the only time removed ones are cleaned up.
const SkillNamesSchema = Schema.NullishOr(
  Schema.Array(Schema.String.pipe(Schema.maxLength(64))).pipe(Schema.maxItems(1_000)),
);
// Instances can nest deeply under long names, so a path gets far more room than an ID.

/** Runs a read against Studio through the broker, keeping Studio's error text for the renderer. */
// OpenCode runs with XDG_CONFIG_HOME inside the workspace (see services/OpenCode.ts).
const openCodeConfigDirectory = () =>
  join(app.getPath("home"), "BloxBot", ".opencode", "config", "opencode");

const queryStudio = <A>(query: (callTool: CallStudioTool) => Promise<A>) =>
  openCodeRuntime.runPromise(
    Effect.gen(function* () {
      const broker = yield* StudioMcpBroker;
      return yield* Effect.tryPromise({
        try: () => query((name, args, options) => Effect.runPromise(broker.callTool(name, args, options))),
        catch: (cause) =>
          new DesktopMainError({
            message: cause instanceof Error ? cause.message : "Studio didn't answer",
            cause,
          }),
      });
    }),
  );

const registerIpcHandlers = Effect.sync(() => {
  registerRojoHandlers();
  ipcMain.handle(channels.readStudioRojoConnection, (_event, input: unknown) => {
    const studioId = Schema.decodeUnknownSync(StudioKeySchema)(input);
    return queryStudio((callTool) => readStudioRojoConnection(callTool, studioId));
  });
  const getOpenCodeInfo = () =>
    openCodeRuntime.runPromise(
      OpenCode.pipe(Effect.flatMap((service) => service.info)),
    );
  ipcMain.handle(channels.getOpenCodeInfo, getOpenCodeInfo);
  const readSubscriptionUsage = createSubscriptionUsageReader(
    getOpenCodeInfo,
    (url, options) => net.fetch(url, options),
    app.getVersion(),
  );
  ipcMain.handle(channels.getSubscriptionUsage, (_event, provider: unknown) =>
    Schema.decodeUnknownPromise(SubscriptionProviderSchema)(provider).then(readSubscriptionUsage),
  );
  ipcMain.handle(channels.getOpenCodeInstallFolder, () => openCodeBinaryDirectory);
  ipcMain.handle(channels.chooseProjectFolder, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Choose a project folder",
      properties: ["openDirectory"],
    };
    const result = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(channels.getStudioMcpStatus, () =>
    openCodeRuntime.runPromise(StudioMcpBroker.pipe(Effect.flatMap((broker) => broker.status))),
  );
  ipcMain.handle(channels.getVersion, () => runMain(Effect.sync(() => app.getVersion())));
  ipcMain.handle(channels.readInstructions, () => readInstructions(openCodeConfigDirectory()));
  ipcMain.handle(channels.saveInstructions, (_event, text: unknown) =>
    Schema.decodeUnknownPromise(Schema.String)(text).then((value) =>
      saveInstructions(openCodeConfigDirectory(), value),
    ),
  );
  const skillFolders = () => ({
    sources: defaultSkillSources(app.getPath("home")),
    configDirectory: openCodeConfigDirectory(),
    home: app.getPath("home"),
  });
  // One at a time, so two imports never copy into BloxBot's skills folder at once.
  let skillWork: Promise<unknown> = Promise.resolve();
  const afterSkillWork = <A>(run: () => Promise<A>): Promise<A> => {
    const result = skillWork.then(run);
    skillWork = result.catch(() => undefined);
    return result;
  };
  ipcMain.handle(channels.listImportableSkills, () =>
    afterSkillWork(() => listImportableSkills(skillFolders())),
  );
  ipcMain.handle(channels.importSkills, (_event, names: unknown) =>
    afterSkillWork(async () => {
      const chosen = await Schema.decodeUnknownPromise(SkillNamesSchema)(names);
      return importSkills({ ...skillFolders(), names: chosen ?? undefined });
    }),
  );
  ipcMain.handle(channels.loadConfig, () => runMain(loadConfig));
  ipcMain.handle(channels.patchConfig, (_event, patch: unknown) => runMain(patchConfig(patch)));
  // Serialize changes to the engine config so one settings screen can't overwrite another.
  const configWrites = Effect.unsafeMakeSemaphore(1);
  ipcMain.handle(channels.setModelSettings, (_event, input: unknown) =>
    runMain(
      configWrites.withPermits(1)(
        Effect.gen(function* () {
          const patch = yield* Schema.decodeUnknown(ModelSettingsPatchSchema)(input).pipe(
            Effect.mapError((cause) => new DesktopMainError({ message: "Model settings are invalid", cause })),
          );
          const current = yield* loadConfig;
          const path = join(openCodeConfigDirectory(), "opencode.json");
          const read = Effect.tryPromise({
            try: () => readFile(path, "utf8"),
            catch: (cause) => new DesktopMainError({ message: "Failed to read OpenCode settings", cause }),
          });
          const previous = yield* read;
          const write = (contents: string) => Effect.tryPromise({
            try: () => writeConfigFile(path, contents),
            catch: (cause) => new DesktopMainError({ message: "Failed to apply model settings", cause }),
          });
          yield* write(withModelSettings(previous, { ...current, ...patch }));
          yield* patchConfig(patch).pipe(Effect.tapError(() => write(previous).pipe(Effect.ignore)));
        }),
      ),
    ),
  );
  ipcMain.handle(channels.setSystemPrompt, (_event, input: unknown) =>
    runMain(
      Effect.gen(function* () {
        const systemPrompt = yield* Schema.decodeUnknown(Schema.NullOr(Schema.String))(input).pipe(
          Effect.mapError(
            (cause) => new DesktopMainError({ message: "System prompt is invalid", cause }),
          ),
        );
        yield* configWrites.withPermits(1)(
          Effect.gen(function* () {
            yield* patchConfig({ systemPrompt });
            // OpenCode reads this file. The renderer reloads it once this has written the change.
            const configFile = join(openCodeConfigDirectory(), "opencode.json");
            yield* Effect.tryPromise({
              try: async () =>
                writeFile(
                  configFile,
                  withSystemPrompt(await readFile(configFile, "utf8"), systemPrompt),
                ),
              catch: (cause) =>
                new DesktopMainError({ message: "Failed to apply the system prompt", cause }),
            });
          }),
        );
      }),
    ),
  );
  // A newer read replaces one still running, so a closed place doesn't keep Studio busy.
  let explorerTreeRead: AbortController | null = null;
  ipcMain.handle(channels.syncExplorerTree, (event, studioId: unknown, request: unknown) =>
    queryStudio(async (callTool) => {
      const id = await Schema.decodeUnknownPromise(StudioKeySchema)(studioId);
      const options = await Schema.decodeUnknownPromise(ExplorerSyncRequestSchema)(request);
      explorerTreeRead?.abort();
      const read = new AbortController();
      explorerTreeRead = read;
      return syncExplorerTree(callTool, id, {
        ...options,
        signal: read.signal,
        onUpdate: (update) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(channels.explorerTreeUpdate, { studioId: id, ...update });
          }
        },
      });
    }),
  );
  ipcMain.handle(channels.getExplorerNodeDetails, (_event, studioId: unknown, request: unknown) =>
    queryStudio(async (callTool) => {
      const details = await inspectExplorerNode(
        callTool,
        await Schema.decodeUnknownPromise(StudioKeySchema)(studioId),
        await Schema.decodeUnknownPromise(ExplorerDetailsRequestSchema)(request),
      );
      return details && Schema.decodeUnknownPromise(ExplorerNodeDetailsSchema)(details);
    }),
  );
  ipcMain.handle(channels.editExplorerObject, (_event, studioId: unknown, edit: unknown) =>
    queryStudio(async (callTool) =>
      editExplorerObject(
        callTool,
        await Schema.decodeUnknownPromise(StudioKeySchema)(studioId),
        await Schema.decodeUnknownPromise(ExplorerEditSchema)(edit),
      ),
    ),
  );
  ipcMain.handle(channels.discoverStudioTargets, () =>
    queryStudio(async (callTool) =>
      Schema.decodeUnknownPromise(StudioTargetDiscoverySchema)(await discoverStudioTargets(callTool)),
    ),
  );
  ipcMain.handle(channels.selectStudioTarget, (_event, input: unknown) =>
    queryStudio(async (callTool) =>
      Schema.decodeUnknownPromise(StudioTargetSelectionSchema)(
        await selectStudioTarget(callTool, await Schema.decodeUnknownPromise(StudioKeySchema)(input)),
      ),
    ),
  );
  ipcMain.handle(channels.openUrl, (_event, rawUrl: string) =>
    runMain(
      parseExternalUrl(rawUrl).pipe(
        Effect.flatMap(openLink),
      ),
    ),
  );
  ipcMain.handle(channels.openNotificationSettings, () => {
    const url = notificationSettingsUrl(process.platform, "ai.bloxbot.desktop");
    return url ? shell.openExternal(url) : undefined;
  });
  ipcMain.handle(channels.showSystemNotification, (_event, input: unknown) =>
    runMain(
      Schema.decodeUnknown(SystemNotificationSchema)(input).pipe(
        Effect.mapError(
          (cause) => new DesktopMainError({ message: "System notification is invalid", cause }),
        ),
        Effect.flatMap((notification) =>
          Effect.tryPromise({
            try: () => showSystemNotification(notification),
            catch: (cause) =>
              new DesktopMainError({ message: "Failed to show a system notification", cause }),
          }),
        ),
      ),
    ),
  );
  let updateCheck: ReturnType<typeof checkForAppUpdate> | undefined;
  ipcMain.handle(channels.listReleaseHistory, () =>
    listReleaseHistory((url, options) => net.fetch(url, options)),
  );
  let updateInstall: ReturnType<typeof installAppUpdate> | undefined;
  ipcMain.handle(channels.checkForUpdate, () => {
    if (!app.isPackaged) return { status: "unsupported" };
    updateCheck ??= checkForAppUpdate(
      () => autoUpdater.checkForUpdates(),
      (url, options) => net.fetch(url, options),
    ).finally(() => {
      updateCheck = undefined;
    });
    return updateCheck;
  });
  ipcMain.handle(channels.installUpdate, () => {
    if (!app.isPackaged) throw new Error("Updates are only available in packaged builds.");
    updateInstall ??= installAppUpdate(autoUpdater).catch((error) => {
      updateInstall = undefined;
      throw error;
    });
    return updateInstall;
  });
  // Kept here rather than on the page, since leaving Settings shouldn't stop or lose a setup.
  let blenderSetup: AbortController | null = null;
  let blenderProgress: BlenderSetupProgress | null = null;
  const applyBlenderToConfig = (blender: ReturnType<typeof blenderMcpServerConfig> | null) =>
    configWrites.withPermits(1)(
      Effect.gen(function* () {
        const { systemPrompt } = yield* loadConfig;
        yield* Effect.tryPromise({
          try: async () => {
            const configFile = join(openCodeConfigDirectory(), "opencode.json");
            await writeFile(
              configFile,
              withBlender(await readFile(configFile, "utf8"), blender, systemPrompt),
            );
          },
          catch: (cause) =>
            new DesktopMainError({ message: "Failed to apply Blender's settings", cause }),
        });
      }),
    );
  ipcMain.handle(channels.getBlenderToolsState, () =>
    blenderSetup
      ? { state: "installing", progress: blenderProgress }
      : getBlenderToolsState(blenderToolsRoot()),
  );
  ipcMain.handle(channels.installBlenderTools, (event) => {
    if (blenderSetup) return undefined;
    const setup = new AbortController();
    blenderSetup = setup;
    blenderProgress = null;
    return runMain(
      installBlenderTools({
        root: blenderToolsRoot(),
        fetch: (url, init) => net.fetch(url, init),
        signal: setup.signal,
        onProgress: (progress) => {
          blenderProgress = progress;
          if (!event.sender.isDestroyed()) {
            event.sender.send(channels.blenderSetupProgress, progress);
          }
        },
      }).pipe(
        // The page reads the reason from the message, as errors lose everything else crossing over.
        Effect.mapError(
          (error) =>
            new DesktopMainError({
              message: `${error.message} (reason: ${error.reason})`,
              cause: error.cause,
            }),
        ),
        Effect.andThen(applyBlenderToConfig(blenderMcpServerConfig(blenderToolsRoot()))),
        Effect.ensuring(
          Effect.sync(() => {
            blenderSetup = null;
          }),
        ),
      ),
    );
  });
  ipcMain.handle(channels.cancelBlenderTools, () => blenderSetup?.abort());
  ipcMain.handle(channels.openBlender, () =>
    runMain(
      Effect.tryPromise({
        try: () => openBlender(blenderToolsRoot()),
        catch: (cause) => new DesktopMainError({ message: "Couldn't open Blender", cause }),
      }),
    ),
  );
  ipcMain.handle(channels.removeBlenderTools, () =>
    runMain(
      Effect.gen(function* () {
        const state = yield* Effect.promise(() => getBlenderToolsState(blenderToolsRoot()));
        if (state.state === "ready" && state.running) {
          return yield* Effect.fail(new DesktopMainError({ message: "Close Blender first" }));
        }
        yield* applyBlenderToConfig(null);
        yield* Effect.tryPromise({
          try: () => removeBlenderTools(blenderToolsRoot()),
          // The page reloads OpenCode only for a lock, which is the one thing that fixes.
          catch: (cause) => {
            const code = (cause as { code?: unknown } | null)?.code;
            const locked = code === "EBUSY" || code === "EPERM" || code === "EACCES";
            return new DesktopMainError({
              message: `Couldn't remove Blender${locked ? " (locked)" : ""}`,
              cause,
            });
          },
        });
      }),
    ),
  );
  const sentModels = () => sentModelsFile(app.getPath("userData"));
  const uploadsInFlight = new Map<
    string,
    { result: Promise<ModelUploadResult>; urls: Set<string> }
  >();
  ipcMain.handle(channels.getUploadAccess, async (_event, studioKey: unknown, modelUrl: unknown) => {
    const modelsFolder = join(app.getPath("home"), "BloxBot", "Models");
    await mkdir(modelsFolder, { recursive: true }).catch(() => {});
    const folder = (typeof modelUrl === "string" ? modelFolder(modelUrl) : null) ?? modelsFolder;
    const details = await queryStudio((callTool) =>
      getUploadAccess(callTool, typeof studioKey === "string" ? studioKey : null, folder),
    ).catch(() => ({ state: "no_studio" as const, readOn: false, writeOn: false }));
    // Failing keeps the last answer on screen, and the checklist asks again on its next check.
    if (details.state === "rate_limited") throw new Error("Roblox asked BloxBot to slow down");
    return { ...details, state: details.state, folder, folderUrl: pathToFileURL(folder).href };
  });
  ipcMain.handle(channels.readModelFile, async (_event, url: unknown) => {
    const file = await readModelFile(await Schema.decodeUnknownPromise(Schema.String)(url));
    if (!file) return null;
    return {
      name: file.name,
      fileName: file.fileName,
      path: file.path,
      folder: file.folder,
      data: file.bytes,
      kind: file.kind,
      sizeBytes: file.bytes.byteLength,
      hash: file.hash,
      sent: await readSentModel(sentModels(), file.hash),
    };
  });
  ipcMain.handle(channels.exportToolImage, async (event, raw: unknown) => {
    const { action, png, filename } = await Schema.decodeUnknownPromise(ToolImageExportSchema)(raw);
    const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length > 128 * 1024 * 1024 || !bytes.subarray(0, 8).equals(pngSignature)) {
      throw new Error("Invalid PNG image");
    }
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error("Could not decode the PNG image");
    if (action === "copy") {
      clipboard.writeImage(image);
      return true;
    }
    const name = filename.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "") ?? "";
    const safeName = name.replace(/[^a-zA-Z0-9 _.-]/g, "_").replace(/^[. ]+|[. ]+$/g, "");
    const options = {
      defaultPath: `${safeName.slice(0, 100) || "attachment"}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, bytes);
    return true;
  });
  ipcMain.handle(channels.saveVideo, async (event, raw: unknown) => {
    // Only a video the chat can already play, named by the same address it plays from.
    const path = localVideoPath(await Schema.decodeUnknownPromise(Schema.String)(raw));
    if (!path) throw new Error("Not a video on this computer");
    const options = videoSaveOptions(path);
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
    if (result.canceled || !result.filePath) return false;
    // Saving over the file itself would leave it empty.
    if (resolve(result.filePath) !== resolve(path)) await copyFile(path, result.filePath);
    return true;
  });
  ipcMain.handle(
    channels.uploadModelToPlace,
    async (event, url: unknown, studioKey: unknown, hash: unknown, addOnly: unknown) => {
      const decodedUrl = await Schema.decodeUnknownPromise(Schema.String)(url);
      const studioId = await Schema.decodeUnknownPromise(StudioKeySchema)(studioKey);
      const expectedHash = await Schema.decodeUnknownPromise(Schema.String)(hash);
      // A second click, or a second card with the same bytes, joins the upload that's running for
      // this Studio. Another Studio gets its own, since the model has to go in its place too.
      const onlyAdd = addOnly === true;
      const key = `${studioId}\n${expectedHash}\n${onlyAdd}`;
      const running = uploadsInFlight.get(key);
      if (running) {
        running.urls.add(decodedUrl);
        return running.result;
      }
      const urls = new Set([decodedUrl]);
      const result = queryStudio((callTool) =>
        sendModelToPlace(decodedUrl, {
          callTool,
          studioId,
          sentFile: sentModels(),
          expectedHash,
          addOnly: onlyAdd,
          onStep: (step) => {
            if (event.sender.isDestroyed()) return;
            for (const each of urls) event.sender.send(channels.modelUploadStep, each, step);
          },
        }),
      ).finally(() => uploadsInFlight.delete(key));
      uploadsInFlight.set(key, { result, urls });
      return result;
    },
  );
  ipcMain.handle(channels.relaunch, () =>
    runMain(
      Effect.sync(() => {
        app.relaunch();
        app.quit();
      }),
    ),
  );
});

function createWindow(): Effect.Effect<void, DesktopMainError> {
  return Effect.gen(function* () {
    const statePath = join(app.getPath("userData"), "window-state.json");
    const state = loadWindowState(
      statePath,
      screen.getPrimaryDisplay().workArea,
      screen.getAllDisplays().map((display) => display.workArea),
    );
    const window = yield* Effect.try({
      try: () =>
        new BrowserWindow({
          title: "BloxBot",
          icon: join(app.getAppPath(), app.isPackaged ? "dist" : "public", "bloxbot-icon.png"),
          ...state.bounds,
          minWidth: Math.min(minimumWindowSize.width, state.bounds.width),
          minHeight: Math.min(minimumWindowSize.height, state.bounds.height),
          backgroundColor: "#ffffff",
          titleBarStyle: "hiddenInset",
          show: false,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: join(currentDirectory, "..", "preload", "preload.mjs"),
            sandbox: true,
          },
        }),
      catch: (cause) => new DesktopMainError({ message: "Failed to create app window", cause }),
    });

    yield* Effect.sync(() => {
      mainWindow = window;
      if (process.platform === "win32") {
        window.webContents.session.setDisplayMediaRequestHandler((request, respond) => {
          const frame = request.frame;
          if (
            mainWindow !== window ||
            !frame ||
            frame !== window.webContents.mainFrame ||
            !request.userGesture ||
            !request.audioRequested ||
            !request.videoRequested
          ) {
            respond({});
            return;
          }
          // Chromium requires video for display capture. Supply the app's own frame,
          // which the visualizer stops immediately, alongside system output audio.
          respond({ video: frame, audio: "loopback" });
        });
      }
      window.webContents.setUserAgent(
        `${window.webContents.getUserAgent()} BloxBot/${app.getVersion()}`,
      );
      window.webContents.on("context-menu", (_event, { isEditable, editFlags }) => {
        if (!isEditable) return;
        Menu.buildFromTemplate([
          { role: "cut", accelerator: "CommandOrControl+X", enabled: editFlags.canCut },
          { role: "copy", accelerator: "CommandOrControl+C", enabled: editFlags.canCopy },
          { role: "paste", accelerator: "CommandOrControl+V", enabled: editFlags.canPaste },
          { type: "separator" },
          { role: "selectAll", accelerator: "CommandOrControl+A", enabled: editFlags.canSelectAll },
        ]).popup({ window });
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        Effect.runFork(
          parseExternalUrl(url).pipe(
            Effect.flatMap(openLink),
            Effect.catchAll(Effect.logWarning),
          ),
        );
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        const currentUrl = window.webContents.getURL();
        const shouldBlock = Effect.runSync(
          Effect.try({
            try: () => Boolean(currentUrl && new URL(url).origin !== new URL(currentUrl).origin),
            catch: () => true,
          }).pipe(Effect.catchAll(() => Effect.succeed(true))),
        );
        if (shouldBlock) event.preventDefault();
      });
      let lastMode = state.mode;
      const currentMode = (): WindowMode =>
        window.isFullScreen() ? "fullscreen" : window.isMaximized() ? "maximized" : "normal";
      const rememberMode = () => {
        if (!window.isMinimized()) lastMode = currentMode();
      };
      window.on("maximize", rememberMode);
      window.on("unmaximize", rememberMode);
      window.on("enter-full-screen", rememberMode);
      window.on("leave-full-screen", rememberMode);
      window.once("ready-to-show", () => {
        if (state.mode === "maximized") window.maximize();
        window.show();
        if (state.mode === "fullscreen") window.setFullScreen(true);
      });
      window.on("close", () => {
        rememberMode();
        try {
          saveWindowState(statePath, { bounds: window.getNormalBounds(), mode: lastMode });
        } catch (cause) {
          Effect.runSync(Effect.logWarning("Failed to save window state", cause));
        }
      });
      window.on("closed", () =>
        Effect.runSync(
          Effect.sync(() => {
            if (mainWindow === window) mainWindow = null;
          }),
        ),
      );
    });

    yield* Effect.tryPromise({
      try: () =>
        process.env.VITE_DEV_SERVER_URL
          ? window.loadURL(process.env.VITE_DEV_SERVER_URL)
          : window.loadFile(join(currentDirectory, "..", "..", "dist", "index.html")),
      catch: (cause) => new DesktopMainError({ message: "Failed to load the app window", cause }),
    });
  });
}

const registerAppLifecycle = Effect.sync(() => {
  // Windows drops notifications from an app without this. It matches appId in electron-builder.yml.
  if (process.platform === "win32") app.setAppUserModelId("ai.bloxbot.desktop");

  // Opening BloxBot again brings this window forward instead of starting a second copy.
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("window-all-closed", () =>
    Effect.runSync(
      Effect.sync(() => {
        handleLastWindowClosed(process.platform, {
          hideDock: () => app.dock?.hide(),
          quit: () => app.quit(),
        });
      }),
    ),
  );

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    Effect.runFork(
      Effect.promise(async () => {
        const results = await Promise.allSettled([rojoServers.stopAll(), openCodeRuntime.dispose()]);
        for (const result of results) {
          if (result.status === "rejected") reportMainError("shutdown", result.reason);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            quitting = true;
            app.quit();
          }),
        ),
      ),
    );
  });
});

Effect.runFork(
  Effect.gen(function* () {
    // A second copy would start a second OpenCode on the same database, which then fails with
    // "database is locked". It hands over to the first one instead.
    if (!app.requestSingleInstanceLock()) {
      yield* Effect.sync(() => {
        quitting = true;
        app.quit();
      });
      return;
    }
    yield* Effect.sync(() => {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.autoRunAppAfterInstall = true;
      // The updater logs raw feed errors before the check can classify an empty fork.
      autoUpdater.logger = null;
    });
    yield* registerAppLifecycle;
    yield* Effect.tryPromise({
      try: () => app.whenReady(),
      catch: (cause) => new DesktopMainError({ message: "Electron failed to become ready", cause }),
    });
    yield* Effect.sync(() => {
      const resolveStudioIcon = createStudioIconResolver({
        platform: process.platform,
        home: app.getPath("home"),
        userData: app.getPath("userData"),
        localAppData: process.env.LOCALAPPDATA,
        xdgDataHome: process.env.XDG_DATA_HOME,
        winePrefix: process.env.WINEPREFIX,
        loadSpriteSheet(png) {
          const image = nativeImage.createFromBuffer(png);
          if (image.isEmpty()) return null;
          return { ...image.getSize(), crop: (rectangle) => image.crop(rectangle).toPNG() };
        },
      });
      protocol.handle(STUDIO_ICON_SCHEME, studioIconProtocolHandler(resolveStudioIcon));
      protocol.handle(LOCAL_VIDEO_SCHEME, serveLocalVideo);
    });
    yield* registerIpcHandlers;
    yield* Effect.sync(() => Menu.setApplicationMenu(null));
    yield* createWindow();
    yield* Effect.sync(() =>
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          Effect.runFork(
            createWindow().pipe(
              Effect.tapError((error) =>
                Effect.sync(() => reportMainError("main_create_window", error)),
              ),
              Effect.catchAll(Effect.logError),
            ),
          );
        }
      }),
    );
  }).pipe(
    Effect.tapError((error) => Effect.sync(() => reportMainError("main_startup", error))),
    Effect.catchAll(Effect.logError),
  ),
);
