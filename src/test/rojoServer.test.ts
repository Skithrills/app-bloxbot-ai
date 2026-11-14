import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RojoServers } from "../../electron/services/Rojo";
import { ROJO_HOST, rojoProjectFilesFor } from "../types/rojo";

vi.mock("../../electron/shellEnv", () => ({ loadShellPath: async () => null }));

describe("RojoServers", () => {
  let directory: string;
  let servers: RojoServers;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bloxbot-rojo-test-"));
    servers = new RojoServers();
  });

  afterEach(async () => {
    await servers.stopAll();
    vi.unstubAllEnvs();
    // Every fixture creates its own verified child of the OS temp directory.
    if (join(directory, "..") === tmpdir()) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  const project = async (name: string, servePort?: number) => {
    const file = join(directory, `${name}.project.json`);
    await writeFile(
      file,
      `{ // Rojo accepts comments and trailing commas
        "name": ${JSON.stringify(`${name} // preview`)},
        "serveAddress": "0.0.0.0",
        ${servePort ? `"servePort": ${servePort},` : ""}
        "tree": { "$className": "Folder" },
      }`,
    );
    return file;
  };

  it("reads a legacy single manifest and respects an explicitly cleared folder", () => {
    const legacy = { rojoProjectFiles: { game: "default.project.json" } };
    expect(rojoProjectFilesFor(legacy, "game")).toEqual(["default.project.json"]);
    expect(rojoProjectFilesFor({ ...legacy, rojoManifests: { game: [] } }, "game")).toEqual([]);
  });

  it("rejects relative, missing and directory project paths and preserves feedback", async () => {
    const missing = join(directory, "missing.project.json");
    expect(await servers.start("a", "default.project.json")).toMatchObject({
      status: "error",
      error: expect.stringContaining("Choose a Rojo"),
      port: null,
    });
    expect(await servers.start("a", missing)).toMatchObject({
      status: "error",
      error: expect.stringContaining("missing"),
      port: null,
    });
    const folder = join(directory, "fake.project.json");
    await mkdir(folder);
    expect(await servers.start("a", folder)).toMatchObject({
      status: "error",
      error: expect.stringContaining("missing"),
    });
    expect(servers.list()).toHaveLength(3);
    expect(servers.list()).toContainEqual(
      expect.objectContaining({ projectId: "a", projectFile: folder, status: "error" }),
    );
  });

  it("ignores relative and project-local PATH entries and reports a missing installation", async () => {
    const file = await project("test");
    const bin = join(directory, "bin");
    await mkdir(bin);
    await writeFile(join(bin, process.platform === "win32" ? "rojo.exe" : "rojo"), "fake", {
      mode: 0o755,
    });
    vi.stubEnv("PATH", ["bin", bin].join(process.platform === "win32" ? ";" : ":"));
    vi.stubEnv("ROKIT_ROOT", join(directory, "empty-rokit"));
    expect(await servers.start(directory, file)).toMatchObject({
      status: "error",
      error: expect.stringContaining("Rojo was not found"),
      port: null,
    });
  });

  it("finds an exact Rokit pin from the enclosing project folder", async () => {
    const place = join(directory, "Combat Framework", "Staging");
    await mkdir(place, { recursive: true });
    const file = join(place, "default.project.json");
    await writeFile(file, '{"tree":{"$className":"DataModel"}}');
    await writeFile(
      join(directory, "rokit.toml"),
      '[tools]\r\nstylua = "JohnnyMorganz/StyLua@2.0.0"\r\nrojo = "rojo-rbx/rojo@7.42.0"\r\n',
    );
    vi.stubEnv("PATH", "");
    vi.stubEnv("ROKIT_ROOT", join(directory, "empty-rokit"));
    expect(await servers.start(directory, file)).toMatchObject({
      status: "error",
      error: expect.stringContaining("pins Rojo 7.42.0"),
    });
  });

  it("shares duplicate starts and cancels pending launches on shutdown", async () => {
    const file = await project("test");
    const first = servers.start("a", file);
    expect(servers.start("a", file)).toBe(first);
    await Promise.all([first, servers.stopAll()]);
    expect(servers.list()).toMatchObject([{ projectId: "a", status: "stopped", port: null }]);
    expect(await servers.start("b", file)).toMatchObject({ status: "error" });
    expect(servers.list()).toHaveLength(1);
  });

  // Uses the actual PATH/cached installation and OS listener ownership checks.
  it.runIf(process.env.BLOXBOT_ROJO_LIVE === "1")(
    "serves two manifests under one folder, keeps configured ports and rejects a conflicting manifest",
    async () => {
      const holder = createServer();
      const port = await new Promise<number>((resolve) => {
        holder.listen(0, ROJO_HOST, () => {
          const address = holder.address();
          if (address && typeof address !== "string") resolve(address.port);
        });
      });
      await new Promise<void>((resolve) => holder.close(() => resolve()));
      const [fileA, fileB, conflict] = await Promise.all([
        project("first place", port),
        project("second place"),
        project("alternate", port),
      ]);
      const [a, b] = await Promise.all([
        servers.start(directory, fileA),
        servers.start(directory, fileB),
      ]);
      expect(a).toMatchObject({ status: "running", port: expect.any(Number), error: null });
      expect(b).toMatchObject({ status: "running", port: expect.any(Number), error: null });
      expect(a.port).not.toBe(b.port);
      expect(a.port).toBe(port);
      expect(await servers.start(directory, conflict)).toMatchObject({
        status: "error",
        error: expect.stringContaining(`Port ${port} is already in use`),
      });
      const urlA = `http://${ROJO_HOST}:${a.port}`;
      const urlB = `http://${ROJO_HOST}:${b.port}`;
      const firstPage = await (await fetch(urlA)).text();
      expect(firstPage).toContain("first place");
      if (process.env.BLOXBOT_ROJO_EXPECT_VERSION) {
        expect(firstPage).toContain(process.env.BLOXBOT_ROJO_EXPECT_VERSION);
      }
      expect(await (await fetch(urlB)).text()).toContain("second place");

      expect(await servers.stop(directory, fileA)).toMatchObject({ status: "stopped", port: null });
      await expect(fetch(urlA, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
      expect((await fetch(urlB)).status).toBe(200);
      const restarted = await servers.start(directory, conflict);
      expect(restarted).toMatchObject({ status: "running", port, error: null });
      await servers.stopAll();
      await expect(fetch(urlB, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
      await expect(
        fetch(`http://${ROJO_HOST}:${restarted.port}`, { signal: AbortSignal.timeout(500) }),
      ).rejects.toThrow();
    },
    45_000,
  );
});
