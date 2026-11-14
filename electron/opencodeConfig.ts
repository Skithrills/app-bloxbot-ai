import { win32 } from "node:path";

import { isKnownFreeModelKey } from "../src/lib/freeModels";
import { OPENAI_API_PROVIDER, toEngineModelKey } from "../src/lib/openAiProfiles";
import { splitModelKey } from "../src/lib/splitModelKey";
import { STUDIO_MCP_SERVER_NAME } from "../src/lib/studioMcp";
import { SUBAGENT_PROFILE_PROMPT, SUBAGENT_PROFILES } from "../src/lib/subagentProfiles";
import {
  CAPTURE_EMBED_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  INSTANCE_REFERENCE_PROMPT,
  ROBLOX_SOURCE_WORKFLOW_PROMPT,
  STUDIO_TOOL_PROMPT,
} from "../src/lib/systemPrompt";
import type { ModelSettings } from "../src/types/desktop";
import { openAiApiProvider } from "./openAiApiProvider";

export const BLENDER_MCP_SERVER_NAME = "blender";

export interface StudioMcpWindowsEnvironment {
  localAppData?: string;
  comSpec?: string;
  systemRoot?: string;
}

export function studioMcpCommand(
  platform: NodeJS.Platform,
  environment: StudioMcpWindowsEnvironment = {},
): string[] {
  if (platform === "darwin") {
    return ["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"];
  }

  if (platform === "win32") {
    const dataDirectory = environment.localAppData ?? "C:\\Users\\Default\\AppData\\Local";
    // Resolve cmd.exe absolutely: the MCP stdio transport spawns with a reduced
    // environment, so a PATH without System32 makes a bare "cmd.exe" fail with ENOENT.
    const systemRoot = environment.systemRoot ?? "C:\\Windows";
    const comSpec = environment.comSpec ?? win32.join(systemRoot, "System32", "cmd.exe");
    return [comSpec, "/c", win32.join(dataDirectory, "Roblox", "mcp.bat")];
  }

  return ["studio-mcp"];
}

/**
 * The file Roblox Studio installs for its MCP helper, or null when the command is looked up
 * on PATH. When the file is missing, Studio isn't installed or hasn't set up MCP yet.
 */
export function studioMcpInstallPath(
  platform: NodeJS.Platform,
  environment: StudioMcpWindowsEnvironment = {},
): string | null {
  if (platform === "darwin" || platform === "win32") {
    return studioMcpCommand(platform, environment).at(-1) ?? null;
  }
  return null;
}

/**
 * Keeps other setups out of BloxBot. OpenCode would otherwise walk up from ~/BloxBot and load
 * ~/AGENTS.md, ~/opencode.json and ~/.opencode, which belong to the user's own OpenCode.
 */
export const OPENCODE_ISOLATION_ENV = { OPENCODE_DISABLE_PROJECT_CONFIG: "1" };

/** Added to whatever the system prompt is while Blender's set up, and gone again when it's removed. */
const BLENDER_PROMPT =
  "Blender's tools run code on this computer, so use them only when someone asks for 3D work. If they can't connect, Blender isn't open: ask the person to open it from Settings, 3D tools. For Roblox, export GLB with its textures embedded, or FBX if GLB isn't possible, under 20,000 triangles per mesh, into the Models folder in your working folder, and link the file with a file:// URL. That shows the person the model, with a button to upload it after they've checked it, so don't upload it yourself. Uploads are permanent and go on the game owner's account. Roblox bans accounts for what they upload, so refuse extremist, hateful or sexual models and flags, whatever the reason given, and tell them moderation can still reject anything.";

/** Studio's tools that act on someone's Roblox account, not just the place that's open. */
const ASK_FIRST = ["upload_image", "open_cloud_invoke"];

interface McpLocalServer {
  type: "local";
  command: string[];
  environment: Record<string, string>;
}

const agentSystem = (systemPrompt: string | null | undefined, hasBlender: boolean) => {
  const base = [
    systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    ROBLOX_SOURCE_WORKFLOW_PROMPT,
    CAPTURE_EMBED_PROMPT,
    STUDIO_TOOL_PROMPT,
    INSTANCE_REFERENCE_PROMPT,
    SUBAGENT_PROFILE_PROMPT,
  ].join("\n\n");
  return hasBlender ? `${base}\n\n${BLENDER_PROMPT}` : base;
};

