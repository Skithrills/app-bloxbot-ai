/** Runs with OPENCODE_LIVE_BIN set. The only model endpoint is a loopback HTTP capture. */
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import { expect, it, vi } from "vitest";
import {
  OPENAI_API_KEY_ENV,
  OPENAI_API_PROVIDER,
  OPENAI_ENGINE_OAUTH_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
} from "@/lib/openAiProfiles";
import { createOpencodeClient } from "@/lib/opencode/client";
import { PASSWORD, startServer } from "@/test/support/liveServer";
import { openAiApiProvider } from "../../electron/openAiApiProvider";
import { migrateLegacyOpenAiCredentials } from "../../electron/services/openAiCredentials";

const BIN = process.env.OPENCODE_LIVE_BIN;
const PLACEHOLDER_KEY = "sk-bloxbot-disposable-test-key";
const NATIVE_OAUTH = OPENAI_ENGINE_OAUTH_PROVIDER;
const STRICT = { throwOnError: true } as const;

it.skipIf(!BIN)(
  "keeps OAuth and API-key profiles independent and sends the configured Responses tier",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bloxbot-openai-live-"));
    const requests: Array<{
      method: string | undefined;
      path: string | undefined;
      hasBearer: boolean;
      body: { model?: string; service_tier?: string };
    }> = [];
    const endpoint = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          method: request.method,
          path: request.url,
          hasBearer: request.headers.authorization === `Bearer ${PLACEHOLDER_KEY}`,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        });
        // A terminal response keeps this test about the exact on-wire request.
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Captured by local test endpoint" } }));
      });
    });
    let engine: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      vi.stubEnv("OPENAI_API_KEY", undefined);
      vi.stubEnv(OPENAI_API_KEY_ENV, undefined);
      vi.stubEnv("OPENCODE_CONFIG", undefined);
      vi.stubEnv("OPENCODE_CONFIG_DIR", undefined);
      vi.stubEnv("OPENCODE_CONFIG_CONTENT", undefined);
      endpoint.listen(0, "127.0.0.1");
      await once(endpoint, "listening");
      const baseURL = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/v1`;
      const config = join(root, "config", "opencode");
      await mkdir(config, { recursive: true });
      const provider = openAiApiProvider("ultrafast");
      await writeFile(
        join(config, "opencode.json"),
        JSON.stringify({
          plugins: ["*", "-opencode.config.compatibility"],
          providers: {
            [OPENAI_API_PROVIDER]: { ...provider, settings: { ...provider.settings, baseURL } },
          },
        }),
      );

      engine = await startServer(BIN as string, root);
      const { baseUrl, workspace } = engine;
      const headers = {
        Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
      };
      const api = OpenCode.make({ baseUrl, headers });
      const client = createOpencodeClient({ baseUrl, directory: workspace, headers });
      const location = { directory: workspace };
      const expectOpenAiProfiles = async () => {
        const [providers, auth] = await Promise.all([
          client.provider.list({}, STRICT),
          client.provider.auth({}, STRICT),
        ]);
        expect(providers.data.all.find(({ id }) => id === OPENAI_OAUTH_PROVIDER)?.name).toBe(
          "ChatGPT Subscription",
        );
        expect(providers.data.all.find(({ id }) => id === OPENAI_API_PROVIDER)?.name).toBe(
          "OpenAI API Key",
        );
        expect(auth.data[OPENAI_API_PROVIDER]?.map(({ type }) => type)).toEqual(["api"]);
      };
      await expectOpenAiProfiles();
      await client.location.reload(STRICT);
      await expectOpenAiProfiles();
      const native = await api.integration.get({ integrationID: NATIVE_OAUTH, location });
      const oauth = native.data.methods.find((method) => method.type === "oauth");
      if (!oauth) throw new Error("The engine did not offer its native OpenAI OAuth method");
      const oauthValue = {
        type: "oauth",
        methodID: oauth.id,
        access: "disposable-oauth-access",
        refresh: "disposable-oauth-refresh",
        expires: Date.now() + 86_400_000,
      } as const;
      const nativeCredential = await api.credential.create({
        integrationID: NATIVE_OAUTH,
        value: oauthValue,
        activate: true,
      });
      const legacy = await api.credential.create({
        integrationID: NATIVE_OAUTH,
        label: "Legacy key",
        value: { type: "key", key: PLACEHOLDER_KEY },
        activate: true,
      });

      expect(await migrateLegacyOpenAiCredentials(api, false)).toBe(OPENAI_API_PROVIDER);
      const credentials = await api.credential.list();
      expect(credentials.some(({ id }) => id === legacy.id)).toBe(false);
      expect(credentials.find(({ id }) => id === nativeCredential.id)).toMatchObject({
        integrationID: NATIVE_OAUTH,
        active: true,
        value: oauthValue,
      });
      const migrated = credentials.find(
        ({ integrationID }) => integrationID === OPENAI_API_PROVIDER,
      );
      expect(migrated).toMatchObject({
        label: "Legacy key",
        active: true,
        value: { type: "key", key: PLACEHOLDER_KEY },
      });
      await migrateLegacyOpenAiCredentials(api, false);
      expect(await api.credential.list()).toEqual(credentials);

      const profiles = (await client.provider.list({}, STRICT)).data;
      const apiModels = profiles.all.find(({ id }) => id === OPENAI_API_PROVIDER)?.models;
      expect(apiModels?.["gpt-6.1-sol"].releasedAt).toBe(Date.parse("2026-09-29"));
      expect(profiles.connected).toEqual(
        expect.arrayContaining([OPENAI_API_PROVIDER, OPENAI_OAUTH_PROVIDER]),
      );
      expect(profiles.all.some(({ id }) => id === NATIVE_OAUTH)).toBe(false);
      const methods = (await client.provider.auth({}, STRICT)).data;
      const oauthMethods = methods[OPENAI_OAUTH_PROVIDER]?.map(({ type }) => type);
      expect(oauthMethods).toContain("oauth");
      expect(oauthMethods?.every((type) => type === "oauth")).toBe(true);
      expect(methods[OPENAI_API_PROVIDER]?.map(({ type }) => type)).toEqual(["api"]);

      for (const [modelID, expectedTier] of [
        ["gpt-6.1-sol", "ultrafast"],
        ["gpt-6-astra", "ultrafast"],
        ["gpt-5.4", undefined],
      ] as const) {
        const session = (await client.session.create({ title: "OpenAI profile wire test" }, STRICT))
          .data;
        await client.session.promptAsync(
          {
            sessionID: session.id,
            model: { providerID: OPENAI_API_PROVIDER, modelID },
            parts: [{ type: "text", text: "Capture this request on loopback." }],
          },
          STRICT,
        );
        await expect
          .poll(() => requests.find(({ body }) => body.model === modelID), { timeout: 8_000 })
          .toMatchObject({ method: "POST", path: "/v1/responses", hasBearer: true });
        const body = requests.find(({ body }) => body.model === modelID)?.body;
        expect(body?.service_tier).toBe(expectedTier);
        if (expectedTier === undefined) expect(body).not.toHaveProperty("service_tier");
      }

      await client.auth.remove({ providerID: OPENAI_API_PROVIDER }, STRICT);
      expect(await api.credential.list()).toEqual([
        expect.objectContaining({ id: nativeCredential.id }),
      ]);
      const newKey = await api.credential.create({
        integrationID: OPENAI_API_PROVIDER,
        value: { type: "key", key: PLACEHOLDER_KEY },
        activate: true,
      });
      await client.auth.remove({ providerID: OPENAI_OAUTH_PROVIDER }, STRICT);
      expect(await api.credential.list()).toEqual([expect.objectContaining({ id: newKey.id })]);
    } finally {
      vi.unstubAllEnvs();
      if (engine && engine.child.exitCode === null && engine.child.signalCode === null) {
        const exited = once(engine.child, "exit");
        engine.child.kill();
        await exited;
      }
      endpoint.closeAllConnections();
      endpoint.close();
      if (
        dirname(root) === resolve(tmpdir()) &&
        basename(root).startsWith("bloxbot-openai-live-")
      ) {
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  60_000,
);
