import { type ChildProcessByStdio, execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readdir, readFile, realpath, rmdir, stat } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { ROJO_HOST, rojoManifestKey, type RojoServer } from "../../src/types/rojo";
import { loadShellPath } from "../shellEnv";

const STARTUP_MS = 30_000;
const COMMAND_MS = 3_000;
const OUTPUT_CHARS = 12_000;
const WINDOWS = process.platform === "win32";
const SYSTEM32 = WINDOWS ? join(process.env.SystemRoot ?? "C:\\Windows", "System32") : "";
const ROJO = WINDOWS ? "rojo.exe" : "rojo";

export function isRojoManifestPath(file: string) {
  return isAbsolute(file) && /\.project\.jsonc?$/i.test(file);
}

function servePort(contents: string): number | undefined {
  // Rojo also accepts comments and trailing commas. Keep quoted content intact.
  const strings = /"(?:\\[\s\S]|[^"\\])*"/.source;
  const json = contents
    .replace(/^\uFEFF/, "")
    .replace(
      new RegExp(`(${strings})|//[^\\r\\n]*|/\\*[\\s\\S]*?\\*/`, "g"),
      (_match, quoted) => quoted ?? " ",
    )
    .replace(new RegExp(`(${strings})|,(?=\\s*[}\\]])`, "g"), "$1");
  // Let the CLI report invalid projects with its own source location and logs.
  try {
    const port: unknown = JSON.parse(json)?.servePort;
    return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

function within(directory: string, file: string) {
  const path = relative(directory, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function executableAt(file: string, projectDirs: string[]) {
  if (projectDirs.some((directory) => within(directory, file))) return null;
  const target = await realpath(file).catch(() => null);
  if (!target || projectDirs.some((directory) => within(directory, target))) return null;
  try {
    if (!(await stat(target)).isFile()) return null;
    await access(target, constants.X_OK);
    return target;
  } catch {
    return null;
  }
}

async function pinnedRokitRojo(projectId: string, projectFile: string) {
  if (!isAbsolute(projectId)) return undefined;
  for (let directory = dirname(projectFile); within(projectId, directory); ) {
    const toml = await readFile(join(directory, "rokit.toml"), "utf8").catch(() => "");
    const tools = /^\s*\[tools\][^\n]*\n([\s\S]*?)(?=^[ \t]*\[|(?![\s\S]))/m.exec(toml);
    const version = /^\s*rojo\s*=\s*["']rojo-rbx\/rojo@(\d+\.\d+\.\d+(?:-[a-z\d.-]+)?)["']\s*(?:#.*)?$/im.exec(
      tools?.[1] ?? "",
    )?.[1];
    if (version) return version;
    const parent = dirname(directory);
    if (directory === parent) break;
    directory = parent;
  }
}

async function findRojo(projectId: string, projectFile: string) {
  const projectDirs = [dirname(projectFile)];
  if (isAbsolute(projectId)) projectDirs.push(projectId);
  const canonicalDirs = await Promise.all(projectDirs.map((dir) => realpath(dir).catch(() => dir)));
  const canonicalProject = await realpath(projectFile).catch(() => projectFile);
  projectDirs.push(...canonicalDirs, dirname(canonicalProject));
  const shellPath = (await loadShellPath()) ?? process.env.PATH ?? "";
  const directories = shellPath.split(delimiter).filter(isAbsolute);
  const rokitRoot = process.env.ROKIT_ROOT || join(homedir(), ".rokit");
  const rokitBin = isAbsolute(rokitRoot) ? join(rokitRoot, "bin") : null;
  const canonicalRokitBin = rokitBin && (await realpath(rokitBin).catch(() => rokitBin));
  const safePath: string[] = [];
  let executable: string | null = null;
  for (const directory of directories) {
    const canonical = await realpath(directory).catch(() => null);
    if (!canonical || projectDirs.some((dir) => within(dir, directory) || within(dir, canonical))) {
      continue;
    }
    safePath.push(canonical);
    // Rokit's aliases may resolve from a project manifest. Use its official installed binary.
    if (canonicalRokitBin && within(canonicalRokitBin, canonical)) continue;
    executable ??= await executableAt(join(canonical, ROJO), [
      ...projectDirs,
      ...(canonicalRokitBin ? [canonicalRokitBin] : []),
    ]);
  }
  const pinned = await pinnedRokitRojo(projectId, projectFile);
  if ((executable === null || pinned) && isAbsolute(rokitRoot)) {
    const canonicalRoot = await realpath(rokitRoot).catch(() => rokitRoot);
    const cache = join(canonicalRoot, "tool-storage", "rojo-rbx", "rojo");
    const canonical = await realpath(cache).catch(() => null);
    if (canonical && relative(cache, canonical) === "") {
      const versions = await readdir(canonical, { withFileTypes: true }).catch(() => []);
      const candidates = pinned
        ? [pinned]
        : versions
            .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
            .sort((a, b) => b.name.localeCompare(a.name, "en", { numeric: true }))
            .map(({ name }) => name);
      for (const version of candidates) {
        const target = await executableAt(join(canonical, version, ROJO), projectDirs);
        if (target && within(canonical, target)) {
          executable = target;
          break;
        }
      }
    }
  }
  if (
    pinned &&
    (!executable ||
      (await command(executable, ["--version"]).catch(() => "")).trim() !== `Rojo ${pinned}`)
  ) {
    throw new Error(`This project pins Rojo ${pinned}. Install the pinned version using Rokit.`);
  }
  if (!executable) {
    throw new Error("Rojo was not found on PATH or in Rokit’s installed stable Rojo versions.");
  }
  return { executable, searchPath: safePath.join(delimiter) };
}

function command(file: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: COMMAND_MS, windowsHide: true, signal }, (error, output) => {
      if (error) reject(error);
      else resolve(output);
    });
  });
}

