/**
 * The real component tree on a mocked client, for states that are hard to reach
 * against the real server. workflows.test.tsx covers what people do end to end.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useRef } from "react";
import { toast } from "sonner";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";
import { desktop } from "@/lib/desktop";
import type { Session, UserMessage } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { type MessagesCache, sseDispatch } from "@/lib/sseDispatch";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import {
  ExplorerReferenceProvider,
  useExplorerReference,
} from "@/providers/ExplorerReferenceProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { StudioTargetProvider } from "@/providers/StudioTargetProvider";
import type { MessageWithParts } from "@/types";

// Mock react-virtual so all items render in jsdom (no viewport measurement)
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: i,
        start: i * 80,
        size: 80,
        end: (i + 1) * 80,
      })),
    getTotalSize: () => count * 80,
    measureElement: () => {},
  }),
}));

// Lexical moves focus through the selection, which jsdom doesn't follow, so what the message box
// was asked for as it appeared is recorded instead.
const composerMounts = vi.hoisted(() => [] as { focusOnMount: boolean }[]);
vi.mock("@/components/ChatInput", async (importOriginal) => {
  const { createElement, useEffect } = await import("react");
  const real = await importOriginal<typeof import("@/components/ChatInput")>();
  type Props = Parameters<typeof real.default>[0];
  return {
    ...real,
    default: (props: Props) => {
      useEffect(() => {
        composerMounts.push({ focusOnMount: props.focusOnMount === true });
      }, []);
      return createElement(real.default, props);
    },
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(id: string, title: string, createdAt = Date.now()): Session {
  return {
    id,
    title,
    time: { created: createdAt, updated: createdAt },
    version: 1,
    parentID: "",
  } as Session;
}

/**
 * Build a minimal but real provider tree for integration tests.
 * We skip OpenCodeClientProvider's lifecycle (desktop bridge, SSE, init)
 * and inject the client + ready state directly via the exported context.
 * Everything below that — ActiveSessionProvider, PreferencesProvider,
 * and all components — runs with real code.
 */
