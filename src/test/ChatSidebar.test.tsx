/**
 * Component tests for ChatSidebar.
 *
 * Tests session list rendering, create/delete/rename interactions,
 * and session filtering (BloxBot-only vs all).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatSidebar from "@/components/ChatSidebar";
import { loadConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import type { Session } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientContext } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { StudioTargetProvider } from "@/providers/StudioTargetProvider";
import type { ProjectFolder } from "@/types/desktop";
import { ROJO_STANDALONE_PROJECT } from "@/types/rojo";

// ── Helpers ──────────────────────────────────────────────────────────

function makeSession(
  id: string,
  title: string,
  createdAt = Date.now(),
  archived?: number,
): Session {
  return {
    id,
    title,
    time: { created: createdAt, updated: createdAt, archived },
    version: 1,
    parentID: "",
  } as Session;
}

function createClient(overrides: Record<string, unknown> = {}) {
  const list = vi.fn().mockResolvedValue({ data: [] });
  return {
    experimental: { session: { list } },
    session: {
      list,
      get: vi.fn().mockResolvedValue({ data: null }),
      create: vi.fn().mockResolvedValue({ data: null }),
      delete: vi.fn().mockResolvedValue({ data: true }),
      update: vi.fn().mockResolvedValue({ data: null }),
      abort: vi.fn().mockResolvedValue({ data: true }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      move: vi.fn().mockResolvedValue({ data: null }),
      status: vi.fn().mockResolvedValue({ data: {} }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      promptAsync: vi.fn().mockResolvedValue({}),
      ...overrides,
    },
    provider: {
      list: vi.fn().mockResolvedValue({ data: { all: [], connected: [] } }),
      oauth: { authorize: vi.fn(), callback: vi.fn() },
      auth: vi.fn().mockResolvedValue({ data: undefined }),
    },
    auth: { set: vi.fn(), remove: vi.fn() },
    question: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn(), reject: vi.fn() },
    permission: { list: vi.fn().mockResolvedValue({ data: [] }), reply: vi.fn() },
    event: { subscribe: vi.fn().mockResolvedValue({ stream: null }) },
    mcp: { connect: vi.fn(), disconnect: vi.fn() },
    instance: { dispose: vi.fn() },
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function seedState(qc: QueryClient, opts: { sessions?: Session[] } = {}) {
  const sessions = opts.sessions ?? [];

  qc.setQueryData(qk.sessions, sessions);
  qc.setQueryData(qk.statuses, {});
  qc.setQueryData(qk.providers, { all: [], connected: [], default: {} });
  qc.setQueryData(qk.config, {
    lastModel: null,
    hiddenModels: [],
    theme: "system",
  });
}

function TestSidebar({
  client,
  queryClient,
  collapsed = false,
  onToggle = vi.fn(),
  onSessionSelect = vi.fn(),
  onOpenSettings = vi.fn(),
  withStudio = false,
}: {
  client: ReturnType<typeof createClient>;
  queryClient: QueryClient;
  collapsed?: boolean;
  onToggle?: () => void;
  onSessionSelect?: () => void;
  onOpenSettings?: () => void;
  withStudio?: boolean;
}) {
  const activeSessionIdRef = useRef<string | null>(null);
  const sidebar = (
    <ChatSidebar
      collapsed={collapsed}
      onToggle={onToggle}
      onSessionSelect={onSessionSelect}
      onOpenSettings={onOpenSettings}
    />
  );
  return (
    <QueryClientProvider client={queryClient}>
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
            {withStudio ? <StudioTargetProvider>{sidebar}</StudioTargetProvider> : sidebar}
          </PreferencesProvider>
        </ActiveSessionProvider>
      </OpenCodeClientContext.Provider>
    </QueryClientProvider>
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("ChatSidebar", () => {
  it("shows the number of serving manifests and keeps the launcher accessible without files", async () => {
    const qc = createQueryClient();
    seedState(qc);
    const projectFile = "C:/Games/lobby.project.json";
    const list = vi.spyOn(desktop, "listRojoServers").mockResolvedValue([]);
    render(<TestSidebar client={createClient()} queryClient={qc} />);
    expect(screen.getByRole("button", { name: "Rojo launcher" })).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalled());

    await act(async () => {
      qc.setQueryData(qk.config, (config) => ({
        ...config,
        rojoManifests: { [ROJO_STANDALONE_PROJECT]: [projectFile] },
      }));
    });
    expect(
      await screen.findByRole("button", { name: "Rojo launcher (0 serving)" }),
    ).toBeInTheDocument();
    list.mockResolvedValue([
      {
        projectId: ROJO_STANDALONE_PROJECT,
        projectFile,
        status: "running",
        port: 34872,
        error: null,
        output: "",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Rojo launcher (0 serving)" }));
    const dialog = await screen.findByRole("dialog", { name: "Rojo server launcher" });
    expect(await within(dialog).findByText("127.0.0.1:34872")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      await screen.findByRole("button", { name: "Rojo launcher (1 serving)" }),
    ).toBeInTheDocument();
  });

  it("adds a real project folder, creates in it, and keeps grouping after a fresh configuration load", async () => {
    const directory = "C:\\Games\\Game A";
    const session = { ...makeSession("project1", "A project chat"), directory: "c:/games/game a" };
    const client = createClient({ create: vi.fn().mockResolvedValue({ data: session }) });
    const qc = createQueryClient();
    seedState(qc);
    vi.spyOn(desktop, "chooseProjectFolder").mockResolvedValue(directory);
    const view = render(<TestSidebar client={client} queryClient={qc} />);

    fireEvent.click(screen.getByTitle("Add project folder"));
    expect(await screen.findByRole("dialog", { name: "Add project folder" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    fireEvent.click(await screen.findByTitle("New chat in Game A"));
    expect(
      await within(screen.getByRole("region", { name: "Game A" })).findByText("A project chat"),
    ).toBeInTheDocument();
    expect(client.session.create).toHaveBeenCalledWith({ directory }, { throwOnError: true });

    view.unmount();
    const reloaded = createQueryClient();
    seedState(reloaded, { sessions: [session] });
    reloaded.setQueryData(qk.config, await loadConfig());
    render(<TestSidebar client={client} queryClient={reloaded} />);
    expect(
      within(screen.getByRole("region", { name: "Game A" })).getByText("A project chat"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Edit Game A"));
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Renamed game" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("region", { name: "Renamed game" })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Edit Renamed game"));
    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove folder" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Renamed game" })).toBeNull());
    expect(screen.getByText("A project chat")).toBeInTheDocument();
    expect(client.session.delete).not.toHaveBeenCalled();
  });

  it("moves an existing chat into a project through OpenCode", async () => {
    const directory = "C:\\Games\\Game A";
    const session = makeSession("general", "Existing chat");
    const client = createClient({
      move: vi.fn().mockResolvedValue({ data: { ...session, directory } }),
    });
    const qc = createQueryClient();
    seedState(qc, { sessions: [session] });
    const projectFolders: ProjectFolder[] = [{ directory, name: "Game A", studio: null }];
    qc.setQueryData(qk.config, { ...(await loadConfig()), projectFolders });
    render(<TestSidebar client={client} queryClient={qc} />);

    fireEvent.click(screen.getByTitle("Chat actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Game A" }));
    expect(
      await within(screen.getByRole("region", { name: "Game A" })).findByText("Existing chat"),
    ).toBeInTheDocument();
    expect(client.session.move).toHaveBeenCalledWith(
      { sessionID: session.id, directory },
      { throwOnError: true },
    );
  });

  it("moves a chat dragged onto a folder or back onto the other chats, once confirmed", async () => {
    const directory = "C:\\Games\\Game A";
    const loose = makeSession("loose", "Loose chat");
    const filed = { ...makeSession("filed", "Filed chat"), directory };
    const move = vi.fn(
      async ({ sessionID, directory: to }: { sessionID: string; directory?: string }) => ({
        data: { ...(sessionID === loose.id ? loose : filed), directory: to ?? "C:\\default" },
      }),
    );
    const client = createClient({ move });
    const qc = createQueryClient();
    seedState(qc, { sessions: [loose, filed] });
    const projectFolders: ProjectFolder[] = [{ directory, name: "Game A", studio: null }];
    qc.setQueryData(qk.config, { ...(await loadConfig()), projectFolders });
    render(<TestSidebar client={client} queryClient={qc} />);
    const dataTransfer = () => {
      const data = new Map<string, string>();
      return {
        setData: (type: string, value: string) => data.set(type, value),
        getData: (type: string) => data.get(type) ?? "",
        get types() {
          return [...data.keys()];
        },
        effectAllowed: "",
        dropEffect: "",
      };
    };
    const drag = (title: string, onto: HTMLElement) => {
      const transfer = dataTransfer();
      const chat = screen.getByText(title).closest("button");
      if (!chat) throw new Error("Expected a chat row");
      fireEvent.dragStart(chat, { dataTransfer: transfer });
      fireEvent.dragOver(onto, { dataTransfer: transfer });
      return { chat, transfer };
    };

    // The folder a chat is already in doesn't take it.
    const folder = screen.getByRole("region", { name: "Game A" });
    const own = drag("Filed chat", folder);
    expect(folder).not.toHaveAttribute("data-drop-target");
    // What is dragged is a whole card of the app's own, with the chat's name on it.
    const card = () => document.querySelector("[data-drag-card]");
    expect(card()).toHaveTextContent("Filed chat");
    expect(card()).toHaveTextContent("Drop on a folder to move it");
    fireEvent.drop(folder, { dataTransfer: own.transfer });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.dragEnd(own.chat);
    expect(card()).toBeNull();

    const into = drag("Loose chat", folder);
    expect(folder).toHaveAttribute("data-drop-target");
    expect(card()).toHaveTextContent("Move to Game A");
    fireEvent.drop(folder, { dataTransfer: into.transfer });
    expect(folder).not.toHaveAttribute("data-drop-target");
    expect(card()).toBeNull();
    const ask = within(screen.getByRole("alertdialog", { name: "Move chat to Game A?" }));
    expect(ask.getByText(directory)).toBeVisible();
    expect(move).not.toHaveBeenCalled();
    // Cancelling leaves the chat where it was.
    fireEvent.click(ask.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(move).not.toHaveBeenCalled();

    const again = drag("Loose chat", folder);
    fireEvent.drop(folder, { dataTransfer: again.transfer });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(move).toHaveBeenLastCalledWith(
        { sessionID: loose.id, directory },
        { throwOnError: true },
      ),
    );
    expect(await within(folder).findByText("Loose chat")).toBeInTheDocument();

    // With every chat in a folder, the other chats still appear while one is dragged.
    expect(screen.queryByRole("region", { name: "Other chats" })).toBeNull();
    const out = screen.getByText("Filed chat").closest("button");
    if (!out) throw new Error("Expected a chat row");
    const transfer = dataTransfer();
    fireEvent.dragStart(out, { dataTransfer: transfer });
    const others = screen.getByRole("region", { name: "Other chats" });
    fireEvent.dragOver(others, { dataTransfer: transfer });
    fireEvent.drop(others, { dataTransfer: transfer });
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Move chat to Other chats?" })).getByRole(
        "button",
        { name: "Move" },
      ),
    );
    await waitFor(() =>
      expect(move).toHaveBeenLastCalledWith(
        { sessionID: filed.id, directory: undefined },
        { throwOnError: true },
      ),
    );
  });

  it("remembers the folder's chosen Studio for a new project chat", async () => {
    const directory = "C:\\Games\\Game A";
    const studio = { key: "game-a", label: "Game A", detail: null, placeId: "101" };
    const differentStudio = { key: "game-b", label: "Game B", detail: null, placeId: "102" };
    const session = { ...makeSession("with-studio", "Project chat"), directory };
    const client = createClient({ create: vi.fn().mockResolvedValue({ data: session }) });
    const qc = createQueryClient();
    seedState(qc);
    qc.setQueryData(qk.config, {
      ...(await loadConfig()),
      projectFolders: [{ directory, name: "Game A", studio }],
    });
    vi.spyOn(desktop, "discoverStudioTargets").mockResolvedValue({
      targets: [studio, differentStudio],
      selectedKey: differentStudio.key,
    });
    const select = vi
      .spyOn(desktop, "selectStudioTarget")
      .mockResolvedValue({ selected: studio, verified: true });
    render(<TestSidebar client={client} queryClient={qc} withStudio />);

    fireEvent.click(screen.getByTitle("New chat in Game A"));
    await waitFor(() => expect(select).toHaveBeenCalledWith(studio.key));
    expect((await loadConfig()).studioTargetsBySession[session.id]).toEqual(studio);
    expect((await loadConfig()).chatsWithChosenPlace).toContain(session.id);
  });

  it("snoozes an idle session instead of deleting it", async () => {
    const s1 = makeSession("s1", "To Snooze");
    const snoozed = makeSession("s1", "To Snooze", s1.time.created, Date.now());
    const client = createClient({ update: vi.fn().mockResolvedValue({ data: snoozed }) });
    const qc = createQueryClient();
    seedState(qc, { sessions: [s1] });
    qc.setQueryData(qk.statuses, { s1: { type: "idle" } });

    render(<TestSidebar client={client} queryClient={qc} />);

    expect(await screen.findByText("To Snooze")).toBeInTheDocument();

    const snoozeBtn = screen.getByTitle("Snooze");
    await act(async () => {
      fireEvent.click(snoozeBtn);
    });

    await waitFor(() =>
      expect(client.session.update).toHaveBeenCalledWith(
        { sessionID: "s1", time: { archived: expect.any(Number) } },
        { throwOnError: true },
      ),
    );
    expect(client.session.delete).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("Snoozed")).toBeInTheDocument();
    });
  });

  it("does not snooze a busy session", async () => {
    const client = createClient();
    const qc = createQueryClient();
    seedState(qc, { sessions: [makeSession("s1", "Still working")] });
    qc.setQueryData(qk.statuses, { s1: { type: "busy" } });

    render(<TestSidebar client={client} queryClient={qc} />);

    const button = await screen.findByTitle("Wait for session to finish");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(client.session.update).not.toHaveBeenCalled();
  });

  it("opens a snoozed session without changing its archive timestamp", async () => {
    const snoozed = makeSession("s1", "A very long snoozed session title", Date.now(), Date.now());
    const client = createClient({ get: vi.fn().mockResolvedValue({ data: snoozed }) });
    const qc = createQueryClient();
    seedState(qc, { sessions: [snoozed] });
    const onSessionSelect = vi.fn();

    render(<TestSidebar client={client} queryClient={qc} onSessionSelect={onSessionSelect} />);
    fireEvent.click(await screen.findByText("Snoozed"));
    await act(async () => {
      fireEvent.click(screen.getByTitle(`Open snoozed session ${snoozed.title}`));
    });

    expect(onSessionSelect).toHaveBeenCalled();
    expect(client.session.update).not.toHaveBeenCalled();
    expect(screen.getByText("Snoozed")).toBeInTheDocument();
  });

  it("permanently deletes a session only from its right-click menu and after confirmation", async () => {
    const snoozed = makeSession("s1", "Old session", Date.now(), Date.now());
    const client = createClient();
    const qc = createQueryClient();
    seedState(qc, { sessions: [snoozed] });

    render(<TestSidebar client={client} queryClient={qc} />);
    fireEvent.click(await screen.findByText("Snoozed"));
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTitle(`Open snoozed session ${snoozed.title}`));
    const deleteButton = screen.getByText("Delete");
    fireEvent.click(deleteButton);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete chat?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(client.session.delete).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByTitle(`Open snoozed session ${snoozed.title}`));
    fireEvent.click(screen.getByText("Delete"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete" })));
    expect(client.session.delete).toHaveBeenCalledWith({ sessionID: "s1" }, { throwOnError: true });
  });

  it("enters rename mode and commits on Enter", async () => {
    const s1 = makeSession("s1", "Original Name");
    const renamed = makeSession("s1", "Renamed");
    const client = createClient({
      update: vi.fn().mockResolvedValue({ data: renamed }),
    });
    const qc = createQueryClient();
    seedState(qc, { sessions: [s1] });

    render(<TestSidebar client={client} queryClient={qc} />);

    expect(await screen.findByText("Original Name")).toBeInTheDocument();

    // Click rename button
    const renameBtn = screen.getByTitle("Rename");
    await act(async () => {
      fireEvent.click(renameBtn);
    });

    // An input should appear with the current title
    const input = screen.getByDisplayValue("Original Name");
    expect(input).toBeInTheDocument();

    // Type new name and press Enter
    await act(async () => {
      fireEvent.change(input, { target: { value: "Renamed" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(client.session.update).toHaveBeenCalledWith(
      {
        sessionID: "s1",
        title: "Renamed",
      },
      { throwOnError: true },
    );
  });

  it("cancels rename on Escape", async () => {
    const s1 = makeSession("s1", "My Session");
    const client = createClient();
    const qc = createQueryClient();
    seedState(qc, { sessions: [s1] });

    render(<TestSidebar client={client} queryClient={qc} />);

    const renameBtn = await screen.findByTitle("Rename");
    await act(async () => {
      fireEvent.click(renameBtn);
    });

    const input = screen.getByDisplayValue("My Session");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Changed" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    // Should not have called update
    expect(client.session.update).not.toHaveBeenCalled();
    // Should show original title
    expect(screen.getByText("My Session")).toBeInTheDocument();
  });
});
