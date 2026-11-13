import { splitModelKey } from "./splitModelKey";

export const OPENAI_OAUTH_PROVIDER = "openai-oauth";
export const OPENAI_API_PROVIDER = "openai-api";
export const OPENAI_ENGINE_OAUTH_PROVIDER = "openai";
export const OPENAI_API_KEY_ENV = "BLOXBOT_OPENAI_API_KEY";

export const OPENAI_SERVICE_TIERS = ["auto", "default", "ultrafast"] as const;
export type OpenAiServiceTier = (typeof OPENAI_SERVICE_TIERS)[number];

export function toEngineProviderID(id: string): string {
  return id === OPENAI_OAUTH_PROVIDER ? OPENAI_ENGINE_OAUTH_PROVIDER : id;
}

export function toAppProviderID(id: string): string {
  return id === OPENAI_ENGINE_OAUTH_PROVIDER ? OPENAI_OAUTH_PROVIDER : id;
}

export function toEngineModelKey(key: string): string {
  const [providerID, modelID] = splitModelKey(key);
  return `${toEngineProviderID(providerID)}/${modelID}`;
}

export function supportsUltrafast(modelID: string): boolean {
  return modelID === "gpt-6.1-sol" || modelID === "gpt-6-astra";
}

export function openAiBillingLabel(providerID: string, serviceTier?: string): string | undefined {
  if (providerID === OPENAI_OAUTH_PROVIDER) return "ChatGPT Sub";
  if (providerID === OPENAI_API_PROVIDER) {
    return serviceTier === "ultrafast" ? "OpenAI API · Ultrafast" : "OpenAI API";
  }
}
