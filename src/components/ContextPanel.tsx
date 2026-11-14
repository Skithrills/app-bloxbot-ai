import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChartBarStacked, ChartPie, PanelRightClose, Shrink } from "lucide-react";
import type { MouseEventHandler } from "react";
import { MENU_TRIGGER } from "@/components/ui/menu";
import type { ChatContext } from "@/hooks/useChatContext";
import {
  formatSubscriptionPercentLeft,
  subscriptionUsageSourceLabel,
} from "@/hooks/useSubscriptionUsage";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import type { ContextChart } from "@/types/desktop";

export const CONTEXT_PANEL_ID = "chat-context-panel";
export const CONTEXT_TITLE_ID = "chat-context-heading";

const number = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });
const share = new Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const resetDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function contextSegments(data: ChatContext["context"]["data"]) {
  const tokens = data?.measurement?.tokens;
  if (!tokens) return [];
  return [
    { label: "Input", count: tokens.input, color: "bg-chart-1", stroke: "stroke-chart-1" },
    {
      label: "Cache read",
      count: tokens.cache.read,
      color: "bg-chart-2",
      stroke: "stroke-chart-2",
    },
    {
      label: "Cache write",
      count: tokens.cache.write,
      color: "bg-chart-3",
      stroke: "stroke-chart-3",
    },
    {
      label: "Output",
      count: tokens.output,
      color: "bg-chart-4",
      stroke: "stroke-chart-4",
    },
    {
      label: "Reasoning",
      count: tokens.reasoning,
      color: "bg-chart-5",
      stroke: "stroke-chart-5",
    },
  ].filter(({ count }) => Number.isFinite(count) && count > 0);
}

/** The saved choice between the meter bar and the pie: shown at once, written in the background. */
function useContextChart() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
    select: (config) => config.contextChart,
  });
  const chart: ContextChart = data ?? "bar";
  const setChart = (next: ContextChart) => {
    const show = (contextChart: ContextChart) =>
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, contextChart } : config,
      );
    show(next);
    patchConfig({ contextChart: next }).catch(() => {
      show(chart);
      notify.error("Couldn't save the chart choice");
    });
  };
  return [chart, setChart] as const;
}

/**
 * A flat pie seen from above. The whole circle is the context limit (or what was measured, when
 * the limit isn't known), so the grey part is the room left.
 */
function ContextPie({
  segments,
  whole,
}: {
  segments: ReturnType<typeof contextSegments>;
  whole: number;
}) {
  let used = 0;
  const slices = segments.map((segment) => {
    const start = used;
    used += (segment.count / whole) * 100;
    return { ...segment, start, share: used - start };
  });
  // Where one slice meets the next, drawn as a thin gap so neighbours stay apart. A pie that is
  // all one slice has no edges, and a full one doesn't need its last edge drawn over the first.
  const edges =
    slices.length > 1 || used < 99.5
      ? [0, ...slices.map(({ start, share }) => start + share).filter((edge) => edge < 99.5)]
      : [];
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      data-context-chart="pie"
      className="mx-auto size-32 -rotate-90"
    >
      <circle cx="50" cy="50" r="50" className="fill-muted" />
      {slices.map(({ label, start, share, stroke }) => (
        <circle
          key={label}
          cx="50"
          cy="50"
          r="25"
          fill="none"
          strokeWidth="50"
          pathLength="100"
          strokeDasharray={`${share} 100`}
          strokeDashoffset={-start}
          className={stroke}
        />
      ))}
      {edges.map((edge) => {
        const angle = (edge / 100) * 2 * Math.PI;
        return (
          <line
            key={edge}
            x1="50"
            y1="50"
            x2={50 + 50 * Math.cos(angle)}
            y2={50 + 50 * Math.sin(angle)}
            strokeWidth="2.5"
            strokeLinecap="round"
            className="stroke-sidebar"
          />
        );
      })}
    </svg>
  );
}