async function listenerPids(port: number, signal: AbortSignal) {
  const endpoint = `${ROJO_HOST}:${port}`;
  if (WINDOWS) {
    const table = await command(join(SYSTEM32, "netstat.exe"), ["-ano", "-p", "TCP"], signal);
    return table.split(/\r?\n/).flatMap((line) => {
      const [protocol, local, peer, , pid] = line.trim().split(/\s+/);
      return protocol === "TCP" && local === endpoint && peer === "0.0.0.0:0" && /^\d+$/.test(pid)
        ? [Number(pid)]
        : [];
    });
  }
  if (process.platform === "linux") {
    for (const ss of ["/usr/bin/ss", "/usr/sbin/ss", "/bin/ss"]) {
      const table = await command(ss, ["-Hltnp", `sport = :${port}`], signal).catch(() => null);
      if (table !== null) {
        return table
          .split("\n")
          .flatMap((line) =>
            line.trim().split(/\s+/)[3] === endpoint
              ? [...line.matchAll(/\bpid=(\d+)/g)].map((match) => Number(match[1]))
              : [],
          );
      }
      signal.throwIfAborted();
    }
  }
  for (const lsof of ["/usr/sbin/lsof", "/usr/bin/lsof"]) {
    try {
      const table = await command(
        lsof,
        ["-nP", `-iTCP@${endpoint}`, "-sTCP:LISTEN", "-Fpn"],
        signal,
      );
      let pid = 0;
      const pids = [];
      for (const line of table.split("\n")) {
        if (line.startsWith("p")) pid = Number(line.slice(1));
        if (pid > 0 && line === `n${endpoint}`) pids.push(pid);
      }
      return pids;
    } catch (error) {
      signal.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return [];
    }
  }
  throw new Error(
    "Rojo’s listening process could not be verified. A system socket utility is required.",
  );
}

async function isChildOf(pid: number, ancestor: number, signal: AbortSignal) {
  if (pid === ancestor) return true;
  if (WINDOWS) {
    const powershell = join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
    // The command only receives integer PIDs read from the OS. Inspect parent links in one run.
    const script = `$p = ${pid}; while ($p -gt 0) { if ($p -eq ${ancestor}) { 'yes'; break }; $p = (Get-CimInstance Win32_Process -Filter "ProcessId=$p").ParentProcessId }`;
    return (
      (
        await command(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], signal)
      ).trim() === "yes"
    );
  }
  // Rokit and other shims launch a child in the detached process group we created.
  const group = await command("/bin/ps", ["-o", "pgid=", "-p", String(pid)], signal);
  return Number(group.trim()) === ancestor;
}

function isRojoReady(port: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(
      {
        hostname: ROJO_HOST,
        port,
        path: "/api/rojo",
        agent: false,
        signal: AbortSignal.any([signal, AbortSignal.timeout(750)]),
      },
      (response) => {
        const type = response.headers["content-type"] ?? "";
        // Rojo 7.7 switched the handshake from JSON to MessagePack.
        resolve(response.statusCode === 200 && /^application\/(json|msgpack)(?:;|$)/.test(type));
        response.destroy();
      },
    );
    request.on("error", () => resolve(false));
  });
}

