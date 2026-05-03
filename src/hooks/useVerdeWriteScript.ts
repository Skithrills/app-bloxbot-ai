import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";
import { verdeScriptRequest } from "@/lib/verdeRequestManager";

export interface WriteScriptParams {
  path: string;
  code: string;
}

/**
 * Write a script to Roblox Studio via Verde, falling back to MCP multi_edit.
 */
export function useVerdeWriteScript() {
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, WriteScriptParams>({
    mutationFn: async ({ path, code }) => {
      // ── Attempt 1: Verde ─────────────────────────────────────────
      try {
        const response = await verdeScriptRequest({
          type: "write_script",
          path,
          source: code,
        });

        if (response.type === "script_written" && response.success) {
          return { success: true };
        }

        throw new Error(response.error || "Verde write failed");
      } catch (verdeErr) {
        const errStr = String(verdeErr);
        if (
          errStr.includes("no_active_peer") ||
          errStr.includes("timed out")
        ) {
          console.log("[useVerdeWriteScript] Verde unavailable, falling back to MCP");
        } else {
          throw verdeErr;
        }
      }

      // ── Attempt 2: MCP fallback ──────────────────────────────────
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
      const success =
        text.includes("success") ||
        text.includes("Success") ||
        text.includes("✓") ||
        text.includes("✅");
      return { success };
    },
    onSuccess: (_, { path }) => {
      queryClient.invalidateQueries({ queryKey: qk.script(path) });
    },
  });
}