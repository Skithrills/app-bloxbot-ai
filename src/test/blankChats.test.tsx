import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useClearBlankChats } from "@/hooks/useClearBlankChats";
import {
  resetBlankChatsForTest,
  takeLeftoverBlankChats,
  trackBlankChat,
  untrackBlankChat,
} from "@/lib/blankChats";
import { saveComposerDraft } from "@/lib/composerDrafts";

const messages = vi.fn();
const deleteSession = vi.fn(async (_id: string) => undefined);
let sessions: { id: string; parentID?: string }[] = [];

vi.mock("@/providers/OpenCodeClientProvider", () => ({
  useOpenCodeClient: () => ({ client: { session: { messages } }, ready: true }),
}));
vi.mock("@/hooks/useSessions", () => ({ useSessions: () => ({ data: sessions }) }));
vi.mock("@/hooks/mutations/useDeleteSession", () => ({
  useDeleteSession: () => ({ mutateAsync: deleteSession }),
}));

const STORAGE_KEY = "bloxbot-blank-chats";
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];

beforeEach(() => {
  localStorage.clear();
  resetBlankChatsForTest();
  messages.mockReset();
  messages.mockResolvedValue({ data: [] });
  deleteSession.mockClear();
  sessions = [];
});

describe("blank chats", () => {
  it("hands over what earlier runs left, but not the chats this run made", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["old"]));
    trackBlankChat("new");

    expect(takeLeftoverBlankChats()).toEqual(["old"]);
    expect(takeLeftoverBlankChats()).toEqual([]);
    expect(stored()).toEqual(["old", "new"]);
    untrackBlankChat("old");
    expect(stored()).toEqual(["new"]);
  });

  it("removes a chat from an earlier run that nothing was sent or typed in", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["blank"]));
    sessions = [{ id: "blank" }, { id: "other" }];
    renderHook(() => useClearBlankChats());

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("blank"));
    await waitFor(() => expect(stored()).toEqual([]));
    expect(deleteSession).toHaveBeenCalledTimes(1);
  });

  it("keeps one with something typed in its message box, to look at again next time", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["typed"]));
    sessions = [{ id: "typed" }];
    saveComposerDraft("typed", { text: "make a lobby", attachments: [] });
    renderHook(() => useClearBlankChats());

    await Promise.resolve();
    expect(messages).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
    expect(stored()).toEqual(["typed"]);
  });

  it("keeps one that has messages or a chat started from it, and stops tracking it", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["sent", "parent", "gone"]));
    sessions = [{ id: "sent" }, { id: "parent" }, { id: "kid", parentID: "parent" }];
    messages.mockImplementation(async ({ sessionID }: { sessionID: string }) => ({
      data: sessionID === "sent" ? [{ id: "m1" }] : [],
    }));
    renderHook(() => useClearBlankChats());

    await waitFor(() => expect(stored()).toEqual([]));
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("leaves a chat it couldn't check for the next launch", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["unknown"]));
    sessions = [{ id: "unknown" }];
    messages.mockRejectedValue(new Error("offline"));
    renderHook(() => useClearBlankChats());

    await waitFor(() => expect(messages).toHaveBeenCalled());
    expect(deleteSession).not.toHaveBeenCalled();
    expect(stored()).toEqual(["unknown"]);
  });
});
