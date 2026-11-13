/**
 * Component tests for ChatInput.
 *
 * Tests message submission, image attachment validation,
 * model selection, and send/abort button states.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatInput from "@/components/ChatInput";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import {
  COMPOSER_PREDICTION_DELAY_MS,
  composerPredictionCache,
} from "@/hooks/useComposerPrediction";
import {
  EMPTY_COMPOSER_DRAFT,
  migrateLegacyComposerDrafts,
  readComposerDraft,
  saveComposerDraft,
} from "@/lib/composerDrafts";
import { desktop } from "@/lib/desktop";
import {
  type ExplorerTreeUpdate,
  OBJECT_DRAG_CLASS_TYPE,
  OBJECT_DRAG_NAME_TYPE,
  OBJECT_DRAG_TYPE,
} from "@/lib/explorer";
import type { Session, SessionStatus } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { ActiveSessionContext } from "@/providers/ActiveSessionProvider";
import {
  ExplorerReferenceProvider,
  useExplorerReference,
} from "@/providers/ExplorerReferenceProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";

const studio = vi.hoisted(() => ({
  selected: null as { key: string } | null,
  sendBlock: null as string | null,
  targets: [] as unknown[],
  noteRouted: vi.fn(),
}));
vi.mock("@/providers/StudioTargetProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/StudioTargetProvider")>()),
  useStudioTargetOptional: () => studio,
}));

// jsdom can't decode video, so the frames come from here.
const videos = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/composerVideos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/composerVideos")>()),
  readVideoFrames: videos.read,
}));

// ── Helpers ──────────────────────────────────────────────────────────

/** Switches predictions on, with the free model they are allowed to use. */
function enablePredictions(qc: QueryClient, modelID: string, hideFreeModels = false) {
  qc.setQueryData(qk.config, { ...DEFAULT_APP_CONFIG, composerPredictions: true, hideFreeModels });
  qc.setQueryData(qk.providers, {
    all: [
      {
        id: "opencode",
        source: "custom",
        name: "OpenCode Zen",
        env: [],
        models: {
          [modelID]: {
            id: modelID,
            name: "Example Free",
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            capabilities: { input: { text: true }, output: { text: true } },
          },
        },
      },
    ],
    connected: ["opencode"],
    default: { opencode: modelID },
  });
}

