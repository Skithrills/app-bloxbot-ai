import { useId } from "react";
import ProviderLogo from "@/components/ProviderLogo";
import { MENU_TRIGGER } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

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
      return "Connect the subscription account to view its usage.";
    case "cli_missing":
      return "Claude Code is required to read this account’s limits.";
    case "session_expired":
      return "The ChatGPT connection has expired. Use this subscription in a chat to refresh it.";
    case "usage_not_shared":
      return "This sign-in supports chats. ChatGPT does not share remaining quota or reset times with BloxBot.";
    case "unsupported":
      return provider === "claude"
        ? "This Claude Code connection or CLI version does not report subscription limits."
        : "This ChatGPT connection does not report subscription limits.";
    case "unavailable":
      return "Usage is temporarily unavailable.";
  }
}

function SubscriptionAccount({
  providerId,
  name,
  reading,
}: (typeof accounts)[number] & { reading: ReturnType<typeof useSubscriptionUsage> }) {
  const { usage, source, status, isError, isFetching, isPreviousReading, now, refresh } = reading;
  const error = !status || status === "available" ? "unavailable" : status;

  return (
    <div className="px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderLogo providerId={providerId} />
          <h6 className="text-sm font-medium">{name}</h6>
        </div>
        {status !== "usage_not_shared" && (
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
        )}
      </div>
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
        {providerId === OPENAI_OAUTH_PROVIDER && (
          <a
            href={CHATGPT_USAGE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-primary underline-offset-2 hover:underline"
          >
            Open ChatGPT Usage
          </a>
        )}
      </div>
    </div>
  );
}

function ConnectedSubscriptionAccount(account: (typeof accounts)[number]) {
  const reading = useSubscriptionUsage(account.providerId);
  return <SubscriptionAccount {...account} reading={reading} />;
}

export function ChatGptUsageControl() {
  const account = accounts[0];
  const reading = useSubscriptionUsage(account.providerId);
  if (!reading.source) return null;

  const windows = reading.usage?.windows.filter(({ id }) => id.startsWith("codex/")) ?? [];
  const tightest = windows.reduce<(typeof windows)[number] | undefined>(
    (lowest, item) => (!lowest || item.usedPercent > lowest.usedPercent ? item : lowest),
    undefined,
  );
  const left = tightest ? subscriptionPercentLeft(tightest.usedPercent) : undefined;
  const summary = tightest
    ? `${tightest.label} · ${formatSubscriptionPercentLeft(tightest.usedPercent)} left${reading.isPreviousReading ? " · Previous reading" : ""}`
    : reading.status === "usage_not_shared"
      ? "View usage in ChatGPT"
      : reading.isFetching
        ? "Checking usage…"
        : statusMessage(
            reading.status === "available" ? "unavailable" : (reading.status ?? "unavailable"),
            reading.source,
          );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`ChatGPT subscription usage · ${summary}`}
          title={summary}
          className={`${MENU_TRIGGER} w-8 shrink-0 justify-center px-0`}
        >
          <svg width="21" height="21" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            {left !== undefined && left > 0 && (
              <circle
                cx="10"
                cy="10"
                r="7.5"
                pathLength="100"
                transform="rotate(-90 10 10)"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${left} 100`}
                className={reading.isPreviousReading ? undefined : "text-primary"}
              />
            )}
            {left === undefined && <circle cx="10" cy="10" r="1.5" fill="currentColor" />}
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 max-w-[calc(100vw-1rem)] p-0"
        aria-label="ChatGPT subscription usage"
      >
        <SubscriptionAccount {...account} reading={reading} />
      </PopoverContent>
    </Popover>
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
          <ConnectedSubscriptionAccount key={account.providerId} {...account} />
        ))}
      </div>
    </section>
  );
}
