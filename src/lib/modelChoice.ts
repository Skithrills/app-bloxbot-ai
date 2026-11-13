import { isKnownFreeModelKey } from "@/lib/freeModels";
import type { Model, ProviderListResponse } from "@/lib/opencode/types";
import { isFreeTier } from "@/lib/providerAuth";
import { canChat } from "@/lib/providerCheck";
import { splitModelKey } from "@/lib/splitModelKey";
import type { ModelInfo } from "@/types";
import type { ModelCatalogOrder } from "@/types/desktop";

export interface ModelChoice {
  key: string;
  name: string;
}

/** The listed model a "provider/model" key names, if OpenCode still offers it. */
export function listedModel(list: ProviderListResponse, key: string) {
  const [providerID, modelID] = splitModelKey(key);
  const provider = list.all.find((candidate) => candidate.id === providerID);
  return provider && Object.values(provider.models).find((model) => model.id === modelID);
}

const modelNameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function releaseTime(model: Pick<Model, "releasedAt">): number {
  const time = model.releasedAt ?? 0;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

export function compareCatalogModels(
  a: Pick<Model, "id" | "name" | "releasedAt">,
  b: Pick<Model, "id" | "name" | "releasedAt">,
  order: ModelCatalogOrder,
): number {
  const byDate = order === "newest" ? releaseTime(b) - releaseTime(a) : 0;
  return byDate || modelNameOrder.compare(a.name, b.name) || modelNameOrder.compare(a.id, b.id);
}

export function supportedVariant(model: Model | undefined, variant: string | null): string | null {
  return variant && Object.keys(model?.variants ?? {}).includes(variant) ? variant : null;
}

export function modelName(list: ProviderListResponse | undefined, key: string): string {
  return (list && listedModel(list, key)?.name) ?? splitModelKey(key)[1];
}

export function modelLabel(model: ModelInfo): string {
  return `${model.name} (${model.billingLabel ?? model.providerName})`;
}

export function fastModelPairs(models: readonly ModelInfo[], unavailable: ReadonlySet<string>) {
  const byKey = new Map(models.map((model) => [`${model.providerId}/${model.id}`, model]));
  const pairs = new Map<string, { standard: ModelInfo; fast: ModelInfo }>();
  for (const [key, fast] of byKey) {
    if (!fast.id.endsWith("-fast") || unavailable.has(key) || fast.status === "deprecated")
      continue;
    const standardKey = key.slice(0, -"-fast".length);
    const standard = byKey.get(standardKey);
    if (!standard || unavailable.has(standardKey) || standard.status === "deprecated") continue;
    const pair = { standard, fast };
    pairs.set(standardKey, pair);
    pairs.set(key, pair);
  }
  return pairs;
}

export function isPaidModel(list: ProviderListResponse, key: string): boolean {
  const [providerID] = splitModelKey(key);
  if (!list.connected.includes(providerID)) return false;
  const provider = list.all.find((entry) => entry.id === providerID);
  const model = listedModel(list, key);
  if (!provider || !model || provider.source === "custom") return false;
  return !(
    isKnownFreeModelKey(key) ||
    (providerID === "opencode" && model.cost?.input === 0 && model.cost?.output === 0)
  );
}

export function pickPaidModel(
  list: ProviderListResponse,
  options: {
    preferred: ReadonlyArray<string | null | undefined>;
    unavailable: ReadonlySet<string>;
    hidden: ReadonlySet<string>;
  },
): ModelChoice | null {
  const candidates = [
    ...options.preferred,
    ...Object.entries(list.default).map(([provider, model]) => `${provider}/${model}`),
    ...list.all.flatMap((provider) =>
      Object.values(provider.models).map((model) => `${provider.id}/${model.id}`),
    ),
  ];
  for (const key of candidates) {
    if (
      !key ||
      options.hidden.has(key) ||
      options.unavailable.has(key) ||
      !isPaidModel(list, key)
    ) {
      continue;
    }
    const model = listedModel(list, key);
    if (model && model.status !== "deprecated") return { key, name: model.name };
  }
  return null;
}

/**
 * Another free model to move to. Skips the ones to avoid (the one that failed, the one selected)
 * and the ones that can't work here, and prefers OpenCode's default, then one out of alpha or beta.
 */
export function pickFreeModel(
  list: ProviderListResponse,
  options: {
    avoid: ReadonlyArray<string | null | undefined>;
    unavailable: ReadonlySet<string>;
    hidden?: ReadonlySet<string>;
  },
): ModelChoice | undefined {
  const avoid = new Set(options.avoid);
  const candidates = list.all
    .filter((provider) => isFreeTier(provider) && list.connected.includes(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        key: `${provider.id}/${model.id}`,
        name: model.name,
        isDefault: list.default[provider.id] === model.id,
        isPreview: model.status === "alpha" || model.status === "beta",
        isDeprecated: model.status === "deprecated",
      })),
    )
    .filter(
      (model) =>
        !model.isDeprecated &&
        !avoid.has(model.key) &&
        !options.unavailable.has(model.key) &&
        !options.hidden?.has(model.key),
    );
  // Lower is better, in the order of preference above.
  const rank = (model: (typeof candidates)[number]) =>
    (model.isDefault ? 0 : 2) + (model.isPreview ? 1 : 0);
  const choice = candidates.sort((a, b) => rank(a) - rank(b))[0];
  return choice && { key: choice.key, name: choice.name };
}

/**
 * Why a saved model can't be used: the catalog removed or deprecated it, or the model was refused
 * in the user's region. A disconnected provider is handled by the caller.
 */
export function goneReason(
  list: ProviderListResponse,
  key: string,
  unavailable: ReadonlySet<string>,
): "retired" | "region" | undefined {
  const [providerID] = splitModelKey(key);
  if (!list.all.some((provider) => provider.id === providerID)) return undefined;
  const model = listedModel(list, key);
  if (!model || model.status === "deprecated") return "retired";
  if (unavailable.has(key)) return "region";
  return undefined;
}

/** Replace a retired chat model within the same provider connection. */
export function replacementModel(
  list: ProviderListResponse,
  key: string,
  options: {
    unavailable: ReadonlySet<string>;
    hidden: ReadonlySet<string>;
    hideFreeModels: boolean;
  },
): ModelChoice | null {
  const [providerID] = splitModelKey(key);
  if (!list.connected.includes(providerID)) return null;
  const provider = list.all.find((entry) => entry.id === providerID);
  const keepFree = isKnownFreeModelKey(key) && !options.hideFreeModels;
  const eligible = Object.values(provider?.models ?? {}).filter((model) => {
    const candidate = `${providerID}/${model.id}`;
    return (
      candidate !== key &&
      (!model.status || model.status === "active") &&
      canChat(model) &&
      !options.hidden.has(candidate) &&
      !options.unavailable.has(candidate) &&
      (!options.hideFreeModels || isPaidModel(list, candidate)) &&
      (!keepFree || !isPaidModel(list, candidate))
    );
  });
  eligible.sort((a, b) => compareCatalogModels(a, b, "newest"));
  const first = eligible[0];
  if (!first) return null;
  const choice = releaseTime(first)
    ? first
    : (eligible.find((model) => model.id === list.default[providerID]) ?? first);
  return { key: `${providerID}/${choice.id}`, name: choice.name };
}
