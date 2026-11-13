import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteComposerDraft } from "@/lib/composerDrafts";
import { clearLegacyInstanceClasses } from "@/lib/instanceReferences";
import { clearMessageFavorites } from "@/lib/messageFavorites";
import type { Session, SessionStatus } from "@/lib/opencode/types";

import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

export function useDeleteSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { activeSessionId, clearSession } = useActiveSession();
  const { forgetChatModel } = usePreferences();

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client");
      const response = await client.session.delete({ sessionID }, { throwOnError: true });
      if (response.data !== true) throw new Error("OpenCode did not delete the session");
      return sessionID;
    },
    onSuccess: (sessionID: string) => {
      deleteComposerDraft(sessionID);
      clearLegacyInstanceClasses(sessionID);
      clearMessageFavorites(sessionID);
      forgetChatModel(sessionID);
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return prev;
        return prev.filter((s) => s.id !== sessionID);
      });
      queryClient.removeQueries({ queryKey: qk.session(sessionID) });
      queryClient.setQueryData<Record<string, SessionStatus>>(qk.statuses, (previous) => {
        if (!previous?.[sessionID]) return previous;
        const { [sessionID]: _deleted, ...remaining } = previous;
        return remaining;
      });

      if (activeSessionId === sessionID) {
        clearSession();
      }
    },
  });
}
