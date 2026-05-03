import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";

export interface WriteScriptParams {
  path: string;
  code: string;
}

/**
 * Write a script to Roblox Studio via MCP multi_edit.
 * Replaces the entire script content.
 */
export function useWriteScript() {
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean },
    Error,
    WriteScriptParams
  >({
    mutationFn: async ({ path, code }) => {
      const result = await invoke<{
        content?: Array<{ type: string; text: string }>;
      }>("call_mcp_tool", {
        tool: "multi_edit",
        arguments: {
          path,
          edits: [
            {
              old_string: "",
              new_string: code,
            },
          ],
        },
      });
      const text = result.content?.[0]?.text ?? "";
      return { success: text.includes("success") || text.includes("Success") || text.includes("✓") || text.includes("✅") };
    },
    onSuccess: (_, { path }) => {
      // Invalidate the script cache so it refetches
      queryClient.invalidateQueries({ queryKey: qk.script(path) });
    },
  });
}
