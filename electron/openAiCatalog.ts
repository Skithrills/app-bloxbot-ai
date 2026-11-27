import { Schema } from "effect";

// Only public metadata is consumed. Never inherit native OpenAI's credentials,
// canonical provider, endpoint, headers, or OAuth-only routing into openai-api.
export const OPENAI_CATALOG_URL = "https://models.opencode.ai/experimental/v2.0/api.json?type=chat";
export const CATALOG_REFRESH_MS = 5 * 60_000;
const Price = Schema.Number.pipe(Schema.finite(), Schema.nonNegative());
const Cache = Schema.Struct({ read: Schema.optional(Price) });
const InputPrice = Schema.Struct({
  price: Price,
  cache: Schema.optional(Cache),
  overrides: Schema.optional(Schema.Array(Schema.Struct({
    when: Schema.Struct({ context: Schema.Struct({ gt: Price }) }),
    price: Schema.optional(Price), cache: Schema.optional(Cache),
  }))),
});
const OutputPrice = Schema.Struct({
  price: Price,
  overrides: Schema.optional(Schema.Array(Schema.Struct({
    when: Schema.Struct({ context: Schema.Struct({ gt: Price }) }), price: Price,
  }))),
});
const SourceModel = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("chat"),
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}(-\d{2})?$/)),
  modalities: Schema.Struct({ input: Schema.Array(Schema.String), output: Schema.Array(Schema.String) }),
  capabilities: Schema.Struct({
    tools: Schema.Struct({ supported: Schema.Boolean }),
    reasoning: Schema.Union(
      Schema.Struct({ supported: Schema.Literal(false) }),
      Schema.Struct({ supported: Schema.Literal(true), effort: Schema.optional(Schema.Array(Schema.String)) }),
    ),
    temperature: Schema.optional(Schema.Boolean),
    service_tier: Schema.optional(Schema.Array(Schema.String)),
  }),
  limit: Schema.Struct({ context: Schema.Int.pipe(Schema.positive()), input: Schema.optional(Schema.Int.pipe(Schema.positive())), output: Schema.Int.pipe(Schema.positive()) }),
  cost: Schema.Struct({
    text: Schema.Struct({ input: InputPrice, output: OutputPrice }),
    multipliers: Schema.optional(Schema.Array(Schema.Struct({
      when: Schema.Struct({
        service_tier: Schema.Struct({ equals: Schema.String }),
        date: Schema.optional(Schema.Struct({ lt: Schema.optional(Schema.String), gte: Schema.optional(Schema.String) })),
      }),
      factor: Schema.Struct({ text: Price }),
    }))),
  }),
  api: Schema.Struct({ responses: Schema.Unknown }),
  experimental: Schema.optional(Schema.Struct({ modes: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })) })),
});
type SourceModel = typeof SourceModel.Type;
type Cost = { input: number; output: number; cache: { read: number }; tier?: { type: "context"; size: number } };
export interface CatalogModel {
  modelID?: string;
  name: string;
  family?: string;
  releaseDate: string;
  limit: { context: number; input?: number; output: number };
  capabilities: { tools: boolean; input: string[]; output: string[]; temperature?: boolean; reasoning: SourceModel["capabilities"]["reasoning"] };
  cost: Cost[];
  body?: { service_tier?: string; reasoning?: { mode: string } };
  disabled?: boolean;
}
export interface OpenAiCatalog {
  models: Record<string, { model: CatalogModel; ultrafast?: CatalogModel }>;
  nativeModels: Record<string, CatalogModel>;
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function costs(source: SourceModel, tier?: string, now = new Date()): Cost[] {
  const { input, output } = source.cost.text;
  const day = now.toISOString().slice(0, 10);
  // Only use an unambiguous service-tier/date multiplier. Region or other
  // conditions must not accidentally become a global price multiplier.
  const factor = tier ? source.cost.multipliers?.find(({ when }) =>
    when.service_tier.equals === tier &&
    (!when.date?.lt || day < when.date.lt) && (!when.date?.gte || day >= when.date.gte),
  )?.factor.text ?? 1 : 1;
  const base: Cost = { input: input.price, output: output.price, cache: { read: input.cache?.read ?? 0 } };
  const tiers = new Map<number, Cost>();
  for (const override of input.overrides ?? []) {
    const size = override.when.context.gt;
    tiers.set(size, { ...base, input: override.price ?? base.input, cache: { read: override.cache?.read ?? base.cache.read }, tier: { type: "context", size } });
  }
  for (const override of output.overrides ?? []) {
    const size = override.when.context.gt;
    tiers.set(size, { ...(tiers.get(size) ?? base), output: override.price, tier: { type: "context", size } });
  }
  return [base, ...[...tiers.values()].sort((a, b) => a.tier!.size - b.tier!.size)].map((cost) => ({
    ...cost, input: cost.input * factor, output: cost.output * factor, cache: { read: cost.cache.read * factor },
  }));
}

export function parseOpenAiCatalog(value: unknown, now = new Date()): OpenAiCatalog {
  const sources = record(record(record(value).openai).models);
  const models: OpenAiCatalog["models"] = {};
  const nativeModels: OpenAiCatalog["nativeModels"] = {};
  const decode = Schema.decodeUnknownEither(SourceModel, { onExcessProperty: "ignore" });
  for (const id of Object.keys(sources).sort()) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(id)) continue;
    // Unknown conditions cannot be silently stripped and treated as applicable.
    const raw = record(sources[id]);
    const clean = { ...raw, cost: { ...record(raw.cost), multipliers: (Array.isArray(record(raw.cost).multipliers) ? record(raw.cost).multipliers as unknown[] : []).filter((item) => {
      const keys = Object.keys(record(record(item).when));
      return keys.every((key) => key === "service_tier" || key === "date");
    }) } };
    const decoded = decode(clean);
    if (decoded._tag === "Left" || decoded.right.id !== id || !Object.hasOwn(record(raw.api), "responses")) continue;
    const source = decoded.right;
    if (!source.capabilities.tools.supported || !source.modalities.output.includes("text")) continue;
    const modality = (items: readonly string[]) => [...new Set(items.map((item) => item === "application/pdf" ? "pdf" : item.split("/")[0]))]
      .filter((item) => ["text", "image", "audio", "video", "pdf"].includes(item));
    const model: CatalogModel = {
      name: source.name, family: source.family, releaseDate: source.release_date,
      limit: { ...source.limit },
      capabilities: { tools: true, input: modality(source.modalities.input), output: modality(source.modalities.output), temperature: source.capabilities.temperature, reasoning: source.capabilities.reasoning },
      cost: costs(source, undefined, now),
    };
    const ultrafast = source.capabilities.service_tier?.includes("ultrafast")
      ? { ...model, cost: costs(source, "ultrafast", now), body: { service_tier: "ultrafast" } } : undefined;
    models[id] = { model, ultrafast };
    if (source.experimental?.modes && Object.hasOwn(source.experimental.modes, "fast") && source.capabilities.service_tier?.includes("priority")) {
      models[`${id}-fast`] = { model: {
        ...model, modelID: id, name: `${source.name} Fast`,
        cost: costs(source, "priority", now), body: { service_tier: "priority" },
      } };
    }
    const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(id);
    const major = Number(version?.[1]);
    const minor = Number(version?.[2] ?? 0);
    const subscription = !!version && id !== "gpt-5.6" && (major > 5 || (major === 5 && minor > 5));
    // Config models overlay native transforms in 2.2.x. Preserve BloxBot's
    // subscription-only policy (including context caps), not API prices or Pro.
    const inputCap = major > 6 || (major === 6 && minor >= 1) ? 500_000 : 272_000;
    const native = { ...model, cost: [], limit: (source.limit.input ?? source.limit.context) > inputCap
      ? { ...model.limit, input: inputCap, context: inputCap + model.limit.output } : model.limit };
    if (subscription) nativeModels[id] = native;
    // Match native catalog mode IDs. Defining the full family prevents losing
    // Fast pairs when the running backend's bundled snapshot is older.
    for (const mode of Object.keys(source.experimental?.modes ?? {}).sort()) {
      if (!["fast", "ultrafast", "flex", "pro"].includes(mode)) continue;
      const tier = mode === "fast" ? "priority" : mode;
      if (!subscription) continue;
      nativeModels[`${id}-${mode}`] = {
        ...native, modelID: id, name: `${source.name} ${mode[0].toUpperCase()}${mode.slice(1)}`,
        ...(mode === "pro" && { disabled: true }),
        body: mode === "pro" ? { reasoning: { mode: "pro" } } : { service_tier: tier },
      };
    }
  }
  if (!Object.keys(models).length) throw new Error("Public catalog contained no supported OpenAI Responses chat models");
  return { models, nativeModels };
}

