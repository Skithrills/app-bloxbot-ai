import type { OpenCodeClient } from "@opencode/client";
import {
  OPENAI_API_PROVIDER,
  OPENAI_ENGINE_OAUTH_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
} from "../../src/lib/openAiProfiles";

/**
 * Move stored API keys out of the native OAuth integration before the renderer can use it.
 * Keep OpenCode responsible for the OAuth token, refreshing it, and selecting that account.
 */
export async function migrateLegacyOpenAiCredentials(
  api: Pick<OpenCodeClient, "credential">,
  apiKeyInEnvironment: boolean,
) {
  const credentials = await api.credential.list();
  const legacy = credentials.filter((entry) => entry.integrationID === OPENAI_ENGINE_OAUTH_PROVIDER);
  const prior = legacy.find((entry) => entry.active) ?? legacy[0];
  const apiKeys = credentials
    .filter((entry) => entry.integrationID === OPENAI_API_PROVIDER)
    .flatMap((entry) => (entry.value.type === "key" ? [entry.value.key] : []));
  // Save the formerly active key first so the API slot retains that account by default.
  const keys = (prior ? [prior, ...legacy.filter(({ id }) => id !== prior.id)] : legacy).flatMap(
    ({ id, label, value }) => (value.type === "key" ? [{ id, label, value }] : []),
  );
  for (const entry of keys) {
    if (!apiKeys.includes(entry.value.key)) {
      await api.credential.create({
        integrationID: OPENAI_API_PROVIDER,
        label: entry.label,
        value: entry.value,
        activate: apiKeys.length === 0,
      });
      apiKeys.push(entry.value.key);
    }
  }
  // If a copy fails, the source slot still holds its original credentials.
  for (const { id } of keys) await api.credential.remove({ credentialID: id });
  return prior?.value.type === "oauth"
    ? OPENAI_OAUTH_PROVIDER
    : prior?.value.type === "key" || apiKeyInEnvironment
      ? OPENAI_API_PROVIDER
      : OPENAI_OAUTH_PROVIDER;
}
