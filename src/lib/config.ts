import { LazyStore } from "@tauri-apps/plugin-store";

export type Theme = "system" | "light" | "dark";
export type SendMode = "instant" | "wait" | "queue";
export type ApprovalMode = "default" | "auto-approve" | "autopilot";

export interface AppConfig {
  lastModel: string | null;
  hiddenModels: string[];
  theme: Theme;
  sendMode?: SendMode;
  approvalMode?: ApprovalMode;
  workspaceDir?: string;
}

const store = new LazyStore("bloxbot-store.json");
const CONFIG_KEY = "config";
const DEFAULT_CONFIG: AppConfig = {
  lastModel: null,
  hiddenModels: [],
  theme: "system",
  sendMode: "wait",
  approvalMode: "default",
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await store.get<AppConfig>(CONFIG_KEY);
    if (raw) return raw;
  } catch {
    // Corrupted data, start fresh
  }
  return DEFAULT_CONFIG;
}

export async function patchConfig(patch: Partial<AppConfig>): Promise<void> {
  const current = await loadConfig();
  await store.set(CONFIG_KEY, { ...current, ...patch });
}