// Verified from models.opencode.ai v2 on 2026-11-27. A first launch without
// network or a saved catalog must still offer GPT-6.2 on both profiles.
export function fallbackOpenAiCatalog(now = new Date()): OpenAiCatalog {
  return parseOpenAiCatalog({ openai: { models: Object.fromEntries([
    ["astra", 8, 40, 0.4], ["sol", 2, 10, 0.1],
  ].map(([name, input, output, cache]) => {
    const id = `gpt-6.2-${name}`;
    return [id, {
      id, type: "chat", name: `GPT-6.2 ${name === "astra" ? "Astra" : "Sol"}`, family: `gpt-${name}`, release_date: "2026-11-17",
      modalities: { input: ["text", "image", "application/pdf"], output: ["text"] },
      capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ["low", "medium", "high", "xhigh", "max"] }, temperature: false, service_tier: ["priority", "ultrafast"] },
      limit: { context: 1_050_000, input: 922_000, output: 128_000 },
      cost: { text: {
        input: { price: input, cache: { read: cache }, overrides: [{ when: { context: { gt: 272_000 } }, price: Number(input) * 2, cache: { read: Number(cache) * 2 } }] },
        output: { price: output, overrides: [{ when: { context: { gt: 272_000 } }, price: Number(output) * 1.5 }] },
      }, multipliers: [
        { when: { service_tier: { equals: "priority" } }, factor: { text: 2 } },
        { when: { service_tier: { equals: "ultrafast" }, date: { lt: "2027-03-01" } }, factor: { text: 3 } },
        { when: { service_tier: { equals: "ultrafast" }, date: { gte: "2027-03-01" } }, factor: { text: 6 } },
      ] },
      api: { responses: {} }, experimental: { modes: { fast: {}, ultrafast: {}, pro: {} } },
    }];
  })) } }, now);
}

