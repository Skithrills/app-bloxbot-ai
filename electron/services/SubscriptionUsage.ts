import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { OPENAI_ENGINE_OAUTH_PROVIDER } from "../../src/lib/openAiProfiles";
import type { OpenCodeInfo } from "../../src/types/desktop";
import type {
  SubscriptionProvider,
  SubscriptionUsageResult,
  SubscriptionWindow,
} from "../../src/types/subscriptionUsage";
import { loadShellPath } from "../shellEnv";
import { chatGptWindows, claudeWindows, codexWindows, record } from "./subscriptionWindows";

const CLAUDE_INTEGRATION = "claude-agent";
const PROBE_TIMEOUT_MS = 25_000;
const PROBE_OUTPUT_BYTES = 512 * 1024;
const ENGINE_TIMEOUT_MS = 8_000;
type UsageFetch = (url: string, init: RequestInit) => Promise<Response>;

const unavailable = { status: "unavailable" } as const;
const unsupported = { status: "unsupported" } as const;
const missing = { status: "cli_missing" } as const;
const disconnected = { status: "disconnected" } as const;

function checked(windows: SubscriptionWindow[]): SubscriptionUsageResult {
  return windows.length ? { status: "available", checkedAt: Date.now(), windows } : unavailable;
}

async function findExecutable(command: string, searchPath: string | undefined) {
  const name = process.platform === "win32" && !/\.exe$/i.test(command) ? `${command}.exe` : command;
  const candidates = isAbsolute(name)
    ? [name]
    : (searchPath ?? "")
        .split(delimiter)
        .filter(isAbsolute)
        .map((directory) => join(directory, name));
  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // A PATH entry can disappear when the user updates or removes a CLI.
    }
  }
}

type UsageProtocol = {
  start(send: (message: object) => void): void;
  read(
    message: Record<string, unknown>,
    send: (message: object) => void,
  ): SubscriptionUsageResult | undefined;
};

function probeCli(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  protocol: UsageProtocol,
): Promise<SubscriptionUsageResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let result: SubscriptionUsageResult | undefined;
    let bytes = 0;
    const finish = (value: SubscriptionUsageResult) => {
      if (result) return;
      result = value;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => finish(unavailable), PROBE_TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ENOENT" ? missing : unavailable),
    );
    child.stdin.on("error", () => finish(unavailable));
    child.stdout.on("error", () => finish(unavailable));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > PROBE_OUTPUT_BYTES) finish(unavailable);
    });
    const lines = createInterface({ input: child.stdout });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    lines.on("line", (line) => {
      if (result) return;
      try {
        const message = record(JSON.parse(line));
        const reply = message && protocol.read(message, send);
        if (reply) finish(reply);
      } catch {
        // Treat malformed provider output as unavailable without exposing subprocess text.
        finish(unavailable);
      }
    });
    child.once("close", () => {
      clearTimeout(timer);
      lines.close();
      resolve(result ?? unavailable);
    });
    protocol.start(send);
  });
}

export function codexProtocol(version: string): UsageProtocol {
  return {
    start(send) {
      send({
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "bloxbot", title: "BloxBot", version } },
      });
    },
    read(message, send) {
      switch (message.id) {
        case 1:
          if (!record(message.result)) return unsupported;
          send({ method: "initialized", params: {} });
          send({ method: "account/read", id: 2, params: { refreshToken: false } });
          return;
        case 2: {
          const reply = record(message.result);
          if (!reply) return unavailable;
          if (reply.account === null) return disconnected;
          if (record(reply.account)?.type !== "chatgpt") return unsupported;
          send({ method: "account/rateLimits/read", id: 3 });
          return;
        }
        case 3:
          return checked(codexWindows(message.result));
      }
    },
  };
}

export const claudeProtocol: UsageProtocol = {
  start(send) {
    send({ type: "control_request", request_id: "init", request: { subtype: "initialize" } });
  },
  read(message, send) {
    if (message.type !== "control_response") return;
    const response = record(message.response);
    if (response?.request_id === "init") {
      if (response.subtype !== "success") return unavailable;
      // Claude Code's experimental read used by the Agent SDK. No user message is sent.
      send({
        type: "control_request",
        request_id: "usage",
        request: { subtype: "get_usage", skip_behaviors: true },
      });
      return;
    }
    if (response?.request_id === "usage") {
      if (response.subtype !== "success") return unsupported;
      if (record(response.response)?.rate_limits_available === false) return unsupported;
      return checked(claudeWindows(response.response));
    }
  },
};

const claudeArgs = [
  "--print",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--settings",
  JSON.stringify({ disableAllHooks: true }),
  "--tools",
  "",
];

