import { type QueryState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useConnectedProviders } from "@/hooks/useProviders";
import { desktop } from "@/lib/desktop";
import { OPENAI_OAUTH_PROVIDER } from "@/lib/openAiProfiles";
import { CLAUDE_AGENT_PROVIDER } from "@/lib/providerAuth";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import type {
  SubscriptionProvider,
  SubscriptionUsageResult,
  SubscriptionWindow,
} from "@/types/subscriptionUsage";

const MIN_REFRESH_MS = 15_000;
const REFRESH_MS = 60_000;
const UNSUPPORTED_REFRESH_MS = 5 * REFRESH_MS;
const PREVIOUS_AFTER_MS = 2 * REFRESH_MS;

type Snapshot = Extract<SubscriptionUsageResult, { status: "available" }> & {
  source: SubscriptionProvider;
};
type Reading = {
  source: SubscriptionProvider;
  status: SubscriptionUsageResult["status"];
  usage?: Snapshot;
};

function subscriptionAccount(providerId: string | undefined): SubscriptionProvider | undefined {
  if (providerId === OPENAI_OAUTH_PROVIDER) return "codex";
  if (providerId === CLAUDE_AGENT_PROVIDER) return "claude";
}

export function subscriptionUsageSourceLabel(source: SubscriptionProvider) {
  switch (source) {
    case "codex":
      return "BloxBot ChatGPT connection";
    case "claude":
      return "Claude Code account";
  }
}

export function subscriptionPercentLeft(usedPercent: number) {
  return 100 - Math.min(100, Math.max(0, usedPercent));
}

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

export function formatSubscriptionPercentLeft(usedPercent: number) {
  return percent.format(subscriptionPercentLeft(usedPercent) / 100);
}

async function readUsage(
  account: SubscriptionProvider,
  checkCancelled: () => void,
  previous: Snapshot | undefined,
): Promise<Reading> {
  let result: SubscriptionUsageResult;
  try {
    result = await desktop.getSubscriptionUsage(account);
  } catch {
    result = { status: "unavailable" };
  }
  checkCancelled();
  let usage: Snapshot | undefined;
  if (result.status === "available") usage = { ...result, source: account };
  if (result.status === "unavailable") usage = previous;
  return { status: result.status, source: account, usage };
}

function pollingInterval(reading: Reading | undefined) {
  if (reading?.status === "usage_not_shared") return false;
  return reading?.status === "available" || reading?.status === "unavailable"
    ? REFRESH_MS
    : UNSUPPORTED_REFRESH_MS;
}

function cooldown(reading: Reading | undefined) {
  if (reading?.status === "usage_not_shared") return Infinity;
  return reading?.status === "available"
    ? MIN_REFRESH_MS
    : pollingInterval(reading) || UNSUPPORTED_REFRESH_MS;
}

function nextAutomaticReadAt(
  state: Pick<QueryState<Reading>, "data" | "dataUpdatedAt"> | undefined,
) {
  return state?.data ? state.dataUpdatedAt + cooldown(state.data) : 0;
}

function isPreviousUsage(usage: Snapshot | undefined, isError: boolean, now: number) {
  return (
    !!usage &&
    (isError ||
      now - usage.checkedAt >= PREVIOUS_AFTER_MS ||
      usage.windows.some((window) => window.resetsAt !== null && window.resetsAt <= now))
  );
}

export function useConnectedSubscriptionProviders() {
  const connected = useConnectedProviders();
  const codexConnected = connected.includes(OPENAI_OAUTH_PROVIDER);
  const claudeConnected = connected.includes(CLAUDE_AGENT_PROVIDER);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!codexConnected) {
      queryClient.removeQueries({ queryKey: qk.subscriptionUsage(OPENAI_OAUTH_PROVIDER) });
    }
    if (!claudeConnected) {
      queryClient.removeQueries({ queryKey: qk.subscriptionUsage(CLAUDE_AGENT_PROVIDER) });
    }
  }, [queryClient, codexConnected, claudeConnected]);
  return connected;
}

