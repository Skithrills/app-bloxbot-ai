import { useId } from "react";
import ProviderLogo from "@/components/ProviderLogo";
import {
  formatSubscriptionPercentLeft,
  subscriptionPercentLeft,
  useConnectedSubscriptionProviders,
  useSubscriptionUsage,
} from "@/hooks/useSubscriptionUsage";
import { OPENAI_OAUTH_PROVIDER } from "@/lib/openAiProfiles";
import { CLAUDE_AGENT_PROVIDER } from "@/lib/providerAuth";
import type { SubscriptionProvider, SubscriptionUsageResult } from "@/types/subscriptionUsage";

const accounts = [
  { providerId: OPENAI_OAUTH_PROVIDER, name: "ChatGPT Subscription" },
  { providerId: CLAUDE_AGENT_PROVIDER, name: "Claude Code" },
] as const;

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function statusMessage(
  status: Exclude<SubscriptionUsageResult["status"], "available">,
  provider: SubscriptionProvider | undefined,
) {
  switch (status) {
    case "disconnected":
      if (provider === "codex-cli") return "The installed Codex CLI is signed out.";
      return "Connect the subscription account to view its usage.";
    case "cli_missing":
      return `${provider === "claude" ? "Claude Code" : "Codex CLI"} is required to read this account’s limits.`;
    case "session_expired":
      return "The ChatGPT connection has expired. Use this subscription in a chat to refresh it.";
    case "unsupported":
      if (provider === "codex-cli")
        return "The installed CLI is using a connection without ChatGPT subscription limits.";
      return "This connection or CLI version does not report subscription limits.";
    case "unavailable":
      return "Usage is temporarily unavailable.";
  }
}

function SubscriptionAccount({ providerId, name }: (typeof accounts)[number]) {
  const { usage, source, status, isError, isFetching, isPreviousReading, now, refresh } =
    useSubscriptionUsage(providerId);
  const error = !status || status === "available" ? "unavailable" : status;

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderLogo providerId={providerId} />
          <h6 className="text-sm font-medium">{name}</h6>
        </div>
        <button
          type="button"
          aria-label={`Refresh ${name} usage`}
          aria-disabled={isFetching}
          onClick={() => {
            if (!isFetching) void refresh();
          }}
          className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-muted aria-disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {usage?.source === "codex-cli" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Usage from the installed Codex CLI account. BloxBot has a separate sign-in.
        </p>
      )}
      <div className="mt-2 space-y-2.5 text-xs" aria-live="polite" aria-busy={isFetching}>
        {usage ? (
          <>
            {usage.windows.map((meter) => (
              <div key={meter.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="font-medium">{meter.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatSubscriptionPercentLeft(meter.usedPercent)} left
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${name} ${meter.label} remaining`}
                  aria-valuenow={subscriptionPercentLeft(meter.usedPercent)}
                  aria-valuetext={`${formatSubscriptionPercentLeft(meter.usedPercent)} left`}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${subscriptionPercentLeft(meter.usedPercent)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {meter.resetsAt === null ? (
                    "Reset time unavailable"
                  ) : (
                    <>
                      {meter.resetsAt <= now ? "Last reported reset " : "Resets "}
                      <time dateTime={new Date(meter.resetsAt).toISOString()}>
                        {dateTime.format(meter.resetsAt)}
                      </time>
                    </>
                  )}
                </p>
              </div>
            ))}
            <p className="text-muted-foreground">
              {isPreviousReading ? "Previous reading" : "Checked"}{" "}
              <time dateTime={new Date(usage.checkedAt).toISOString()}>
                {dateTime.format(usage.checkedAt)}
              </time>
              {isFetching ? " · Updating…" : isError && " · Refresh failed"}
            </p>
          </>
        ) : isFetching ? (
          <p className="text-muted-foreground">Checking usage…</p>
        ) : (
          <p className="text-muted-foreground">{statusMessage(error, source)}</p>
        )}
      </div>
    </div>
  );
}

export function SubscriptionUsage() {
  const headingId = useId();
  const connected = useConnectedSubscriptionProviders();
  const visible = accounts.filter(({ providerId }) => connected.includes(providerId));
  if (!visible.length) return null;

  return (
    <section className="mt-6" aria-labelledby={headingId}>
      <h5 id={headingId} className="mb-1.5 text-xs font-medium text-muted-foreground">
        Subscription usage
      </h5>
      <div className="divide-y rounded-lg border bg-card">
        {visible.map((account) => (
          <SubscriptionAccount key={account.providerId} {...account} />
        ))}
      </div>
    </section>
  );
}
