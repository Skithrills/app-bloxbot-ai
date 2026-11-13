import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { expect, it, vi } from "vitest";
import { pickComposerPredictionModel } from "@/lib/composerPredictions";
import { createOpencodeClient } from "@/lib/opencode/client";
import { PASSWORD, startServer } from "@/test/support/liveServer";

const bin = process.env.OPENCODE_LIVE_BIN;

it.skipIf(!bin || !process.env.OPENCODE_LIVE_PREDICTIONS)(
  "generates a continuation with anonymous OpenCode Zen and removes the isolated session",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bloxbot-live-prediction-"));
    const { child, baseUrl, workspace } = await startServer(bin as string, home);
    const network = globalThis.fetch;
    const generateStatuses: Array<{ status: number; reason?: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const response = await network(input, init);
      if (new URL(response.url).pathname.endsWith("/generate")) {
        const error = response.ok
          ? null
          : await response
              .clone()
              .json()
              .catch(() => null);
        generateStatuses.push({ status: response.status, reason: error?.reason ?? error?.message });
      }
      return response;
    });
    try {
      const headers = {
        Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
      };
      const api = OpenCode.make({ baseUrl, headers });
      const client = createOpencodeClient({ baseUrl, directory: workspace, headers });
      const { data: list } = await client.provider.list({}, { throwOnError: true });
      const modelID = pickComposerPredictionModel(list, new Set(), new Set());
      expect(modelID, "an anonymous zero-price Zen text model").toBeTruthy();

      const draft = "Build a small Roblox lobby with";
      const start = Date.now();
      const suffix = await client.composer.predict(
        { draft, modelID: modelID as string },
        { signal: AbortSignal.timeout(20_000) },
      );
      const sessions = await api.session.list();
      expect(sessions.data).toHaveLength(0);
      console.info("[live] composer prediction", {
        modelID,
        suffix,
        elapsedMs: Date.now() - start,
        generateStatuses,
      });
      expect(suffix, JSON.stringify(generateStatuses)).toMatch(/^ \S/);
    } finally {
      vi.restoreAllMocks();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit").catch(() => undefined);
        child.kill();
        await exited;
      }
      await rm(home, { recursive: true, force: true });
    }
  },
  45_000,
);
