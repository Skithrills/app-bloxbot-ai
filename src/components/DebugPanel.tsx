import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

// ── Level colors ──────────────────────────────────────────────────────

const LEVEL_CLASS: Record<string, string> = {
  ERROR: "text-red-500",
  WARN: "text-amber-400",
  INFO: "text-emerald-400",
  DEBUG: "text-stone-500",
};

// ── Props ─────────────────────────────────────────────────────────────

interface DebugPanelProps {
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────

function DebugPanel({ onClose }: DebugPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Track whether user has scrolled up
  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  // Scroll to bottom when new entries arrive (if autoScroll is on)
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries, autoScroll]);

  // Load buffered logs on mount
  useEffect(() => {
    invoke<LogEntry[]>("get_opencode_logs").then(setEntries).catch(console.error);
  }, []);

  // Listen for real-time log events
  useEffect(() => {
    const unlisten = listen<LogEntry>("opencode-log", (event) => {
      setEntries((prev) => {
        const next = [...prev, event.payload];
        // Keep ring buffer in state too
        if (next.length > 5000) {
          return next.slice(next.length - 5000);
        }
        return next;
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const clearLogs = useCallback(() => {
    setEntries([]);
  }, []);

  const filtered = showDebug ? entries : entries.filter((e) => e.level !== "DEBUG");

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col border-t bg-stone-950">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-stone-800 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">
          Debug Output
        </span>
        <div className="flex items-center gap-1">
          <span className="mr-2 text-[10px] tabular-nums text-stone-600">
            {filtered.length} lines
          </span>
          <button
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              showDebug ? "bg-stone-700 text-stone-200" : "text-stone-500 hover:text-stone-300"
            }`}
            onClick={() => setShowDebug((v) => !v)}
            title="Toggle DEBUG lines"
          >
            DEBUG
          </button>
          <button
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
            onClick={clearLogs}
          >
            Clear
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
            onClick={onClose}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Log lines */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-xs leading-relaxed"
      >
        {filtered.length === 0 && (
          <div className="py-4 text-center text-stone-600">Waiting for OpenCode output...</div>
        )}
        {filtered.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="shrink-0 text-stone-600 tabular-nums">{entry.timestamp}</span>
            <span
              className={`shrink-0 w-12 text-right text-[10px] font-semibold ${
                LEVEL_CLASS[entry.level] ?? "text-stone-400"
              }`}
            >
              {entry.level}
            </span>
            <span className={`${LEVEL_CLASS[entry.level] ?? "text-stone-300"}`}>
              {entry.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default DebugPanel;
