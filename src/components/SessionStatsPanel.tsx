import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { MessageWithParts } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────

interface SessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
  messageCount: number;
  stepFinishCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const EMPTY_CACHE: MessagesCache = { messageIds: [], messagesById: {} };
const NOOP_KEY = ["__noop__"] as const;

function computeStats(cache: MessagesCache): SessionStats {
  const stats: SessionStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    messageCount: cache.messageIds.length,
    stepFinishCount: 0,
  };

  for (const msgId of cache.messageIds) {
    const msg = cache.messagesById[msgId];
    if (!msg) continue;
    for (const part of msg.parts) {
      if (part.type === "step-finish") {
        stats.stepFinishCount++;
        stats.totalInputTokens += part.tokens.input;
        stats.totalOutputTokens += part.tokens.output;
        stats.totalReasoningTokens += part.tokens.reasoning;
        stats.totalCacheReadTokens += part.tokens.cache.read;
        stats.totalCacheWriteTokens += part.tokens.cache.write;
        stats.totalCost += part.cost;
      }
    }
  }

  return stats;
}

// ── Hooks ────────────────────────────────────────────────────────────────

function useSessionStats() {
  const { activeSessionId } = useActiveSession();
  const { client, ready } = useOpenCodeClient();
  const queryKey = activeSessionId ? qk.messages(activeSessionId) : NOOP_KEY;

  return useQuery<MessagesCache, Error, SessionStats>({
    queryKey,
    queryFn: async () => {
      if (!client || !activeSessionId) return EMPTY_CACHE;
      const res = await client.session.messages({ sessionID: activeSessionId });
      if (!res.data) return EMPTY_CACHE;
      const messageIds: string[] = [];
      const messagesById: Record<string, MessageWithParts> = {};
      for (const msg of res.data) {
        messageIds.push(msg.info.id);
        messagesById[msg.info.id] = { info: msg.info, parts: msg.parts };
      }
      return { messageIds, messagesById };
    },
    enabled: ready && !!client && !!activeSessionId,
    select: useCallback(computeStats, []),
  });
}

function useCompactSession() {
  const { client } = useOpenCodeClient();

  return useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("No client");
      await client.tui.executeCommand({ command: "session.compact" });
    },
    onSuccess: () => {
      toast.success("Session compacted");
    },
    onError: (err: Error) => {
      toast.error("Failed to compact session", {
        description: err.message,
      });
    },
  });
}

// ── Component ────────────────────────────────────────────────────────────

const statsRows = [
  {
    key: "Messages",
    label: "Messages",
    accessor: (s: SessionStats) => s.messageCount.toLocaleString(),
  },
  {
    key: "Steps",
    label: "Steps (step-finish)",
    accessor: (s: SessionStats) => s.stepFinishCount.toLocaleString(),
  },
  {
    key: "Input",
    label: "Input Tokens",
    accessor: (s: SessionStats) => s.totalInputTokens.toLocaleString(),
  },
  {
    key: "Output",
    label: "Output Tokens",
    accessor: (s: SessionStats) => s.totalOutputTokens.toLocaleString(),
  },
  {
    key: "Reasoning",
    label: "Reasoning Tokens",
    accessor: (s: SessionStats) => s.totalReasoningTokens.toLocaleString(),
  },
  {
    key: "CacheRead",
    label: "Cache Read",
    accessor: (s: SessionStats) => s.totalCacheReadTokens.toLocaleString(),
  },
  {
    key: "CacheWrite",
    label: "Cache Write",
    accessor: (s: SessionStats) => s.totalCacheWriteTokens.toLocaleString(),
  },
  { key: "Cost", label: "Total Cost", accessor: (s: SessionStats) => `$${s.totalCost.toFixed(6)}` },
] as const;

function SessionStatsPanel({ onClose }: { onClose: () => void }) {
  const { data: stats, isLoading } = useSessionStats();
  const compactMutation = useCompactSession();

  if (isLoading) {
    return (
      <div className="w-72 rounded-lg border bg-popover p-4 text-center text-xs text-muted-foreground shadow-lg">
        Loading stats...
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="w-72 rounded-lg border bg-popover p-4 text-center text-xs text-muted-foreground shadow-lg">
        No data available
      </div>
    );
  }

  return (
    <div className="w-72 rounded-lg border bg-popover p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold">Session Stats</h4>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close stats panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="space-y-0.5">
        {statsRows.map((row) => (
          <div key={row.key} className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium tabular-nums">{row.accessor(stats)}</span>
          </div>
        ))}
      </div>

      <button
        onClick={() => compactMutation.mutate()}
        disabled={compactMutation.isPending}
        className="mt-3 w-full rounded-md bg-foreground py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {compactMutation.isPending ? "Compacting..." : "Compact Session"}
      </button>
    </div>
  );
}

export default SessionStatsPanel;
