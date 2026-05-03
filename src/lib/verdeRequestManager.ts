import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────

export interface VerdeScriptRequest {
  type: "read_script" | "write_script";
  requestId: string;
  path: string;
  source?: string;
}

export interface VerdeScriptContentResponse {
  type: "script_content";
  requestId: string;
  success: boolean;
  source?: string;
  path?: string;
  error?: string;
}

export interface VerdeScriptWrittenResponse {
  type: "script_written";
  requestId: string;
  success: boolean;
  path?: string;
  error?: string;
}

export type VerdeScriptResponse = VerdeScriptContentResponse | VerdeScriptWrittenResponse;

// ── State ──────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: VerdeScriptResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();

let unlistenFn: UnlistenFn | null = null;
let listenerPromise: Promise<UnlistenFn> | null = null;

const DEFAULT_TIMEOUT_MS = 5000;

// ── Helpers ────────────────────────────────────────────────────────────

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function cleanupRequest(requestId: string) {
  const req = pending.get(requestId);
  if (req) {
    clearTimeout(req.timer);
    pending.delete(requestId);
  }
}

async function ensureListener(): Promise<void> {
  if (unlistenFn) return;
  if (listenerPromise) {
    await listenerPromise;
    return;
  }

  listenerPromise = listen<string>("verde-rx", (event) => {
    try {
      const payload = JSON.parse(event.payload) as VerdeScriptResponse;
      if (!payload.requestId) return;

      const req = pending.get(payload.requestId);
      if (!req) return;

      cleanupRequest(payload.requestId);

      if (payload.success) {
        req.resolve(payload);
      } else {
        req.reject(
          new Error(payload.error || "Verde script operation failed"),
        );
      }
    } catch {
      // Not a JSON message or not a script response — ignore
    }
  });

  unlistenFn = await listenerPromise;
}

/**
 * Send a script operation to the Verde plugin and wait for a response.
 *
 * @param payload The operation payload (without requestId — auto-generated)
 * @param timeoutMs How long to wait before rejecting (default 5000ms)
 * @returns The response payload from the plugin
 * @throws Error on timeout, no active peer, or plugin-reported failure
 */
export async function verdeScriptRequest(
  payload: Omit<VerdeScriptRequest, "requestId">,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<VerdeScriptResponse> {
  await ensureListener();

  const requestId = generateRequestId();
  const fullPayload: VerdeScriptRequest = { ...payload, requestId };

  return new Promise<VerdeScriptResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanupRequest(requestId);
      reject(new Error(`Verde request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timer });

    invoke("verde_tx", { payload: JSON.stringify(fullPayload) }).catch(
      (err) => {
        cleanupRequest(requestId);
        const errStr = String(err);
        if (errStr.includes("no_active_peer")) {
          reject(new Error("no_active_peer"));
        } else {
          reject(new Error(`Failed to send to Verde: ${errStr}`));
        }
      },
    );
  });
}

/**
 * Tear down the Verde request manager (useful in tests).
 */
export function destroyVerdeRequestManager(): void {
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }
  listenerPromise = null;
  for (const [, req] of pending) {
    clearTimeout(req.timer);
    req.reject(new Error("Verde request manager destroyed"));
  }
  pending.clear();
}