export interface LiveCatalogOptions {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  readCache: () => Promise<string>;
  writeCache: (contents: string) => Promise<void>;
}

export function createLiveOpenAiCatalog(options: LiveCatalogOptions) {
  let current = fallbackOpenAiCatalog();
  let lastSource: unknown;
  let cachedContents: string | undefined;
  let inFlight: Promise<OpenAiCatalog> | undefined;
  return {
    get current() { return current; },
    async load() {
      try {
        const contents = await options.readCache();
        const source: unknown = JSON.parse(contents);
        current = parseOpenAiCatalog(source);
        lastSource = source;
        cachedContents = contents;
      } catch { /* Offline fallback. */ }
      return this.refresh();
    },
    refresh(): Promise<OpenAiCatalog> {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const response = await options.fetch(OPENAI_CATALOG_URL, {
            signal: AbortSignal.timeout(8_000), credentials: "omit", redirect: "error",
          });
          if (!response.ok) throw new Error(`Public catalog HTTP ${response.status}`);
          const value: unknown = await response.json();
          const next = parseOpenAiCatalog(value);
          current = next;
          // Cache only the public OpenAI slice, not the multi-MB global catalog.
          lastSource = { openai: { models: record(record(record(value).openai).models) } };
          const contents = JSON.stringify(lastSource);
          if (contents !== cachedContents) {
            await options.writeCache(contents).then(() => { cachedContents = contents; }).catch(() => undefined);
          }
        } catch {
          // Re-evaluate time-limited pricing even offline. Keep the same object
          // when nothing changed, and never remove last-good models on failure.
          const next = lastSource ? parseOpenAiCatalog(lastSource) : fallbackOpenAiCatalog();
          if (JSON.stringify(next) !== JSON.stringify(current)) current = next;
        }
        return current;
      })().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
