import { splitModelKey } from "./splitModelKey";

/** OpenCode Zen uses the suffix for current free models, and Big Pickle predates it. */
export function isKnownFreeModelKey(key: string): boolean {
  const [provider, model] = splitModelKey(key);
  return provider === "opencode" && (model.endsWith("-free") || model === "big-pickle");
}
