import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { createOpencodeClient } from "@/lib/opencode/client";
import type { Event, InboxDelivery } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { type MessagesCache, sseDispatch } from "@/lib/sseDispatch";
import { PASSWORD, shellCall, startScriptedProvider, startServer } from "@/test/support/liveServer";
import { createOpenCodeConfig } from "../../electron/opencodeConfig";

const bin = process.env.OPENCODE_LIVE_BIN;
const model = { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" };

it.skipIf(!bin)(
  "steers the next step and queues a separate turn in the native inbox",
  async () => {
    if (!bin) return;
    localStorage.clear();
    const home = await mkdtemp(join(tmpdir(), "bloxbot-inbox-"));
    const scripted = await startScriptedProvider([
      shellCall(
        `node -e "setInterval(() => { if (require('node:fs').existsSync('release-turn')) process.exit(0) }, 25); setTimeout(() => process.exit(1), 20000)"`,
      ),
      { content: "Current turn done" },
      { content: "Queued turn done" },
    ]);
    const abort = new AbortController();
    let stopEngine: (() => void) | undefined;
    try {
      const config = join(home, "config", "opencode", "opencode.json");
      await mkdir(dirname(config), { recursive: true });
      await writeFile(
        config,
        JSON.stringify({
          ...createOpenCodeConfig({ url: "http://127.0.0.1:9/mcp" }),
          providers: { opencode: { settings: { baseURL: scripted.url } } },
        }),
      );
      const { child, baseUrl, workspace } = await startServer(bin, home);
      stopEngine = () => child.kill();
      const options = {
        baseUrl,
        directory: workspace,
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
        },
      };
      const client = createOpencodeClient(options);
      const events: Event[] = [];
      const cache = new QueryClient();
      const currentSession = { current: null as string | null };
      const { stream } = await client.event.subscribe({}, { signal: abort.signal });
      void (async () => {
        for await (const event of stream) {
          events.push(event);
          sseDispatch(cache, event, currentSession);
        }
      })().catch(() => undefined);

      const request = { throwOnError: true } as const;
      const sessionID = (await client.session.create({}, request)).data.id;
      currentSession.current = sessionID;
      const studioTargetID = "fixture-studio";
      await client.session.promptAsync(
        {
          sessionID,
          model,
          system: `Route every Roblox Studio MCP tool call for this request to studio_id "${studioTargetID}".`,
          parts: [{ type: "text", text: "FIRST_PROMPT" }],
        },
        request,
      );
      await expect
        .poll(
          () =>
            events.some((event) => {
              if (event.type !== "message.part.updated") return false;
              const { part } = event.properties;
              return (
                part.sessionID === sessionID &&
                part.type === "tool" &&
                part.state.status === "running"
              );
            }),
          { timeout: 15_000 },
        )
        .toBe(true);

      const send = async (text: string, delivery: InboxDelivery) =>
        (await client.session.promptInbox({ sessionID, studioTargetID, text, delivery }, request))
          .data.id;
      const queue = await send("QUEUE_PROMPT", "queue");
      const steer = await send("STEER_PROMPT", "steer");
      const promoted = await send("PROMOTED_PROMPT", "queue");
      const cancelled = await send("CANCELLED_PROMPT", "queue");
      await client.session.inbox.update(
        { sessionID, inboxID: promoted, delivery: "steer" },
        request,
      );
      await client.session.inbox.cancel({ sessionID, inboxID: cancelled }, request);
      const pending = (await client.session.messages({ sessionID, includePending: true }, request))
        .data;
      expect(
        pending
          .filter(({ info }) => [queue, steer, promoted, cancelled].includes(info.id))
          .map(({ info }) => info),
      ).toMatchObject([
        { id: queue, inbox: { delivery: "queue", state: "pending" } },
        { id: steer, inbox: { delivery: "steer", state: "pending" } },
        { id: promoted, inbox: { delivery: "steer", state: "pending" } },
      ]);
      const transcript = () => {
        const data = cache.getQueryData<MessagesCache>(qk.messages(sessionID));
        return data?.messageIds.map((id) => data.messagesById[id]) ?? [];
      };
      await expect
        .poll(() => transcript().find(({ info }) => info.id === promoted)?.info)
        .toMatchObject({
          inbox: { delivery: "steer", state: "pending" },
        });

      await writeFile(join(workspace, "release-turn"), "");
      await expect.poll(() => scripted.bodies.length, { timeout: 20_000 }).toBe(3);
      const [first, nextStep, nextTurn] = scripted.bodies;
      expect(first).toContain("FIRST_PROMPT");
      expect(nextStep).toContain("STEER_PROMPT");
      expect(nextStep).toContain("PROMOTED_PROMPT");
      expect(nextStep).not.toContain("QUEUE_PROMPT");
      expect(nextTurn).toContain("QUEUE_PROMPT");
      expect(nextStep).toContain(studioTargetID);
      expect(nextTurn).toContain(studioTargetID);
      expect(scripted.bodies.every((body) => JSON.parse(body).model === model.modelID)).toBe(true);
      expect(scripted.bodies.every((body) => !body.includes("CANCELLED_PROMPT"))).toBe(true);

      await expect
        .poll(() => transcript().at(-1)?.parts)
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "Queued turn done" }),
          ]),
        );
      expect(transcript().map(({ info }) => info)).toMatchObject([
        { role: "user" },
        { role: "assistant" },
        { id: steer, inbox: { delivery: "steer", state: "read" } },
        { id: promoted, inbox: { delivery: "steer", state: "read" } },
        { role: "assistant", parentID: promoted },
        { id: queue, inbox: { delivery: "queue", state: "delivered" } },
        { role: "assistant", parentID: queue },
      ]);
      expect(transcript()[1].parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool",
            state: expect.objectContaining({ status: "completed" }),
          }),
        ]),
      );

      // A new renderer adapter restores promotions from local storage and direct steers from history.
      const fresh = (
        await createOpencodeClient(options).session.messages(
          { sessionID, includePending: true },
          request,
        )
      ).data;
      expect(fresh.map(({ info }) => info)).toMatchObject([
        { role: "user" },
        { role: "assistant" },
        { id: steer, inbox: { delivery: "steer", state: "read" } },
        { id: promoted, inbox: { delivery: "steer", state: "read" } },
        { role: "assistant", parentID: promoted },
        { id: queue, inbox: { delivery: "queue", state: "delivered" } },
        { role: "assistant", parentID: queue },
      ]);
      // A late cancellation may race the native inbox draining the item.
      await client.session.inbox.cancel({ sessionID, inboxID: promoted });
      const afterCancel = (
        await createOpencodeClient(options).session.messages({ sessionID }, request)
      ).data;
      expect(afterCancel.find(({ info }) => info.id === promoted)?.info).toMatchObject({
        inbox: { delivery: "steer", state: "read" },
      });
    } finally {
      localStorage.clear();
      abort.abort();
      stopEngine?.();
      scripted.provider.close();
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  },
  45_000,
);
