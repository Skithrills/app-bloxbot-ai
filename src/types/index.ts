import type { Message, Part } from "@opencode-ai/sdk/v2/client";

// ── Chat types ──────────────────────────────────────────────────────────

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

/** Model info as returned by provider.list() */
export interface ModelInfo {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  status?: "alpha" | "beta" | "deprecated" | "active";
  variants?: Record<string, Record<string, unknown>>;
}

/** Provider info from the API */
export interface ProviderInfo {
  id: string;
  name: string;
  env: string[];
}

// ── Custom Agent types ──────────────────────────────────────────────────

/** Tool permission configuration for a custom agent. */
export interface ToolPermissions {
  /** Whitelist of tool names this agent may use. Empty = no tools (default-deny). */
  allow: string[];
  /** Blacklist of tool names this agent may NOT use. */
  deny: string[];
}

/** Optional model overrides for a custom agent. */
export interface ModelOverrides {
  /** Override the default model name. */
  model_name?: string;
  /** Override the sampling temperature. */
  temperature?: number;
  /** Override the maximum output tokens. */
  max_tokens?: number;
}

/** Optional display metadata for a custom agent. */
export interface AgentMetadata {
  icon?: string;
  color?: string;
  tags: string[];
}

/** A custom agent definition (mirrors the Rust struct). */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  system_prompt: string;
  tools: ToolPermissions;
  model: ModelOverrides;
  metadata: AgentMetadata;
}

/** Extended agent type that combines OpenCode Agent with custom metadata. */
export interface BloxBotAgent {
  /** The agent ID (e.g., "studio", "code-reviewer"). */
  id: string;
  /** Display name. */
  name: string;
  /** Short description. */
  description: string;
  /** Whether this is a built-in agent or custom. */
  isBuiltin: boolean;
  /** Icon emoji or identifier (for custom agents). */
  icon?: string;
  /** Theme color (for custom agents). */
  color?: string;
  /** Tags for categorization. */
  tags: string[];
  /** Tool permissions (for custom agents). */
  tools?: ToolPermissions;
  /** Model overrides (for custom agents). */
  modelOverrides?: ModelOverrides;
  /** Version (for custom agents). */
  version?: string;
  /** Author (for custom agents). */
  author?: string;
  /** Whether the user has acknowledged this custom agent's capabilities. */
  acknowledged?: boolean;
}
