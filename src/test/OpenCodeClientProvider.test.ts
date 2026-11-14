import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { OpencodeClient } from "@/lib/opencode/client";
import type { Session } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import {
  chatRojoProjectFiles,
  prefetchServerState,
  reconcileServerState,
} from "@/providers/OpenCodeClientProvider";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";
import { ROJO_STANDALONE_PROJECT } from "@/types/rojo";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

describe("OpenCode query lifecycle", () => {
  it("uses only the manifests configured for the chat's exact project folder", async () => {
    const queryClient = makeQueryClient();
    const project = "C:\\Games\\Combat";
    const other = "C:\\Games\\Other";
    const manifests = [`${project}\\full.project.json`, `${project}\\range.project.json`];
    const oldManifest = `${other}\\default.project.json`;
    queryClient.setQueryData(qk.config, {
      ...DEFAULT_APP_CONFIG,
      projectFolders: [
        { directory: project, name: "Combat", studio: null },
        { directory: other, name: "Other", studio: null },
      ],
      rojoManifests: {
        [project]: manifests,
        [ROJO_STANDALONE_PROJECT]: ["C:\\standalone.project.json"],
      },
      rojoProjectFiles: { [project]: "C:\\ignored.project.json", [other]: oldManifest },
    });
    queryClient.setQueryData(qk.sessions, [
      { id: "combat", directory: "c:/games/combat/" },
      { id: "other", directory: other },
      { id: "subfolder", directory: `${project}\\Lobby` },
      { id: "unfiled", directory: "C:\\BloxBot" },
    ]);
    await expect(chatRojoProjectFiles(queryClient, "combat")).resolves.toEqual(manifests);
    await expect(chatRojoProjectFiles(queryClient, "other")).resolves.toEqual([oldManifest]);
    for (const id of ["subfolder", "unfiled", "unknown"]) {
      await expect(chatRojoProjectFiles(queryClient, id)).resolves.toEqual([]);
    }

    queryClient.setQueryData(qk.sessions, [{ id: "combat", directory: "C:\\BloxBot" }]);
    await expect(chatRojoProjectFiles(queryClient, "combat")).resolves.toEqual([]);
  });

  it("keeps successful startup snapshots when another endpoint fails", async () => {
    const client = {
      experimental: {
        session: { list: vi.fn().mockRejectedValue(new Error("sessions unavailable")) },
      },
      session: {
        status: vi.fn().mockResolvedValue({ data: { s1: { type: "idle" } } }),
      },
      provider: {
        list: vi.fn().mockResolvedValue({
          data: { all: [], connected: [], default: {} },
        }),
        auth: vi.fn().mockRejectedValue(new Error("auth unavailable")),
      },
    } as unknown as OpencodeClient;
    const queryClient = makeQueryClient();

    await expect(prefetchServerState(client, queryClient)).resolves.toBeUndefined();

    expect(queryClient.getQueryData(qk.sessions)).toBeUndefined();
    expect(queryClient.getQueryData(qk.statuses)).toEqual({ s1: { type: "idle" } });
    expect(queryClient.getQueryData(qk.providers)).toEqual({
      all: [],
      connected: [],
      default: {},
    });
  });

  it("fails startup when every server-state endpoint is unavailable", async () => {
    const unavailable = vi.fn().mockRejectedValue(new Error("unavailable"));
    const client = {
      experimental: { session: { list: unavailable } },
      session: { status: unavailable },
      provider: { list: unavailable, auth: unavailable },
    } as unknown as OpencodeClient;

    await expect(prefetchServerState(client, makeQueryClient())).rejects.toThrow(
      "OpenCode server state is unavailable",
    );
  });

  it("invalidates the active root and descendant snapshots after SSE connects", async () => {
    const queryClient = makeQueryClient();
    const activeKeys = [
      qk.sessions,
      qk.statuses,
      qk.providers,
      qk.messages("s1"),
      qk.sessionContext("s1"),
      [...qk.sessionContext("s1"), "staged-undo"],
      qk.todos("s1"),
      qk.questions("s1"),
      qk.permissions("s1"),
      qk.messages("child"),
      qk.permissions("child"),
    ];
    for (const queryKey of activeKeys) queryClient.setQueryData(queryKey, {});
    queryClient.setQueryData<Session[]>(qk.sessions, [
      {
        id: "child",
        parentID: "s1",
        title: "Subagent",
        slug: "",
        projectID: "workspace",
        directory: "/workspace",
        time: { created: 1, updated: 1 },
        version: "",
      },
    ]);
    queryClient.setQueryData(qk.messages("s2"), {});

    await reconcileServerState(queryClient, "s1");

    for (const queryKey of activeKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(qk.messages("s2"))?.isInvalidated).toBe(false);
  });
});
