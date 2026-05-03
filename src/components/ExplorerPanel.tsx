import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import {
  buildUpdateTreePayload,
  RobloxExplorerProvider,
  translateToVerdePlugin,
} from "@/lib/verdeProvider";
import { useGenerateCodebaseContext } from "@/hooks/useContextFiles";
import type { VerdePeer } from "@/stores/explorerStore";
import { useExplorerStore } from "@/stores/explorerStore";

// ── Constants ──────────────────────────────────────────────────────────
const RETRY_INTERVAL_MS = 2000;
const RETRY_TIMEOUT_MS = 30000;
const CODEBASE_THROTTLE_MS = 60000;

interface ExplorerPanelProps {
  onOpenScript: (path: string) => void;
  activePath?: string | null;
}

export default function ExplorerPanel({ onOpenScript, activePath }: ExplorerPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const providerRef = useRef<RobloxExplorerProvider | null>(null);
  const hasReceivedSnapshot = useRef(false);
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryStartRef = useRef<number | null>(null);
  const lastCodebaseGenRef = useRef<number>(0);
  const generateCodebase = useGenerateCodebaseContext();

  // Local UI state for connection status & session picker
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [retryTimedOut, setRetryTimedOut] = useState(false);
  const [peers, setPeersLocal] = useState<VerdePeer[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settings = useExplorerStore((s) => s.settings);
  const setSetting = useExplorerStore((s) => s.setSetting);

  if (!providerRef.current) {
    providerRef.current = new RobloxExplorerProvider();
  }

  useEffect(() => {
    console.log("[Verde React] ExplorerPanel mounted – setting up listeners");

    providerRef.current!.onChange(() => {
      try {
        const payload = buildUpdateTreePayload(
          providerRef.current!,
          Array.from(useExplorerStore.getState().selectedPaths),
        );
        const nodeCount = Object.keys(payload.nodes).length;
        console.log("[Verde React] Sending updateTree to iframe:", nodeCount, "nodes");
        iframeRef.current?.contentWindow?.postMessage(
          {
            source: "bloxbot-host",
            payload,
          },
          "*",
        );
      } catch (err) {
        console.error("[Verde React] Error building updateTree payload:", err);
      }
    });

    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.source === "verde" && e.source === iframeRef.current?.contentWindow) {
        const payload = e.data.payload;
        if (payload && payload.type === "selectionChanged") {
          useExplorerStore.getState().setSelectedPaths(payload.nodeIds || []);
        }

        // Handle "Add to Chat" — don't forward to plugin
        if (payload && payload.type === "addToChat") {
          const nodes = payload.nodes || [];
          if (nodes.length > 0) {
            useExplorerStore
              .getState()
              .setChatContext(
                nodes.map((n: any) => ({ id: n.id, name: n.name, className: n.className })),
              );
          }
          return;
        }

        // Handle double-click on script — open in editor tab
        if (payload && payload.type === "scriptActivated") {
          const nodeId = payload.nodeId;
          if (nodeId) {
            onOpenScript(nodeId);
          }
          return;
        }

        const settings = useExplorerStore.getState().settings;
        const translatedPayload = translateToVerdePlugin(payload, {
          incrementNames: settings.incrementNames,
        });
        if (translatedPayload) {
          invoke("verde_tx", { payload: JSON.stringify(translatedPayload) }).catch((err) => {
            const errStr = String(err);
            console.error("[Verde React] Failed to forward verde_tx:", errStr);
            if (errStr.includes("no_active_peer")) {
              setErrorMessage("No Studio session connected");
            } else if (errStr.includes("send_failed")) {
              setErrorMessage("Failed to send to Studio — connection may have dropped");
            } else {
              setErrorMessage(`Send error: ${errStr}`);
            }
            // Auto-clear error after 4 seconds
            setTimeout(() => setErrorMessage(null), 4000);
          });
        } else {
          console.warn("[Verde React] Unrecognized Verde message type:", payload?.type);
        }
      }
    };
    window.addEventListener("message", handleMessage);

    // ── verde-rx: Messages from Studio plugin ──────────────────────
    let unlistenFn: (() => void) | null = null;
    listen<string>("verde-rx", (event) => {
      try {
        const payload = JSON.parse(event.payload);
        console.log("[Verde React] verde-rx event received, type:", payload.type);
        if (payload.type === "explorer_snapshot") {
          const nodeCount = Array.isArray(payload.payload?.nodes)
            ? payload.payload.nodes.length
            : Object.keys(payload.payload?.nodes || {}).length;
          console.log(
            "[Verde React] ✅ Received snapshot. Nodes:",
            nodeCount,
            "Roots:",
            payload.payload?.rootIds?.length,
          );
          providerRef.current!.setSnapshot(payload.payload);
          hasReceivedSnapshot.current = true;
          setConnectionStatus("connected");
          setRetryTimedOut(false);
          setErrorMessage(null);
          // Stop retrying once we have data
          if (retryIntervalRef.current) {
            console.log("[Verde React] Clearing snapshot retry interval");
            clearInterval(retryIntervalRef.current);
            retryIntervalRef.current = null;
            retryStartRef.current = null;
          }
          // Throttled auto-generation of codebase.md
          const now = Date.now();
          if (now - lastCodebaseGenRef.current > CODEBASE_THROTTLE_MS) {
            lastCodebaseGenRef.current = now;
            generateCodebase.mutate(payload);
          }
        } else if (payload.type === "explorer_delta") {
          console.log("[Verde React] Received delta. Ops:", payload.ops?.length);
          providerRef.current!.applyDelta(payload.ops, payload.addedRootIds);
        } else {
          console.log("[Verde React] Forwarding non-explorer message to iframe:", payload.type);
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: "bloxbot-host",
              payload,
            },
            "*",
          );
        }
      } catch (e) {
        console.error("[Verde React] Failed to parse verde-rx payload:", e);
      }
    }).then((fn) => {
      unlistenFn = fn;
      console.log("[Verde React] ✅ verde-rx listener registered");
    });

    // ── verde-peer-connected: Studio plugin WebSocket connected ────
    let unlistenPeerFn: (() => void) | null = null;
    listen<any>("verde-peer-connected", (event) => {
      const data = event.payload;
      console.log(
        `[Verde React] 🔌 Studio plugin connected – ${data.label} (${data.peer_count} peer(s))`,
      );
      hasReceivedSnapshot.current = false;
      setConnectionStatus("connecting");
      setRetryTimedOut(false);
      setErrorMessage(null);
      // Update store
      useExplorerStore.getState().setStudioConnection(true, data.peer_count, data.label);
      // Refresh peer list
      refreshPeers();
      // Request fresh snapshot from Studio (source of truth)
      setTimeout(() => requestSnapshot(), 500);
    }).then((fn) => {
      unlistenPeerFn = fn;
    });

    // ── verde-peer-disconnected: Studio plugin WebSocket disconnected
    let unlistenPeerDisconnectFn: (() => void) | null = null;
    listen<any>("verde-peer-disconnected", (event) => {
      const data = event.payload;
      console.log(
        `[Verde React] 🔌 Studio plugin disconnected – ${data.label} (${data.peer_count} peer(s) remaining)`,
      );
      if (data.peer_count === 0) {
        // All peers gone — fully disconnected
        setConnectionStatus("disconnected");
        hasReceivedSnapshot.current = false;
        // Clear all explorer data (Studio is source of truth)
        useExplorerStore.getState().setStudioConnection(false, 0, null);
        useExplorerStore.getState().setPeers([]);
        setPeersLocal([]);
        // Clear the tree in the iframe
        iframeRef.current?.contentWindow?.postMessage(
          {
            source: "bloxbot-host",
            payload: { type: "updateTree", nodes: {}, rootIds: [], selectedIds: [] },
          },
          "*",
        );
      } else {
        // Other peers remain — refresh and request new snapshot
        useExplorerStore.getState().setStudioConnection(true, data.peer_count, null);
        refreshPeers();
        setTimeout(() => requestSnapshot(), 300);
      }
    }).then((fn) => {
      unlistenPeerDisconnectFn = fn;
    });

    // ── verde-active-peer-changed: User switched active peer ───────
    let unlistenActivePeerFn: (() => void) | null = null;
    listen<any>("verde-active-peer-changed", (event) => {
      const data = event.payload;
      console.log(`[Verde React] 🔀 Active peer changed to ${data.label}`);
      useExplorerStore.getState().setStudioConnection(true, data.peer_count, data.label);
      refreshPeers();
      // Request a fresh snapshot from the new active peer
      hasReceivedSnapshot.current = false;
      setConnectionStatus("connecting");
      setTimeout(() => requestSnapshot(), 300);
    }).then((fn) => {
      unlistenActivePeerFn = fn;
    });

    return () => {
      window.removeEventListener("message", handleMessage);
      if (unlistenFn) unlistenFn();
      if (unlistenPeerFn) unlistenPeerFn();
      if (unlistenPeerDisconnectFn) unlistenPeerDisconnectFn();
      if (unlistenActivePeerFn) unlistenActivePeerFn();
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
    };
  }, []);

  // ── Sync activePath to iframe (highlight active script) ────────
  useEffect(() => {
    if (activePath && iframeRef.current?.contentWindow) {
      console.log("[Verde React] Syncing activePath to iframe:", activePath);
      iframeRef.current.contentWindow.postMessage(
        {
          source: "bloxbot-host",
          payload: { type: "highlightScript", nodeId: activePath },
        },
        "*",
      );
    }
  }, [activePath]);

  const refreshPeers = () => {
    invoke<VerdePeer[]>("verde_get_peers")
      .then((peerList) => {
        // Map snake_case from Rust to camelCase
        const mapped = peerList.map((p: any) => ({
          addr: p.addr,
          label: p.label,
          isActive: p.is_active,
        }));
        setPeersLocal(mapped);
        useExplorerStore.getState().setPeers(mapped);
        // Update active label
        const active = mapped.find((p: VerdePeer) => p.isActive);
        if (active) {
          useExplorerStore.getState().setStudioConnection(true, mapped.length, active.label);
        }
      })
      .catch((err) => {
        console.warn("[Verde React] Failed to get peer list:", err);
      });
  };

  const requestSnapshot = () => {
    console.log("[Verde React] Requesting snapshot from Studio...");
    invoke("verde_tx", { payload: JSON.stringify({ type: "request_snapshot" }) })
      .then(() => {
        console.log("[Verde React] ✅ request_snapshot sent to Studio");
      })
      .catch((err) => {
        console.warn("[Verde React] ⚠️ request_snapshot failed:", err);
      });
  };

  const startRetryInterval = () => {
    if (retryIntervalRef.current) return;
    retryStartRef.current = Date.now();
    setRetryTimedOut(false);
    console.log("[Verde React] Starting retry interval (every 2s, 30s timeout)");
    retryIntervalRef.current = setInterval(() => {
      if (hasReceivedSnapshot.current) {
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
          retryStartRef.current = null;
        }
        return;
      }
      // Check if we've exceeded the timeout
      if (retryStartRef.current && Date.now() - retryStartRef.current > RETRY_TIMEOUT_MS) {
        console.log("[Verde React] ⏱️ Retry timeout reached — stopping retries");
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
          retryStartRef.current = null;
        }
        setRetryTimedOut(true);
        return;
      }
      console.log("[Verde React] ⏳ Retrying snapshot request...");
      requestSnapshot();
    }, RETRY_INTERVAL_MS);
  };

  const handleManualReconnect = () => {
    setRetryTimedOut(false);
    setConnectionStatus("connecting");
    requestSnapshot();
    startRetryInterval();
  };

  const handleSwitchPeer = (addr: string) => {
    invoke("verde_set_active_peer", { addr }).catch((err) => {
      console.error("[Verde React] Failed to switch active peer:", err);
      setErrorMessage(`Failed to switch peer: ${err}`);
      setTimeout(() => setErrorMessage(null), 4000);
    });
  };

  const handleIframeLoad = () => {
    console.log("[Verde React] iframe loaded");
    // Send whatever we have cached
    const payload = buildUpdateTreePayload(
      providerRef.current!,
      Array.from(useExplorerStore.getState().selectedPaths),
    );
    const nodeCount = Object.keys(payload.nodes).length;
    console.log("[Verde React] Sending cached data to iframe:", nodeCount, "nodes");
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "bloxbot-host",
        payload,
      },
      "*",
    );

    // Request fresh snapshot from Studio
    requestSnapshot();

    // If we haven't received a snapshot yet, start retrying
    if (!hasReceivedSnapshot.current) {
      setConnectionStatus("connecting");
      startRetryInterval();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* ── Explorer Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 py-1 select-none shrink-0 border-b border-[#3c3c3c]">
        <div className="text-xs font-semibold text-[#cccccc] tracking-wide uppercase">Explorer</div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleManualReconnect}
            className="p-1 hover:bg-[#2a2d2e] rounded text-[#cccccc]"
            title="Refresh Connection"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5h-1a4.5 4.5 0 1 1-1.318-3.182L9.5 6.5H14V2l-1.636 1.636A5.474 5.474 0 0 0 8 2.5z"
              />
            </svg>
          </button>

          {/* Settings Dropdown */}
          <div className="relative">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="p-1 hover:bg-[#2a2d2e] rounded text-[#cccccc]"
              title="Explorer Settings"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M2 4h12v1H2V4zm0 3h12v1H2V7zm0 3h12v1H2v-1z"
                />
              </svg>
            </button>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)}></div>
                <div className="absolute right-0 top-full mt-1 w-64 bg-[#252526] border border-[#454545] rounded shadow-lg z-50 p-2 text-xs text-[#cccccc]">
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-[#2a2d2e] p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={settings.incrementNames}
                      onChange={(e) => setSetting("incrementNames", e.target.checked)}
                      className="accent-[#094771] w-3 h-3 m-0"
                    />
                    <span>Increment names for new instances</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Session picker (visible when 2+ peers) ─────────────── */}
      {peers.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 8px",
            background: "#252526",
            borderBottom: "1px solid #3c3c3c",
            fontSize: "12px",
            color: "#cccccc",
            flexShrink: 0,
          }}
        >
          <span style={{ opacity: 0.7, fontSize: "11px" }}>Session:</span>
          <select
            value={peers.find((p) => p.isActive)?.addr || ""}
            onChange={(e) => handleSwitchPeer(e.target.value)}
            style={{
              flex: 1,
              background: "#3c3c3c",
              color: "#cccccc",
              border: "1px solid #555",
              borderRadius: "3px",
              padding: "2px 4px",
              fontSize: "12px",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {peers.map((p) => (
              <option key={p.addr} value={p.addr}>
                {p.label}
                {p.isActive ? " (active)" : ""}
              </option>
            ))}
          </select>
          <span
            style={{
              fontSize: "10px",
              color: "#52d38d",
              background: "rgba(52,211,153,0.1)",
              padding: "1px 6px",
              borderRadius: "8px",
              border: "1px solid rgba(52,211,153,0.3)",
            }}
          >
            {peers.length} connected
          </span>
        </div>
      )}

      {/* ── Error banner ───────────────────────────────────────── */}
      {errorMessage && (
        <div
          style={{
            padding: "6px 10px",
            background: "rgba(248,113,113,0.1)",
            borderBottom: "1px solid rgba(248,113,113,0.3)",
            color: "#f87171",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: 0,
          }}
        >
          <span>⚠️</span>
          <span style={{ flex: 1 }}>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              background: "none",
              border: "none",
              color: "#f87171",
              cursor: "pointer",
              padding: "0 4px",
              fontSize: "14px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── Connection status overlay ──────────────────────────── */}
      {connectionStatus === "disconnected" && !retryTimedOut && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            gap: "8px",
            color: "#888",
            fontSize: "13px",
            padding: "20px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "28px", opacity: 0.5 }}>🔌</div>
          <div>Waiting for Roblox Studio...</div>
          <div style={{ fontSize: "11px", opacity: 0.6 }}>
            Open a project with the BloxBot plugin installed
          </div>
        </div>
      )}

      {retryTimedOut && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            gap: "10px",
            color: "#888",
            fontSize: "13px",
            padding: "20px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "28px", opacity: 0.5 }}>⏱️</div>
          <div>Could not connect to Studio</div>
          <div style={{ fontSize: "11px", opacity: 0.6, maxWidth: "220px" }}>
            Make sure Roblox Studio is open with the BloxBot plugin installed and enabled
          </div>
          <button
            onClick={handleManualReconnect}
            style={{
              marginTop: "6px",
              padding: "6px 16px",
              background: "#0e6399",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Reconnect
          </button>
        </div>
      )}

      {/* ── Explorer iframe (hidden when disconnected) ─────────── */}
      <iframe
        ref={iframeRef}
        onLoad={handleIframeLoad}
        src="/verde/explorer.html"
        className="w-full h-full border-none flex-1"
        style={{
          display:
            connectionStatus === "connected" || connectionStatus === "connecting"
              ? "block"
              : "none",
        }}
        title="Explorer"
      />

      {/* ── Single peer connection indicator ──────────────────── */}
      {peers.length === 1 && connectionStatus === "connected" && (
        <div
          style={{
            padding: "3px 8px",
            background: "#252526",
            borderTop: "1px solid #3c3c3c",
            fontSize: "11px",
            color: "#52d38d",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              background: "#52d38d",
              borderRadius: "50%",
              display: "inline-block",
            }}
          />
          {peers[0].label}
        </div>
      )}
    </div>
  );
}
