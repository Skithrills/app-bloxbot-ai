import { useQuery } from "@tanstack/react-query";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/**
 * Fetch all available tool IDs from the OpenCode engine.
 * Includes both built-in tools and dynamically registered MCP tools.
 */
export function useAvailableTools() {
  const { client } = useOpenCodeClient();

  return useQuery<string[]>({
    queryKey: qk.tools,
    queryFn: async () => {
      if (!client) return [];
      const res = await client.tool.ids({});
      return res.data ?? [];
    },
    enabled: !!client,
    staleTime: 30_000, // Tools don't change often; 30s is fine
  });
}
