import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composerPredictionContext,
  composerPredictionSuffix,
  createPredictionCache,
} from "@/lib/composerPredictions";
import { createOpencodeClient } from "@/lib/opencode/client";
import type { MessagesCache } from "@/lib/sseDispatch";

const engine = vi.hoisted(() => ({
  model: { list: vi.fn() },
  integration: { list: vi.fn() },
  event: { subscribe: vi.fn() },
  session: {
    create: vi.fn(),
    generate: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    switchModel: vi.fn(),
    prompt: vi.fn(),
  },
}));

vi.mock("@opencode/client", () => ({ OpenCode: { make: () => engine } }));

const modelID = "example-free";
const draft = "Build a Roblox lobby with";
const model = { providerID: "opencode", id: modelID };
const free = {
  ...model,
  enabled: true,
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  capabilities: { input: ["text"], output: ["text"] },
  variants: [],
};
const anonymous = { id: "opencode", methods: [], connections: [] };
const scratch = { id: "scratch", model };

describe("composer predictions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    engine.model.list.mockResolvedValue({ data: [free] });
    engine.integration.list.mockResolvedValue({ data: [anonymous] });
    engine.session.create.mockResolvedValue(scratch);
    engine.session.generate.mockResolvedValue({ text: " a shop and spawn area." });
    engine.session.remove.mockResolvedValue(undefined);
  });

  function makeClient() {
    return createOpencodeClient({ baseUrl: "http://localhost:4096", directory: "/workspace" });
  }

  it("only sends the draft to a hidden scratch session with the explicitly free model", async () => {
    const client = makeClient();
    const { signal } = new AbortController();
    await expect(client.composer.predict({ draft, modelID }, { signal })).resolves.toBe(
      " a shop and spawn area.",
    );
    expect(engine.session.create).toHaveBeenCalledExactlyOnceWith({
      title: "Composer prediction",
      model,
      metadata: { bloxbotHidden: true, bloxbotComposerPrediction: true },
      location: { directory: "/workspace" },
    });
    expect(engine.session.generate).toHaveBeenCalledExactlyOnceWith(
      { sessionID: scratch.id, prompt: expect.stringContaining(JSON.stringify(draft)) },
      { signal },
    );
    expect(engine.session.remove).toHaveBeenCalledExactlyOnceWith(
      { sessionID: scratch.id },
      { signal: expect.anything() },
    );
    expect(engine.session.switchModel).not.toHaveBeenCalled();
    expect(engine.session.prompt).not.toHaveBeenCalled();
  });

  it("leaves paid, authenticated and unpriced catalog models untouched", async () => {
    const client = makeClient();
    await expect(client.composer.predict({ draft, modelID: "paid-model" })).resolves.toBeNull();
    engine.integration.list.mockResolvedValueOnce({
      data: [{ ...anonymous, connections: [{ type: "credential", method: "key" }] }],
    });
    await expect(client.composer.predict({ draft, modelID })).resolves.toBeNull();
    engine.model.list.mockResolvedValueOnce({ data: [{ ...free, cost: [] }] });
    await expect(client.composer.predict({ draft, modelID })).resolves.toBeNull();
    engine.model.list.mockResolvedValueOnce({
      data: [{ ...free, cost: [{ input: 0, output: 1, cache: { read: 0, write: 0 } }] }],
    });
    await expect(client.composer.predict({ draft, modelID })).resolves.toBeNull();
    expect(engine.session.create).not.toHaveBeenCalled();
    expect(engine.session.generate).not.toHaveBeenCalled();
  });

  it("cleans up when the draft changes while creating the scratch session", async () => {
    const client = makeClient();
    const abort = new AbortController();
    engine.session.create.mockImplementationOnce(async () => {
      abort.abort();
      return scratch;
    });
    await expect(
      client.composer.predict({ draft, modelID }, { signal: abort.signal }),
    ).resolves.toBeNull();
    expect(engine.session.generate).not.toHaveBeenCalled();
    expect(engine.session.remove).toHaveBeenCalledOnce();
    expect(engine.session.remove.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it("keeps scratch sessions and their events out of the chat client", async () => {
    const client = makeClient();
    const metadata = { bloxbotHidden: true, bloxbotComposerPrediction: true };
    engine.session.list.mockResolvedValue({ data: [{ ...scratch, metadata }], cursor: {} });
    engine.event.subscribe.mockImplementation(async function* () {
      yield { type: "session.created", data: { sessionID: scratch.id, metadata } };
      yield { type: "session.status", data: { sessionID: scratch.id, status: { type: "busy" } } };
      yield { type: "session.deleted", data: { sessionID: scratch.id } };
      yield { type: "session.idle", data: { sessionID: "chat" } };
    });
    await expect(client.experimental.session.list()).resolves.toMatchObject({ data: [] });
    const { stream } = await client.event.subscribe();
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([{ type: "session.idle", properties: { sessionID: "chat" } }]);
  });

  it("backs off without retrying or switching models after the shared free quota is used", async () => {
    const client = makeClient();
    engine.session.generate.mockRejectedValueOnce({ reason: "provider.free-limit", status: 429 });
    await expect(client.composer.predict({ draft, modelID })).resolves.toBeNull();
    await expect(
      client.composer.predict({ draft: "Build a Roblox arena with", modelID }),
    ).resolves.toBeNull();
    expect(engine.session.generate).toHaveBeenCalledOnce();
    expect(engine.session.remove).toHaveBeenCalledOnce();
  });

  it("keeps plain continuations and rejects echoed drafts and formatted responses", () => {
    expect(composerPredictionSuffix(draft, " a shop ")).toBe(" a shop");
    expect(composerPredictionSuffix(`${draft} `, "a shop")).toBe("a shop");
    expect(composerPredictionSuffix(draft, ".")).toBe(".");
    expect(composerPredictionSuffix(draft, `${draft} a shop`)).toBeNull();
    expect(composerPredictionSuffix(draft, "a shop\nand a spawn area")).toBeNull();
    expect(composerPredictionSuffix(draft, "```a shop```")).toBeNull();
  });

  it("asks for the whole next message when nothing is typed, and only with a chat to read", async () => {
    const client = makeClient();
    const context = JSON.stringify({ user: "Add a shop", assistant: "Done. Want a sign too?" });
    engine.session.generate.mockResolvedValue({ text: '"Yes, add a sign"' });
    await expect(client.composer.predict({ draft: "", modelID, context })).resolves.toBe(
      "Yes, add a sign",
    );
    const { prompt } = engine.session.generate.mock.calls[0][0];
    expect(prompt).toContain("Predict the next message the user would send");
    expect(prompt.endsWith(context)).toBe(true);

    // An empty composer in a chat with no reply has nothing to go on, and a short draft is too
    // little to continue even when there is a chat.
    await expect(client.composer.predict({ draft: "", modelID })).resolves.toBeNull();
    await expect(client.composer.predict({ draft: "Yes", modelID, context })).resolves.toBeNull();
    expect(engine.session.generate).toHaveBeenCalledOnce();

    expect(composerPredictionSuffix("", "  Yes, add a sign ")).toBe("Yes, add a sign");
    expect(composerPredictionSuffix("", "“Make it glow”")).toBe("Make it glow");
    expect(composerPredictionSuffix("", "Sure!\nAnd a door")).toBeNull();
    expect(composerPredictionSuffix("", "/goal pause")).toBeNull();
  });

  it("reads the end of the chat only once its latest reply has finished", () => {
    const message = (id: string, role: string, text: string, extra: object = {}) => ({
      info: {
        id,
        role,
        time: { created: 1, ...(role === "assistant" && { completed: 2 }) },
        ...extra,
      },
      parts: [
        { id: `${id}-tool`, type: "tool" },
        { id: `${id}-text`, type: "text", text },
      ],
    });
    const cache = (...messages: ReturnType<typeof message>[]) =>
      ({
        messageIds: messages.map(({ info }) => info.id),
        messagesById: Object.fromEntries(messages.map((item) => [item.info.id, item])),
      }) as unknown as MessagesCache;
    const ask = message("u1", "user", "Old question");
    const latest = message(
      "u2",
      "user",
      'Fix <Instance reference="game.Workspace.Door" class="Model">@Door</Instance>',
    );
    const steps = [message("a1", "assistant", "Looking."), message("a2", "assistant", "Fixed it.")];

    expect(
      composerPredictionContext(cache(ask, message("a0", "assistant", "Old"), latest, ...steps)),
    ).toBe(JSON.stringify({ user: "Fix Door", assistant: "Looking.\nFixed it." }));
    // A queued message waits behind the reply and isn't part of what was said.
    const queued = message("u3", "user", "Later", {
      inbox: { state: "pending", delivery: "queue" },
    });
    expect(composerPredictionContext(cache(latest, ...steps, queued))).toBe(
      JSON.stringify({ user: "Fix Door", assistant: "Looking.\nFixed it." }),
    );

    expect(composerPredictionContext(cache())).toBeNull();
    expect(composerPredictionContext(cache(latest))).toBeNull();
    const arriving = message("a3", "assistant", "Still wri", { time: { created: 1 } });
    expect(composerPredictionContext(cache(latest, steps[0], arriving))).toBeNull();
    const failed = message("a4", "assistant", "Partly", { error: { name: "APIError" } });
    expect(composerPredictionContext(cache(latest, failed))).toBeNull();

    const long = message("a5", "assistant", `${"x".repeat(3000)} Shall I continue?`);
    const context = JSON.parse(composerPredictionContext(cache(latest, long)) ?? "{}");
    expect(context.assistant).toHaveLength(1500);
    expect(context.assistant.endsWith("Shall I continue?")).toBe(true);
  });

  it("reuses a suggestion for the same draft and for typing along it", () => {
    const cache = createPredictionCache(2);
    cache.set("a-free", "Build a lobby", " with a shop");
    expect(cache.get("a-free", "Build a lobby")).toBe(" with a shop");
    expect(cache.get("a-free", "Build a lobby with")).toBe(" a shop");
    // Typed something else, typed all of it, or a different model: nothing to reuse.
    expect(cache.get("a-free", "Build a lobby for")).toBeNull();
    expect(cache.get("a-free", "Build a lobby with a shop")).toBeNull();
    expect(cache.get("b-free", "Build a lobby")).toBeNull();

    // The least recently used draft makes room.
    cache.set("a-free", "Make a sword", " that glows");
    cache.get("a-free", "Build a lobby");
    cache.set("a-free", "Add a door", " that opens");
    expect(cache.get("a-free", "Make a sword")).toBeNull();
    expect(cache.get("a-free", "Build a lobby")).toBe(" with a shop");
  });
});
