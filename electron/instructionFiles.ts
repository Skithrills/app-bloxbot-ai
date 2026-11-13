import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

/** Displays a home-relative path consistently across platforms. */
export function displayPath(path: string, home: string): string {
  const relative =
    path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
  return sep === "\\" ? relative.replaceAll("\\", "/") : relative;
}

/** What the user wrote in Settings, which is the file OpenCode loads. */
export async function readInstructions(globalConfigDirectory: string): Promise<string> {
  return readFile(join(globalConfigDirectory, "AGENTS.md"), "utf8").catch((error) => {
    // Anything else must not look empty, or saving would replace what's there.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
}

export async function saveInstructions(globalConfigDirectory: string, text: string): Promise<void> {
  const path = join(globalConfigDirectory, "AGENTS.md");
  if (!text.trim()) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(globalConfigDirectory, { recursive: true });
  // Replaced in one step, so a write that fails partway leaves the old instructions alone.
  const draft = `${path}.saving`;
  try {
    await writeFile(draft, text);
    await rename(draft, path);
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
}
