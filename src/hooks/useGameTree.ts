import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";

export interface GameTreeNode {
  name: string;
  className: string;
  fullPath: string;
  parentName: string;
  childSummary?: string;
  unexploredChildCount?: number;
}

export interface GameTree {
  nodes: GameTreeNode[];
}

/**
 * Fetch the Roblox game tree via MCP.
 * Returns a flat list of instances that can be parsed into a tree.
 */
export function useGameTree(enabled: boolean) {
  return useQuery<GameTree>({
    queryKey: qk.gameTree,
    queryFn: async () => {
      const result = await invoke<{
        content?: Array<{ type: string; text: string }>;
      }>("call_mcp_tool", {
        tool: "search_game_tree",
        arguments: {
          max_depth: 10,
        },
      });
      const text = result.content?.[0]?.text ?? "[]";
      try {
        const nodes = JSON.parse(text) as GameTreeNode[];
        return { nodes };
      } catch {
        return { nodes: [] };
      }
    },
    enabled,
    staleTime: 30000,
  });
}
