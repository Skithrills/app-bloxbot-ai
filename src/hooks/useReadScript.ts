import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";

export interface ScriptContent {
  text: string;
  path: string;
}

/**
 * Read a script from Roblox Studio via MCP.
 */
export function useReadScript(path: string | null) {
  return useQuery<ScriptContent>({
    queryKey: qk.script(path ?? ""),
    queryFn: async () => {
      if (!path) throw new Error("No path provided");
      const result = await invoke<{
        content?: Array<{ type: string; text: string }>;
      }>("call_mcp_tool", {
        tool: "script_read",
        arguments: {
          path,
        },
      });
      const text = result.content?.[0]?.text ?? "";
      return { text, path };
    },
    enabled: !!path,
    staleTime: 5000,
  });
}