function TestApp({
  client,
  queryClient,
  withStudioTargets = false,
  children,
}: {
  client: ReturnType<typeof createClient>;
  queryClient: QueryClient;
  withStudioTargets?: boolean;
  children?: ReactNode;
}) {
  const activeSessionIdRef = useRef<string | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <OpenCodeClientContext.Provider
          value={{
            client: client as never,
            status: "ready",
            port: 4096,
            ready: true,
            initError: null,
          }}
        >
          <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
            <PreferencesProvider>
              <ExplorerReferenceProvider>
                {withStudioTargets ? (
                  <StudioTargetProvider>
                    <ChatWithSonner />
                  </StudioTargetProvider>
                ) : (
                  <ChatWithSonner />
                )}
                {children}
              </ExplorerReferenceProvider>
            </PreferencesProvider>
          </ActiveSessionProvider>
        </OpenCodeClientContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Lazy-import Chat to avoid top-level desktop bridge calls in module scope */
import Chat from "@/components/Chat";
import { Toaster } from "@/components/ui/sonner";

function ChatWithSonner() {
  return (
    <>
      <Chat />
      <Toaster />
    </>
  );
}

/** Stands in for a link to an object in a reply. */
function ObjectLink({ path }: { path: string }) {
  const { focusObject } = useExplorerReference();
  return (
    <button type="button" onClick={() => focusObject(path)}>
      Show {path}
    </button>
  );
}

/** One Studio open on one place, with a tree, and the titlebar the Explorer and Playtest live in. */
function openStudio() {
  const titlebar = document.createElement("div");
  titlebar.id = "titlebar-actions";
  document.body.append(titlebar);
  vi.spyOn(desktop, "discoverStudioTargets").mockResolvedValue({
    targets: [{ key: "studio-1", label: "My Place", detail: "Local place" }],
    selectedKey: "studio-1",
  } as never);
  const listeners = new Set<(update: unknown) => void>();
  vi.spyOn(desktop, "onExplorerTreeUpdate").mockImplementation((listener) => {
    listeners.add(listener as never);
    return () => listeners.delete(listener as never);
  });
  vi.spyOn(desktop, "syncExplorerTree").mockImplementation(async (studioId) => {
    for (const listener of listeners) {
      listener({
        studioId,
        parentId: null,
        placeName: "My Place",
        children: [
          {
            name: "Workspace",
            className: "Workspace",
            path: "game.Workspace",
            hasChildren: false,
            properties: [],
            attributes: [],
            children: [],
          },
        ],
      });
    }
    return { changed: true, watching: false, complete: true, truncated: false, slowestReadMs: 0 };
  });
  return () => titlebar.remove();
}

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({ data: null }),
      create: vi.fn().mockResolvedValue({ data: null }),
      delete: vi.fn().mockResolvedValue({ data: true }),
      update: vi.fn().mockResolvedValue({ data: null }),
      abort: vi.fn().mockResolvedValue({ data: true }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      status: vi.fn().mockResolvedValue({ data: {} }),
      context: vi.fn().mockResolvedValue({
        data: { measurement: null, hasCompacted: false, canCompact: false },
      }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue({}),
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
                "claude-3.5-sonnet": {
                  id: "claude-3.5-sonnet",
                  name: "Claude 3.5 Sonnet",
                },
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
    question: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      reply: vi.fn().mockResolvedValue({}),
      reject: vi.fn().mockResolvedValue({}),
    },
    permission: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      reply: vi.fn().mockResolvedValue({}),
    },
    event: { subscribe: vi.fn().mockResolvedValue({ stream: null }) },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    mcp: {
      status: vi.fn().mockResolvedValue({
        data: { "roblox-studio": { status: "connected" } },
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });
}

/** Seed the query cache with the minimum state the app needs to be "ready" */
function seedReadyState(
  queryClient: QueryClient,
  opts: {
    sessions?: Session[];
  } = {},
) {
  const sessions = opts.sessions ?? [];

  queryClient.setQueryData(qk.sessions, sessions);
  queryClient.setQueryData(qk.statuses, {});
  queryClient.setQueryData(qk.providers, {
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        env: [],
        models: {
          "claude-3.5-sonnet": {
            id: "claude-3.5-sonnet",
            name: "Claude 3.5 Sonnet",
            limit: { context: 100_000, output: 10_000 },
          },
        },
      },
    ],
    connected: ["anthropic"],
    default: { anthropic: "claude-3.5-sonnet" },
  });
  queryClient.setQueryData(qk.config, {
    lastModel: "anthropic/claude-3.5-sonnet",
    hiddenModels: [],
    theme: "system",
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  toast.dismiss();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("User journeys", () => {
  // Settings loads on first open, and on a slow machine that outlasts findBy's wait.
  beforeAll(() => import("@/components/Settings"), 60_000);

  it("shows the fork privacy policy without an analytics switch", async () => {
    const queryClient = createQueryClient();
    seedReadyState(queryClient);
    render(<TestApp client={createClient()} queryClient={queryClient} />);

    fireEvent.click(await screen.findByText("Settings"));
    fireEvent.click(await screen.findByRole("button", { name: "Privacy" }));
    expect(screen.getByText(/This fork does not send app analytics/)).toBeVisible();
    expect(screen.queryByRole("switch", { name: "Share AI usage data" })).not.toBeInTheDocument();
  });

  it("links to Paralov, Studs.gg and the legal pages from About", async () => {
    const queryClient = createQueryClient();
    seedReadyState(queryClient);

    render(<TestApp client={createClient()} queryClient={queryClient} />);

    fireEvent.click(await screen.findByText("Settings"));
    fireEvent.click(await screen.findByRole("button", { name: "About" }));
    for (const [name, url] of [
      ["Website", "https://bloxbot.ai/"],
      ["Paralov", "https://paralov.com/"],
      ["Studs.gg", "https://studs.gg/"],
      ["Privacy Policy", "https://bloxbot.ai/privacy"],
      ["Terms of Service", "https://bloxbot.ai/terms"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", url);
    }
  });

  it("lets someone skip Studio setup, and doesn't ask again", async () => {
    const client = createClient();
    client.mcp.status = vi
      .fn()
      .mockResolvedValue({ data: { "roblox-studio": { status: "failed" } } });
    client.mcp.connect = vi.fn().mockResolvedValue({});
    const queryClient = createQueryClient();
    seedReadyState(queryClient);

    try {
      const { unmount } = render(<TestApp client={client} queryClient={queryClient} />);
      fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));

      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "Let's connect Studio" })).toBeNull(),
      );
      await expect(desktop.loadConfig()).resolves.toMatchObject({ studioSetupSkipped: true });
      // Nobody has a chat yet, and they've just said they're ready to start.
      expect(client.session.create).toHaveBeenCalledTimes(1);
      unmount();

      render(<TestApp client={client} queryClient={queryClient} />);
      expect(await screen.findByText("What would you like to build?")).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Let's connect Studio" })).toBeNull();
    } finally {
      await desktop.patchConfig({ studioSetupSkipped: false });
    }
  });

  it("leaves setup when someone picks a chat from the sidebar", async () => {
    const session = makeSession("s1", "Older chat");
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    });
    client.mcp.status = vi
      .fn()
      .mockResolvedValue({ data: { "roblox-studio": { status: "failed" } } });
    client.mcp.connect = vi.fn().mockResolvedValue({});
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    render(<TestApp client={client} queryClient={queryClient} />);
    expect(await screen.findByRole("heading", { name: "Let's connect Studio" })).toBeVisible();

    fireEvent.click(screen.getByText("Older chat"));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Let's connect Studio" })).toBeNull(),
    );
    expect(await screen.findByRole("textbox", { name: "Message" })).toBeVisible();
  });

  it("finishes first-run setup when a Studio appears, with no chat open", async () => {
    const discover = vi
      .spyOn(desktop, "discoverStudioTargets")
      .mockResolvedValue({ targets: [], selectedKey: null } as never);
    const client = createClient();
    const studioStatus = vi
      .fn()
      .mockResolvedValue({ data: { "roblox-studio": { status: "failed" } } });
    client.mcp.status = studioStatus;
    client.mcp.connect = vi.fn().mockResolvedValue({});
    const queryClient = createQueryClient();
    seedReadyState(queryClient);

    try {
      render(<TestApp client={client} queryClient={queryClient} withStudioTargets />);
      expect(await screen.findByRole("heading", { name: "Let's connect Studio" })).toBeVisible();

      studioStatus.mockResolvedValue({ data: { "roblox-studio": { status: "connected" } } });
      discover.mockResolvedValue({
        targets: [{ key: "studio-1", label: "My Place", detail: "Local place" }],
        selectedKey: null,
      } as never);
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));

      expect(
        await screen.findByRole("heading", { name: "Studio connected" }, { timeout: 4_000 }),
      ).toBeVisible();
    } finally {
      discover.mockRestore();
    }
  });

  it("guides the user until Roblox Studio connects", async () => {
    const client = createClient();
    const studioStatus = vi
      .fn()
      .mockResolvedValue({ data: { "roblox-studio": { status: "failed" } } });
    client.mcp.status = studioStatus;
    client.mcp.connect = vi.fn().mockResolvedValue({});
    const queryClient = createQueryClient();
    seedReadyState(queryClient);

    render(<TestApp client={client} queryClient={queryClient} />);

    expect(await screen.findByRole("heading", { name: "Let's connect Studio" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    studioStatus.mockResolvedValue({
      data: { "roblox-studio": { status: "connected" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(await screen.findByRole("heading", { name: "Studio connected" })).toBeVisible();
  });

  it("walks through setup from the picker until a Studio appears, with a way back", async () => {
    const discover = vi
      .spyOn(desktop, "discoverStudioTargets")
      .mockResolvedValue({ targets: [], selectedKey: null } as never);
    const session = makeSession("s1", "My Session");
    const never = new Promise<never>(() => {});
    const client = createClient({
      get: vi.fn().mockReturnValue(never),
      messages: vi.fn().mockReturnValue(never),
      todo: vi.fn().mockReturnValue(never),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    try {
      render(<TestApp client={client} queryClient={queryClient} withStudioTargets />);
      const openSetup = async () => {
        fireEvent.click(await screen.findByRole("button", { name: /No Studio/ }));
        // The picker and the notice over the message box both offer it.
        fireEvent.click(screen.getAllByRole("button", { name: "Show me how" })[0] as HTMLElement);
      };

      fireEvent.click(await screen.findByText("My Session"));
      await openSetup();

      // The helper is connected, but with no Studio listed setup isn't done.
      expect(await screen.findByRole("heading", { name: "Let's connect Studio" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Studio connected" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
      await openSetup();
      expect(await screen.findByRole("heading", { name: "Let's connect Studio" })).toBeVisible();

      discover.mockResolvedValue({
        targets: [{ key: "studio-1", label: "My Place", detail: "Local place" }],
        selectedKey: "studio-1",
      } as never);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));

      expect(await screen.findByRole("heading", { name: "Studio connected" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Let's build" }));
      expect(await screen.findByRole("button", { name: /My Place/ })).toBeVisible();
    } finally {
      discover.mockRestore();
    }
  });

  it("leaves focus in the picker when setup hands over to it, after an earlier setup was left", async () => {
    const discover = vi
      .spyOn(desktop, "discoverStudioTargets")
      .mockResolvedValue({ targets: [], selectedKey: null } as never);
    const session = makeSession("s1", "My Session");
    const never = new Promise<never>(() => {});
    const client = createClient({
      get: vi.fn().mockReturnValue(never),
      messages: vi.fn().mockReturnValue(never),
      todo: vi.fn().mockReturnValue(never),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    try {
      render(<TestApp client={client} queryClient={queryClient} withStudioTargets />);
      const openSetup = async () => {
        fireEvent.click(await screen.findByRole("button", { name: /No Studio/ }));
        fireEvent.click(screen.getAllByRole("button", { name: "Show me how" })[0] as HTMLElement);
      };
      fireEvent.click(await screen.findByText("My Session"));
      await openSetup();
      // Leaving this one asks for the message box to have focus.
      fireEvent.click(await screen.findByRole("button", { name: "Back to chat" }));
      await openSetup();

      // Two Studios and no choice made, so the picker comes next.
      discover.mockResolvedValue({
        targets: [
          { key: "studio-1", label: "My Place", detail: "Local place" },
          { key: "studio-2", label: "Other Place", detail: "Local place" },
        ],
        selectedKey: null,
      } as never);
      fireEvent.click(await screen.findByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Check now" }));
      composerMounts.length = 0;
      fireEvent.click(await screen.findByRole("button", { name: "Choose a place" }));

      await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
      expect(composerMounts).toEqual([{ focusOnMount: false }]);
    } finally {
      discover.mockRestore();
    }
  });

  it("lands in the Explorer's search when it's asked for again on its way out", async () => {
    const closeStudio = openStudio();
    const session = makeSession("s1", "My Session");
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    try {
      render(<TestApp client={client} queryClient={queryClient} withStudioTargets />);
      fireEvent.click(await screen.findByText("My Session"));
      fireEvent.click(await screen.findByRole("button", { name: "Explorer" }));
      await screen.findByRole("searchbox", { name: "Search Explorer" });
      // Done with landing in it the first time.
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const playtest = screen.getByRole("button", { name: "Playtest" });
      playtest.focus();
      fireEvent.click(playtest);
      // Back before the Explorer has finished leaving.
      const explorer = screen.getByRole("button", { name: "Explorer" });
      explorer.focus();
      fireEvent.click(explorer);

      await waitFor(() =>
        expect(screen.getByRole("searchbox", { name: "Search Explorer" })).toHaveFocus(),
      );
    } finally {
      closeStudio();
    }
  });

  it("doesn't open the Explorer in the next chat for a link left waiting in the last one", async () => {
    const closeStudio = openStudio();
    const first = makeSession("s1", "First Session");
    const second = makeSession("s2", "Second Session");
    const client = createClient({
      get: vi
        .fn()
        .mockImplementation(({ path }: { path: { id: string } }) =>
          Promise.resolve({ data: path.id === "s1" ? first : second }),
        ),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [first, second] });

    try {
      render(
        <TestApp client={client} queryClient={queryClient} withStudioTargets>
          {/* Not in the tree yet, so the request waits. */}
          <ObjectLink path="game.Workspace.Door" />
        </TestApp>,
      );
      fireEvent.click(await screen.findByText("First Session"));
      expect(await screen.findByRole("button", { name: "Explorer" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      fireEvent.click(screen.getByRole("button", { name: "Show game.Workspace.Door" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Explorer" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
      );

      fireEvent.click(screen.getByText("Second Session"));
      expect(await screen.findByRole("heading", { name: "Second Session" })).toBeVisible();
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(await screen.findByRole("button", { name: "Explorer" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    } finally {
      closeStudio();
    }
  });

  it("switches to the latest session immediately without waiting for older requests", async () => {
    const first = makeSession("s1", "First Session");
    const second = makeSession("s2", "Second Session");
    const never = new Promise<never>(() => {});
    const client = createClient({
      get: vi.fn().mockReturnValue(never),
      messages: vi.fn().mockReturnValue(never),
      todo: vi.fn().mockReturnValue(never),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [first, second] });

    render(<TestApp client={client} queryClient={queryClient} />);

    const firstTitle = await screen.findByText("First Session");
    await act(async () => {
      fireEvent.click(firstTitle);
      fireEvent.click(screen.getByText("Second Session"));
    });

    expect(await screen.findByRole("heading", { name: "Second Session" })).toBeVisible();
    expect(client.session.get).not.toHaveBeenCalled();
  });

  it("sends a message and shows the assistant response via SSE", async () => {
    const session = makeSession("s1", "My Session");
    const client = createClient({
      create: vi.fn().mockResolvedValue({ data: session }),
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue({}),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    // Pre-populate the active session state
    queryClient.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: [],
      messagesById: {},
    });
    queryClient.setQueryData(qk.todos("s1"), []);
    queryClient.setQueryData(qk.questions("s1"), null);
    queryClient.setQueryData(qk.permissions("s1"), null);

    render(<TestApp client={client} queryClient={queryClient} />);

    // Click the session in the sidebar to select it
    const sessionTitle = await screen.findByText("My Session");
    await act(async () => {
      fireEvent.click(sessionTitle);
    });

    // Wait for the chat input to appear
    const textarea = await screen.findByRole("textbox", { name: "Message" });

    // Type and send a message
    await act(async () => {
      fireEvent.input(textarea, { target: { textContent: "Build me a Roblox game" } });
    });
    const sendBtn = screen.getByTitle("Send");
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(client.session.promptAsync).toHaveBeenCalled();
    const callArgs = client.session.promptAsync.mock.calls[0][0];
    expect(callArgs.parts[0].text).toBe("Build me a Roblox game");

    // Simulate SSE: assistant message comes in
    const activeRef = { current: "s1" };
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.updated",
          properties: {
            info: {
              id: "msg_1",
              sessionID: "s1",
              role: "assistant",
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as never,
        activeRef,
      );
    });

    // Simulate SSE: text part streams in
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part_1",
              messageID: "msg_1",
              sessionID: "s1",
              type: "text",
              text: "I'll create a Roblox obby for you!",
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as never,
        activeRef,
      );
    });

    // The assistant's response should appear on screen
    await waitFor(() => {
      expect(screen.getByText(/I'll create a Roblox obby for you!/)).toBeInTheDocument();
    });
  });

  it("shows permission prompt and user can approve it", async () => {
    const session = makeSession("s1", "My Session");
    const permRequest = {
      id: "perm_1",
      sessionID: "s1",
      permission: "bash",
      patterns: ["rm -rf /tmp/test"],
    };
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({
        data: [
          {
            info: {
              id: "msg_1",
              sessionID: "s1",
              role: "assistant",
              time: { created: Date.now(), updated: Date.now() },
            },
            parts: [],
          },
        ],
      }),
    });
    // Make permission.list return our permission so selectSession picks it up
    client.permission.list = vi.fn().mockResolvedValue({ data: [permRequest] });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    render(<TestApp client={client} queryClient={queryClient} />);

    // Select the session — this triggers selectSession which fetches permissions from SDK
    const sessionTitle = await screen.findByText("My Session");
    await act(async () => {
      fireEvent.click(sessionTitle);
    });

    // The permission prompt should appear (populated by selectSession from SDK response)
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "BloxBot needs your permission" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Run this command?")).toBeInTheDocument();
    });

    // Click "Allow Once"
    const allowBtn = screen.getByText("Allow once");
    await act(async () => {
      fireEvent.click(allowBtn);
    });

    expect(client.permission.reply).toHaveBeenCalledWith(
      {
        requestID: "perm_1",
        sessionID: "s1",
        reply: "once",
      },
      { throwOnError: true },
    );
  });

  it("shows question prompt and user can answer it", async () => {
    const session = makeSession("s1", "My Session");
    const questionReq = {
      id: "q1",
      sessionID: "s1",
      questions: [
        {
          header: "File Conflict",
          question: "The file already exists. What should I do?",
          options: [
            { label: "Overwrite", description: "Replace the file" },
            { label: "Skip", description: "Leave it" },
          ],
          multiple: false,
          custom: true,
        },
      ],
    };
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({
        data: [
          {
            info: {
              id: "msg_1",
              sessionID: "s1",
              role: "assistant",
              time: { created: Date.now(), updated: Date.now() },
            },
            parts: [],
          },
        ],
      }),
    });
    // Make question.list return our question so selectSession picks it up
    client.question.list = vi.fn().mockResolvedValue({ data: [questionReq] });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    render(<TestApp client={client} queryClient={queryClient} />);

    // Select session — selectSession fetches questions from SDK
    await act(async () => {
      fireEvent.click(await screen.findByText("My Session"));
    });

    // Question prompt should appear (populated by selectSession from SDK response)
    await waitFor(() => {
      expect(screen.getByText("File Conflict")).toBeInTheDocument();
      expect(screen.getByText("The file already exists. What should I do?")).toBeInTheDocument();
    });

    // Click "Overwrite" option
    await act(async () => {
      fireEvent.click(screen.getByText("Overwrite"));
    });

    // Submit the answer
    await act(async () => {
      fireEvent.click(screen.getByText("Submit"));
    });

    expect(client.question.reply).toHaveBeenCalledWith(
      {
        requestID: "q1",
        sessionID: "s1",
        answers: [["Overwrite"]],
      },
      { throwOnError: true },
    );
  });

  it("streams tool use (bash command) and shows it in the UI", async () => {
    const session = makeSession("s1", "My Session");
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    queryClient.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: [],
      messagesById: {},
    });
    queryClient.setQueryData(qk.todos("s1"), []);
    queryClient.setQueryData(qk.questions("s1"), null);
    queryClient.setQueryData(qk.permissions("s1"), null);

    render(<TestApp client={client} queryClient={queryClient} />);

    // Select session
    await act(async () => {
      fireEvent.click(await screen.findByText("My Session"));
    });
    await screen.findByRole("textbox", { name: "Message" });

    const activeRef = { current: "s1" };

    // SSE: assistant message
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.updated",
          properties: {
            info: {
              id: "msg_a",
              sessionID: "s1",
              role: "assistant",
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as never,
        activeRef,
      );
    });

    // SSE: tool part — bash command running
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "tool_1",
              messageID: "msg_a",
              sessionID: "s1",
              type: "tool",
              tool: "bash",
              state: {
                status: "running",
                input: { command: "ls -la src/", description: "List source files" },
              },
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as never,
        activeRef,
      );
    });

    // The bash command should be visible
    await waitFor(() => {
      expect(screen.getByText("List source files")).toBeInTheDocument();
      expect(screen.getByText("Running")).toBeInTheDocument();
    });

    // SSE: tool completes with output
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.part.updated",
          properties: {
            part: {
              id: "tool_1",
              messageID: "msg_a",
              sessionID: "s1",
              type: "tool",
              tool: "bash",
              state: {
                status: "completed",
                input: { command: "ls -la src/", description: "List source files" },
                output: "total 48\ndrwxr-xr-x  12 user  staff  384 Mar 21 10:00 .",
              },
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as never,
        activeRef,
      );
    });

    // Running indicator should be gone, output should be available
    await waitFor(() => {
      expect(screen.queryByText("Running")).not.toBeInTheDocument();
    });
  });

  it("shows a collapsed capture gallery across tool steps and embeds only the referenced capture", async () => {
    const session = makeSession("captures", "Capture gallery");
    const sessionID = session.id;
    const created = Date.UTC(2026, 10, 12, 8, 5);
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=";
    const assistant = (id: string, offset: number) => ({
      id,
      sessionID,
      role: "assistant",
      parentID: "user",
      cost: 0.0003,
      tokens: { output: 30, reasoning: 10 },
      time: { created: created + offset, completed: created + offset + 2000 },
    });
    const captures = ["first", "second", "third", "fourth"].map((capture_id, index) => {
      const id = `step-${index}`;
      const input = { capture_id };
      return {
        info: assistant(id, (index + 1) * 2000),
        parts: [
          {
            type: "tool",
            id: `call-${index}`,
            sessionID,
            messageID: id,
            tool: "execute",
            state: {
              status: "completed",
              input: { code: 'return await tools["roblox-studio"].screen_capture({});' },
              output: "Capture complete",
              metadata: { toolCalls: [{ tool: "roblox-studio.screen_capture", input }] },
              time: { end: created + (index + 2) * 2000 },
              attachments: [{ id: `image-${index}`, type: "file", mime: "image/png", url }],
            },
          },
        ],
      };
    });
    const client = createClient({
      messages: vi.fn().mockResolvedValue({
        data: [
          {
            info: { id: "user", sessionID, role: "user", time: { created } },
            parts: [{ id: "request", type: "text", text: "Capture the scene" }],
          },
          ...captures,
          {
            info: assistant("reply", 10000),
            parts: [
              {
                id: "reply-text",
                type: "text",
                text: "![Selected view](capture:third)\n\n![Missing view](capture:missing)",
              },
            ],
          },
        ],
      }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    const { container } = render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText("Capture gallery"));

    const disclosure = await screen.findByRole("button", { name: "Used Roblox Studio 4 times" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("+1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /image 2 of 4/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("2 / 4")).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Next image" }));
    expect(dialog.getByText("3 / 4")).toBeVisible();
    fireEvent.keyDown(dialog.getByRole("button", { name: "Previous image" }), { key: "ArrowLeft" });
    expect(dialog.getByText("2 / 4")).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Previous image" }));
    expect(dialog.getByText("1 / 4")).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Close image" }));
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("img", { name: "Selected view" })).toHaveAttribute("src", url);
    expect(screen.queryByRole("img", { name: "Missing view" })).toBeNull();
    expect(screen.getByText("20 tok/s")).toBeInTheDocument();
    expect(screen.getByTitle("Reported cost in US dollars")).toBeInTheDocument();
    expect([...container.querySelectorAll("time")].map((time) => time.dateTime)).toEqual([
      new Date(created).toISOString(),
      new Date(created + 12000).toISOString(),
    ]);
    fireEvent.contextMenu(screen.getByRole("img", { name: "Selected view" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add to Chat" }));
    expect(client.session.promptAsync).not.toHaveBeenCalled();
    expect(await screen.findByTitle("Remove")).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByTitle("Send"));
    });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID,
        parts: expect.arrayContaining([
          expect.objectContaining({ type: "file", mime: "image/png", url }),
        ]),
      }),
      { throwOnError: true },
    );
  });

  it("says what the model is doing in place of Thinking when it shares titled reasoning", async () => {
    const session = makeSession("thinking", "Thinking summary");
    const sessionID = session.id;
    const reasoning = (id: string, text: string, done: boolean) => ({
      id,
      sessionID,
      messageID: "work",
      type: "reasoning",
      text,
      time: { start: 1, ...(done && { end: 2 }) },
    });
    const turn = (...parts: object[]) => ({
      data: [
        {
          info: { id: "user", sessionID, role: "user", time: { created: 1 } },
          parts: [{ id: "request", type: "text", text: "Fix the door" }],
        },
        {
          info: {
            id: "work",
            sessionID,
            role: "assistant",
            parentID: "user",
            time: { created: 2 },
          },
          parts,
        },
      ],
    });
    const messages = vi
      .fn()
      .mockResolvedValue(
        turn(reasoning("r1", "**Reading the door script**\n\nIt has a debounce.", false)),
      );
    const client = createClient({ messages });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    queryClient.setQueryData(qk.statuses, { [sessionID]: { type: "busy" } });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText("Thinking summary"));
    expect(await screen.findByRole("button", { name: "Reading the door script" })).toBeVisible();

    // Several steps collapse into one line, which carries the newest step's title.
    messages.mockResolvedValue(
      turn(
        reasoning("r1", "**Reading the door script**\n\nIt has a debounce.", true),
        {
          id: "t1",
          sessionID,
          messageID: "work",
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "Door.luau" }, output: "" },
        },
        reasoning("r2", "**Fixing the debounce**\n\nThe flag never", false),
      ),
    );
    await act(() => queryClient.refetchQueries({ queryKey: qk.messages(sessionID) }));
    // It also keeps count of how long the work has been going.
    expect(
      await screen.findByRole("button", { name: /^Working for .+Fixing the debounce$/ }),
    ).toBeVisible();
    expect(screen.queryByText("Thinking")).toBeNull();

    // A thought whose end was never recorded doesn't keep the clock running. Once the chat stops
    // working the steps read as finished, and so does that thought.
    act(() => {
      queryClient.setQueryData(qk.statuses, { [sessionID]: { type: "idle" } });
    });
    const finished = await screen.findByRole("button", { name: "Worked for 1s" });
    expect(screen.queryByRole("button", { name: /^Working/ })).toBeNull();
    fireEvent.click(finished);
    expect(screen.getAllByRole("button", { name: "Thought" })).toHaveLength(2);
  });

  it("rewinds to a sent message, putting its text back in the composer and files back as they were", async () => {
    const session = makeSession("rewind", "Rewind chat");
    const sessionID = session.id;
    const created = Date.now() - 11 * 60 * 60 * 1000 - 60_000;
    const undo = vi.fn().mockResolvedValue({ data: { files: 2 } });
    const client = createClient({
      undo,
      messages: vi.fn().mockResolvedValue({
        data: [
          {
            info: { id: "user", sessionID, role: "user", time: { created } },
            parts: [{ id: "request", type: "text", text: "Make the wall thicker" }],
          },
          {
            info: {
              id: "reply",
              sessionID,
              role: "assistant",
              parentID: "user",
              time: { created: created + 1000, completed: created + 5000 },
            },
            parts: [{ id: "answer", type: "text", text: "The wall is 8 studs thick now." }],
          },
        ],
      }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText("Rewind chat"));

    // Under the message: that the model got it, how long ago, then Copy, Edit and Rewind.
    expect(await screen.findByRole("img", { name: "Model received this message" })).toBeVisible();
    expect(screen.getAllByText("11 hours ago")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Copy message" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Edit message" })).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rewind to this message" }));
    });
    expect(undo).toHaveBeenCalledExactlyOnceWith(
      { sessionID, messageID: "user", files: true },
      { throwOnError: true },
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Message" })).toHaveTextContent(
        "Make the wall thicker",
      ),
    );
    expect(await screen.findByText("Rewound to before this message")).toBeVisible();
    expect(screen.getByText(/2 files were put back as they were\./)).toBeVisible();
    expect(client.session.promptAsync).not.toHaveBeenCalled();
  });

  it("shows a compaction as a step with its status, not as a message that was sent", async () => {
    const session = makeSession("compacted", "Compacted chat");
    const sessionID = session.id;
    const compaction = (status: string, error?: string) => ({
      info: { id: "compaction", sessionID, role: "user", time: { created: Date.now() } },
      parts: [
        {
          id: "compaction:compaction",
          sessionID,
          messageID: "compaction",
          type: "compaction",
          auto: false,
          status,
          error,
        },
      ],
    });
    const messages = vi.fn().mockResolvedValue({ data: [compaction("running")] });
    const client = createClient({ messages });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText("Compacted chat"));

    expect(await screen.findByText("Compacting context…")).toBeVisible();
    // Nothing of a sent message: no receipt, and nothing to copy, edit or rewind.
    expect(screen.queryByRole("img", { name: "Model received this message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rewind to this message" })).toBeNull();

    messages.mockResolvedValue({ data: [compaction("completed")] });
    await act(() => queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) }));
    expect(await screen.findByText("Context compacted")).toBeVisible();

    messages.mockResolvedValue({ data: [compaction("failed", "No model is connected")] });
    await act(() => queryClient.invalidateQueries({ queryKey: qk.messages(sessionID) }));
    expect(
      await screen.findByText("Couldn't compact context: No model is connected"),
    ).toBeVisible();
  });

  it("offers standard speed when fast mode's own rate limit keeps a turn retrying", async () => {
    const session = makeSession("fast", "Fast limit");
    const sessionID = session.id;
    const id = "claude-opus";
    const message =
      "This request would exceed your rate limit of 200,000 fast mode input tokens per minute.";
    const abort = vi.fn().mockResolvedValue({ data: true });
    const client = createClient({
      abort,
      messages: vi.fn().mockResolvedValue({
        data: [
          {
            info: { id: "user", sessionID, role: "user", time: { created: Date.now() } },
            parts: [{ id: "request", type: "text", text: "Refactor the shop" }],
          },
        ],
      }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    const provider = {
      id: "anthropic",
      name: "Anthropic",
      env: [],
      models: {
        [id]: { id, name: "Claude Opus", variants: { high: {} } },
        [`${id}-fast`]: { id: `${id}-fast`, name: "Claude Opus Fast", variants: { high: {} } },
      },
    };
    queryClient.setQueryData(qk.providers, {
      all: [provider],
      connected: ["anthropic"],
      default: { anthropic: id },
    });
    queryClient.setQueryData(qk.config, {
      lastModel: `anthropic/${id}-fast`,
      hiddenModels: [],
      theme: "system",
    });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText("Fast limit"));
    await screen.findByText("Refactor the shop");

    // Any other reason to retry is only reported, as before.
    act(() => {
      queryClient.setQueryData(qk.statuses, {
        [sessionID]: { type: "retry", attempt: 1, message: "Overloaded", next: Date.now() + 5000 },
      });
    });
    expect(await screen.findByText("Waiting to retry")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => {
      queryClient.setQueryData(qk.statuses, {
        [sessionID]: { type: "retry", attempt: 3, message, next: Date.now() + 5000 },
      });
    });
    const notice = within(await screen.findByRole("alert"));
    expect(notice.getByText("Fast mode's rate limit is in the way")).toBeVisible();
    await act(async () => {
      fireEvent.click(
        notice.getByRole("button", { name: "Continue with Claude Opus at standard speed" }),
      );
    });
    // The stuck turn is stopped first, then the same chat goes on with the standard model.
    expect(abort).toHaveBeenCalledExactlyOnceWith(
      { sessionID, wait: true },
      { throwOnError: true },
    );
    await waitFor(() => expect(client.session.promptAsync).toHaveBeenCalledOnce());
    expect(abort.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.promptAsync.mock.invocationCallOrder[0],
    );
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID,
        parts: [{ type: "text", text: "Continue from where you stopped." }],
        model: { providerID: "anthropic", modelID: id },
      }),
      { throwOnError: true },
    );
  });

  it("puts edits to one file on a single line with their line counts, and shows a sent video as one attachment", async () => {
    const session = makeSession("edits", "Edit batch");
    const sessionID = session.id;
    const created = Date.UTC(2026, 10, 14, 9, 0);
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=";
    const edit = (id: string, file: string, oldString: string, newString: string) => ({
      type: "tool",
      id,
      sessionID,
      messageID: "work",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: `C:/game/src/${file}`, oldString, newString },
        output: "",
        time: { start: created + 1000, end: created + 33_000 },
      },
    });
    const undo = vi.fn().mockResolvedValue({});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const client = createClient({
      undo,
      messages: vi.fn().mockResolvedValue({
        data: [
          {
            info: { id: "user", sessionID, role: "user", time: { created } },
            parts: [
              {
                id: "request",
                type: "text",
                text: 'Fix the door\n\n[Video "clip.mp4" (0:08): attached images 1–2 are still frames from it, taken at 2.0s, 6.0s. Its audio is not included.]',
              },
              { id: "frame-1", type: "file", mime: "image/jpeg", url, filename: "frame 1.jpg" },
              { id: "frame-2", type: "file", mime: "image/jpeg", url, filename: "frame 2.jpg" },
              { id: "notes", type: "file", mime: "image/png", url, filename: "notes.png" },
            ],
          },
          {
            info: {
              id: "work",
              sessionID,
              role: "assistant",
              parentID: "user",
              time: { created: created + 500, completed: created + 2000 },
            },
            parts: [
              // The second line is the same before and after, so only one line changed.
              edit(
                "e1",
                "Door.luau",
                "local open = false\nprint(open)",
                "local open = true\nprint(open)",
              ),
              edit("e2", "Door.luau", "print(open)", "print(open)\nreturn open"),
              edit("e3", "Key.luau", "local key = 1", "local key = 2"),
              { id: "summary", type: "text", text: "The door **opens** now." },
            ],
          },
        ],
      }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText("Edit batch"));

    // Finished work is summed up by how long it took.
    fireEvent.click(await screen.findByRole("button", { name: "Worked for 32s" }));
    const door = screen.getByRole("button", { name: /Edited.*Door\.luau.*\+2.*−1/ });
    expect(screen.getByRole("button", { name: /Edited.*Key\.luau.*\+1.*−1/ })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Edited/ })).toHaveLength(2);
    expect(within(door).getByTitle("2 lines added")).toHaveTextContent("+2");
    expect(within(door).getByTitle("1 line removed")).toHaveTextContent("−1");

    // The finished turn closes with every file it edited, each opening to its changed lines.
    const card = within(screen.getByRole("region", { name: "Files edited in this turn" }));
    expect(card.getByText("Edited 2 files")).toBeVisible();
    expect(card.getByTitle("3 lines added")).toHaveTextContent("+3");
    expect(card.getByTitle("2 lines removed")).toHaveTextContent("−2");
    const doorRow = card.getByRole("button", { name: /Door\.luau.*\+2.*−1/ });
    expect(doorRow).toHaveAttribute("title", "C:/game/src/Door.luau");
    expect(doorRow).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("local open = true")).toBeNull();
    fireEvent.click(doorRow);
    expect(doorRow).toHaveAttribute("aria-expanded", "true");
    expect(card.getByText("local open = true")).toBeVisible();
    expect(card.getByText("return open")).toBeVisible();
    expect(card.queryByText("local key = 2")).toBeNull();
    fireEvent.click(card.getByRole("button", { name: "View changes" }));
    expect(card.getByText("local key = 2")).toBeVisible();
    fireEvent.click(card.getByRole("button", { name: "Hide changes" }));
    expect(card.queryByText("local open = true")).toBeNull();

    // The note that told the model which images are frames stays out of the bubble.
    expect(screen.queryByText(/still frames from it/)).toBeNull();
    expect(screen.getAllByText("Fix the door").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open notes.png" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open frame 1.jpg" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open clip.mp4, 2 frames" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("1 / 2")).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Close image" }));

    // Both messages copy as they read, and the sent one can be taken back to the composer.
    const [copyUser, copyReply] = screen.getAllByRole("button", { name: "Copy message" });
    await act(async () => fireEvent.click(copyUser));
    expect(writeText).toHaveBeenLastCalledWith("Fix the door");
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
    await act(async () => fireEvent.click(copyReply));
    expect(writeText).toHaveBeenLastCalledWith("The door **opens** now.");
    // Editing happens in the bubble. Until it is sent nothing is rewound, and Escape drops it.
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    const field = () => screen.getByRole("textbox", { name: "Edit message" });
    expect(field()).toHaveValue("Fix the door");
    expect(field()).toHaveFocus();
    fireEvent.change(field(), { target: { value: "Never mind" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Edit message" })).toBeNull();
    expect(undo).not.toHaveBeenCalled();
    expect(screen.getAllByText("Fix the door").length).toBeGreaterThan(0);
    expect(screen.getByText(/The door/)).toBeVisible();

    // Sent, it rewinds to before the message and goes again with the same attachments.
    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(field(), { target: { value: "Fix the gate" } });
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" });
    });
    await waitFor(() => expect(client.session.promptAsync).toHaveBeenCalledOnce());
    expect(undo).toHaveBeenCalledExactlyOnceWith(
      { sessionID, messageID: "user" },
      { throwOnError: true },
    );
    expect(undo.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.promptAsync.mock.invocationCallOrder[0],
    );
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID,
        parts: [
          {
            type: "text",
            text: 'Fix the gate\n\n[Video "clip.mp4" (0:08): attached images 1–2 are still frames from it, taken at 2.0s, 6.0s. Its audio is not included.]',
          },
          { type: "file", mime: "image/jpeg", url, filename: "frame 1.jpg" },
          { type: "file", mime: "image/jpeg", url, filename: "frame 2.jpg" },
          { type: "file", mime: "image/png", url, filename: "notes.png" },
        ],
      }),
      { throwOnError: true },
    );
  }, 20_000);

  it("keeps Explorer mounted to the right of Context and lets either panel close independently", async () => {
    const closeStudio = openStudio();
    const chat = makeSession("context-explorer", "Inspect a place");
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: chat }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [chat] });

    try {
      render(
        <TestApp client={client} queryClient={queryClient} withStudioTargets>
          <div id="titlebar-actions" />
        </TestApp>,
      );
      fireEvent.click(await screen.findByText(chat.title));
      const explorerToggle = await screen.findByRole("button", { name: "Explorer" });
      fireEvent.click(explorerToggle);
      const search = await screen.findByRole("searchbox", { name: "Search Explorer" });
      await waitFor(() => expect(search).toHaveFocus());

      expect(screen.queryByRole("button", { name: /Context and usage/ })).toBeNull();
      const radial = screen.getByRole("button", { name: "Context" });
      fireEvent.click(radial);
      const panel = await screen.findByRole("complementary", { name: "Context window" });
      expect(explorerToggle).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("searchbox", { name: "Search Explorer" })).toBe(search);
      expect(radial.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(panel.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(explorerToggle);
      expect(explorerToggle).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByRole("searchbox", { name: "Search Explorer" })).toBeNull();
      expect(screen.getByRole("complementary", { name: "Context window" })).toBe(panel);

      fireEvent.click(explorerToggle);
      const reopenedSearch = await screen.findByRole("searchbox", { name: "Search Explorer" });
      expect(screen.getByRole("complementary", { name: "Context window" })).toBe(panel);
      fireEvent.click(within(panel).getByRole("button", { name: "Close Context" }));
      expect(radial).toHaveFocus();
      expect(screen.queryByRole("complementary", { name: "Context window" })).toBeNull();
      expect(screen.getByRole("searchbox", { name: "Search Explorer" })).toBe(reopenedSearch);
    } finally {
      closeStudio();
    }
  });

  it("shows measured Context, waits for an idle chat, and refreshes after compacting", async () => {
    const chat = makeSession("context-chat", "Inspect context");
    const context = vi.fn().mockResolvedValue({
      data: {
        measurement: {
          modelKey: "anthropic/claude-3.5-sonnet",
          tokens: { input: 18_000, cache: { read: 1_000, write: 0 }, output: 900, reasoning: 100 },
        },
        hasCompacted: false,
        canCompact: true,
      },
    });
    const compact = vi.fn(async () => {
      context.mockResolvedValue({
        data: { measurement: null, hasCompacted: true, canCompact: false },
      });
    });
    const client = createClient({ context, compact });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [chat] });
    queryClient.setQueryData(qk.statuses, { [chat.id]: { type: "busy" } });
    render(
      <TestApp client={client} queryClient={queryClient}>
        <div id="titlebar-actions" />
      </TestApp>,
    );
    fireEvent.click(await screen.findByText(chat.title));
    expect(screen.queryByRole("button", { name: /Context and usage/ })).toBeNull();
    const radial = await screen.findByRole("button", { name: "Context" });
    fireEvent.click(radial);
    let panel = within(await screen.findByRole("complementary", { name: "Context window" }));
    expect(panel.getByRole("heading", { name: "Context window" })).toHaveFocus();
    expect(panel.getByRole("meter", { name: "Context window used" })).toHaveValue(20);
    expect(panel.getByText("Cache read")).toBeVisible();
    expect(panel.getByText("Reasoning")).toBeVisible();

    // The same usage as a pie, and back to the bar.
    const region = screen.getByRole("complementary", { name: "Context window" });
    expect(region.querySelector('[data-context-chart="bar"]')).not.toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Show usage as a pie chart" }));
    await waitFor(() => expect(region.querySelector('[data-context-chart="pie"]')).not.toBeNull());
    expect(region.querySelector('[data-context-chart="bar"]')).toBeNull();
    // One slice for each kind of token. Free space is the grey that's left, with a row of its own.
    expect(
      region.querySelectorAll('[data-context-chart="pie"] circle[stroke-dasharray]'),
    ).toHaveLength(panel.getAllByRole("definition").length - 1);
    expect(panel.getByText("Free space").closest("div")).toHaveTextContent("80,00080.0%");
    expect(panel.getByRole("meter", { name: "Context window used" })).toHaveValue(20);
    fireEvent.click(panel.getByRole("button", { name: "Show usage as a meter bar" }));
    await waitFor(() => expect(region.querySelector('[data-context-chart="bar"]')).not.toBeNull());

    // A window too narrow to fit it beside the chat closes it, and a wider one brings it back.
    const resizeTo = (width: number) =>
      act(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
      });
    const wide = window.innerWidth;
    resizeTo(700);
    expect(screen.queryByRole("complementary", { name: "Context window" })).toBeNull();
    resizeTo(wide);
    panel = within(screen.getByRole("complementary", { name: "Context window" }));
    expect(panel.getByRole("meter", { name: "Context window used" })).toHaveValue(20);

    const button = panel.getByRole("button", { name: "Compact session" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(compact).not.toHaveBeenCalled();

    act(() => queryClient.setQueryData(qk.statuses, { [chat.id]: { type: "idle" } }));
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(button);
    expect(await panel.findByText("Context compacted.")).toBeVisible();
    expect(compact).toHaveBeenCalledWith(
      {
        sessionID: chat.id,
        waitForCompletion: true,
        model: { providerID: "anthropic", modelID: "claude-3.5-sonnet" },
      },
      { throwOnError: true },
    );
    expect(
      panel.getByText(/Context usage will update after the next measured reply/),
    ).toBeVisible();
    expect(panel.queryByRole("meter")).not.toBeInTheDocument();
    fireEvent.keyDown(panel.getByRole("heading", { name: "Context window" }), { key: "Escape" });
    expect(radial).toHaveFocus();
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Context window" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Context" }));
    expect(await screen.findByRole("complementary", { name: "Context window" })).toBeVisible();
  });

  it("shows radial meters only for the selected ChatGPT-plan model across chats", async () => {
    const codexChat = makeSession("codex-context", "Codex chat");
    const newChat = makeSession("new-context", "Unsent chat");
    const client = createClient({
      messages: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
        data:
          sessionID === codexChat.id
            ? [
                {
                  info: {
                    id: "codex-reply",
                    sessionID,
                    role: "assistant",
                    providerID: "openai",
                    modelID: "gpt-6.1-sol",
                    time: { created: 1, completed: 2 },
                    tokens: { input: 10, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
                  },
                  parts: [],
                },
              ]
            : [],
      })),
    });
    const readUsage = vi.spyOn(desktop, "getSubscriptionUsage").mockResolvedValue({
      status: "available",
      checkedAt: Date.now(),
      windows: [
        { id: "codex/primary", label: "5-hour window", usedPercent: 15, resetsAt: null },
        { id: "codex/secondary", label: "Weekly", usedPercent: 35, resetsAt: null },
      ],
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [codexChat, newChat] });
    queryClient.setQueryData(qk.config, {
      lastModel: "anthropic/claude-3.5-sonnet",
      hiddenModels: [],
      theme: "system",
      chatModels: { [codexChat.id]: { key: "openai-oauth/gpt-6.1-sol", variant: null } },
    });
    queryClient.setQueryData<{ all: unknown[]; connected: string[] }>(
      qk.providers,
      (providers) =>
        providers && {
          ...providers,
          all: [
            ...providers.all,
            {
              id: "openai-oauth",
              name: "OpenAI",
              models: { "gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" } },
            },
            {
              id: "openai-api",
              name: "OpenAI API",
              models: { "gpt-6.1-sol": { id: "gpt-6.1-sol", name: "GPT API" } },
            },
          ],
          connected: [...providers.connected, "openai-oauth", "openai-api"],
        },
    );
    render(
      <TestApp client={client} queryClient={queryClient}>
        <div id="titlebar-actions" />
      </TestApp>,
    );

    fireEvent.click(await screen.findByText(codexChat.title));
    const quota = await screen.findByRole("button", {
      name: "ChatGPT subscription usage · Weekly · 65% left",
    });
    expect(readUsage).toHaveBeenCalledWith("codex");
    fireEvent.click(quota);
    const panel = within(await screen.findByRole("dialog", { name: "ChatGPT subscription usage" }));
    expect(panel.getByText("85% left")).toBeVisible();
    expect(panel.getByText("65% left")).toBeVisible();

    fireEvent.click(screen.getByText(newChat.title));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Context and usage/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /ChatGPT subscription usage/ })).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Claude 3\.5 Sonnet/ }));
    fireEvent.click(await screen.findByRole("button", { name: /GPT-6\.1 Sol/ }));
    expect(
      await screen.findByRole("button", { name: /ChatGPT subscription usage.*65% left/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Context and usage" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /GPT-6\.1 Sol/ }));
    fireEvent.click(await screen.findByRole("button", { name: /GPT API/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Context and usage/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /ChatGPT subscription usage/ })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Context" })).toBeVisible();

    fireEvent.click(screen.getByText(codexChat.title));
    expect(await screen.findByRole("button", { name: /ChatGPT subscription usage/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Context and usage" })).toBeVisible();

    // A previous plan-model reply must not keep its meter visible after choosing API billing.
    fireEvent.click(screen.getByRole("button", { name: /GPT-6\.1 Sol/ }));
    fireEvent.click(await screen.findByRole("button", { name: /GPT API/ }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Context and usage/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /ChatGPT subscription usage/ })).toBeNull();
    });
  });

  it("wraps long user messages and shows saved Studio references as chips", async () => {
    const session = makeSession("reference-chat", "Studio references");
    const longText = "UnbrokenText".repeat(50);
    const path = "game.Workspace.AnimalDiscoSession";
    const text = `**Literal user text**\n${longText} <Instance reference="${path}">@AnimalDiscoSession</Instance> trailing text`;
    const message: MessageWithParts = {
      info: {
        id: "reference-message",
        sessionID: session.id,
        role: "user",
        time: { created: Date.now() },
        agent: "studio",
        model: { providerID: "anthropic", modelID: "claude-3.5-sonnet" },
      },
      parts: [
        {
          id: "reference-text",
          sessionID: session.id,
          messageID: "reference-message",
          type: "text",
          text,
        },
      ],
    };
    const client = createClient({ messages: vi.fn(async () => ({ data: [message] })) });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText(session.title));

    const transcript = within(await screen.findByRole("region", { name: "Chat transcript" }));
    const chip = await transcript.findByText("AnimalDiscoSession");
    expect(chip).toHaveAttribute("title", path);
    expect(chip.querySelector("img")).toHaveAttribute(
      "src",
      "bloxbot-icon://studio/light/Placeholder",
    );
    expect(transcript.queryByText(/<Instance/)).not.toBeInTheDocument();
    const textPart = chip.closest(".whitespace-pre-wrap");
    expect(textPart).toHaveClass("whitespace-pre-wrap");
    expect(textPart?.textContent).toBe(
      `**Literal user text**\n${longText} AnimalDiscoSession trailing text`,
    );
    expect(chip.closest("[data-user-message]")).toHaveClass("wrap-anywhere");
  });

  it("keeps queued messages above the composer and shows steer receipts in the transcript", async () => {
    const session = makeSession("inbox-chat", "Inbox chat");
    function inboxMessage(id: string, text: string, delivery: "queue" | "steer") {
      const info: UserMessage = {
        id,
        sessionID: session.id,
        role: "user",
        time: { created: Date.now() },
        agent: "studio",
        model: { providerID: "anthropic", modelID: "claude-3.5-sonnet" },
        inbox: { delivery, state: "pending" },
      };
      return {
        info,
        parts: [{ id: `${id}:text`, sessionID: session.id, messageID: id, type: "text", text }],
      } satisfies MessageWithParts;
    }
    const queued = inboxMessage("queue", "Run after the turn", "queue");
    const cancelled = inboxMessage("cancel", "Remove this from the queue", "queue");
    const promoted = inboxMessage("promote", "Promote me to a steer", "queue");
    const steer = inboxMessage("steer", "Change the current task", "steer");
    let history = [queued, cancelled, promoted, steer];
    const cancel = vi.fn(async () => {
      history = history.filter(({ info }) => info.id !== cancelled.info.id);
    });
    const update = vi.fn(async () => {
      history = history.map((message) =>
        message.info.id === promoted.info.id
          ? {
              ...message,
              info: { ...message.info, inbox: { delivery: "steer", state: "pending" } },
            }
          : message,
      );
    });
    const client = createClient({
      messages: vi.fn(async () => ({ data: history })),
      inbox: { cancel, update },
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });
    render(<TestApp client={client} queryClient={queryClient} />);
    fireEvent.click(await screen.findByText(session.title));

    const tray = within(await screen.findByRole("list", { name: "Queued messages" }));
    const transcript = within(await screen.findByRole("region", { name: "Chat transcript" }));
    expect(tray.getByText("Run after the turn")).toBeVisible();
    expect(transcript.queryByText("Run after the turn")).not.toBeInTheDocument();
    expect(transcript.getByText("Change the current task")).toBeVisible();
    expect(transcript.getByRole("img", { name: "Waiting for the next model step" })).toBeVisible();
    expect(transcript.queryByRole("img", { name: "Model received this steer" })).toBeNull();

    const queuedRow = (preview: string) => {
      const row = tray.getByText(preview).closest("li");
      if (!row) throw new Error("Queued message row is missing");
      return within(row);
    };
    fireEvent.click(
      queuedRow("Remove this from the queue").getByRole("button", {
        name: "Remove queued message",
      }),
    );
    await waitFor(() => expect(tray.queryByText("Remove this from the queue")).toBeNull());
    expect(cancel).toHaveBeenCalledWith(
      { sessionID: session.id, inboxID: cancelled.info.id },
      { throwOnError: true },
    );
    fireEvent.click(
      queuedRow("Promote me to a steer").getByRole("button", { name: "Steer queued message" }),
    );
    expect(await transcript.findByText("Promote me to a steer")).toBeVisible();
    expect(tray.queryByText("Promote me to a steer")).toBeNull();
    expect(update).toHaveBeenCalledWith(
      { sessionID: session.id, inboxID: promoted.info.id, delivery: "steer" },
      { throwOnError: true },
    );

    const active = { current: session.id };
    const deliver = (message: typeof queued, delivery: "steer" | "queue") =>
      sseDispatch(
        queryClient,
        {
          type: "message.updated",
          properties: {
            sessionID: session.id,
            info: { ...message.info, inbox: { delivery, state: "delivered" } },
            inboxDelivered: true,
          },
        },
        active,
      );
    act(() => deliver(steer, "steer"));
    expect(
      await transcript.findByRole("img", { name: "Steer delivered to the conversation" }),
    ).toBeVisible();
    expect(transcript.queryByRole("img", { name: "Model received this steer" })).toBeNull();
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.inbox.read",
          properties: { sessionID: session.id, messageID: steer.info.id },
        },
        active,
      );
      deliver(queued, "queue");
    });
    expect(await transcript.findByRole("img", { name: "Model received this steer" })).toBeVisible();
    expect(transcript.getByText("Run after the turn")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });

  it("opens a child chat, steers it with an image, and sends its result to the main chat", async () => {
    const root = makeSession("root", "Main chat");
    const plannerImage = {
      uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
      name: "Planner reference.png",
    };
    const planner = {
      ...makeSession("planner", "Review layout"),
      parentID: root.id,
      agent: "planner",
      model: { id: "claude-3.5-sonnet", providerID: "anthropic", variant: "xhigh" },
      cost: 0.125,
    };
    const auditor = {
      ...makeSession("auditor", "Inspect hierarchy"),
      parentID: root.id,
      agent: "explorer-auditor",
      outcome: "succeeded" as const,
    };
    const unrelated = {
      ...makeSession("unrelated", "Different workspace task"),
      parentID: "other",
    };
    const nested = {
      ...makeSession("nested", "Check contrast"),
      parentID: planner.id,
      outcome: "interrupted" as const,
    };
    const wideValue = "longunbrokencode".repeat(30);
    const client = createClient({
      promptInbox: vi.fn().mockResolvedValue({}),
      messages: vi.fn(async ({ sessionID }: { sessionID: string }) => {
        const messageID = `message-${sessionID}`;
        const shared = { id: `part-${sessionID}`, sessionID, messageID };
        return {
          data: [
            ...(sessionID === planner.id
              ? [
                  {
                    info: { id: "reference", sessionID, role: "user", time: { created: 0 } },
                    parts: [
                      {
                        id: "planner-image",
                        type: "file",
                        mime: "image/png",
                        url: plannerImage.uri,
                        filename: plannerImage.name,
                      },
                    ],
                  },
                ]
              : []),
            {
              info: {
                id: messageID,
                sessionID,
                role: "assistant",
                time: { created: 1, completed: 2 },
                tokens: { input: 10, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
                ...(sessionID === nested.id && {
                  providerID: "anthropic",
                  modelID: "claude-3.5-sonnet",
                  variant: "low",
                }),
              },
              parts: [
                sessionID === root.id
                  ? {
                      ...shared,
                      callID: "call",
                      type: "tool",
                      tool: "task",
                      state: {
                        status: "running",
                        input: { agent: "planner", description: "Review layout" },
                        metadata: { sessionID: planner.id },
                        time: { start: 1 },
                      },
                    }
                  : {
                      ...shared,
                      type: "text",
                      text:
                        sessionID === planner.id
                          ? `Planner transcript.\n\n\`\`\`\n${wideValue}\n\`\`\`\n\n| Column |\n| --- |\n| ${wideValue} |`
                          : sessionID === nested.id
                            ? "Nested transcript."
                            : "Auditor transcript.",
                    },
                ...(sessionID === planner.id
                  ? [
                      {
                        ...shared,
                        id: "nested-task-part",
                        callID: "nested-call",
                        type: "tool",
                        tool: "task",
                        state: {
                          status: "completed",
                          input: { description: nested.title },
                          metadata: { sessionID: nested.id },
                        },
                      },
                    ]
                  : []),
              ],
            },
          ],
        };
      }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [root, planner, auditor, nested, unrelated] });
    queryClient.setQueryData(qk.statuses, { [planner.id]: { type: "busy" } });
    render(
      <TestApp client={client} queryClient={queryClient}>
        <div id="titlebar-actions" />
      </TestApp>,
    );
    fireEvent.click(await screen.findByText("Main chat"));
    const toggle = screen.getByRole("button", { name: "Subagents" });
    fireEvent.click(toggle);
    const drawer = await screen.findByRole("complementary", { name: "Subagent chats" });
    const panel = within(drawer);
    expect(panel.getByRole("heading", { name: "Subagents" })).toHaveFocus();
    const active = within(panel.getByRole("region", { name: "Active" }));
    const plannerRow = active.getByRole("button", { name: "Review layout, Running" });
    expect(plannerRow).toBeVisible();
    const done = within(panel.getByRole("region", { name: "Done" }));
    const auditorRow = done.getByRole("button", { name: "Inspect hierarchy, Completed" });
    expect(auditorRow).toBeVisible();
    expect(plannerRow.querySelector(".lucide-bot")?.getAttribute("class")).toBeDefined();
    expect(plannerRow.querySelector(".lucide-bot")?.getAttribute("class")).not.toBe(
      auditorRow.querySelector(".lucide-bot")?.getAttribute("class"),
    );
    expect(done.getByRole("button", { name: "Check contrast, Stopped" })).toBeVisible();
    expect(panel.queryByText("Different workspace task")).not.toBeInTheDocument();
    expect(
      await screen.findByTitle("Reported subagent session cost in US dollars"),
    ).toHaveTextContent("$0.125");
    fireEvent.click(await screen.findByRole("button", { name: "Open Subagent Chat" }));

    expect(await panel.findByText("Planner transcript.")).toBeVisible();
    expect(panel.getByRole("heading", { name: planner.title })).toBeVisible();
    expect(panel.getByText("Claude 3.5 Sonnet (Anthropic)")).toBeVisible();
    expect(panel.getByText("· Extra high effort")).toBeVisible();
    const transcript = drawer.querySelector("[data-chat-scroll='subagent']");
    expect(transcript?.querySelector("pre")).toHaveClass("overflow-x-auto");
    expect(panel.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    const message = panel.getByRole("textbox", { name: "Message subagent" });
    fireEvent.click(panel.getByRole("button", { name: `Open ${plannerImage.name}` }));
    const preview = screen.getByRole("dialog", { name: plannerImage.name });
    fireEvent.contextMenu(within(preview).getByRole("img", { name: plannerImage.name }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add to Chat" }));
    expect(await panel.findByRole("button", { name: `Remove ${plannerImage.name}` })).toBeVisible();
    expect(preview).not.toBeInTheDocument();
    expect(client.session.promptInbox).not.toHaveBeenCalled();
    await waitFor(() => expect(message).toHaveFocus());
    fireEvent.change(message, { target: { value: "Check spacing next." } });
    fireEvent.keyDown(message, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(message, { key: "Enter", isComposing: true });
    expect(client.session.promptInbox).not.toHaveBeenCalled();
    fireEvent.keyDown(message, { key: "Enter" });
    await waitFor(() =>
      expect(client.session.promptInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: planner.id,
          text: "Check spacing next.",
          delivery: "steer",
          files: [plannerImage],
        }),
        { throwOnError: true },
      ),
    );
    await waitFor(() => expect(message).toHaveValue(""));
    fireEvent.change(panel.getByRole("combobox", { name: "Subagent message delivery" }), {
      target: { value: "steer" },
    });
    fireEvent.change(message, { target: { value: "Review accessibility afterwards." } });
    fireEvent.keyDown(message, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(client.session.promptInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: planner.id,
          text: "Review accessibility afterwards.",
          delivery: "queue",
        }),
        { throwOnError: true },
      ),
    );
    await waitFor(() => expect(message).toHaveValue(""));
    act(() => {
      queryClient.setQueryData(qk.config, (config: Record<string, unknown>) => ({
        ...config,
        composerShortcuts: { steer: "alt-enter", queue: "mod-shift-enter" },
      }));
    });
    fireEvent.change(message, { target: { value: "Use my custom shortcut." } });
    fireEvent.keyDown(message, { key: "Enter" });
    expect(client.session.promptInbox).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(message, { key: "Enter", altKey: true });
    await waitFor(() =>
      expect(client.session.promptInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: planner.id,
          text: "Use my custom shortcut.",
          delivery: "steer",
        }),
        { throwOnError: true },
      ),
    );
    await waitFor(() => expect(message).toHaveValue(""));
    fireEvent.change(message, { target: { value: "Keep my draft" } });
    fireEvent.click(panel.getByRole("button", { name: "Open Subagent Chat" }));
    expect(await panel.findByText("Nested transcript.")).toBeVisible();
    expect(panel.getByText("· Low effort")).toBeVisible();
    expect(panel.getByRole("textbox", { name: "Message subagent" })).toHaveFocus();

    fireEvent.click(panel.getByRole("button", { name: "Back" }));
    expect(panel.getByRole("button", { name: "Check contrast, Stopped" })).toHaveFocus();
    fireEvent.click(panel.getByRole("button", { name: "Review layout, Running" }));
    expect(panel.getByRole("textbox", { name: "Message subagent" })).toHaveValue("Keep my draft");
    fireEvent.click(panel.getByRole("button", { name: "Back" }));
    fireEvent.click(panel.getByRole("button", { name: "Inspect hierarchy, Completed" }));
    expect(await panel.findByText("Auditor transcript.")).toBeVisible();
    expect(panel.queryByText("Planner transcript.")).not.toBeInTheDocument();
    expect(panel.queryByText(/effort/)).not.toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Send Summary Back to Main Agent" }));
    await waitFor(() =>
      expect(client.session.promptInbox).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: root.id,
          text: expect.stringContaining("Auditor transcript."),
          delivery: "queue",
        }),
        { throwOnError: true },
      ),
    );
    fireEvent.click(panel.getByRole("button", { name: "Close subagent chats" }));
    expect(toggle).toHaveFocus();
  });

  it("ends the turn at the free limit with the reason and a way to keep going", async () => {
    const session = makeSession("s1", "Quota Session");
    const client = createClient({
      get: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
    });
    const queryClient = createQueryClient();
    seedReadyState(queryClient, { sessions: [session] });

    render(<TestApp client={client} queryClient={queryClient} />);
    await act(async () => {
      fireEvent.click(await screen.findByText("Quota Session"));
    });
    await screen.findByRole("textbox", { name: "Message" });

    const activeRef = { current: "s1" };
    act(() => {
      sseDispatch(
        queryClient,
        { type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } },
        activeRef,
      );
    });

    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "session.error",
          properties: {
            sessionID: "s1",
            error: {
              name: "APIError",
              data: {
                message: "Free usage limit reached.",
                retryAfterMs: 2 * 60 * 60 * 1000,
                isRetryable: false,
              },
            },
          },
        },
        activeRef,
      );
    });

    expect(await screen.findByText("You've used the free messages for now")).toBeInTheDocument();

    // The failed reply has no content, and it must not look like it's still thinking.
    act(() => {
      sseDispatch(
        queryClient,
        {
          type: "message.updated",
          properties: {
            sessionID: "s1",
            info: {
              id: "reply",
              sessionID: "s1",
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
              parentID: "prompt",
              modelID: "m",
              providerID: "p",
              mode: "studio",
              agent: "studio",
              path: { cwd: "", root: "" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              error: {
                name: "APIError",
                data: {
                  message: "Free usage limit reached.",
                  retryAfterMs: 2 * 60 * 60 * 1000,
                },
              },
            },
          },
        } as never,
        activeRef,
      );
    });
    await waitFor(() =>
      expect(screen.queryAllByRole("status").every((status) => !status.textContent)).toBe(true),
    );
    expect(screen.getByRole("link", { name: "See OpenCode Go" })).toHaveAttribute(
      "href",
      "https://opencode.ai/go",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Free messages come back in about 2 hours/)).toBeInTheDocument();
    // Every free model shares the limit, so switching between them isn't offered.
    expect(
      screen.queryByRole("button", { name: "Switch to another free model" }),
    ).not.toBeInTheDocument();
  });

  describe("a model that can't answer here", () => {
    const FREE_TIER = {
      all: [
        {
          id: "opencode",
          name: "OpenCode Zen",
          source: "custom",
          env: [],
          models: {
            "crouton-alpha-free": {
              id: "crouton-alpha-free",
              name: "Crouton Alpha",
              status: "alpha",
            },
            "flash-free": { id: "flash-free", name: "Flash Free", status: "active" },
          },
        },
      ],
      connected: ["opencode"],
      default: { opencode: "flash-free" },
    };

    /** A chat on a free model whose reply failed with this message. */
    async function failReply(message: string) {
      const session = makeSession("s1", "Free chat");
      const client = createClient({
        get: vi.fn().mockResolvedValue({ data: session }),
        messages: vi.fn().mockResolvedValue({ data: [] }),
      });
      client.provider.list = vi.fn().mockResolvedValue({ data: FREE_TIER });
      const queryClient = createQueryClient();
      seedReadyState(queryClient, { sessions: [session] });
      queryClient.setQueryData(qk.providers, FREE_TIER);
      queryClient.setQueryData(qk.config, {
        ...(queryClient.getQueryData(qk.config) as object),
        lastModel: "opencode/crouton-alpha-free",
      });

      render(<TestApp client={client} queryClient={queryClient} />);
      await act(async () => {
        fireEvent.click(await screen.findByText("Free chat"));
      });
      await screen.findByRole("button", { name: "Crouton Alpha" });

      act(() => {
        sseDispatch(
          queryClient,
          {
            type: "message.updated",
            properties: {
              sessionID: "s1",
              info: {
                id: "reply",
                sessionID: "s1",
                role: "assistant",
                time: { created: Date.now(), completed: Date.now() },
                parentID: "prompt",
                modelID: "crouton-alpha-free",
                providerID: "opencode",
                mode: "studio",
                agent: "studio",
                path: { cwd: "", root: "" },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                error: { name: "UnknownError", data: { message } },
              },
            },
          } as never,
          { current: "s1" },
        );
      });
    }

    it("switches a region-locked model to another free one, and marks it in the picker", async () => {
      await failReply("This model is not available in your country");

      expect(await screen.findByText("This model isn't offered in your region")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Switch to another free model" }));

      expect(await screen.findByText(/Now using Flash Free/)).toBeVisible();
      await waitFor(() =>
        expect(desktop.loadConfig()).resolves.toMatchObject({
          lastModel: "opencode/flash-free",
          unavailableModels: ["opencode/crouton-alpha-free"],
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: "Flash Free" }));
      const refused = await screen.findByRole("button", { name: /Crouton Alpha/ });
      expect(refused).toBeDisabled();
      expect(refused).toHaveTextContent("Not offered in your region");
    });

    it("offers a switch away from a model OpenCode retired, without remembering it", async () => {
      await failReply("Upstream request failed: Model is unavailable.");

      expect(await screen.findByText("This model is no longer available")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Switch to another free model" }));

      expect(await screen.findByText(/Now using Flash Free/)).toBeVisible();
      await waitFor(() =>
        expect(desktop.loadConfig()).resolves.toMatchObject({
          lastModel: "opencode/flash-free",
          unavailableModels: [],
        }),
      );
    });
  });
});
