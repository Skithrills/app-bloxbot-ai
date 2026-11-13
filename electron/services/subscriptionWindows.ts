import type { SubscriptionWindow } from "../../src/types/subscriptionUsage";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function displayWindow(minutes: unknown, fallback: string) {
  if (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes <= 0) {
    return fallback;
  }
  if (minutes === 7 * 24 * 60) return "Weekly";
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

function usageWindow(
  id: string,
  label: string,
  percent: unknown,
  resetsAt: number,
): SubscriptionWindow[] {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) return [];
  return [
    {
      id,
      label,
      usedPercent: percent,
      resetsAt: resetsAt > 0 && Number.isFinite(new Date(resetsAt).getTime()) ? resetsAt : null,
    },
  ];
}

/** Prefer Codex's multi-bucket view and retain the single-bucket view for older CLI versions. */
export function codexWindows(payload: unknown): SubscriptionWindow[] {
  const response = record(payload);
  const byId = record(response?.rateLimitsByLimitId);
  const buckets = byId && Object.keys(byId).length > 0
    ? Object.entries(byId)
    : [["codex", response?.rateLimits] as const];

  return buckets.flatMap(([id, value]) => {
    const bucket = record(value);
    const name = id === "codex"
      ? ""
      : (typeof bucket?.limitName === "string" ? bucket.limitName.trim() : "") || id;
    return ["primary", "secondary"].flatMap((kind) => {
      const meter = record(bucket?.[kind]);
      const period = displayWindow(
        meter?.windowDurationMins,
        kind === "primary" ? "Primary window" : "Secondary window",
      );
      const reset = typeof meter?.resetsAt === "number" ? meter.resetsAt * 1_000 : 0;
      return usageWindow(`${id}/${kind}`, name ? `${name} · ${period}` : period, meter?.usedPercent, reset);
    });
  });
}

/** Claude Code's get_usage percentages are already on the 0–100 scale. */
export function claudeWindows(payload: unknown): SubscriptionWindow[] {
  const limits = record(record(payload)?.rate_limits);
  const toWindow = (id: string, label: string, value: unknown) => {
    const meter = record(value);
    const reset = typeof meter?.resets_at === "string" ? Date.parse(meter.resets_at) : 0;
    return usageWindow(id, label, meter?.utilization, reset);
  };

  const scoped = Array.isArray(limits?.model_scoped) ? limits.model_scoped : [];
  return [
    ...toWindow("five_hour", "5-hour window", limits?.five_hour),
    ...toWindow("seven_day", "Weekly", limits?.seven_day),
    ...scoped.flatMap((value) => {
      const model = record(value);
      const name = typeof model?.display_name === "string" ? model.display_name.trim() : "";
      return name ? toWindow(`model/${name}`, `Weekly · ${name}`, model) : [];
    }),
  ];
}
