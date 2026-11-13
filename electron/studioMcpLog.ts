import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

/** Past this the log starts again, and the one before is kept beside it as `.old`. */
export const STUDIO_MCP_LOG_MAX_BYTES = 1_000_000;

/**
 * Reports what Studio's helper and the broker are doing: to stderr as before, and to a file when
 * one is given, with the time, so a connection that dropped can be traced after the fact.
 */
export function createStudioMcpLog(file?: string, now: () => Date = () => new Date()) {
  let size: number | undefined;
  let writes: Promise<void> = Promise.resolve();
  const log = (message: string) => {
    process.stderr.write(`[studio-mcp] ${message}\n`);
    if (!file) return;
    const line = `${now().toISOString()} ${message}\n`;
    // One at a time, so lines land in the order they happened.
    writes = writes
      .then(async () => {
        if (size === undefined) {
          await mkdir(dirname(file), { recursive: true });
          size = await stat(file).then(
            (stats) => stats.size,
            () => 0,
          );
        }
        const bytes = Buffer.byteLength(line);
        if (size > 0 && size + bytes > STUDIO_MCP_LOG_MAX_BYTES) {
          await rename(file, `${file}.old`);
          size = 0;
        }
        await appendFile(file, line);
        size += bytes;
      })
      // A log that can't be written mustn't get in the way of Studio.
      .catch(() => undefined);
  };
  /** Resolves once everything reported so far is on disk. */
  log.flushed = () => writes;
  return log;
}
