import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";
import { verdeScriptRequest } from "@/lib/verdeRequestManager";

export interface ScriptContent {
  text: string;
  path: string;
}

/**
 * Read a script from Roblox Studio via Verde, falling back to MCP.
 */
export function useVerdeReadScript(path: string | null) {
  return useQuery<ScriptContent>({
    queryKey: qk.script(path ?? ""),
    queryFn: async () => {
      if (!path) throw new Error("No path provided");

      // ── Attempt 1: Verde ─────────────────────────────────────────
      try {
        const response = await verdeScriptRequest({
          type: "read_script",
          path,
        });

        if (response.type === "script_content" && response.success) {
          return { text: response.source ?? "", path };
        }

        throw new Error(response.error || "Verde read failed");
      } catch (verdeErr) {
        const errStr = String(verdeErr);
        if (
          errStr.includes("no_active_peer") ||
          errStr.includes("timed out")
        ) {
          console.log("[useVerdeReadScript] Verde unavailable, falling back to MCP");
        } else {
          // Verde returned a real error (e.g., not a script) — don't fall back
          throw verdeErr;
        }
      }

      // ── Attempt 2: MCP fallback ──────────────────────────────────
      const result = await invoke<{
        content?: Array<{ type: string; text: string }>;
      }>("call_mcp_tool", {
        tool: "script_read",
        arguments: { path },
      });

      const text = result.content?.[0]?.text ?? "";
      return { text, path };
    },
    enabled: !!path,
    staleTime: 5000,
  });
}