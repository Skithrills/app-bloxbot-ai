import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { expect, it } from "vitest";
import { createOpencodeClient } from "@/lib/opencode/client";
import { PASSWORD, startServer } from "@/test/support/liveServer";
import { createOpenCodeConfig } from "../../electron/opencodeConfig";

const BIN = process.env.OPENCODE_LIVE_BIN;
const SUMMARY = `## Objective
- Verify session compaction.

## Requirements
- (none)

## Decisions
- (none)

## Work State
### Completed
- Sent test prompts.

### Active
- (none)

### Blocked
- (none)

## Next Move
1. Continue the conversation.

## Relevant Files
- (none)

## Important Context
- (none)`;

it.skipIf(!BIN)(
  "measures native context and refreshes it after compaction",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bloxbot-context-"));
    const requests: string[] = [];
    let failCompact = true;
    const provider = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const { messages } = JSON.parse(body) as { messages: { content?: string }[] };
        const summarizing = messages.some(({ content }) =>
          content?.startsWith("You MUST summarize"),
        );
        if (summarizing) requests.push(body);
        const content = summarizing && !failCompact ? SUMMARY : "A scripted reply.";
        const input = 20 + messages.length * 10;
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (payload: object) =>
          res.write(
            `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", ...payload })}\n\n`,
          );
        chunk({
          choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
        });
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        chunk({
          choices: [],
          usage: {
            prompt_tokens: input,
            completion_tokens: 10,
            total_tokens: input + 10,
            prompt_tokens_details: { cached_tokens: 5 },
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        });
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const configPath = join(home, "config", "opencode");
      const url = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`;
      await mkdir(configPath, { recursive: true });
      await writeFile(
        join(configPath, "opencode.json"),
        JSON.stringify({
          ...createOpenCodeConfig({ url }),
          providers: { opencode: { settings: { baseURL: url } } },
          mcp: {},
        }),
      );
      server = await startServer(BIN as string, home);
      const headers = {
        Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
      };
      const api = OpenCode.make({ baseUrl: server.baseUrl, headers });
      const client = createOpencodeClient({
        baseUrl: server.baseUrl,
        directory: server.workspace,
        headers,
      });
      const options = { throwOnError: true };
      const {
        data: { id: sessionID },
      } = await client.session.create({}, options);
      const context = async (beforeMessageID?: string) =>
        (await client.session.context({ sessionID, beforeMessageID }, options)).data;
      const compact = () => client.session.compact({ sessionID, waitForCompletion: true }, options);
      const send = async (text: string) => {
        await client.session.promptAsync(
          {
            sessionID,
            model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" },
            parts: [{ type: "text", text }],
          },
          options,
        );
        await api.experimental.session.wait({ sessionID });
      };

      expect(await context()).toEqual({
        measurement: null,
        hasCompacted: false,
        canCompact: false,
      });
      await send("First prompt");
      await send("Second prompt");
      await send("Reverted third prompt");
      const original = await context();
      expect(original.measurement).toEqual({
        modelKey: "opencode/deepseek-v4.1-flash-free",
        tokens: { input: 75, cache: { read: 5, write: 0 }, output: 7, reasoning: 3 },
      });
      expect(original.canCompact).toBe(true);

      await expect(compact()).rejects.toThrow(
        "Compaction summary did not match the required template",
      );
      expect(await context()).toEqual(original);

      const history = await api.session.context({ sessionID });
      const reverted = history.find(
        (entry) => entry.type === "user" && entry.text === "Reverted third prompt",
      );
      expect(reverted).toBeDefined();
      await client.session.undo({ sessionID, messageID: reverted?.id as string }, options);
      expect((await context(reverted?.id)).measurement?.tokens.input).toBe(55);

      failCompact = false;
      requests.length = 0;
      await compact();
      expect(requests).toHaveLength(1);
      expect(requests[0]).not.toContain("Reverted third prompt");
      expect(await context()).toEqual({ measurement: null, hasCompacted: true, canCompact: false });

      await send("After compact");
      expect((await context()).measurement?.tokens.input).toBe(45);
    } finally {
      server?.child.kill();
      provider.close();
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  },
  45_000,
);