function subagents(settings?: ModelSettings) {
  return Object.fromEntries(
    SUBAGENT_PROFILES.map(({ id, description, system }) => {
      const override = settings?.subagentModels[id];
      const model =
        override && (!settings?.hideFreeModels || !isKnownFreeModelKey(override))
          ? toEngineModelKey(override)
          : undefined;
      const variant = model ? settings?.subagentEfforts?.[id] : undefined;
      const [providerID, modelID] = model ? splitModelKey(model) : [];
      return [
        id,
        {
          mode: "subagent",
          description: model
            ? `${description} Configured model: ${model}. Effort: ${variant ?? "model default"}.`
            : description,
          system: [
            system,
            ROBLOX_SOURCE_WORKFLOW_PROMPT,
            CAPTURE_EMBED_PROMPT,
            STUDIO_TOOL_PROMPT,
            INSTANCE_REFERENCE_PROMPT,
          ].join("\n\n"),
          ...(model && {
            model: variant ? { providerID, model: modelID, variant } : model,
          }),
        },
      ];
    }),
  );
}

export function createOpenCodeConfig(
  broker: { url: string },
  systemPrompt?: string | null,
  blender?: McpLocalServer | null,
  modelSettings?: ModelSettings,
) {
  return {
    // Keep OpenCode's standard automatic context compaction enabled for long sessions.
    compaction: {
      auto: true,
    },
    // The chat's task list. OpenCode 2 only offers the todo tool behind this flag.
    experimental: {
      todo: true,
    },
    mcp: {
      servers: {
        [STUDIO_MCP_SERVER_NAME]: {
          type: "remote",
          url: broker.url,
        },
        ...(blender ? { [BLENDER_MCP_SERVER_NAME]: blender } : {}),
      },
    },
    // Roblox bans accounts for what they upload, and the AI shouldn't be able to do that by itself.
    // OpenCode's docs say unsupported characters in a tool's name become _, without listing them.
    permissions: ASK_FIRST.flatMap((tool) => [
      { action: `${STUDIO_MCP_SERVER_NAME}_${tool}`, resource: "*", effect: "ask" },
      { action: `${STUDIO_MCP_SERVER_NAME.replaceAll("-", "_")}_${tool}`, resource: "*", effect: "ask" },
    ]),
    // OpenCode would otherwise load skills from ~/.claude and ~/.agents, which belong to other tools.
    plugins: ["*", "-opencode.config.compatibility"],
    providers: {
      [OPENAI_API_PROVIDER]: openAiApiProvider(modelSettings?.openAiApiServiceTier ?? "auto"),
    },
    default_agent: "studio",
    agents: {
      ...subagents(modelSettings),
      studio: {
        mode: "primary",
        description: "Roblox Studio development assistant",
        system: agentSystem(systemPrompt, !!blender),
      },
    },
  };
}

export function withModelSettings(contents: string, settings: ModelSettings): string {
  const config: {
    agents?: Record<string, unknown>;
    providers?: Record<string, unknown>;
  } = JSON.parse(contents);
  config.agents = { ...config.agents, ...subagents(settings) };
  config.providers = {
    ...config.providers,
    [OPENAI_API_PROVIDER]: openAiApiProvider(settings.openAiApiServiceTier),
  };
  return JSON.stringify(config, null, 2);
}

/** The config with its system prompt swapped, for a change while OpenCode is running. */
export function withSystemPrompt(contents: string, systemPrompt: string | null): string {
  const config = JSON.parse(contents);
  config.agents.studio.system = agentSystem(
    systemPrompt,
    !!config.mcp.servers[BLENDER_MCP_SERVER_NAME],
  );
  return JSON.stringify(config, null, 2);
}

/** Applies Blender being set up or removed to a config OpenCode has already read. */
export function withBlender(
  contents: string,
  blender: McpLocalServer | null,
  systemPrompt: string | null,
): string {
  const config = JSON.parse(contents);
  if (blender) config.mcp.servers[BLENDER_MCP_SERVER_NAME] = blender;
  else delete config.mcp.servers[BLENDER_MCP_SERVER_NAME];
  config.agents.studio.system = agentSystem(systemPrompt, !!blender);
  return JSON.stringify(config, null, 2);
}
