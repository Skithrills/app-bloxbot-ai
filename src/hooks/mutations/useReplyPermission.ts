import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PermissionRequest } from "@/lib/opencode/types";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

export function useReplyPermission(targetSessionId?: string) {
  const { client } = useOpenCodeClient();
  const { activeSessionId: rootSessionId } = useActiveSession();
  const activeSessionId = targetSessionId ?? rootSessionId;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestID,
      reply,
    }: {
      requestID: string;
      reply: "once" | "always" | "reject";
    }) => {
      if (!client || !activeSessionId) throw new Error("No client or session");
      const sessionID = activeSessionId;
      await client.permission.reply({ requestID, sessionID, reply }, { throwOnError: true });
      return sessionID;
    },
    onSuccess: (sessionID) => {
      queryClient.setQueryData<PermissionRequest | null>(qk.permissions(sessionID), null);
    },
  });
}
