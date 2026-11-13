import { Schema } from "effect";

const UpdateInfoSchema = Schema.Struct({
  version: Schema.String,
  body: Schema.NullOr(Schema.String),
});

export type UpdateInfo = typeof UpdateInfoSchema.Type;

export const AppUpdateCheckSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal("available"), update: UpdateInfoSchema }),
  Schema.Struct({ status: Schema.Literal("up-to-date"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("no-releases", "unsupported") }),
);

export type AppUpdateCheck = typeof AppUpdateCheckSchema.Type;
