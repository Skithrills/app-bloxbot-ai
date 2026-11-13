import { useEffect, useRef } from "react";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { useSessions } from "@/hooks/useSessions";
import { takeLeftoverBlankChats, untrackBlankChat } from "@/lib/blankChats";
import { readComposerDraft } from "@/lib/composerDrafts";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/**
 * Once per launch, removes the blank chats an earlier run left behind. One with something typed
 * in its message box stays, and so does anything that turns out to have messages after all.
 */
export function useClearBlankChats() {
  const { client, ready } = useOpenCodeClient();
  const { data: sessions } = useSessions();
  const { mutateAsync: deleteSession } = useDeleteSession();
  const started = useRef(false);

  useEffect(() => {
    if (!client || !ready || !sessions || started.current) return;
    started.current = true;
    const leftover = takeLeftoverBlankChats();
    if (leftover.length === 0) return;
    void (async () => {
      for (const id of leftover) {
        if (!sessions.some((session) => session.id === id)) {
          untrackBlankChat(id);
          continue;
        }
        const draft = readComposerDraft(id);
        // Still blank, but there's something to come back to. It's looked at again next launch.
        if (draft.text.trim() || draft.attachments.length > 0) continue;
        try {
          const history = await client.session.messages(
            { sessionID: id, includePending: true },
            { throwOnError: true },
          );
          const used =
            (history.data?.length ?? 0) > 0 || sessions.some((session) => session.parentID === id);
          if (!used) await deleteSession(id);
          untrackBlankChat(id);
        } catch {
          // Couldn't tell, or couldn't remove it. It stays, and the next launch tries again.
        }
      }
    })();
  }, [client, ready, sessions, deleteSession]);
}