/** Settings and the active model observe the same reading and share in-flight requests. */
export function useSubscriptionUsage(providerId: string | undefined, completedTurn?: string) {
  const connected = useConnectedSubscriptionProviders();
  const account = connected.includes(providerId ?? "")
    ? subscriptionAccount(providerId)
    : undefined;
  const queryClient = useQueryClient();
  const queryKey = qk.subscriptionUsage(account ? providerId : undefined);
  const query = useQuery({
    queryKey,
    queryFn: (context) => {
      if (!account) throw new Error("Subscription account is not connected.");
      return readUsage(
        account,
        // IPC cannot be interrupted, so a model switch can still share the pending read.
        () => context.signal.throwIfAborted(),
        queryClient.getQueryData<Reading>(queryKey)?.usage,
      );
    },
    enabled: !!account,
    gcTime: UNSUPPORTED_REFRESH_MS,
    retry: false,
    staleTime: (query) => cooldown(query.state.data),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => pollingInterval(query.state.data),
  });
  const { data, fetchStatus, isFetching, refetch } = query;
  const automaticReadAt = nextAutomaticReadAt(query);

  // TanStack listens to visibility changes. An Electron window can regain focus while visible.
  useEffect(() => {
    if (!account || !providerId) return;
    const onFocus = () => {
      const state = queryClient.getQueryState<Reading>(qk.subscriptionUsage(providerId));
      if (state?.fetchStatus === "idle" && nextAutomaticReadAt(state) <= Date.now()) {
        void refetch({ cancelRefetch: false });
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [account, providerId, queryClient, refetch]);

  const turn = useRef({ account, id: completedTurn, refreshPending: false });
  useEffect(() => {
    if (turn.current.account !== account) {
      turn.current = { account, id: completedTurn, refreshPending: false };
    } else if (turn.current.id !== completedTurn) {
      turn.current.id = completedTurn;
      if (completedTurn) turn.current.refreshPending = true;
    }
    if (
      !account ||
      !providerId ||
      !turn.current.refreshPending ||
      fetchStatus !== "idle" ||
      !Number.isFinite(automaticReadAt)
    )
      return;
    const key = qk.subscriptionUsage(providerId);
    const timer = window.setTimeout(
      () => {
        const state = queryClient.getQueryState<Reading>(key);
        if (state?.fetchStatus !== "idle" || nextAutomaticReadAt(state) > Date.now()) return;
        turn.current.refreshPending = false;
        void refetch({ cancelRefetch: false });
      },
      Math.max(0, automaticReadAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [account, providerId, completedTurn, automaticReadAt, fetchStatus, queryClient, refetch]);

  const usage = data?.usage;
  const isError = data?.status === "unavailable";
  const [clock, setNow] = useState(Date.now);
  const now = Math.max(clock, data?.usage?.checkedAt ?? 0);
  useEffect(() => {
    if (!usage) return;
    const timer = window.setInterval(() => setNow(Date.now()), MIN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [usage]);
  return {
    usage,
    source: usage?.source ?? data?.source ?? account,
    status: data?.status,
    isError,
    isFetching,
    isPreviousReading: isPreviousUsage(usage, isError, now),
    now,
    refresh: () => refetch({ cancelRefetch: false }),
  };
}

export function subscriptionWindowsForModel(
  source: SubscriptionProvider,
  windows: readonly SubscriptionWindow[],
  modelId: string,
) {
  const model = modelId.toLowerCase().replace(/_/g, "-");
  if (source === "claude") {
    return windows.filter(({ id }) => {
      if (id === "five_hour" || id === "seven_day") return true;
      if (!id.startsWith("model/")) return false;
      const scope = id
        .slice("model/".length)
        .toLowerCase()
        .replace(/[\s_]+/g, "-");
      return model === scope || model.startsWith(`claude-${scope}-`);
    });
  }
  const scoped = windows.filter(({ id }) => {
    const bucket = id.slice(0, id.lastIndexOf("/")).toLowerCase().replace(/_/g, "-");
    return bucket === model;
  });
  return scoped.length ? scoped : windows.filter(({ id }) => id.startsWith("codex/"));
}

export function useSubscriptionUsageForModel(modelKey: string | undefined, completedTurn?: string) {
  const [providerId, modelId] = modelKey ? splitModelKey(modelKey) : [];
  const reading = useSubscriptionUsage(providerId, completedTurn);
  const windows =
    reading.usage && modelId
      ? subscriptionWindowsForModel(reading.usage.source, reading.usage.windows, modelId)
      : undefined;
  const usage = reading.usage && windows?.length ? { ...reading.usage, windows } : undefined;
  return {
    ...reading,
    usage,
    isPreviousReading: isPreviousUsage(usage, reading.isError, reading.now),
    isSubscriptionModel: !!subscriptionAccount(providerId),
  };
}