/** Keep OAuth tokens in the main process and send them only to the ChatGPT usage endpoint. */
export async function fetchChatGptUsage(
  credential: {
    methodID: string;
    access: string;
    expires: number;
    metadata?: Record<string, unknown>;
  },
  fetchUsage: UsageFetch,
): Promise<SubscriptionUsageResult> {
  // Sign in with ChatGPT grants inference through the Responses API, not access
  // to Codex's account quota endpoint. Keep that sign-in available for chats.
  if (credential.methodID === "chatgpt-token-sharing") return { status: "usage_not_shared" };
  if (!credential.access) return disconnected;
  if (credential.expires <= Date.now()) return { status: "session_expired" };
  const accountId = credential.metadata?.accountID;
  try {
    const response = await fetchUsage("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credential.access}`,
        ...(typeof accountId === "string" && accountId ? { "ChatGPT-Account-Id": accountId } : {}),
      },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    if (response.status === 401) return { status: "session_expired" };
    if (response.status === 403) return { status: "usage_not_shared" };
    if (!response.ok) return unavailable;
    return checked(chatGptWindows(await response.json()));
  } catch {
    return unavailable;
  }
}

/** Read connected accounts through their active integration, or the explicitly selected CLI account. */
export function createSubscriptionUsageReader(
  getEngine: () => Promise<OpenCodeInfo>,
  fetchUsage: UsageFetch,
  clientVersion = "0.0.0",
) {
  async function readInstalledCodex(): Promise<SubscriptionUsageResult> {
    const path = (await loadShellPath()) || process.env.PATH;
    const executable = await findExecutable("codex", path);
    if (!executable) return missing;
    // Keep the CLI's configured profile and let it load its own existing account.
    return probeCli(
      executable,
      ["app-server"],
      tmpdir(),
      {
        ...process.env,
        PATH: path,
        CODEX_ACCESS_TOKEN: undefined,
        CODEX_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
        RUST_LOG: "off",
      },
      codexProtocol(clientVersion),
    );
  }

  async function readClaude(workspace: string): Promise<SubscriptionUsageResult> {
    const shellPath = await loadShellPath();
    const path = shellPath || process.env.PATH;
    const executable = await findExecutable(process.env.OPENCODE_CLAUDE_PATH || "claude", path);
    if (!executable) return missing;
    return probeCli(
      executable,
      claudeArgs,
      workspace,
      {
        ...process.env,
        PATH: path,
        CLAUDE_CODE_SIMPLE: undefined,
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
        CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      claudeProtocol,
    );
  }

  async function readChatGpt(api: OpenCodeClient, credentialId: string): Promise<SubscriptionUsageResult> {
    const entries = await api.credential.list({ signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
    const credential = entries.find(
      (entry) =>
        entry.id === credentialId && entry.integrationID === OPENAI_ENGINE_OAUTH_PROVIDER && entry.active,
    )?.value;
    if (credential?.type !== "oauth") return disconnected;
    return fetchChatGptUsage(credential, fetchUsage);
  }

  const pending = new Map<string, Promise<SubscriptionUsageResult>>();
  function share(key: string, read: () => Promise<SubscriptionUsageResult>) {
    const current = pending.get(key);
    if (current) return current;
    const request = read().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  async function read(provider: SubscriptionProvider): Promise<SubscriptionUsageResult> {
    if (provider === "codex-cli") return share(provider, readInstalledCodex);
    const engine = await getEngine();
    const api = OpenCode.make({
      baseUrl: `http://127.0.0.1:${engine.port}`,
      headers: { Authorization: engine.authorization },
    });
    const location = { directory: engine.workspace };
    const integrationID = provider === "codex" ? OPENAI_ENGINE_OAUTH_PROVIDER : CLAUDE_INTEGRATION;
    const method = provider === "codex" ? "oauth" : "external";
    const activeCredential = async () => {
      const { data } = await api.integration.get(
        { integrationID, location },
        { signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) },
      );
      const connection = data.connections.find(
        (entry) => entry.type === "credential" && entry.method === method && !entry.status,
      );
      return connection?.type === "credential" ? connection.id : undefined;
    };
    const credentialId = await activeCredential();
    if (!credentialId) return disconnected;

    const key = JSON.stringify([engine.port, provider, credentialId]);
    return share(key, async () => {
      const result = provider === "codex"
        ? await readChatGpt(api, credentialId)
        : await readClaude(engine.workspace);
      return result.status === "available" && (await activeCredential()) !== credentialId
        ? disconnected
        : result;
    });
  }

  // Provider/engine errors may contain request information. Only return these app-owned states.
  return (provider: SubscriptionProvider) => read(provider).catch(() => unavailable);
}