type RojoChild = ChildProcessByStdio<null, Readable, Readable>;

interface Run {
  state: RojoServer;
  cancel: AbortController;
  starting?: Promise<RojoServer>;
  stopping?: Promise<RojoServer>;
  cwd?: string;
  port?: number;
  child?: RojoChild;
  closed?: Promise<void>;
  didClose?: boolean;
  cleanup?: Promise<void>;
}

function hasExited(child: RojoChild) {
  return child.exitCode !== null || child.signalCode !== null;
}

function stopGroup(child: RojoChild, signal: NodeJS.Signals) {
  if (child.pid === undefined) return;
  try {
    if (WINDOWS) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// The selected file supplies its own base path. A private cwd keeps a launcher shim from
// discovering project-controlled tools in its working directory.
export class RojoServers {
  private readonly runs = new Map<string, Run>();
  private readonly ports = new Set<number>();
  private shuttingDown = false;

  list(): RojoServer[] {
    return [...this.runs.values()].map(({ state }) => ({ ...state }));
  }

  start(projectId: string, projectFile: string): Promise<RojoServer> {
    const key = rojoManifestKey(projectId, projectFile);
    const existing = this.runs.get(key);
    const state: RojoServer = {
      projectId,
      projectFile,
      status: "starting",
      port: null,
      error: null,
      output: "",
    };
    if (this.shuttingDown) {
      return Promise.resolve({ ...state, status: "error", error: "BloxBot is shutting down." });
    }
    if (existing?.stopping) return existing.stopping;
    if (existing?.starting) return existing.starting;
    if (existing?.state.needsStop) {
      return this.stop(projectId, projectFile).then((stopped) =>
        stopped?.needsStop ? stopped : this.start(projectId, projectFile),
      );
    }
    if (existing?.child && !existing.didClose) return Promise.resolve({ ...existing.state });

    const run: Run = { state, cancel: new AbortController() };
    this.runs.set(key, run);
    run.starting = this.launch(run).finally(() => {
      run.starting = undefined;
    });
    return run.starting;
  }

  stop(projectId: string, projectFile: string): Promise<RojoServer | null> {
    const run = this.runs.get(rojoManifestKey(projectId, projectFile));
    if (!run) return Promise.resolve(null);
    if (run.stopping) return run.stopping;
    run.state.status = "stopping";
    run.cancel.abort();
    run.stopping = this.finishStop(run).finally(() => {
      run.stopping = undefined;
    });
    return run.stopping;
  }

  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    const results = await Promise.all(
      this.list().map(({ projectId, projectFile }) => this.stop(projectId, projectFile)),
    );
    const failed = results.filter((result) => result?.needsStop);
    if (failed.length) throw new Error(`Could not stop ${failed.length} Rojo server(s).`);
  }

  private async reservePort(preferred?: number) {
    const portBusy = () =>
      new Error(
        `Port ${preferred} is already in use. Stop the server using it before starting this project file.`,
      );
    for (let attempt = 0; attempt < 5; attempt++) {
      if (preferred && this.ports.has(preferred)) throw portBusy();
      const server = createServer();
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: ROJO_HOST, port: preferred ?? 0, exclusive: true }, () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      }).catch((error: NodeJS.ErrnoException) => {
        if (preferred && error.code === "EADDRINUSE") throw portBusy();
        throw error;
      });
      const available = port > 0 && !this.ports.has(port);
      if (available) this.ports.add(port);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (available) return port;
      if (preferred) throw portBusy();
    }
    throw new Error("Could not reserve a local port for Rojo. Try starting it again.");
  }

  private async launch(run: Run): Promise<RojoServer> {
    const { state, cancel } = run;
    try {
      const project = state.projectFile;
      if (!isRojoManifestPath(project)) {
        throw new Error("Choose a Rojo .project.json file.");
      }
      if (!(await stat(project).catch(() => null))?.isFile()) {
        throw new Error("The selected Rojo project file is missing or cannot be read.");
      }
      cancel.signal.throwIfAborted();
      const preferred = servePort(await readFile(project, "utf8"));
      const { executable, searchPath } = await findRojo(state.projectId, project);
      cancel.signal.throwIfAborted();
      run.cwd = await mkdtemp(join(tmpdir(), "bloxbot-rojo-"));
      cancel.signal.throwIfAborted();
      const port = await this.reservePort(preferred);
      run.port = port;
      cancel.signal.throwIfAborted();
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.toUpperCase() === "PATH") delete env[key];
      }
      env.PATH = searchPath;
      const child = spawn(
        executable,
        ["serve", "--color", "never", "--address", ROJO_HOST, "--port", String(port), project],
        {
          cwd: run.cwd,
          env,
          detached: !WINDOWS,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      run.child = child;
      const exited = new AbortController();
      const onExit = (message: string) => {
        exited.abort(new Error(message));
        if (state.status === "running") {
          state.status = "error";
          state.port = null;
          state.error = message;
        }
      };
      child.on("error", (error) => onExit(`Could not run Rojo. ${error.message}`));
      child.once("exit", (code, signal) =>
        onExit(`Rojo exited (${signal ?? code ?? "unknown status"}).`),
      );
      run.closed = new Promise((resolve) => {
        child.once("close", () => {
          run.didClose = true;
          resolve();
          if (state.status === "error" && !run.starting && !run.stopping) {
            void this.cleanup(run).catch(() => undefined);
          }
        });
      });
      let announced = false;
      let stdout = "";
      const banner = new RegExp(
        `^Rojo server listening:\\r?\\n[ \\t]*Address:[ \\t]*(?:localhost|127\\.0\\.0\\.1)\\r?\\n[ \\t]*Port:[ \\t]*${port}\\r?\\n`,
        "m",
      );
      const append = (chunk: string) => {
        state.output = (state.output + chunk).slice(-OUTPUT_CHARS);
      };
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        append(chunk);
        if (!announced) {
          stdout = (stdout + chunk).slice(-OUTPUT_CHARS);
          announced = banner.test(stdout);
        }
      });
      child.stderr.setEncoding("utf8").on("data", append);

      const timeout = AbortSignal.timeout(STARTUP_MS);
      const signal = AbortSignal.any([cancel.signal, exited.signal, timeout]);
      while (true) {
        signal.throwIfAborted();
        if (announced && child.pid !== undefined) {
          const pids = await listenerPids(port, signal);
          if (
            pids.length === 1 &&
            (await isChildOf(pids[0], child.pid, signal)) &&
            (await isRojoReady(port, signal))
          ) {
            signal.throwIfAborted();
            state.status = "running";
            state.port = port;
            return { ...state };
          }
        }
        await delay(150, undefined, { signal });
      }
    } catch (error) {
      if (!cancel.signal.aborted) {
        state.status = "error";
        const reason =
          error instanceof Error && "cause" in error && error.cause instanceof Error
            ? error.cause
            : error;
        const message = reason instanceof Error ? reason.message : String(reason);
        state.error =
          reason instanceof Error && reason.name === "TimeoutError"
            ? "Rojo did not start listening within 30 seconds. Check its output and try again."
            : message;
        await this.cleanup(run).catch((failure: Error) => {
          state.needsStop = true;
          state.error += ` ${failure.message}`;
        });
      }
      return { ...state };
    }
  }

  private async finishStop(run: Run): Promise<RojoServer> {
    await run.starting;
    try {
      await this.cleanup(run);
      run.state.status = "stopped";
      run.state.error = null;
    } catch (error) {
      run.state.status = "error";
      run.state.error = error instanceof Error ? error.message : String(error);
      run.state.needsStop = true;
    }
    run.state.port = null;
    return { ...run.state };
  }

  private cleanup(run: Run): Promise<void> {
    run.cleanup ??= this.dispose(run).finally(() => {
      run.cleanup = undefined;
    });
    return run.cleanup;
  }

  private async dispose(run: Run) {
    const { child, closed } = run;
    if (child && !run.didClose) {
      if (WINDOWS && child.pid !== undefined && !hasExited(child)) {
        await command(join(SYSTEM32, "taskkill.exe"), [
          "/T",
          "/F",
          "/PID",
          String(child.pid),
        ]).catch(() => stopGroup(child, "SIGKILL"));
      } else if (!WINDOWS || !hasExited(child)) {
        stopGroup(child, "SIGTERM");
      }
      await Promise.race([closed, delay(1_000, undefined, { ref: false })]);
      if (!run.didClose) {
        stopGroup(child, "SIGKILL");
        await Promise.race([closed, delay(1_000, undefined, { ref: false })]);
      }
      if (!run.didClose) throw new Error("Rojo did not stop. Try stopping it again.");
    }
    run.child = undefined;
    delete run.state.needsStop;
    if (run.port !== undefined) {
      this.ports.delete(run.port);
      run.port = undefined;
    }
    if (run.cwd) {
      await rmdir(run.cwd).catch(() => undefined);
      run.cwd = undefined;
    }
  }
}
