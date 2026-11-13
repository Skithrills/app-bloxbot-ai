import { lineDiff, patchLineCounts } from "@/lib/lineDiff";
import type { MessageWithParts } from "@/types";

/** What a turn did to one file, from the edits the model made to it. */
export interface FileChange {
  file: string;
  added: number;
  removed: number;
  /** Each edit's lines in the order they were made: "-" taken out, "+" put in, " " unchanged. */
  diffs: string[];
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A patch can touch several files. Each gets the lines under its own header. */
function patchFiles(patch: string): Array<{ file: string; diff: string }> {
  const files: Array<{ file: string; lines: string[] }> = [];
  for (const line of patch.split("\n")) {
    const header = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) files.push({ file: header[1].trim(), lines: [] });
    else if (!line.startsWith("*** ")) files[files.length - 1]?.lines.push(line);
  }
  return files.map(({ file, lines }) => ({ file, diff: lines.join("\n").replace(/\n+$/, "") }));
}

/**
 * The files a turn's finished edits changed, in the order they were first touched. It reads what
 * the model asked for, so it covers the edit, write and patch tools and not what a shell command
 * or a subagent changed.
 */
export function fileChangesIn(messages: readonly MessageWithParts[]): FileChange[] {
  const changes = new Map<string, FileChange>();
  const record = (file: string, diff: string, added: number, removed: number) => {
    if (!file || added + removed === 0) return;
    // The same file can be named with either slash on Windows.
    const key = file.replace(/\\/g, "/");
    const change = changes.get(key) ?? { file: key, added: 0, removed: 0, diffs: [] };
    change.added += added;
    change.removed += removed;
    change.diffs.push(diff);
    changes.set(key, change);
  };
  for (const { info, parts } of messages) {
    if (info.role !== "assistant") continue;
    for (const part of parts) {
      if (part.type !== "tool" || part.state.status !== "completed") continue;
      const input: Record<string, unknown> = part.state.input ?? {};
      const tool = part.tool.replace(/^mcp_[^_]+_/, "");
      if (tool === "edit") {
        const diff = lineDiff(text(input.oldString), text(input.newString));
        record(text(input.filePath), diff.text, diff.added, diff.removed);
      } else if (tool === "write") {
        const lines = text(input.content).replace(/\n$/, "").split("\n");
        const written = text(input.content) ? lines : [];
        record(
          text(input.filePath),
          written.map((line) => `+${line}`).join("\n"),
          written.length,
          0,
        );
      } else if (tool === "patch") {
        for (const { file, diff } of patchFiles(text(input.patchText))) {
          const { added, removed } = patchLineCounts(diff);
          record(file, diff, added, removed);
        }
      }
    }
  }
  return [...changes.values()];
}

/** A file's folder and name, with the folder given from the chat's own folder when it's inside. */
export function splitFilePath(file: string, directory?: string): { folder: string; name: string } {
  const path = file.replace(/\\/g, "/");
  const root = directory?.replace(/\\/g, "/").replace(/\/+$/, "");
  const inside = root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`);
  const shown = inside ? path.slice(root.length + 1) : path;
  const cut = shown.lastIndexOf("/") + 1;
  return { folder: shown.slice(0, cut), name: shown.slice(cut) };
}