function makeSession(id: string, title: string): Session {
  return {
    id,
    title,
    time: { created: Date.now(), updated: Date.now() },
    version: 1,
    parentID: "",
  } as Session;
}

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    composer: { predict: vi.fn().mockResolvedValue(null) },
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({ data: null }),
      create: vi.fn().mockResolvedValue({ data: null }),
      delete: vi.fn().mockResolvedValue({ data: true }),
      update: vi.fn().mockResolvedValue({ data: null }),
      abort: vi.fn().mockResolvedValue({ data: true }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      status: vi.fn().mockResolvedValue({ data: {} }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue({}),
      promptInbox: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      ...overrides,
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: {
          all: [
            {
              id: "anthropic",
              name: "Anthropic",
              env: [],
              models: {
                "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
              },
            },
          ],
          connected: ["anthropic"],
          default: { anthropic: "claude-3.5-sonnet" },
        },
      }),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
      auth: vi.fn().mockResolvedValue({ data: undefined }),
    },
    auth: { set: vi.fn(), remove: vi.fn() },
    question: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn(), reject: vi.fn() },
    permission: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn() },
    event: { subscribe: vi.fn().mockResolvedValue({ stream: null }) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    location: { reload: vi.fn().mockResolvedValue({}) },
    mcp: { connect: vi.fn(), disconnect: vi.fn() },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function seedState(qc: QueryClient, session: Session) {
  qc.setQueryData(qk.sessions, [session]);
  qc.setQueryData(qk.statuses, {});
  qc.setQueryData(qk.providers, {
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        env: [],
        models: { "claude-3.5-sonnet": { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet" } },
      },
    ],
    connected: ["anthropic"],
    default: { anthropic: "claude-3.5-sonnet" },
  });
  qc.setQueryData(qk.config, {
    lastModel: "anthropic/claude-3.5-sonnet",
    hiddenModels: [],
    theme: "system",
  });
  qc.setQueryData<MessagesCache>(qk.messages(session.id), { messageIds: [], messagesById: {} });
  qc.setQueryData(qk.todos(session.id), []);
  qc.setQueryData(qk.questions(session.id), null);
  qc.setQueryData(qk.permissions(session.id), null);
}

/**
 * Wrapper that renders ChatInput with all required providers.
 * Pre-selects a session so the input is active.
 */
function TestChatInput({
  client,
  queryClient,
  sessionId = "s1",
  clientStatus = "ready",
  onOpenSettings,
  prepareCache,
}: {
  onOpenSettings?: () => void;
  client: ReturnType<typeof createClient>;
  queryClient: QueryClient;
  sessionId?: string;
  clientStatus?: string;
  prepareCache?: (client: QueryClient) => void;
}) {
  const activeSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);
  const session = makeSession(sessionId, "Test Session");
  seedState(queryClient, session);
  prepareCache?.(queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <OpenCodeClientContext.Provider
          value={{
            client: client as never,
            status: clientStatus as "waiting" | "ready" | "error",
            port: 4096,
            ready: clientStatus === "ready",
            initError: null,
          }}
        >
          <ActiveSessionContext.Provider
            value={{
              activeSessionId: sessionId,
              selectSession: async () => {},
              clearSession: () => {},
              activeSessionIdRef,
            }}
          >
            <PreferencesProvider>
              <ExplorerReferenceProvider>
                <ChatInput onOpenSettings={onOpenSettings} />
                <ReferenceButton />
                <Toaster />
              </ExplorerReferenceProvider>
            </PreferencesProvider>
          </ActiveSessionContext.Provider>
        </OpenCodeClientContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const PART = {
  name: "Part",
  className: "Part",
  path: "game.Workspace.Part",
  hasChildren: false,
  properties: [],
  attributes: [],
  children: [],
};

/** What Explorer's right-click action does, and the objects its sync shares. */
function ReferenceButton() {
  const { referenceObject } = useExplorerReference();
  return (
    <>
      <button type="button" onClick={() => referenceObject(PART)}>
        Reference Part
      </button>
      <button
        type="button"
        onClick={() => referenceObject({ ...PART, field: { kind: "property", name: "Anchored" } })}
      >
        Reference Anchored
      </button>
    </>
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  studio.selected = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("ChatInput", () => {
  beforeEach(() => {
    localStorage.clear();
    composerPredictionCache.clear();
    for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
      saveComposerDraft(id, EMPTY_COMPOSER_DRAFT);
    }
  });

  // Hiding free models is about the models chats use, so it leaves predictions on.
  it.each([
    false,
    true,
  ])("previews the latest draft with a free model and appends it only on unmodified Tab (free models hidden: %s)", async (hideFreeModels) => {
    const client = createClient();
    const queryClient = createQueryClient();
    const modelID = "example-free";
    const current = "Build a Roblox lobby with";
    let finishOld: (suffix: string) => void = () => {};
    client.composer.predict
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(" a shop and spawn area.");

    render(
      <TestChatInput
        client={client}
        queryClient={queryClient}
        prepareCache={(qc) => enablePredictions(qc, modelID, hideFreeModels)}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Message" });
    const writeDraft = async (draft: string) => {
      await act(async () => {
        editor.focus();
        fireEvent.input(editor, { target: { textContent: draft } });
      });
      const tail = editor.querySelector("[data-lexical-text]")?.firstChild;
      if (!tail) throw new Error("Expected a Lexical text node");
      await act(async () => {
        window.getSelection()?.collapse(tail, draft.length);
        document.dispatchEvent(new Event("selectionchange"));
      });
    };
    const waitForPrediction = { timeout: COMPOSER_PREDICTION_DELAY_MS + 2_000 };
    const pressTab = (modifiers = {}) => fireEvent.keyDown(editor, { key: "Tab", ...modifiers });

    await writeDraft("Build a small Roblox game");
    await waitFor(
      () => expect(client.composer.predict).toHaveBeenCalledTimes(1),
      waitForPrediction,
    );
    const oldSignal = client.composer.predict.mock.calls[0][1].signal;
    await writeDraft(current);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finishOld(" with lots of coins."));
    expect(editor.querySelector("[data-composer-prediction]")).toBeNull();

    await waitFor(
      () =>
        expect(editor.querySelector("[data-composer-prediction]")).toHaveAttribute(
          "data-composer-prediction",
          " a shop and spawn area.",
        ),
      waitForPrediction,
    );
    expect(client.composer.predict.mock.calls[1][0]).toEqual({ draft: current, modelID });
    expect(editor).toHaveTextContent(current);
    expect(editor).not.toHaveTextContent("shop");
    expect(pressTab({ shiftKey: true })).toBe(true);
    expect(pressTab({ isComposing: true })).toBe(true);
    expect(pressTab()).toBe(false);
    await waitFor(() => expect(editor).toHaveTextContent(`${current} a shop and spawn area.`));
    expect(editor.querySelector("[data-composer-prediction]")).toBeNull();
    expect(client.session.promptAsync).not.toHaveBeenCalled();
    expect(pressTab()).toBe(true);
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    await waitFor(() => expect(editor).toHaveTextContent(current));
    expect(editor).not.toHaveTextContent("shop");

    // Typing along a suggestion already made shows the rest of it without asking the model.
    await writeDraft(`${current} a shop`);
    await waitFor(() =>
      expect(editor.querySelector("[data-composer-prediction]")).toHaveAttribute(
        "data-composer-prediction",
        " and spawn area.",
      ),
    );
    expect(client.composer.predict).toHaveBeenCalledTimes(2);
  });

  it("suggests the whole next message in an empty composer, in place of the placeholder", async () => {
    const client = createClient();
    const modelID = "example-free";
    const placeholder = "Describe what you want to build...";
    const reply = (id: string, text: string, completed: boolean) => ({
      info: {
        id,
        sessionID: "s1",
        role: "assistant",
        time: { created: 2, ...(completed && { completed: 3 }) },
      },
      parts: [{ id: `${id}-text`, type: "text", text }],
    });
    const chat = (...replies: ReturnType<typeof reply>[]) =>
      ({
        messageIds: ["ask", ...replies.map(({ info }) => info.id)],
        messagesById: Object.fromEntries(
          [
            {
              info: { id: "ask", sessionID: "s1", role: "user", time: { created: 1 } },
              parts: [{ id: "ask-text", type: "text", text: "Watch this clip" }],
            },
            ...replies,
          ].map((message) => [message.info.id, message]),
        ),
      }) as unknown as MessagesCache;
    client.composer.predict.mockResolvedValueOnce("Yes, pull more frames");
    const queryClient = createQueryClient();
    const { container } = render(
      <TestChatInput
        client={client}
        queryClient={queryClient}
        prepareCache={(qc) => {
          enablePredictions(qc, modelID);
          // A reply that is still arriving has nothing settled to read a suggestion from.
          qc.setQueryData(qk.messages("s1"), chat(reply("partial", "You broke", false)));
        }}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Message" });
    const focusEmpty = async () => {
      const paragraph = editor.querySelector("p");
      if (!paragraph) throw new Error("Expected an empty paragraph");
      await act(async () => {
        editor.focus();
        window.getSelection()?.collapse(paragraph, 0);
        document.dispatchEvent(new Event("selectionchange"));
      });
    };
    const waitForPrediction = { timeout: COMPOSER_PREDICTION_DELAY_MS + 2_000 };
    const suggestion = () => container.querySelector("[data-composer-next-message]");

    await focusEmpty();
    await act(() => new Promise((resolve) => setTimeout(resolve, COMPOSER_PREDICTION_DELAY_MS)));
    expect(client.composer.predict).not.toHaveBeenCalled();
    expect(screen.getByText(placeholder)).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(
        qk.messages("s1"),
        chat(reply("done", "You broke a skylight. Want more frames?", true)),
      );
    });
    await waitFor(
      () =>
        expect(suggestion()).toHaveAttribute("data-composer-next-message", "Yes, pull more frames"),
      waitForPrediction,
    );
    expect(client.composer.predict).toHaveBeenCalledExactlyOnceWith(
      {
        draft: "",
        modelID,
        context: JSON.stringify({
          user: "Watch this clip",
          assistant: "You broke a skylight. Want more frames?",
        }),
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(screen.queryByText(placeholder)).toBeNull();
    expect(editor).toHaveTextContent("");

    // Typing along the suggestion keeps the rest of it as the usual gray continuation.
    await act(async () => {
      fireEvent.input(editor, { target: { textContent: "Yes, pull" } });
    });
    const tail = editor.querySelector("[data-lexical-text]")?.firstChild;
    if (!tail) throw new Error("Expected a Lexical text node");
    await act(async () => {
      window.getSelection()?.collapse(tail, "Yes, pull".length);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await waitFor(() =>
      expect(editor.querySelector("[data-composer-prediction]")).toHaveAttribute(
        "data-composer-prediction",
        " more frames",
      ),
    );
    expect(suggestion()).toBeNull();

    // Emptied again, the suggestion is back at once, and Tab writes it without sending.
    await act(async () => {
      fireEvent.input(editor, { target: { textContent: "" } });
    });
    await focusEmpty();
    await waitFor(() => expect(suggestion()).not.toBeNull());
    expect(fireEvent.keyDown(editor, { key: "Tab" })).toBe(false);
    await waitFor(() => expect(editor).toHaveTextContent("Yes, pull more frames"));
    expect(suggestion()).toBeNull();
    expect(client.composer.predict).toHaveBeenCalledOnce();
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("attaches a video as still frames and tells the model which images they are", async () => {
    const client = createClient();
    const frames = [0.5, 1.5].map((time) => ({
      dataUrl: `data:image/jpeg;base64,AA${time}`,
      time,
    }));
    let finishReading = (_video: { duration: number; frames: typeof frames }) => {};
    videos.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReading = resolve;
        }),
    );
    const { container } = render(
      <TestChatInput client={client} queryClient={createQueryClient()} />,
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("File input was not rendered");
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    const clip = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [clip] } });
    });
    expect(videos.read).toHaveBeenCalledExactlyOnceWith(clip);
    expect(await screen.findByText("Reading video")).toBeInTheDocument();

    // Sending now would leave the video out, so the message waits for it.
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "What happens here?" } });
      await Promise.resolve();
      fireEvent.keyDown(textarea, { key: "Enter" });
    });
    expect(client.session.promptAsync).not.toHaveBeenCalled();
    expect(textarea).toHaveTextContent("What happens here?");

    await act(async () => finishReading({ duration: 2, frames }));
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(screen.queryByText("Reading video")).toBeNull();
    expect(screen.getByTitle("Sent as 2 still frames, without sound")).toHaveTextContent("0:02");

    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    await waitFor(() => expect(client.session.promptAsync).toHaveBeenCalledOnce());
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s1",
        parts: [
          {
            type: "text",
            text: 'What happens here?\n\n[Video "clip.mp4" (0:02): attached images 1–2 are still frames from it, taken at 0.5s, 1.5s. Its audio is not included.]',
          },
          {
            type: "file",
            mime: "image/jpeg",
            url: frames[0].dataUrl,
            filename: "clip.mp4 frame 1.jpg",
          },
          {
            type: "file",
            mime: "image/jpeg",
            url: frames[1].dataUrl,
            filename: "clip.mp4 frame 2.jpg",
          },
        ],
      }),
      { throwOnError: true },
    );
    expect(screen.queryByText("clip.mp4")).toBeNull();
  });

  it("turns away a video that can't be decoded and a file that is neither image nor video", async () => {
    const client = createClient();
    videos.read.mockRejectedValueOnce(new Error("The video couldn't be decoded."));
    const { container } = render(
      <TestChatInput client={client} queryClient={createQueryClient()} />,
    );
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("File input was not rendered");
    await act(async () => {
      fireEvent.change(fileInput, {
        target: {
          files: [
            new File(["video"], "broken.mkv", { type: "" }),
            new File(["text"], "notes.txt", { type: "text/plain" }),
          ],
        },
      });
    });
    expect(
      await screen.findByText("Couldn't read that video. Try an MP4 or WebM."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "That file isn't an image or video. Try a PNG, JPEG, GIF, WebP, MP4, or WebM instead.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Reading video")).toBeNull();
    expect(screen.queryByText("broken.mkv")).toBeNull();
    expect(screen.getByTitle("Send")).toBeDisabled();
  });

  it("keeps the chat's last used model at the top of the picker, with a warning once another is chosen", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const provider = {
      id: "anthropic",
      name: "Anthropic",
      env: [],
      models: {
        big: { id: "big", name: "Claude Big", limit: { context: 1_000_000, output: 1 } },
        small: { id: "small", name: "Claude Small", limit: { context: 200_000, output: 1 } },
      },
    };
    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        prepareCache={(cache) => {
          cache.setQueryData(qk.providers, {
            all: [provider],
            connected: ["anthropic"],
            default: { anthropic: "big" },
          });
          cache.setQueryData(qk.config, { ...DEFAULT_APP_CONFIG, lastModel: "anthropic/big" });
          cache.setQueryData(qk.messages("s1"), {
            messageIds: ["reply"],
            messagesById: {
              reply: {
                info: {
                  id: "reply",
                  sessionID: "s1",
                  role: "assistant",
                  providerID: "anthropic",
                  modelID: "big",
                  time: { created: 1, completed: 2 },
                },
                parts: [],
              },
            },
          } as unknown as MessagesCache);
        }}
      />,
    );
    const picker = () => screen.getByRole("button", { name: /Claude (Big|Small)$/ });
    fireEvent.click(await screen.findByRole("button", { name: "Claude Big" }));
    // On the chat's own model there is nothing to warn about.
    const lastUsed = await screen.findByRole("button", { name: /Last used.*Claude Big/ });
    expect(lastUsed).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/reads the whole chat again/)).toBeNull();

    // Another model, picked by accident or not, is marked on the picker and explained in it.
    fireEvent.click(screen.getByRole("button", { name: "Claude Small" }));
    await waitFor(() =>
      expect(picker()).toHaveAccessibleDescription(/^This chat has been using Claude Big\./),
    );
    expect(picker().querySelector("[data-model-switched]")).not.toBeNull();
    fireEvent.click(picker());
    expect(
      await screen.findByText(
        /This chat has been using Claude Big\. A different model reads the whole chat again from the start, which costs more, and this one holds less \(200K against 1M tokens\), so the chat may be compacted\./,
      ),
    ).toBeVisible();

    // One click on the card goes back.
    fireEvent.click(screen.getByRole("button", { name: /Last used.*Claude Big/ }));
    const back = await screen.findByRole("button", { name: "Claude Big" });
    expect(back).not.toHaveAttribute("title");
    expect(back.querySelector("[data-model-switched]")).toBeNull();
  });

  it("groups a Fast model with its standard version and keeps compatible effort when toggled", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const id = "gpt-6.1-sol";
    const provider = {
      id: "openai-oauth",
      name: "ChatGPT Subscription",
      source: "api",
      env: [],
      models: {
        [id]: { id, name: "GPT-6.1 Sol", variants: { low: {}, max: {} } },
        [`${id}-fast`]: { id: `${id}-fast`, name: "GPT-6.1 Sol Fast", variants: { low: {} } },
      },
    };
    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        prepareCache={(cache) => {
          cache.setQueryData(qk.providers, {
            all: [provider],
            connected: [provider.id],
            default: { [provider.id]: id },
          });
          cache.setQueryData(qk.config, {
            ...DEFAULT_APP_CONFIG,
            lastModel: `${provider.id}/${id}`,
          });
        }}
      />,
    );
    const modelPicker = await screen.findByRole("button", { name: /GPT-6.1 Sol.*ChatGPT Sub/ });
    fireEvent.click(modelPicker);
    expect(await screen.findByRole("button", { name: "GPT-6.1 Sol", pressed: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: "GPT-6.1 Sol Fast" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search models" }), { key: "Escape" });
    await waitFor(() => expect(modelPicker).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Auto effort" }));
    const slider = await screen.findByRole("slider", { name: "Reasoning effort" });
    await waitFor(() => expect(slider).toHaveFocus());
    fireEvent.change(slider, { target: { value: "1" } });
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuetext", "Low"));
    fireEvent.click(await screen.findByRole("button", { name: "Fast mode", pressed: false }));
    expect(await screen.findByRole("button", { name: "Fast mode", pressed: true })).toBeVisible();
    expect(slider).toHaveAttribute("aria-valuetext", "Low");
    expect(slider.parentElement).toHaveAttribute("data-fast");
    fireEvent.keyDown(slider, { key: "Escape" });

    const editor = screen.getByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.input(editor, { target: { textContent: "Use the Fast version." } });
    });
    fireEvent.click(screen.getByTitle("Send"));
    await waitFor(() =>
      expect(client.session.promptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          model: { providerID: provider.id, modelID: `${id}-fast` },
          variant: "low",
        }),
        expect.anything(),
      ),
    );
  });

  it("hides free models from /model and sends with the configured paid default", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const free = {
      id: "opencode",
      name: "OpenCode Zen",
      source: "custom",
      env: [],
      models: { "test-free": { id: "test-free", name: "Example Free" } },
    };
    const api = {
      id: "openai-api",
      name: "OpenAI API Key",
      source: "api",
      env: [],
      models: {
        "gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", serviceTier: "ultrafast" },
      },
    };
    const oauth = { ...api, id: "openai-oauth", name: "ChatGPT Subscription" };
    const providerList = {
      all: [free, oauth, api],
      connected: [free.id, oauth.id, api.id],
      default: { opencode: "test-free" },
    };
    const setModelSettings = vi.spyOn(desktop, "setModelSettings").mockResolvedValue(undefined);
    client.provider.list.mockResolvedValue({ data: providerList });
    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        prepareCache={(cache) => {
          cache.setQueryData(qk.providers, providerList);
          cache.setQueryData(qk.config, {
            ...DEFAULT_APP_CONFIG,
            lastModel: "opencode/test-free",
            paidDefaultModel: "openai-api/gpt-6.1-sol",
          });
        }}
      />,
    );
    const editor = await screen.findByRole("textbox", { name: "Message" });
    await screen.findByRole("button", { name: "Example Free" });
    await act(async () => {
      fireEvent.input(editor, { target: { textContent: "/model" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    const hideFree = await screen.findByRole("checkbox", { name: "Hide free models" });
    expect(hideFree).not.toBeChecked();
    fireEvent.click(hideFree);

    await waitFor(() => expect(hideFree).toBeChecked());
    expect(setModelSettings).toHaveBeenCalledWith({ hideFreeModels: true });
    expect(screen.queryByText("Example Free")).not.toBeInTheDocument();
    expect(screen.getByText("ChatGPT Subscription")).toBeInTheDocument();
    expect(screen.getByText("OpenAI API Key")).toBeInTheDocument();
    const model = screen.getByRole("button", { name: /GPT-6.1 Sol.*OpenAI API · Ultrafast/ });
    fireEvent.click(model);
    await act(async () => {
      fireEvent.input(editor, { target: { textContent: "Use the paid model" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    await waitFor(() =>
      expect(client.session.promptAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          model: { providerID: "openai-api", modelID: "gpt-6.1-sol" },
          requirePaidModel: true,
        }),
        expect.anything(),
      ),
    );
  });

  it("sends a text message on submit", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByRole("textbox", { name: "Message" });

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Build a game" } });
    });
    expect(localStorage.getItem("bloxbot-composer-draft:s1")).toContain("Build a game");

    const sendBtn = screen.getByTitle("Send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(client.session.promptAsync).toHaveBeenCalled();
    const args = client.session.promptAsync.mock.calls[0][0];
    expect(args.parts[0].text).toBe("Build a game");
    expect(args.sessionID).toBe("s1");
    expect(localStorage.getItem("bloxbot-composer-draft:s1")).toBeNull();
  });

  it("notes the Studio a message went to, but not for a command that runs here", async () => {
    const onOpenSettings = vi.fn();
    const client = createClient();
    render(
      <TestChatInput
        client={client}
        queryClient={createQueryClient()}
        onOpenSettings={onOpenSettings}
      />,
    );
    const textarea = await screen.findByRole("textbox", { name: "Message" });

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "/connect" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    expect(onOpenSettings).toHaveBeenCalled();
    expect(studio.noteRouted).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Build a game" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    expect(client.session.promptAsync).toHaveBeenCalled();
    expect(studio.noteRouted).toHaveBeenCalledOnce();
  });

  it("offers a way to add providers and models from the model picker", async () => {
    const onOpenSettings = vi.fn();
    const client = createClient();
    const queryClient = createQueryClient();
    render(
      <TestChatInput client={client} queryClient={queryClient} onOpenSettings={onOpenSettings} />,
    );
    await screen.findByRole("textbox", { name: "Message" });

    fireEvent.click(screen.getByRole("button", { name: /Select model|GPT|Claude/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Add providers and models" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Add providers and models" }),
    ).not.toBeInTheDocument();
  });

  it("adds a referenced property as a chip that names it", async () => {
    const client = createClient();
    render(<TestChatInput client={client} queryClient={createQueryClient()} />);
    await screen.findByRole("textbox", { name: "Message" });

    fireEvent.click(screen.getByRole("button", { name: "Reference Anchored" }));

    const chip = await screen.findByText("Part.Anchored");
    expect(chip).toHaveAttribute("title", `Property of ${PART.path}`);
    expect(chip.querySelector("img")).toHaveAttribute("src", "bloxbot-icon://studio/light/Part");
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    expect(client.session.promptAsync.mock.calls[0][0].parts[0].text).toBe(
      '<Instance reference="game.Workspace.Part" class="Part" property="Anchored">@Part.Anchored</Instance>',
    );
  });

  it("adds an object dragged from Explorer as a chip", async () => {
    studio.selected = { key: "studio-1" };
    let send: (update: ExplorerTreeUpdate) => void = () => {};
    vi.spyOn(desktop, "onExplorerTreeUpdate").mockImplementation((listener) => {
      send = listener;
      return () => {};
    });
    vi.spyOn(desktop, "syncExplorerTree").mockImplementation(async (studioId) => {
      send({ studioId, parentId: null, children: [PART] });
      return {
        changed: true,
        watching: false,
        complete: true,
        truncated: false,
        slowestReadMs: 0,
      };
    });
    render(<TestChatInput client={createClient()} queryClient={createQueryClient()} />);
    const textbox = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(desktop.syncExplorerTree).toHaveBeenCalled());
    // An object only offers itself once the tree has been read.
    await act(async () => {});

    const composer = textbox.closest("[data-composer]") as Element;
    const dataTransfer = {
      types: [OBJECT_DRAG_TYPE],
      files: [],
      dropEffect: "none",
      getData: (type: string) => (type === OBJECT_DRAG_TYPE ? PART.path : ""),
    };
    fireEvent.dragEnter(composer, { dataTransfer });
    expect(screen.getByText("Drop to reference this object...")).toBeInTheDocument();
    fireEvent.dragOver(composer, { dataTransfer });
    fireEvent.drop(composer, { dataTransfer });

    const chip = await screen.findByText("Part");
    expect(chip).toHaveAttribute("title", PART.path);
    expect(chip.querySelector("img")).toHaveAttribute("src", "bloxbot-icon://studio/light/Part");
    expect(screen.queryByText("Drop to reference this object...")).not.toBeInTheDocument();
  });

  it("takes an object dragged from Explorer before the message box has heard of it", async () => {
    render(<TestChatInput client={createClient()} queryClient={createQueryClient()} />);
    const textbox = await screen.findByRole("textbox", { name: "Message" });
    const composer = textbox.closest("[data-composer]") as Element;
    const dataTransfer = {
      types: [OBJECT_DRAG_TYPE],
      files: [],
      dropEffect: "none",
      getData: (type: string) =>
        new Map([
          [OBJECT_DRAG_TYPE, "game.Workspace.Model.La.te"],
          [OBJECT_DRAG_NAME_TYPE, "La.te"],
          [OBJECT_DRAG_CLASS_TYPE, "MeshPart"],
        ]).get(type) ?? "",
    };
    fireEvent.dragEnter(composer, { dataTransfer });
    fireEvent.drop(composer, { dataTransfer });

    const chip = await screen.findByText("La.te");
    expect(chip).toHaveAttribute("title", "game.Workspace.Model.La.te");
    expect(chip.querySelector("img")).toHaveAttribute(
      "src",
      "bloxbot-icon://studio/light/MeshPart",
    );
  });

  it("adds Explorer's Reference as the same chip and text as an @ mention", async () => {
    const client = createClient();

    render(<TestChatInput client={client} queryClient={createQueryClient()} />);
    await screen.findByRole("textbox", { name: "Message" });

    fireEvent.click(screen.getByRole("button", { name: "Reference Part" }));

    expect(await screen.findByText("Part")).toHaveAttribute("title", "game.Workspace.Part");
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    expect(client.session.promptAsync.mock.calls[0][0].parts[0].text).toBe(
      '<Instance reference="game.Workspace.Part" class="Part">@Part</Instance>',
    );
  });

  it("sends message on Enter key (without Shift)", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByRole("textbox", { name: "Message" });

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Hello" } });
      await Promise.resolve();
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    expect(client.session.promptAsync).toHaveBeenCalled();
  });

  it("does NOT send on Shift+Enter (allows newline)", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = await screen.findByRole("textbox", { name: "Message" });

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Hello" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    });

    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("restores the draft and status when sending fails", async () => {
    const client = createClient({
      promptAsync: vi.fn().mockRejectedValue(new Error("Prompt rejected")),
    });
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    const textarea = (await screen.findByRole("textbox", {
      name: "Message",
    })) as HTMLTextAreaElement;
    act(() => {
      qc.setQueryData(qk.statuses, { s1: { type: "idle" } as SessionStatus });
    });

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Keep this draft" } });
      await Promise.resolve();
      fireEvent.click(screen.getByTitle("Send"));
    });

    await waitFor(() => expect(textarea).toHaveTextContent("Keep this draft"));
    expect(qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1.type).toBe("idle");
  });

  it("does not restore a failed send into a different session", async () => {
    let rejectPrompt: (error: Error) => void = () => {};
    const client = createClient({
      promptAsync: vi.fn().mockImplementation(() => {
        const pending = new Promise((_resolve, reject) => {
          rejectPrompt = reject;
        });
        void pending.catch(() => undefined);
        return pending;
      }),
    });
    const qc = createQueryClient();
    const view = render(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);

    const textarea = (await screen.findByRole("textbox", {
      name: "Message",
    })) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Session one draft" } });
      fireEvent.click(screen.getByTitle("Send"));
    });

    view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s2" />);
    await act(async () => {
      rejectPrompt(new Error("Prompt rejected"));
      await Promise.resolve();
    });

    expect(textarea).not.toHaveTextContent("Session one draft");
    expect(screen.queryByText("Message not sent")).not.toBeInTheDocument();

    view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    await waitFor(() => expect(textarea).toHaveTextContent("Session one draft"));
  });

  it("shows Stop button when session is busy", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    // Set busy *after* render so seedState doesn't overwrite
    act(() => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
    });

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeInTheDocument();
    });
  });

  it("marks a successfully aborted session idle without refetching", async () => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    act(() => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
    });

    const stopButton = await screen.findByTitle("Stop");
    await act(async () => {
      fireEvent.click(stopButton);
    });

    await waitFor(() => {
      expect(qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1.type).toBe("idle");
    });
    expect(client.session.abort).toHaveBeenCalledWith({ sessionID: "s1" }, { throwOnError: true });
  });

  it("won't send while this chat's place is closed, keeping what was typed", async () => {
    studio.sendBlock = "Dungeon isn't open. Reopen it, choose another, or work without Studio.";
    try {
      const client = createClient();
      render(<TestChatInput client={client} queryClient={createQueryClient()} />);
      const textarea = await screen.findByRole("textbox", { name: "Message" });

      await act(async () => {
        fireEvent.input(textarea, { target: { textContent: "Delete everything" } });
      });
      expect(
        screen.getByTitle("Dungeon isn't open. Reopen it, choose another, or work without Studio."),
      ).toHaveAttribute("aria-disabled", "true");

      await act(async () => {
        fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });
      });

      expect(client.session.promptAsync).not.toHaveBeenCalled();
      expect(textarea).toHaveTextContent("Delete everything");

      // Commands that don't set the agent to work still run.
      await act(async () => {
        fireEvent.input(textarea, { target: { textContent: "/connect" } });
      });
      expect(screen.getByTitle("Send")).toBeEnabled();
    } finally {
      studio.sendBlock = null;
    }
  });

  it("keeps what was typed when something else takes over the screen for a while", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const { unmount } = render(<TestChatInput client={client} queryClient={qc} />);
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Build a lobby" } });
    });
    unmount();

    render(<TestChatInput client={client} queryClient={createQueryClient()} />);
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveTextContent(
      "Build a lobby",
    );
  });

  it("keeps a draft when switching chats, and brings it back on return", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const view = render(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Half a thought" } });
    });

    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s2" />);
    });
    expect(textarea).not.toHaveTextContent("Half a thought");

    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    });
    expect(textarea).toHaveTextContent("Half a thought");
  });

  it("brings a saved draft back when its chat is opened again", async () => {
    localStorage.setItem("bloxbot-composer-draft:s2", JSON.stringify({ text: "Saved for later" }));
    const client = createClient();
    const qc = createQueryClient();
    const view = render(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    expect(textarea).not.toHaveTextContent("Saved for later");

    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s2" />);
    });

    expect(textarea).toHaveTextContent("Saved for later");
    expect(readComposerDraft("s2").text).toBe("Saved for later");
  });

  it("falls back to a draft's words when its editor state can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    saveComposerDraft("s2", {
      text: "Still worth keeping",
      attachments: [],
      editorState: {
        root: { type: "root", children: [{ type: "not-a-node", version: 1 }] },
      } as never,
    });
    const client = createClient();
    const qc = createQueryClient();
    const view = render(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    const textarea = await screen.findByRole("textbox", { name: "Message" });

    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s2" />);
    });

    expect(textarea).toHaveTextContent("Still worth keeping");
    error.mockRestore();
  });

  it("keeps separate text and reference drafts through reloads and removes cleared drafts", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const view = render(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.click(screen.getByRole("button", { name: "Reference Part" }));
    await screen.findByText("Part");
    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s2" />);
    });
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Another chat's draft" } });
    });

    // A fresh module has no in-memory composer state, like the next app launch.
    vi.resetModules();
    const fresh = await import("@/lib/composerDrafts");
    expect(fresh.readComposerDraft("s1").editorState).toBeDefined();
    expect(fresh.readComposerDraft("s2").text).toBe("Another chat's draft");

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "" } });
    });
    vi.resetModules();
    const relaunched = await import("@/lib/composerDrafts");
    expect(relaunched.readComposerDraft("s1").editorState).toBeDefined();
    expect(relaunched.readComposerDraft("s2")).toEqual(EMPTY_COMPOSER_DRAFT);
  });

  it("migrates legacy text independently of invalid editor or image data", () => {
    const draft = { text: "Still here", attachments: [] };
    localStorage.setItem(
      "bloxbot-kept-drafts",
      JSON.stringify([
        ["s1", draft],
        ["s2", { text: 5 }],
        "s3",
        ["s4", { ...draft, attachments: [{}] }],
        ["s5", { ...draft, editorState: { root: {} } }],
        ["s6", { ...draft, editorState: { root: { type: "paragraph", children: [] } } }],
      ]),
    );
    migrateLegacyComposerDrafts();
    expect(localStorage.getItem("bloxbot-kept-drafts")).toBeNull();
    for (const id of ["s1", "s4", "s5", "s6"]) expect(readComposerDraft(id)).toEqual(draft);
    for (const id of ["s2", "s3"]) expect(readComposerDraft(id)).toEqual(EMPTY_COMPOSER_DRAFT);
  });

  it("keeps draft text through storage quota errors for images and clears deleted drafts", async () => {
    const smallImage = {
      id: "small",
      dataUrl: "data:image/png;base64,AA==",
      mime: "image/png",
      filename: "small.png",
    };
    const quotaErrorImage = { ...smallImage, id: "large", filename: "large.png" };
    const originalSetItem = localStorage.setItem;
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "bloxbot-composer-images:s2")
        throw new DOMException("Full", "QuotaExceededError");
      originalSetItem(key, value);
    });
    saveComposerDraft("s1", { text: "With image", attachments: [smallImage] });
    saveComposerDraft("s2", { text: "Image won't fit", attachments: [quotaErrorImage] });

    vi.resetModules();
    const fresh = await import("@/lib/composerDrafts");
    expect(fresh.readComposerDraft("s1").attachments).toEqual([smallImage]);
    expect(fresh.readComposerDraft("s2")).toEqual({ text: "Image won't fit", attachments: [] });

    fresh.saveComposerDraft("deleted", { text: "Discard me", attachments: [smallImage] });
    fresh.deleteComposerDraft("deleted");
    fresh.saveComposerDraft("deleted", { text: "Late result", attachments: [] });
    expect(fresh.readComposerDraft("deleted")).toEqual(EMPTY_COMPOSER_DRAFT);
    expect(localStorage.getItem("bloxbot-composer-images:deleted")).toBeNull();
  });

  it("keeps an object's chip in a draft across chats", async () => {
    const client = createClient();
    const qc = createQueryClient();
    const view = render(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.click(screen.getByRole("button", { name: "Reference Part" }));
    await screen.findByText("Part");

    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s2" />);
    });
    expect(textarea).not.toHaveTextContent("Part");
    await act(async () => {
      view.rerender(<TestChatInput client={client} queryClient={qc} sessionId="s1" />);
    });

    expect(await screen.findByText("Part")).toBeInTheDocument();
    expect(textarea).not.toHaveTextContent("<Instance");
  });

  it.each([
    [false, "steer"],
    [true, "queue"],
  ])("routes busy Enter (Ctrl pressed: %s) to %s", async (ctrlKey, delivery) => {
    const client = createClient();
    const qc = createQueryClient();

    render(<TestChatInput client={client} queryClient={qc} />);

    // Set busy after render
    act(() => {
      qc.setQueryData(qk.statuses, { s1: { type: "busy" } as SessionStatus });
    });

    const textarea = await screen.findByRole("textbox", { name: "Message" });

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Hello" } });
      await Promise.resolve();
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey });
    });

    expect(client.session.promptAsync).not.toHaveBeenCalled();
    expect(client.session.promptInbox).toHaveBeenCalledExactlyOnceWith(
      { sessionID: "s1", text: "Hello", delivery, studioTargetID: null },
      { throwOnError: true },
    );
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
    expect(textarea.textContent).toBe("");
  });

  it("uses configured busy chords and leaves Shift+Enter and IME composition to the editor", async () => {
    const client = createClient();
    const qc = createQueryClient();
    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        prepareCache={(cache) => {
          cache.setQueryData(qk.statuses, { s1: { type: "busy" } });
          cache.setQueryData(qk.config, {
            ...DEFAULT_APP_CONFIG,
            lastModel: "anthropic/claude-3.5-sonnet",
            composerShortcuts: { steer: "mod-shift-enter", queue: "alt-enter" },
          });
        }}
      />,
    );
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    // Nothing to send into the turn yet, so the button stops it.
    expect(screen.getByTitle("Stop")).toBeInTheDocument();

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Follow up" } });
      await Promise.resolve();
    });
    // With a draft the arrow takes Stop's place. Neither chord is plain Enter, so it steers.
    expect(screen.queryByTitle("Stop")).toBeNull();
    const arrow = screen.getByRole("button", { name: "Steer at the next step (Ctrl+Shift+Enter)" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.mouseEnter(arrow);
    const menu = within(screen.getByRole("menu", { name: "Send while working" }));
    expect(menu.getByRole("menuitem", { name: /^Steer.*Ctrl\+Shift\+Enter$/ })).toBeVisible();
    expect(menu.getByRole("menuitem", { name: /^Queue.*Alt\+Enter$/ })).toBeVisible();
    expect(menu.getByRole("menuitem", { name: "Stop" })).toBeVisible();
    fireEvent.mouseLeave(arrow);
    expect(screen.queryByRole("menu")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", altKey: true, isComposing: true });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    });
    expect(client.session.promptInbox).not.toHaveBeenCalled();
    expect(textarea).toHaveTextContent("Follow up");

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true, shiftKey: true });
    });
    expect(client.session.promptInbox).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: "steer", text: "Follow up" }),
      { throwOnError: true },
    );
  });

  it("keeps slash commands working while a turn runs", async () => {
    const client = createClient();
    const onOpenSettings = vi.fn();
    render(
      <TestChatInput
        client={client}
        queryClient={createQueryClient()}
        prepareCache={(cache) => {
          cache.setQueryData(qk.statuses, { s1: { type: "busy" } });
          cache.setQueryData(qk.config, {
            ...DEFAULT_APP_CONFIG,
            composerShortcuts: { steer: "disabled", queue: "mod-enter" },
          });
        }}
        onOpenSettings={onOpenSettings}
      />,
    );
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "/connect" } });
      await Promise.resolve();
      fireEvent.keyDown(textarea, { key: "Enter" });
    });
    await waitFor(() => expect(onOpenSettings).toHaveBeenCalledOnce());
    expect(client.session.promptInbox).not.toHaveBeenCalled();
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("queues references and images and restores them with new draft text when rejected", async () => {
    let rejectSend = (_error: Error) => {};
    const client = createClient({
      promptInbox: vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectSend = reject;
          }),
      ),
    });
    const qc = createQueryClient();
    studio.selected = { key: "studio-1" };
    const { container } = render(
      <TestChatInput
        client={client}
        queryClient={qc}
        prepareCache={(cache) => cache.setQueryData(qk.statuses, { s1: { type: "busy" } })}
      />,
    );
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Image file input was not rendered");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reference Anchored" }));
      fireEvent.change(fileInput, {
        target: { files: [new File(["contents"], "reference.png", { type: "image/png" })] },
      });
    });
    expect(await screen.findByText("reference.png")).toBeInTheDocument();

    const arrow = () => screen.getByRole("button", { name: "Steer at the next step (Enter)" });
    fireEvent.mouseEnter(arrow());
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /^Queue/ })));
    expect(client.session.promptInbox).toHaveBeenCalledExactlyOnceWith(
      {
        sessionID: "s1",
        text: '<Instance reference="game.Workspace.Part" class="Part" property="Anchored">@Part.Anchored</Instance>',
        files: [{ name: "reference.png", uri: expect.stringMatching(/^data:image\/png;base64,/) }],
        delivery: "queue",
        studioTargetID: "studio-1",
      },
      { throwOnError: true },
    );
    expect(studio.noteRouted).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Another message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });
    expect(client.session.promptInbox).toHaveBeenCalledOnce();
    expect(arrow()).toBeDisabled();
    expect(screen.queryByRole("menu")).toBeNull();
    await act(async () => rejectSend(new Error("Inbox unavailable")));

    expect(await screen.findByText("Message not sent")).toBeInTheDocument();
    expect(await screen.findByText("Part.Anchored")).toBeInTheDocument();
    expect(screen.getByText("reference.png")).toBeInTheDocument();
    expect(textarea).toHaveTextContent("Another message");
    expect(qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1.type).toBe("busy");
  });

  it("only queues what is sent while the chat is being compacted", async () => {
    const client = createClient();
    const qc = createQueryClient();
    render(
      <TestChatInput
        client={client}
        queryClient={qc}
        prepareCache={(cache) => {
          cache.setQueryData(qk.statuses, { s1: { type: "busy" } });
          cache.setQueryData(qk.messages("s1"), {
            messageIds: ["compaction"],
            messagesById: {
              compaction: {
                info: { id: "compaction", sessionID: "s1", role: "user", time: { created: 1 } },
                parts: [
                  {
                    id: "compaction:compaction",
                    sessionID: "s1",
                    messageID: "compaction",
                    type: "compaction",
                    auto: false,
                    status: "running",
                  },
                ],
              },
            },
          } as unknown as MessagesCache);
        }}
      />,
    );
    const textarea = await screen.findByRole("textbox", { name: "Message" });
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Then add a roof" } });
    });
    const arrow = await screen.findByRole("button", {
      name: "Queue until compacting is done (Enter)",
    });
    fireEvent.mouseEnter(arrow);
    expect(screen.getByRole("menuitem", { name: /^Queue/ })).toHaveTextContent("After compacting");
    expect(screen.queryByRole("menuitem", { name: /^Steer/ })).toBeNull();

    // Enter steers during a turn. Here it can only queue.
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter" });
    });
    expect(client.session.promptInbox).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sessionID: "s1", text: "Then add a roof", delivery: "queue" }),
      { throwOnError: true },
    );
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("attaches an image to the submitted message", async () => {
    const client = createClient();
    const qc = createQueryClient();

    const { container } = render(<TestChatInput client={client} queryClient={qc} />);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error("Image file input was not rendered");

    const image = new File(["image contents"], "reference.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [image] } });
    });

    expect(await screen.findByText("reference.png")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });

    await waitFor(() => expect(client.session.promptAsync).toHaveBeenCalledOnce());
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s1",
        parts: [
          { type: "text", text: " " },
          {
            type: "file",
            mime: "image/png",
            url: expect.stringMatching(/^data:image\/png;base64,/),
            filename: "reference.png",
          },
        ],
      }),
      { throwOnError: true },
    );
  });
});
