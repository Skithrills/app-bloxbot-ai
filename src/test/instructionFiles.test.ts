import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readInstructions, saveInstructions } from "../../electron/instructionFiles";

let root: string;

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("saved instructions", () => {
  it("says when the file can't be read, rather than showing it as empty", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
    // A folder where the file should be fails to read with something other than "not found".
    await mkdir(join(root, "AGENTS.md"));
    await expect(readInstructions(root)).rejects.toThrow();
  });

  it("creates the folder, reads back what was saved, and removes the file when emptied", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
    const folder = join(root, "config", "opencode");

    await expect(readInstructions(folder)).resolves.toBe("");
    await saveInstructions(folder, "Name folders clearly.");
    await expect(readInstructions(folder)).resolves.toBe("Name folders clearly.");
    await expect(readdir(folder)).resolves.toEqual(["AGENTS.md"]);

    await saveInstructions(folder, "   ");
    await expect(readInstructions(folder)).resolves.toBe("");
    await expect(readdir(folder)).resolves.toEqual([]);
  });

  it("keeps what's there when a save fails partway", async () => {
    root = await mkdtemp(join(tmpdir(), "bloxbot-instructions-"));
    await saveInstructions(root, "Keep me.");
    // A folder in the way makes the write to the temporary file fail.
    await mkdir(join(root, "AGENTS.md.saving"));

    await expect(saveInstructions(root, "Replacement")).rejects.toThrow();
    await expect(readInstructions(root)).resolves.toBe("Keep me.");
  });
});
