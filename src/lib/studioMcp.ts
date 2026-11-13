/** The name BloxBot gives Roblox Studio's MCP server in OpenCode. */
export const STUDIO_MCP_SERVER_NAME = "roblox-studio";

// Code Mode reaches Studio through execute calls that name the Studio server.
const STUDIO_IN_CODE = /roblox[-_]studio/;

export function isStudioTool(tool: string, input?: Record<string, unknown>): boolean {
  if (tool === "execute") return typeof input?.code === "string" && STUDIO_IN_CODE.test(input.code);
  return tool.startsWith(`${STUDIO_MCP_SERVER_NAME}_`);
}
