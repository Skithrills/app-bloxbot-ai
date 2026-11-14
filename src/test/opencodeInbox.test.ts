import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpencodeClient } from "@/lib/opencode/client";
import { EventTranslator } from "@/lib/opencode/events";

const engine = vi.hoisted(() => ({
  session: {
    prompt: vi.fn(),
    command: vi.fn(),
    switchModel: vi.fn(),
    remove: vi.fn(),
    inbox: { update: vi.fn() },
  },
  message: { list: vi.fn() },
  experimental: {
    session: { instructions: { entry: { list: vi.fn(), put: vi.fn(), remove: vi.fn() } } },
  },
}));

vi.mock("@opencode/client", () => ({ OpenCode: { make: () => engine } }));

const entry = engine.experimental.session.instructions.entry;
const ROUTING = {
  key: "bloxbot.prompt",
  value:
    'Route every Roblox Studio MCP tool call for this request to studio_id "studio-1". The selected Studio is "Place 1".',
};

describe("main chat native inbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    entry.list.mockResolvedValue([ROUTING]);
    entry.remove.mockResolvedValue(undefined);
  });

  it("updates project context alongside Studio routing on ordinary turns and commands", async () => {
    let projectFiles = ["C:\\Project\\full.project.json", "C:\\Project\\jump.project.json"];
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      rojoProjectFiles: async () => projectFiles,
    });
    const options = { throwOnError: true } as const;
    const prompt = {
      sessionID: "s1",
      system: ROUTING.value,
      model: { modelID: "fixture", providerID: "fixture" },
      parts: [{ type: "text", text: "Work on jump" }],
    };
    await client.session.promptAsync(prompt, options);
    const stored = entry.put.mock.calls[0]?.[0];
    expect(stored).toMatchObject({ sessionID: "s1", key: ROUTING.key });
    expect(stored.value).toMatch(/^Route every Roblox Studio MCP tool call/);
    expect(stored.value).toContain("include the Studio routing instructions above verbatim");
    expect(stored.value).toContain(JSON.stringify(projectFiles));
    expect(entry.put.mock.invocationCallOrder[0]).toBeLessThan(
      engine.session.prompt.mock.invocationCallOrder[0],
    );

    entry.list.mockResolvedValue([stored]);
    projectFiles = [];
    await client.session.promptInbox(
      {
        sessionID: "s1",
        studioTargetID: "studio-1",
        text: "Queue in the same turn",
        delivery: "queue",
      },
      options,
    );
    expect(entry.put).toHaveBeenCalledTimes(1);
    expect(entry.remove).not.toHaveBeenCalled();

    await client.session.command({ ...prompt, name: "review" }, options);
    expect(entry.put.mock.calls[1]?.[0].value).not.toContain("full.project.json");
    expect(engine.session.command).toHaveBeenCalledOnce();
    await client.session.promptAsync({ ...prompt, system: undefined }, options);
    expect(entry.remove).toHaveBeenCalledExactlyOnceWith({ sessionID: "s1", key: ROUTING.key });
  });

  it.each([
    "steer",
    "queue",
  ] as const)("passes %s with attachments and keeps the current turn settings", async (delivery) => {
    const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
    const files = [{ name: "reference.png", uri: "data:image/png;base64,AAAA" }];
    await client.session.promptInbox(
      { sessionID: "s1", text: "Adjust the plan", files, delivery, studioTargetID: "studio-1" },
      { throwOnError: true },
    );

    expect(entry.list).toHaveBeenCalledExactlyOnceWith({ sessionID: "s1" });
    expect(engine.session.prompt).toHaveBeenCalledExactlyOnceWith({
      sessionID: "s1",
      text: "Adjust the plan",
      files,
      delivery,
      metadata: { "bloxbot.inboxDelivery": delivery },
      resume: true,
    });
    expect(engine.session.switchModel).not.toHaveBeenCalled();
    expect(entry.put).not.toHaveBeenCalled();
    expect(entry.remove).not.toHaveBeenCalled();
  });

  it.each([
    "studio-2",
    null,
  ])("keeps a running turn on its Studio when the selection changes to %s", async (studioTargetID) => {
    const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
    await expect(
      client.session.promptInbox(
        { sessionID: "s1", text: "Adjust the plan", delivery: "queue", studioTargetID },
        { throwOnError: true },
      ),
    ).rejects.toThrow("The Studio selection changed.");

    expect(engine.session.prompt).not.toHaveBeenCalled();
    expect(entry.put).not.toHaveBeenCalled();
    expect(entry.remove).not.toHaveBeenCalled();
  });

  describe("delivery overrides", () => {
    const connect = () => createOpencodeClient({ baseUrl: "http://localhost:4096" });
    const request = { throwOnError: true } as const;
    const queued = { sessionID: "s1", inboxID: "msg_queue" };
    const promotion = { ...queued, delivery: "steer" } as const;
    const historyReceipt = async (client = connect(), sessionID = queued.sessionID) => {
      const { data } = await client.session.messages({ sessionID }, request);
      const info = data[0].info;
      return info.role === "user" ? info.inbox : undefined;
    };

    beforeEach(() => {
      engine.message.list.mockResolvedValue({
        data: [
          {
            id: queued.inboxID,
            type: "user",
            text: "private message text",
            metadata: { "bloxbot.inboxDelivery": "queue" },
            time: { created: 1 },
          },
        ],
      });
    });

    it("restores only the confirmed delivery in the same session without storing the message", async () => {
      const client = connect();
      await client.session.inbox.update(promotion, request);

      expect(localStorage.length).toBe(1);
      const key = localStorage.key(0);
      expect(key).toContain(queued.sessionID);
      expect(JSON.parse(localStorage.getItem(key ?? "") ?? "null")).toEqual({
        [queued.inboxID]: "steer",
      });
      expect(await historyReceipt()).toEqual({ delivery: "steer", state: "delivered" });
      expect(await historyReceipt(connect(), "s2")).toEqual({
        delivery: "queue",
        state: "delivered",
      });
    });

    it("does not store rejected promotions", async () => {
      engine.session.inbox.update.mockRejectedValueOnce(new Error("Already delivered"));
      await expect(connect().session.inbox.update(promotion, request)).rejects.toThrow(
        "Already delivered",
      );

      expect(localStorage.length).toBe(0);
      expect(await historyReceipt()).toEqual({ delivery: "queue", state: "delivered" });
    });

    it("stores native delivery events and removes them after confirmed cancellation or deletion", async () => {
      const translator = new EventTranslator();
      translator.translate({
        type: "session.inbox.delivery.changed",
        id: "evt_change",
        created: 1,
        durable: { aggregateID: queued.sessionID, seq: 1, version: 1 },
        data: promotion,
      });
      expect(await historyReceipt()).toEqual({ delivery: "steer", state: "delivered" });

      const client = connect();
      translator.translate({
        type: "session.inbox.cancelled",
        id: "evt_cancel",
        created: 2,
        durable: { aggregateID: queued.sessionID, seq: 2, version: 1 },
        data: queued,
      });
      expect(localStorage.length).toBe(0);
      await client.session.inbox.update(promotion, request);
      await client.session.delete({ sessionID: queued.sessionID }, request);
      expect(localStorage.length).toBe(0);
    });

    it("keeps confirmed delivery in memory when storage is unavailable", async () => {
      const unavailable = () => {
        throw new Error("Storage is unavailable");
      };
      const read = vi.spyOn(localStorage, "getItem").mockImplementation(unavailable);
      const write = vi.spyOn(localStorage, "setItem").mockImplementation(unavailable);
      try {
        const client = connect();
        await client.session.inbox.update(promotion, request);
        expect(await historyReceipt(client)).toEqual({ delivery: "steer", state: "delivered" });
      } finally {
        read.mockRestore();
        write.mockRestore();
      }
    });

    it("does not recreate storage when an update response arrives after session deletion", async () => {
      const response = Promise.withResolvers<void>();
      engine.session.inbox.update.mockReturnValueOnce(response.promise);
      const client = connect();
      const update = client.session.inbox.update(promotion, request);
      await client.session.delete({ sessionID: queued.sessionID }, request);
      response.resolve();
      await update;
      expect(localStorage.length).toBe(0);
    });
  });
});
