import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@/types/desktop";
import type { SkillImportList, SkillImportResult } from "@/types/skillImport";

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  notify: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock("@/providers/OpenCodeClientProvider", () => ({
  useOpenCodeClient: () => ({ client: { location: { reload: mocks.reload } } }),
}));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify }));

import SkillsSettings, { importSummary } from "@/components/SkillsSettings";

const listImportableSkills = vi.fn<() => Promise<SkillImportList>>();
const importSkills = vi.fn<(names?: readonly string[]) => Promise<SkillImportResult>>();

const found: SkillImportList = {
  available: true,
  folder: "~/BloxBot/.opencode/config/opencode/skills",
  importable: [
    {
      name: "luau-coding",
      description: "Write Luau",
      sources: ["Claude Code", "Codex"],
      path: "~/.claude/skills/luau-coding",
      status: "new",
    },
    {
      name: "hatch-pet",
      description: null,
      sources: ["Codex"],
      path: "~/.codex/skills/hatch-pet",
      status: "new",
    },
  ],
  installed: [{ name: "mine", description: null, sources: [] }],
  skipped: [],
};

const imported: SkillImportResult = {
  imported: ["luau-coding", "hatch-pet"],
  updated: [],
  removed: [],
  unchanged: [],
  skipped: [{ name: "big", reason: "Left out video.mp4 (over 5 MB)." }],
  installed: [],
};

const afterImport: SkillImportList = {
  ...found,
  importable: found.importable.map((skill) => ({ ...skill, status: "current" })),
  installed: [
    { name: "hatch-pet", description: null, sources: ["Codex"] },
    { name: "luau-coding", description: "Write Luau", sources: ["Claude Code", "Codex"] },
    { name: "mine", description: null, sources: [] },
  ],
};

function open(chatRunning = false) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SkillsSettings chatRunning={chatRunning} />
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: "Import from Codex and Claude Code" });
}

describe("Settings: importing skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reload.mockResolvedValue({ data: undefined });
    window.bloxbot = { listImportableSkills, importSkills } as unknown as DesktopApi;
  });

  afterEach(() => {
    window.bloxbot = undefined;
  });

  it("imports everything in one click, reloads OpenCode, and lists what BloxBot has", async () => {
    listImportableSkills.mockResolvedValueOnce(found).mockResolvedValue(afterImport);
    importSkills.mockResolvedValue(imported);
    const button = open();

    expect(await screen.findByText("2 skills found, 2 to import.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 skill in BloxBot" })).toBeInTheDocument();
    fireEvent.click(button);

    expect(await screen.findByText("Imported 2 skills.")).toBeInTheDocument();
    expect(importSkills).toHaveBeenCalledWith(undefined);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.notify.success).toHaveBeenCalledWith("Imported 2 skills");
    expect(
      screen.getByText("Left out video.mp4 (over 5 MB).", { exact: false }),
    ).toBeInTheDocument();

    // The list opens by itself after an import.
    const toggle = await screen.findByRole("button", { name: "3 skills in BloxBot" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toContain("luau-codingWrite LuauClaude Code, Codex");
    expect(rows).toContain("hatch-petCodex");
    expect(rows).toContain("mineAdded by you");
    expect(button).toBeEnabled();
  });

  it("says what went wrong when the import fails, and can be tried again", async () => {
    listImportableSkills.mockResolvedValue(found);
    importSkills.mockRejectedValue(new Error("Couldn't read ~/.codex/skills: EPERM"));
    const button = open();
    await screen.findByText("2 skills found, 2 to import.");
    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.notify.error).toHaveBeenCalledWith("Couldn't import your skills", {
        description: "Couldn't read ~/.codex/skills: EPERM",
      }),
    );
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.notify.success).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("still counts as imported when OpenCode can't reload, and says how to load them", async () => {
    listImportableSkills.mockResolvedValue(found);
    importSkills.mockResolvedValue(imported);
    mocks.reload.mockRejectedValue(new Error("offline"));
    const button = open();
    await screen.findByText("2 skills found, 2 to import.");
    fireEvent.click(button);

    expect(
      await screen.findByText("Imported 2 skills. Type /reload in a chat to start using them."),
    ).toBeInTheDocument();
    expect(mocks.notify.message).toHaveBeenCalledWith("Skills imported", {
      description: "Type /reload in a chat to start using them.",
    });
    expect(mocks.notify.error).not.toHaveBeenCalled();
  });

  it("doesn't reload OpenCode when nothing changed", async () => {
    listImportableSkills.mockResolvedValue(afterImport);
    importSkills.mockResolvedValue({
      ...imported,
      imported: [],
      unchanged: ["a", "b"],
      skipped: [],
    });
    const button = open();
    await screen.findByText("2 skills found, all up to date.");
    fireEvent.click(button);

    expect(await screen.findByText("Everything is already up to date.")).toBeInTheDocument();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  it("waits for running chats to finish, as saving instructions does", async () => {
    listImportableSkills.mockResolvedValue(found);
    const button = open(true);
    expect(
      await screen.findByText("Importing waits for your chats to finish."),
    ).toBeInTheDocument();
    await waitFor(() => expect(listImportableSkills).toHaveBeenCalled());
    expect(button).toBeDisabled();
  });

  it("says it needs the desktop app when opened in a browser", async () => {
    window.bloxbot = undefined;
    const button = open();
    expect(await screen.findByText("Importing skills needs the desktop app.")).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("says when the folders can't be read", async () => {
    listImportableSkills.mockRejectedValue(new Error("EPERM"));
    const button = open();
    expect(await screen.findByText("Couldn't read your skills folders. EPERM")).toBeInTheDocument();
    expect(button).toBeDisabled();
  });
});

describe("the import's summary", () => {
  const result = (imported: number, updated: number, removed: number, unchanged = 0) =>
    importSummary({
      imported: Array.from({ length: imported }, String),
      updated: Array.from({ length: updated }, String),
      removed: Array.from({ length: removed }, String),
      unchanged: Array.from({ length: unchanged }, String),
      skipped: [],
      installed: [],
    });

  it("leads with whatever happened most importantly", () => {
    expect(result(14, 2, 1)).toBe("Imported 14 skills, 2 updated, 1 removed");
    expect(result(1, 0, 0)).toBe("Imported 1 skill");
    expect(result(0, 2, 1)).toBe("Updated 2 skills, 1 removed");
    expect(result(0, 0, 1)).toBe("Removed 1 skill");
    expect(result(0, 0, 0, 3)).toBe("Everything is already up to date");
    expect(result(0, 0, 0)).toBe("Nothing to import");
  });
});
