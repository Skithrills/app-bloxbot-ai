import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composerNextMessageKey,
  composerPredictionContext,
  composerPredictionSuffix,
  createPredictionCache,
  storedNextMessages,
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

  it("runs a replacement prediction after canceled scratch cleanup", async () => {
    const client = makeClient();
    const abort = new AbortController();
    let finishCleanup = () => {};
    engine.session.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    engine.session.generate.mockImplementationOnce(async () => {
      abort.abort();
      return { text: "Stale words" };
    });
    const old = client.composer.predict({ draft, modelID }, { signal: abort.signal });
    await vi.waitFor(() => expect(engine.session.remove).toHaveBeenCalledOnce());
    const onStatus = vi.fn();
    const replacement = client.composer.predict(
      { draft: "Build a Roblox arena with", modelID },
      { onStatus },
    );
    expect(onStatus).toHaveBeenCalledExactlyOnceWith("waiting");
    expect(engine.session.generate).toHaveBeenCalledOnce();
    finishCleanup();
    await expect(old).resolves.toBeNull();
    await expect(replacement).resolves.toBe(" a shop and spawn area.");
    expect(onStatus).toHaveBeenLastCalledWith("generating");
    expect(engine.session.remove).toHaveBeenCalledTimes(2);
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
    const onStatus = vi.fn();
    await expect(client.composer.predict({ draft, modelID }, { onStatus })).resolves.toBeNull();
    expect(onStatus).toHaveBeenLastCalledWith("free-limit");
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

  it("uses the exact opted-in chat provider for next messages, rejects drafts and has no fallback", async () => {
    const client = makeClient();
    const chosen = { id: "chat-model", providerID: "openai" };
    const context = JSON.stringify({ user: "Add a shop", assistant: "Done. Want a sign too?" });
    const input = { draft: "", modelID: chosen.id, chatProviderID: "openai-oauth", context };
    const provider = {
      id: "openai",
      methods: [],
      connections: [{ type: "credential", method: "oauth" }],
    };
    const list = [
      free,
      { ...free, ...chosen, cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }] },
    ];
    const beforeGenerate = vi.fn();
    expect(await client.composer.predict({ ...input, draft }, { beforeGenerate })).toBeNull();
    expect(beforeGenerate).not.toHaveBeenCalled();
    expect(engine.session.create).not.toHaveBeenCalled();

    engine.model.list.mockResolvedValue({ data: list });
    engine.integration.list.mockResolvedValue({ data: [anonymous, provider] });
    await expect(client.composer.predict(input)).resolves.toBeNull();
    expect(engine.session.create).not.toHaveBeenCalled();
    engine.session.create.mockResolvedValueOnce({ ...scratch, model: chosen });
    engine.session.generate.mockResolvedValueOnce({ text: "Yes, add a sign" });
    const onStatus = vi.fn();
    const suggestion = await client.composer.predict(input, { beforeGenerate, onStatus });
    expect(onStatus.mock.calls).toEqual([["requesting"], ["generating"]]);
    expect(suggestion).toBe("Yes, add a sign");
    expect(engine.session.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: chosen }),
    );
    expect(engine.session.generate).toHaveBeenCalledOnce();

    beforeGenerate.mockReturnValueOnce("attempted");
    engine.session.create.mockResolvedValueOnce({ ...scratch, model: chosen });
    await expect(client.composer.predict(input, { beforeGenerate })).resolves.toBeNull();
    expect(engine.session.generate).toHaveBeenCalledOnce();

    // The scratch session responded with an unexpected model. Never generate against it.
    await expect(client.composer.predict(input, { beforeGenerate })).resolves.toBeNull();
    expect(engine.session.generate).toHaveBeenCalledOnce();

    engine.integration.list.mockResolvedValue({
      data: [anonymous, { ...provider, connections: [] }],
    });
    await expect(client.composer.predict(input, { beforeGenerate })).resolves.toBeNull();
    expect(engine.session.create).toHaveBeenCalledTimes(3);
    expect(engine.session.generate).toHaveBeenCalledOnce();
    expect(beforeGenerate).toHaveBeenCalledTimes(2);
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

    const old = message("a0", "assistant", "Old");
    expect(composerPredictionContext(cache(ask, old, latest, ...steps))).toEqual({
      status: "ready",
      turnID: JSON.stringify(["u2", "a2"]),
      text: JSON.stringify({ user: "Fix Door", assistant: "Looking.\nFixed it." }),
    });
    expect(composerPredictionContext(cache(ask, old, latest, ...steps), "u2")).toEqual({
      status: "ready",
      turnID: JSON.stringify(["u1", "a0"]),
      text: JSON.stringify({ user: "Old question", assistant: "Old" }),
    });
    const queued = message("u3", "user", "Later", {
      inbox: { state: "pending", delivery: "queue" },
    });
    expect(composerPredictionContext(cache(latest, ...steps, queued))).toEqual({
      status: "pending",
    });

    expect(composerPredictionContext(cache())).toEqual({ status: "no-context" });
    expect(composerPredictionContext(cache(latest))).toEqual({ status: "no-context" });
    const arriving = message("a3", "assistant", "Still wri", { time: { created: 1 } });
    expect(composerPredictionContext(cache(latest, steps[0], arriving))).toEqual({
      status: "streaming",
    });
    const failed = message("a4", "assistant", "Partly", { error: { name: "APIError" } });
    expect(composerPredictionContext(cache(latest, failed))).toEqual({ status: "no-context" });

    const long = message("a5", "assistant", `${"x".repeat(3000)} Shall I continue?`);
    const context = composerPredictionContext(cache(latest, long));
    expect(context.status).toBe("ready");
    if (context.status !== "ready") throw new Error("Expected a completed turn");
    const { assistant } = JSON.parse(context.text);
    expect(assistant).toHaveLength(1500);
    expect(assistant.endsWith("Shall I continue?")).toBe(true);
  });

  it("persists only valid next-message suggestions against opaque chat and turn keys", async () => {
    localStorage.clear();
    vi.stubGlobal("crypto", webcrypto);
    const scope = (chat: string, turn: string) =>
      JSON.stringify([chat, turn, "synthetic transcript"]);
    try {
      const key = await composerNextMessageKey(scope("one", "latest"));
      if (!key) throw new Error("Expected a storage key");
      storedNextMessages().set(key, "Can you add a roof?");
      expect(storedNextMessages().get(key)).toBe("Can you add a roof?");
      expect(localStorage.getItem(localStorage.key(0) ?? "")).not.toContain("synthetic transcript");
      for (const input of [scope("two", "latest"), scope("one", "earlier")]) {
        const different = await composerNextMessageKey(input);
        if (!different) throw new Error("Expected a storage key");
        expect(storedNextMessages().get(different)).toBeUndefined();
      }
      storedNextMessages().set(key, "/example");
      expect(storedNextMessages().get(key)).toBe("Can you add a roof?");
      storedNextMessages().set(key, null);
      expect(storedNextMessages().get(key)).toBeNull();
      const failedStorage = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
        throw new Error("Storage full");
      });
      expect(storedNextMessages().set(key, "A different suggestion")).toBe(false);
      failedStorage.mockRestore();
    } finally {
      vi.unstubAllGlobals();
      localStorage.clear();
    }
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
