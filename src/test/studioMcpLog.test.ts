import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudioMcpLog, STUDIO_MCP_LOG_MAX_BYTES } from "../../electron/studioMcpLog";

describe("Studio MCP log", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "bloxbot-studio-log-"));
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true });
  });

  it("writes timed lines in order, to a folder it makes, and still reports to stderr", async () => {
    const file = join(folder, "logs", "studio-mcp.log");
    const log = createStudioMcpLog(file, () => new Date("2026-11-13T10:00:00Z"));
    log("helper closed");
    log("result list_roblox_studios 12ms error=false studios=0");
    await log.flushed();

    expect(await readFile(file, "utf8")).toBe(
      "2026-11-13T10:00:00.000Z helper closed\n" +
        "2026-11-13T10:00:00.000Z result list_roblox_studios 12ms error=false studios=0\n",
    );
    expect(process.stderr.write).toHaveBeenCalledWith("[studio-mcp] helper closed\n");
  });

  it("starts again once the file is full and keeps the one before", async () => {
    const file = join(folder, "studio-mcp.log");
    await writeFile(file, "x".repeat(STUDIO_MCP_LOG_MAX_BYTES - 10));
    const log = createStudioMcpLog(file, () => new Date("2026-11-13T10:00:00Z"));
    log("broker starting");
    await log.flushed();

    expect(await readFile(file, "utf8")).toBe("2026-11-13T10:00:00.000Z broker starting\n");
    expect(await readFile(`${file}.old`, "utf8")).toHaveLength(STUDIO_MCP_LOG_MAX_BYTES - 10);
  });

  it("only reports to stderr without a file, and a file it can't write doesn't throw", async () => {
    createStudioMcpLog()("broker starting");
    const log = createStudioMcpLog(join(folder, "missing\0folder", "studio-mcp.log"));
    log("broker starting");
    await expect(log.flushed()).resolves.toBeUndefined();
    expect(process.stderr.write).toHaveBeenCalledTimes(2);
  });
});
