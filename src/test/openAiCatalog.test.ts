import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";
import { openAiApiProvider } from "../../electron/openAiApiProvider";
import {
  createLiveOpenAiCatalog,
  fallbackOpenAiCatalog,
  OPENAI_CATALOG_URL,
  parseOpenAiCatalog,
} from "../../electron/openAiCatalog";
import {
  createOpenCodeConfig,
  withModelCatalog,
  withModelSettings,
  withSystemPrompt,
} from "../../electron/opencodeConfig";
import { catalogFixture } from "./support/modelCatalog";

const id = "gpt-6.2-catalog-test";
const now = new Date("2026-11-27");
const broker = { url: "http://127.0.0.1:1234/mcp" };

describe("live public OpenAI catalog", () => {
  it.skipIf(!process.env.OPENCODE_CATALOG_LIVE)(
    "parses the current public catalog without sending credentials",
    async () => {
      const response = await fetch(OPENAI_CATALOG_URL, {
        credentials: "omit",
        signal: AbortSignal.timeout(8_000),
      });
      expect(response.ok).toBe(true);
      const live = parseOpenAiCatalog(await response.json(), now);
      expect(live.models["gpt-6.2-astra"].model.cost[0].input).toBe(8);
      expect(live.models["gpt-6.2-sol"].ultrafast?.cost[0].input).toBe(6);
      expect(live.models["gpt-6.2-sol-fast"].model).toMatchObject({
        modelID: "gpt-6.2-sol",
        body: { service_tier: "priority" },
      });
      expect(live.models["gpt-6.2-sol-fast"].model.cost[0]).toMatchObject({ input: 4, output: 20 });
      expect(live.nativeModels).toHaveProperty("gpt-6.2-sol-fast");
    },
    15_000,
  );
  it("offers verified 6.2 offline on both profiles, including native Fast pairs", () => {
    const config = createOpenCodeConfig(broker);
    for (const provider of ["openai", "openai-api"] as const) {
      expect(config.providers[provider].models).toHaveProperty("gpt-6.2-astra");
      expect(config.providers[provider].models).toHaveProperty("gpt-6.2-sol");
    }
    expect(config.providers.openai.models["gpt-6.2-sol-fast"]).toMatchObject({
      modelID: "gpt-6.2-sol",
      body: { service_tier: "priority" },
    });
  });

  it("discovers an unshipped model for both profiles without inheriting auth or routing", () => {
    const catalog = parseOpenAiCatalog(catalogFixture(), now);
    const config = createOpenCodeConfig(broker, null, null, DEFAULT_APP_CONFIG, catalog);
    expect(config.providers.openai.models).toHaveProperty(id);
    expect(config.providers.openai.models).toHaveProperty(`${id}-fast`);
    expect(config.providers["openai-api"].models[`${id}-fast`]).toMatchObject({
      modelID: id,
      body: { service_tier: "priority" },
      cost: [{ input: 4, output: 20, cache: { read: 0.2 } }],
    });
    expect(config.providers["openai-api"]).toMatchObject({
      env: ["BLOXBOT_OPENAI_API_KEY"],
      package: "@opencode/ai/providers/openai/responses",
      settings: { baseURL: "https://api.openai.com/v1", transport: "http" },
    });
    expect(config.providers["openai-api"]).not.toHaveProperty("canonical");
    expect(JSON.stringify(config.providers)).not.toContain("untrusted");
    expect(config.providers.openai).not.toHaveProperty("settings");
    expect(config.providers.openai).not.toHaveProperty("env");
  });

  it("derives tier support and date-aware 6.2 pricing from the catalog", () => {
    for (const [date, input] of [
      ["2026-11-27", 6],
      ["2027-03-01", 12],
    ] as const) {
      const catalog = parseOpenAiCatalog(catalogFixture(), new Date(date));
      expect(openAiApiProvider("ultrafast", catalog).models[id]).toMatchObject({
        body: { service_tier: "ultrafast" },
        cost: [{ input, output: input * 5, cache: { read: input * 0.05 } }],
      });
    }
    const fixture = catalogFixture();
    fixture.openai.models[id].capabilities.service_tier = ["priority"];
    expect(
      openAiApiProvider("ultrafast", parseOpenAiCatalog(fixture)).models[id],
    ).not.toHaveProperty("body");
    expect(fallbackOpenAiCatalog(now).models["gpt-6.2-astra"].ultrafast?.cost[0].input).toBe(24);
  });

  it("keeps the latest catalog through settings and prompt changes and skips no-op rewrites", () => {
    const catalog = parseOpenAiCatalog(catalogFixture(), now);
    const original = JSON.stringify(createOpenCodeConfig(broker), null, 2);
    const next = withModelCatalog(original, DEFAULT_APP_CONFIG, catalog);
    const settings = {
      ...DEFAULT_APP_CONFIG,
      openAiApiServiceTier: "ultrafast" as const,
      subagentModels: { general: `openai-oauth/${id}` },
    };
    const changed = JSON.parse(
      withSystemPrompt(withModelSettings(next, settings, catalog), "Custom"),
    );
    expect(changed.providers["openai-api"].models[id].body.service_tier).toBe("ultrafast");
    expect(changed.providers.openai.models).toHaveProperty(`${id}-fast`);
    expect(changed.agents.general.model).toBe(`openai/${id}`);
    expect(changed.agents.studio.system).toContain("Custom");
    expect(withModelCatalog(next, DEFAULT_APP_CONFIG, catalog)).toBe(next);
    expect(JSON.parse(next).agents).toEqual(JSON.parse(original).agents);
    expect(JSON.parse(next).mcp).toEqual(JSON.parse(original).mcp);
  });

  it("deduplicates refreshes, uses credential-free timeout fetches, and preserves last-good across failures and restarts", async () => {
    let cache = "";
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalogFixture())));
    const options = {
      fetch,
      readCache: async () => cache,
      writeCache: async (value: string) => {
        cache = value;
      },
    };
    const live = createLiveOpenAiCatalog(options);
    const [first, second] = await Promise.all([live.refresh(), live.refresh()]);
    expect(first).toBe(second);
    expect(first.models).toHaveProperty(id);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(OPENAI_CATALOG_URL, {
      signal: expect.any(AbortSignal),
      credentials: "omit",
      redirect: "error",
    });
    for (const response of [
      new Response("failure", { status: 503 }),
      new Response("{}"),
      new Response("not json"),
    ]) {
      fetch.mockResolvedValueOnce(response);
      expect(await live.refresh()).toBe(first);
    }
    fetch.mockRejectedValue(new Error("Offline"));
    const restarted = createLiveOpenAiCatalog(options);
    expect((await restarted.load()).models).toHaveProperty(id);
    expect(
      (await createLiveOpenAiCatalog({ ...options, readCache: async () => "corrupt" }).load())
        .models,
    ).toHaveProperty("gpt-6.2-sol");
  });
});
