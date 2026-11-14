import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RojoLauncher } from "@/components/RojoLauncher";
import { ROJO_STANDALONE_PROJECT, type RojoServer } from "@/types/rojo";
import type { StudioTarget } from "@/types/studioTarget";

const { loadConfig, desktop, studio } = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  desktop: {
    addRojoProjectFiles: vi.fn(),
    removeRojoProjectFile: vi.fn(),
    listRojoServers: vi.fn(),
    startRojoServer: vi.fn(),
    stopRojoServer: vi.fn(),
    readStudioRojoConnection: vi.fn(),
  },
  studio: { selected: null as StudioTarget | null },
}));

vi.mock("@/lib/config", () => ({ loadConfig }));
vi.mock("@/lib/desktop", () => ({ desktop }));
vi.mock("@/providers/StudioTargetProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/StudioTargetProvider")>()),
  useStudioTargetOptional: () => studio,
}));

const projectId = "C:\\Games\\Obby";
const projectFile = `${projectId}\\default.project.json`;
const secondFile = `${projectId}\\maps\\lobby.project.jsonc`;
const projectFolders = [{ directory: projectId, name: "Obby", studio: null }];
const running: RojoServer = {
  projectId,
  projectFile,
  status: "running",
  port: 34872,
  error: null,
  output: "Rojo server listening",
};
const lobbyRunning: RojoServer = {
  ...running,
  projectFile: secondFile,
  port: 34873,
};