export function ContextControl({
  value,
  expanded,
  onToggle,
}: {
  value: ChatContext;
  expanded: boolean;
  onToggle: MouseEventHandler<HTMLButtonElement>;
}) {
  const { context, limit } = value;
  const count = contextSegments(context.data).reduce((sum, segment) => sum + segment.count, 0);
  const ratio = limit && count > 0 ? count / limit : undefined;
  const usageLabel =
    ratio === undefined
      ? "Context window"
      : `Context window · ${percent.format(ratio)} used${context.isError ? " · Previous reading" : ""}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Context and usage${ratio === undefined ? "" : ` · ${usageLabel}`}`}
      aria-expanded={expanded}
      aria-controls={CONTEXT_PANEL_ID}
      title={usageLabel}
      className={`${MENU_TRIGGER} w-8 shrink-0 justify-center px-0 aria-expanded:bg-accent aria-expanded:text-foreground`}
    >
      <svg aria-hidden="true" width="23" height="23" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        {ratio === undefined ? (
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
        ) : (
          <circle
            cx="10"
            cy="10"
            r="7.5"
            pathLength="100"
            transform="rotate(-90 10 10)"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${Math.min(1, Math.max(0, ratio)) * 100} 100`}
            strokeOpacity={ratio > 0 ? 1 : 0}
          />
        )}
      </svg>
    </button>
  );
}

export function ContextPanel({
  value,
  busy,
  onClose,
}: {
  value: ChatContext;
  busy: boolean;
  onClose: () => void;
}) {
  const { context, limit, modelName, compact, compactStatus, compactError, subscription } = value;
  const segments = contextSegments(context.data);
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
  const ratio = limit ? total / limit : undefined;
  const free = limit ? Math.max(limit - total, 0) : undefined;
  const compacting = compactStatus === "pending";
  const canCompact = !!context.data?.canCompact && !context.isError && !busy && !compacting;
  const [chart, setChart] = useContextChart();
  const pie = chart === "pie";

  return (
    <aside
      id={CONTEXT_PANEL_ID}
      aria-labelledby={CONTEXT_TITLE_ID}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l bg-sidebar"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2
          id={CONTEXT_TITLE_ID}
          tabIndex={-1}
          className="text-sm font-semibold focus:outline-none"
        >
          Context window
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={MENU_TRIGGER}
            aria-label={pie ? "Show usage as a meter bar" : "Show usage as a pie chart"}
            title={pie ? "Show as a meter bar" : "Show as a pie chart"}
            onClick={() => setChart(pie ? "bar" : "pie")}
          >
            {pie ? (
              <ChartBarStacked aria-hidden="true" size={15} />
            ) : (
              <ChartPie aria-hidden="true" size={15} />
            )}
          </button>
          <button
            type="button"
            className={MENU_TRIGGER}
            aria-label="Close Context"
            onClick={onClose}
          >
            <PanelRightClose aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3.5 text-xs">
        <section aria-label="Context token usage" className="space-y-2.5">
          {modelName && <p className="break-words text-muted-foreground">{modelName}</p>}
          {total > 0 ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <div className="tabular-nums">
                  <span className="text-sm font-semibold">{number.format(total)}</span>
                  <span className="text-muted-foreground">
                    {limit ? ` / ${number.format(limit)} tokens` : " tokens measured"}
                  </span>
                </div>
                {ratio !== undefined && (
                  <span className="font-medium tabular-nums">{percent.format(ratio)} used</span>
                )}
              </div>
              {ratio !== undefined && (
                <meter
                  className="sr-only"
                  aria-label="Context window used"
                  aria-valuetext={`${percent.format(ratio)} used`}
                  max={100}
                  value={Math.min(ratio * 100, 100)}
                />
              )}
              {pie ? (
                <ContextPie segments={segments} whole={Math.max(limit ?? 0, total)} />
              ) : (
                ratio !== undefined && (
                  <div
                    aria-hidden="true"
                    data-context-chart="bar"
                    className="h-2.5 overflow-hidden rounded-full bg-muted"
                  >
                    {/* The panel's own colour shows through the gaps, so neighbours read apart. */}
                    <div
                      className="flex h-full gap-[3px] bg-sidebar pr-[3px]"
                      style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                    >
                      {segments.map(({ label, count, color }) => (
                        <span
                          key={label}
                          className={`min-w-[3px] ${color}`}
                          style={{ flexGrow: count }}
                        />
                      ))}
                    </div>
                  </div>
                )
              )}
              <p className="text-muted-foreground">
                {context.isError ? "Previous reading · Refresh failed" : "Last measured model call"}
              </p>
              <dl className="space-y-1.5">
                {segments.map(({ label, count, color }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-2">
                      <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />
                      {label}
                    </dt>
                    <dd className="tabular-nums text-muted-foreground">
                      {number.format(count)}
                      {limit ? <span className="ml-1.5">{share.format(count / limit)}</span> : null}
                    </dd>
                  </div>
                ))}
                {free !== undefined && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full border border-muted-foreground/40 bg-muted"
                      />
                      Free space
                    </dt>
                    <dd className="tabular-nums text-muted-foreground">
                      {number.format(free)}
                      <span className="ml-1.5">{share.format(free / (limit as number))}</span>
                    </dd>
                  </div>
                )}
              </dl>
              <p className="text-muted-foreground">
                Models report only these totals, not how much of the input is instructions, tools or
                messages.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              {context.isPending
                ? "Reading context…"
                : context.isError
                  ? "Context usage is unavailable."
                  : context.data?.hasCompacted
                    ? "Context usage will update after the next measured reply."
                    : "Context usage appears after a model reports token counts."}
              {limit && !context.isError ? ` Context limit ${number.format(limit)} tokens.` : ""}
            </p>
          )}
        </section>

        {subscription.isSubscriptionModel && (
          <section className="space-y-2.5 border-t pt-3" aria-label="Subscription usage">
            <h3 className="text-sm font-medium">Subscription usage</h3>
            {subscription.usage ? (
              <>
                <p className="text-muted-foreground">
                  {subscriptionUsageSourceLabel(subscription.usage.source)}
                  {subscription.isPreviousReading && " · Previous reading"}
                </p>
                <ul className="space-y-2">
                  {subscription.usage.windows.map((window) => (
                    <li key={window.id}>
                      <p className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                        <span>{window.label}</span>
                        <span className="font-medium tabular-nums">
                          {formatSubscriptionPercentLeft(window.usedPercent)} left
                        </span>
                      </p>
                      {window.resetsAt !== null && (
                        <p className="mt-0.5 text-muted-foreground">
                          {window.resetsAt <= subscription.now ? "Last reported reset " : "Resets "}
                          <time dateTime={new Date(window.resetsAt).toISOString()}>
                            {resetDate.format(window.resetsAt)}
                          </time>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                {subscription.isFetching ? "Checking usage…" : "Subscription usage is unavailable."}
              </p>
            )}
          </section>
        )}
      </div>

      <div className="space-y-2 border-t p-3.5">
        <output className="block empty:hidden text-xs text-muted-foreground" aria-live="polite">
          {compactError
            ? `Compaction failed. ${compactError.message}`
            : compactStatus === "success"
              ? "Context compacted."
              : ""}
        </output>
        <button
          type="button"
          aria-disabled={!canCompact}
          title={
            busy
              ? "Wait for the chat to finish"
              : "Summarize older chat messages to free up context"
          }
          onClick={() => {
            if (canCompact) compact();
          }}
          className={`${MENU_TRIGGER} w-full justify-center gap-1.5 border text-foreground aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent`}
        >
          <Shrink aria-hidden="true" size={14} />
          {compacting ? "Compacting…" : "Compact session"}
        </button>
      </div>
    </aside>
  );
}
