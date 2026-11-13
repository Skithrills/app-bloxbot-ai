/**
 * Component tests for ChatInput.
 *
 * Tests message submission, image attachment validation,
 * model selection, and send/abort button states.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// ── Helpers ──────────────────────────────────────────────────────────

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
        prepareCache={(qc) => {
          qc.setQueryData(qk.config, {
            ...DEFAULT_APP_CONFIG,
            composerPredictions: true,
            hideFreeModels,
          });
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
        }}
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
    expect(screen.getByRole("button", { name: "Queue" })).toHaveAttribute(
      "title",
      "Queue after the current turn (Alt+Enter)",
    );

    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Follow up" } });
      await Promise.resolve();
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

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Queue" })));
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
    expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
    await act(async () => rejectSend(new Error("Inbox unavailable")));

    expect(await screen.findByText("Message not sent")).toBeInTheDocument();
    expect(await screen.findByText("Part.Anchored")).toBeInTheDocument();
    expect(screen.getByText("reference.png")).toBeInTheDocument();
    expect(textarea).toHaveTextContent("Another message");
    expect(qc.getQueryData<Record<string, SessionStatus>>(qk.statuses)?.s1.type).toBe("busy");
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
