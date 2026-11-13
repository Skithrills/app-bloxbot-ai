import { describe, expect, it } from "vitest";

import { SUBAGENT_PROFILE_PROMPT, SUBAGENT_PROFILES } from "@/lib/subagentProfiles";
import {
  CAPTURE_EMBED_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  INSTANCE_REFERENCE_PROMPT,
  STUDIO_TOOL_PROMPT,
} from "@/lib/systemPrompt";
import { isCaptureId } from "@/lib/toolImages";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";
import {
  createOpenCodeConfig,
  studioMcpCommand,
  withBlender,
  withSystemPrompt,
} from "../../electron/opencodeConfig";

const broker = { url: "http://127.0.0.1:43210/mcp" };
const withAppInstructions = (prompt: string) =>
  [
    prompt,
    CAPTURE_EMBED_PROMPT,
    STUDIO_TOOL_PROMPT,
    INSTANCE_REFERENCE_PROMPT,
    SUBAGENT_PROFILE_PROMPT,
  ].join("\n\n");

describe("Studio MCP command", () => {
  it("resolves cmd.exe through ComSpec instead of PATH on Windows", () => {
    expect(
      studioMcpCommand("win32", {
        localAppData: "C:\\Users\\User\\AppData\\Local",
        comSpec: "C:\\WINDOWS\\system32\\cmd.exe",
      }),
    ).toEqual([
      "C:\\WINDOWS\\system32\\cmd.exe",
      "/c",
      "C:\\Users\\User\\AppData\\Local\\Roblox\\mcp.bat",
    ]);
  });

  it("falls back to SystemRoot, then C:\\Windows, when ComSpec is missing", () => {
    expect(studioMcpCommand("win32", { systemRoot: "D:\\Windows" })[0]).toBe(
      "D:\\Windows\\System32\\cmd.exe",
    );
    expect(studioMcpCommand("win32")[0]).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});

describe("OpenCode configuration", () => {
  it("does not install third-party authentication plugins by default", () => {
    expect(createOpenCodeConfig(broker)).not.toHaveProperty("plugin");
  });

  it("configures the General worker with its own model and reasoning variant", () => {
    const config = createOpenCodeConfig(broker, null, null, {
      ...DEFAULT_APP_CONFIG,
      subagentModels: { general: "openai-oauth/gpt-6-luna" },
      subagentEfforts: { general: "low" },
    });
    expect(config.agents.general).toMatchObject({
      mode: "subagent",
      description: expect.stringContaining("openai/gpt-6-luna. Effort: low."),
      model: { providerID: "openai", model: "gpt-6-luna", variant: "low" },
    });
    expect(createOpenCodeConfig(broker).agents.general).not.toHaveProperty("model");
  });
});

describe("system prompt", () => {
  it("uses the default until the user has written their own", () => {
    expect(createOpenCodeConfig(broker).agents.studio.system).toBe(
      withAppInstructions(DEFAULT_SYSTEM_PROMPT),
    );
    expect(createOpenCodeConfig(broker, null).agents.studio.system).toBe(
      withAppInstructions(DEFAULT_SYSTEM_PROMPT),
    );
    expect(createOpenCodeConfig(broker, "Be brief.").agents.studio.system).toBe(
      withAppInstructions("Be brief."),
    );
  });

  it("keeps the formats the chat reads out of a reply", () => {
    expect(INSTANCE_REFERENCE_PROMPT).toContain(
      '<Instance reference="game.Workspace.Model.Part" class="Part">Part</Instance>',
    );
    expect(INSTANCE_REFERENCE_PROMPT).toContain("Omit class if unknown");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("file:// URL");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("studio_id");

    const example = /!\[[^\]]+\]\(capture:([^)]+)\)/.exec(CAPTURE_EMBED_PROMPT)?.[1];
    expect(isCaptureId(example)).toBe(true);
    expect(CAPTURE_EMBED_PROMPT).toContain(`capture_id ${example}`);
    expect(CAPTURE_EMBED_PROMPT).toContain("the only tool call in that execute");
  });

  it("opens with plain text that only the default prompt has", () => {
    // The live tests look for these characters in a JSON request body, so nothing JSON escapes.
    const opening = DEFAULT_SYSTEM_PROMPT.slice(0, 40);
    expect(opening).toMatch(/^[A-Za-z0-9 ,.]{40}$/);
    expect(withAppInstructions("Be brief.")).not.toContain(opening);
  });

  it("gives every subagent the Studio routing rule and names each profile to the main agent", () => {
    const { studio, ...workers } = createOpenCodeConfig(broker).agents;
    expect(studio.system).toContain(SUBAGENT_PROFILE_PROMPT);
    for (const profile of SUBAGENT_PROFILES) {
      const { system } = workers[profile.id];
      expect(system).toContain("Pass that studio_id on every Studio tool call.");
      expect(system).toContain(CAPTURE_EMBED_PROMPT);
      expect(SUBAGENT_PROFILE_PROMPT).toContain(profile.id);
    }
  });

  it("swaps only the prompt in a written config, and resets it", () => {
    const written = JSON.stringify(createOpenCodeConfig(broker));
    const custom = JSON.parse(withSystemPrompt(written, "Be brief."));
    expect(custom.agents.studio.system).toBe(withAppInstructions("Be brief."));
    expect(custom.mcp.servers["roblox-studio"].url).toBe(broker.url);

    const reset = JSON.parse(withSystemPrompt(JSON.stringify(custom), null));
    expect(reset.agents.studio.system).toBe(withAppInstructions(DEFAULT_SYSTEM_PROMPT));
  });

  describe("Blender", () => {
    const server = { type: "local" as const, command: ["/blender-mcp"], environment: { A: "1" } };

    it("isn't there until it's set up", () => {
      const config = createOpenCodeConfig(broker);
      expect(Object.keys(config.mcp.servers)).not.toContain("blender");
      expect(config.agents.studio.system).toBe(withAppInstructions(DEFAULT_SYSTEM_PROMPT));
    });

    it("adds the server and what the agent has to know, whatever the system prompt is", () => {
      const config = createOpenCodeConfig(broker, "Be brief.", server);
      expect(config.mcp.servers).toHaveProperty("blender", server);
      expect(config.agents.studio.system).toMatch(/^Be brief\./);
      expect(config.agents.studio.system).toMatch(/don't upload it yourself/);
      expect(config.agents.studio.system).toMatch(/refuse extremist/);
    });

    it("applies being set up and removed to a config already written", () => {
      const written = JSON.stringify(createOpenCodeConfig(broker, "Be brief."));

      const added = JSON.parse(withBlender(written, server, "Be brief."));
      expect(added.mcp.servers.blender).toEqual(server);
      expect(added.agents.studio.system).toMatch(/don't upload it yourself/);

      const removed = JSON.parse(withBlender(JSON.stringify(added), null, "Be brief."));
      expect(removed.mcp.servers).not.toHaveProperty("blender");
      expect(removed.agents.studio.system).toBe(withAppInstructions("Be brief."));
    });

    it("keeps what the agent has to know when the system prompt changes", () => {
      const written = JSON.stringify(createOpenCodeConfig(broker, null, server));
      const changed = JSON.parse(withSystemPrompt(written, "Be brief."));
      expect(changed.agents.studio.system).toMatch(/^Be brief\./);
      expect(changed.agents.studio.system).toMatch(/don't upload it yourself/);
    });
  });
});

describe("uploads the AI can't make by itself", () => {
  it("asks before Studio's tools act on someone's Roblox account, with or without Blender", () => {
    for (const blender of [
      null,
      { type: "local" as const, command: ["blender-mcp"], environment: {} },
    ]) {
      const { permissions } = createOpenCodeConfig({ url: "http://127.0.0.1:1" }, null, blender);
      expect(permissions).toEqual(
        expect.arrayContaining([
          { action: "roblox-studio_upload_image", resource: "*", effect: "ask" },
          { action: "roblox_studio_upload_image", resource: "*", effect: "ask" },
          { action: "roblox-studio_open_cloud_invoke", resource: "*", effect: "ask" },
          { action: "roblox_studio_open_cloud_invoke", resource: "*", effect: "ask" },
        ]),
      );
    }
  });

  it("tells the AI to export for the upload button, and not to upload by itself", () => {
    const blender = { type: "local" as const, command: ["blender-mcp"], environment: {} };
    const { system } = createOpenCodeConfig({ url: "http://127.0.0.1:1" }, null, blender).agents
      .studio;
    expect(system).toContain("export GLB");
    expect(system).toContain("the Models folder");
    expect(system).toContain("don't upload it yourself");
    expect(system).not.toContain("API key");
  });
});

it("keeps instance-chip guidance for custom main prompts and every subagent", () => {
  const config = createOpenCodeConfig(broker, "Be brief.");
  expect(config.agents.studio.system).toContain(INSTANCE_REFERENCE_PROMPT);
  for (const agent of Object.values(config.agents)) {
    expect(agent.system).toContain(INSTANCE_REFERENCE_PROMPT);
  }
});
