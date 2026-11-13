import { beforeEach, describe, expect, it, vi } from "vitest";
import { composerPredictionSuffix, createPredictionCache } from "@/lib/composerPredictions";
import { createOpencodeClient } from "@/lib/opencode/client";

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
