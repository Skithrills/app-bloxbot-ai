import { Schema } from "effect";

export const SubscriptionProviderSchema = Schema.Literal("codex", "claude");
export type SubscriptionProvider = typeof SubscriptionProviderSchema.Type;

const SubscriptionWindowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  usedPercent: Schema.Finite,
  resetsAt: Schema.NullOr(Schema.Finite),
});
export type SubscriptionWindow = typeof SubscriptionWindowSchema.Type;

export const SubscriptionUsageSchema = Schema.Union(
  Schema.Struct({
    status: Schema.Literal("available"),
    checkedAt: Schema.Finite,
    windows: Schema.Array(SubscriptionWindowSchema),
  }),
  Schema.Struct({
    status: Schema.Literal(
      "disconnected",
      "cli_missing",
      "session_expired",
      "usage_not_shared",
      "unsupported",
      "unavailable",
    ),
  }),
);
export type SubscriptionUsageResult = typeof SubscriptionUsageSchema.Type;
