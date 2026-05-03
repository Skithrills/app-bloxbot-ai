import type { Agent } from "@opencode-ai/sdk/v2/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { useAgents } from "@/hooks/useAgents";
import { qk } from "@/lib/queryKeys";
import type { AgentDefinition, BloxBotAgent } from "@/types";

// ── Queries ──────────────────────────────────────────────────────────────

/** Fetch all custom agent definitions from the Rust backend. */
export function useCustomAgents() {
  return useQuery<AgentDefinition[]>({
    queryKey: qk.customAgents,
    queryFn: async () => {
      const agents = await invoke<AgentDefinition[]>("list_custom_agents");
      return agents ?? [];
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────

/** Save (create or update) a custom agent definition. */
export function useSaveCustomAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agent: AgentDefinition) => invoke<string>("save_custom_agent", { agent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.customAgents });
    },
  });
}

/** Delete a custom agent definition by ID. */
export function useDeleteCustomAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invoke<void>("delete_custom_agent", { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.customAgents });
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Built-in agent metadata. */
const BUILTIN_AGENTS: BloxBotAgent[] = [
  {
    id: "plan",
    name: "Plan",
    description: "Plans and architects systems before writing code",
    isBuiltin: true,
    tags: ["planning", "architecture"],
  },
  {
    id: "studio",
    name: "Studio",
    description: "Roblox Studio development assistant",
    isBuiltin: true,
    tags: ["roblox", "studio", "development"],
  },
  {
    id: "build",
    name: "Build",
    description: "Executes tools based on the conversation",
    isBuiltin: true,
    tags: ["building", "execution"],
  },
  {
    id: "commander",
    name: "Commander",
    description:
      "Orchestrates complex multi-step workflows by planning, delegating, and coordinating results",
    isBuiltin: true,
    tags: ["orchestration", "workflow", "multi-step"],
  },
  {
    id: "brainstormer",
    name: "Brainstormer",
    description: "Explores design alternatives, generates creative ideas, and evaluates trade-offs",
    isBuiltin: true,
    tags: ["design", "exploration", "creativity"],
  },
];

/** Merge OpenCode SDK agents with custom agent definitions into BloxBotAgents. */
export function mergeAgents(sdkAgents: Agent[], customAgents: AgentDefinition[]): BloxBotAgent[] {
  const result: BloxBotAgent[] = [];
  const customMap = new Map(customAgents.map((a) => [a.id, a]));

  // Start with built-in agent definitions
  for (const builtin of BUILTIN_AGENTS) {
    // SDK agents are keyed by name — match built-in IDs to SDK agent names
    const sdkAgent = sdkAgents.find((a) => a.name === builtin.id);
    result.push({
      ...builtin,
      description: sdkAgent?.description ?? builtin.description,
    });
  }

  // Add custom agents
  for (const custom of customAgents) {
    result.push({
      id: custom.id,
      name: custom.name,
      description: custom.description,
      isBuiltin: false,
      icon: custom.metadata.icon,
      color: custom.metadata.color,
      tags: custom.metadata.tags,
      tools: custom.tools,
      modelOverrides: custom.model,
      version: custom.version,
      author: custom.author,
      acknowledged: false,
    });
  }

  // Add any SDK agents we haven't covered yet (shouldn't happen normally,
  // but handles edge cases where new built-in agents are added)
  for (const sdkAgent of sdkAgents) {
    if (!result.find((a) => a.id === sdkAgent.name) && !customMap.has(sdkAgent.name)) {
      result.push({
        id: sdkAgent.name,
        name: sdkAgent.name,
        description: sdkAgent.description ?? "",
        isBuiltin: true,
        tags: [],
      });
    }
  }

  return result;
}

/** Hook that returns all agents (built-in + custom) merged together. */
export function useAllAgents(): BloxBotAgent[] {
  const sdkAgents = useAgents();
  const { data: customAgents } = useCustomAgents();

  return mergeAgents(sdkAgents ?? [], customAgents ?? []);
}
