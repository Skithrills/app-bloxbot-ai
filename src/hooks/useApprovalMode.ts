import type { PermissionRequest } from "@opencode-ai/sdk/v2/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

/**
 * Hook that manages approval mode state and handles auto-approval of
 * permission requests when in auto-approve or autopilot modes.
 *
 * Subscribes to the query cache for permission.asked events. When a
 * non-default mode is active, it immediately replies "always" before
 * any UI prompt can render.
 */
export function useApprovalMode() {
  const { approvalMode, setApprovalMode } = usePreferences();
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const processedRef = useRef<Set<string>>(new Set());

  // Auto-approve permissions when in auto-approve or autopilot mode.
  // Uses query cache subscription so it fires synchronously when
  // sseDispatch sets qk.permissions — before React re-renders.
  useEffect(() => {
    if (approvalMode === "default" || !client) return;

    // Clear stale IDs when re-entering auto modes
    processedRef.current.clear();

    const unsubscribe = queryClient.getQueryCache().subscribe((cacheEvent) => {
      if (!cacheEvent.query) return;
      if (
        !Array.isArray(cacheEvent.query.queryKey) ||
        cacheEvent.query.queryKey[0] !== qk.permissions[0]
      ) {
        return;
      }

      const perm = cacheEvent.query.state.data as PermissionRequest | undefined;
      if (!perm) return;
      if (processedRef.current.has(perm.id)) return;

      processedRef.current.add(perm.id);

      // Fire-and-forget: reply "always" to auto-approve
      client.permission.reply({ requestID: perm.id, reply: "always" });

      // Clear the query cache so PermissionPrompt never renders
      queryClient.setQueryData<PermissionRequest | null>(qk.permissions, null);

      // Show a non-blocking toast in auto-approve mode (not autopilot)
      if (approvalMode === "auto-approve") {
        toast(`Auto-approved: ${perm.permission}`, { duration: 2000 });
      }
    });

    return unsubscribe;
  }, [approvalMode, client, queryClient]);

  const handleSetApprovalMode = useCallback(
    (mode: typeof approvalMode) => {
      setApprovalMode(mode);
    },
    [setApprovalMode],
  );

  return {
    approvalMode,
    setApprovalMode: handleSetApprovalMode,
  } as const;
}