function showLauncher({ withOpener = false } = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(withOpener ? <LauncherWithOpener /> : <RojoLauncher onClose={onClose} />, {
      wrapper: Wrapper,
    }),
    onClose,
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  function LauncherWithOpener() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Rojo launcher
        </button>
        {open && (
          <RojoLauncher
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  desktop.listRojoServers.mockResolvedValue([]);
  loadConfig.mockResolvedValue({});
  studio.selected = null;
});

afterEach(() => vi.unstubAllGlobals());

describe("RojoLauncher", () => {
  it("adds multiple standalone files with one picker and removes just the selected row", async () => {
    desktop.addRojoProjectFiles.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
      loadConfig.mockResolvedValue({
        rojoManifests: { [ROJO_STANDALONE_PROJECT]: [projectFile, secondFile] },
      });
      return [projectFile, secondFile];
    });
    desktop.removeRojoProjectFile.mockImplementationOnce(async () => {
      loadConfig.mockResolvedValue({
        rojoManifests: { [ROJO_STANDALONE_PROJECT]: [secondFile] },
      });
    });
    showLauncher();

    const standalone = within(screen.getByRole("region", { name: "Standalone project" }));
    const add = await standalone.findByRole("button", { name: "Add project files…" });
    expect(standalone.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    fireEvent.click(add);
    await waitFor(() => expect(desktop.addRojoProjectFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(add).toBeEnabled());

    fireEvent.click(add);
    expect(await standalone.findByText(projectFile)).toBeInTheDocument();
    expect(standalone.getByText(secondFile)).toBeInTheDocument();
    expect(desktop.addRojoProjectFiles).toHaveBeenCalledWith(ROJO_STANDALONE_PROJECT);
    expect(desktop.startRojoServer).not.toHaveBeenCalled();
    const defaultRow = within(standalone.getByRole("region", { name: "default.project.json" }));
    const remove = defaultRow.getByRole("button", { name: "Remove" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    await waitFor(() => expect(standalone.queryByText(projectFile)).not.toBeInTheDocument());
    expect(standalone.getByText(secondFile)).toBeInTheDocument();
    expect(desktop.removeRojoProjectFile).toHaveBeenCalledWith(
      ROJO_STANDALONE_PROJECT,
      projectFile,
    );
  });

  it("shows legacy files, lets the folder add while serving, and keeps serving on close", async () => {
    loadConfig.mockResolvedValue({
      projectFolders,
      rojoProjectFiles: { [projectId]: projectFile },
    });
    desktop.startRojoServer.mockImplementation(async () => {
      desktop.listRojoServers.mockResolvedValue([running]);
      return running;
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { onClose } = showLauncher({ withOpener: true });
    const opener = screen.getByRole("button", { name: "Rojo launcher" });
    opener.focus();
    fireEvent.click(opener);
    const folder = within(await screen.findByRole("region", { name: "Obby" }));
    const manifest = within(folder.getByRole("region", { name: "default.project.json" }));
    const start = manifest.getByRole("button", { name: "Start" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    expect(await manifest.findByText("127.0.0.1:34872")).toBeInTheDocument();
    expect(desktop.startRojoServer).toHaveBeenCalledWith(projectId, projectFile);
    expect(folder.getByRole("button", { name: "Add project files…" })).toBeEnabled();
    expect(manifest.getByRole("button", { name: "Remove" })).toBeDisabled();
    fireEvent.click(manifest.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith("127.0.0.1:34872");
    expect(manifest.getByText("Rojo server listening")).not.toBeVisible();
    fireEvent.click(manifest.getByText("Server logs"));
    expect(manifest.getByText("Rojo server listening")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(desktop.stopRojoServer).not.toHaveBeenCalled();
  });

  it("keeps a failed start and its logs on the affected manifest", async () => {
    loadConfig.mockResolvedValue({
      projectFolders,
      rojoManifests: { [projectId]: [projectFile, secondFile] },
    });
    desktop.listRojoServers.mockResolvedValue([running]);
    desktop.startRojoServer.mockImplementation(async () => {
      const failed = {
        ...lobbyRunning,
        status: "error",
        port: null,
        error: "Rojo port 34872 is already in use.",
        output: "Address already in use",
      };
      desktop.listRojoServers.mockResolvedValue([running, failed]);
      return failed;
    });
    showLauncher();
    const defaultRow = within(await screen.findByRole("region", { name: "default.project.json" }));
    const lobby = within(screen.getByRole("region", { name: "maps/lobby.project.jsonc" }));
    await waitFor(() => expect(lobby.getByRole("button", { name: "Start" })).toBeEnabled());
    fireEvent.click(lobby.getByRole("button", { name: "Start" }));
    expect(await lobby.findByRole("alert")).toHaveTextContent("Rojo port 34872 is already in use.");
    expect(desktop.startRojoServer).toHaveBeenCalledWith(projectId, secondFile);
    expect(defaultRow.queryByRole("alert")).not.toBeInTheDocument();
    expect(defaultRow.getByRole("button", { name: "Stop" })).toBeEnabled();
    fireEvent.click(lobby.getByText("Server logs"));
    expect(lobby.getByText("Address already in use")).toBeVisible();
  });

  it("stops orphan manifests independently and deduplicates the same stop while pending", async () => {
    desktop.listRojoServers.mockResolvedValue([running, lobbyRunning]);
    desktop.stopRojoServer.mockImplementation(async () => {
      const stopped = { ...running, status: "stopped" };
      desktop.listRojoServers.mockResolvedValue([stopped, lobbyRunning]);
      return stopped;
    });
    showLauncher();
    const folder = within(await screen.findByRole("region", { name: projectId }));
    const manifest = within(folder.getByRole("region", { name: "default.project.json" }));
    const stop = manifest.getByRole("button", { name: "Stop" });
    act(() => {
      fireEvent.click(stop);
      fireEvent.click(stop);
    });
    await waitFor(() =>
      expect(
        folder.queryByRole("region", { name: "default.project.json" }),
      ).not.toBeInTheDocument(),
    );
    expect(folder.getByRole("region", { name: "maps/lobby.project.jsonc" })).toBeInTheDocument();
    expect(desktop.stopRojoServer).toHaveBeenCalledExactlyOnceWith(projectId, projectFile);
  });

  it("checks only on request and matches the reported endpoint to the selected Studio and row", async () => {
    studio.selected = { key: "edit-obby", label: "Obby", detail: null, placeId: "42" };
    loadConfig.mockResolvedValue({
      projectFolders,
      rojoManifests: { [projectId]: [projectFile, secondFile] },
    });
    desktop.listRojoServers.mockResolvedValue([running, lobbyRunning]);
    desktop.readStudioRojoConnection.mockResolvedValue({ port: 34873, placeId: "42" });
    const { onClose, rerender } = showLauncher();
    const defaultRow = within(await screen.findByRole("region", { name: "default.project.json" }));
    const lobby = within(screen.getByRole("region", { name: "maps/lobby.project.jsonc" }));
    expect(desktop.readStudioRojoConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Check Studio connection" }));
    expect(await lobby.findByText("Studio reported this endpoint")).toBeInTheDocument();
    expect(defaultRow.queryByText("Studio reported this endpoint")).not.toBeInTheDocument();
    expect(screen.getByText(/Reported local port 34873 at/)).toBeInTheDocument();
    expect(desktop.readStudioRojoConnection).toHaveBeenCalledExactlyOnceWith("edit-obby");

    studio.selected = { key: "edit-other", label: "Other place", detail: null, placeId: "33" };
    rerender(<RojoLauncher onClose={onClose} />);
    expect(screen.queryByText("Studio reported this endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText(/Reported local port 34873 at/)).not.toBeInTheDocument();
    expect(desktop.readStudioRojoConnection).toHaveBeenCalledTimes(1);
  });

  it("explains an absent plugin report and presents rejected checks separately", async () => {
    studio.selected = { key: "edit-obby", label: "Obby", detail: null, placeId: "42" };
    desktop.readStudioRojoConnection
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Rojo requires the desktop app."));
    showLauncher();
    const studioPanel = within(screen.getByRole("region", { name: "Studio connection" }));
    fireEvent.click(studioPanel.getByRole("button", { name: "Check Studio connection" }));
    expect(await studioPanel.findByText(/No endpoint reported/)).toHaveTextContent(
      "Auto Connect Playtest Server",
    );
    fireEvent.click(studioPanel.getByRole("button", { name: "Check Studio connection" }));
    expect(await studioPanel.findByRole("alert")).toHaveTextContent(
      "Rojo requires the desktop app.",
    );
    expect(studioPanel.queryByText(/No endpoint reported/)).not.toBeInTheDocument();
  });
});
