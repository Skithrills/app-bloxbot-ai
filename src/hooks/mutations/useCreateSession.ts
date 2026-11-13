import { useMutation, useQueryClient } from "@tanstack/react-query";
import { findProjectFolder } from "@/hooks/useProjectFolders";
import { trackBlankChat } from "@/lib/blankChats";
import { notify } from "@/lib/notifications";
import type { Session } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";
import type { AppConfig } from "@/types/desktop";

export function useCreateSession() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const { activeSessionIdRef, selectSession } = useActiveSession();
  const studioTarget = useStudioTargetOptional();

  return useMutation({
    // biome-ignore lint/suspicious/noConfusingVoidType: TanStack allows a no-argument mutation only when variables include void.
    mutationFn: async (directory: string | null | void) => {
      if (!client) throw new Error("No client");
      const folders = queryClient.getQueryData<AppConfig>(qk.config)?.projectFolders ?? [];
      const active = queryClient
        .getQueryData<Session[]>(qk.sessions)
        ?.find((session) => session.id === activeSessionIdRef.current);
      const folder = findProjectFolder(
        folders,
        directory === undefined ? active?.directory : (directory ?? undefined),
      );
      const res = await client.session.create(folder ? { directory: folder.directory } : {}, {
        throwOnError: true,
      });
      if (!res.data) throw new Error("No data");
      // Nothing's been written in it yet, so it's only kept if that changes.
      trackBlankChat(res.data.id);
      if (folder?.studio) {
        await studioTarget?.rememberProjectStudio(res.data.id, folder.studio).catch(() => {
          notify.error("Couldn't save the Studio place for this chat.");
        });
      }
      return res.data;
    },
    onSuccess: (newSession: Session) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (prev) => {
        if (!prev) return [newSession];
        if (prev.some((s) => s.id === newSession.id)) return prev;
        return [newSession, ...prev];
      });

      // Clear messages/todos/questions/permissions for new session
      queryClient.setQueryData(qk.messages(newSession.id), {
        messageIds: [],
        messagesById: {},
      });
      queryClient.setQueryData(qk.todos(newSession.id), []);
      queryClient.setQueryData(qk.questions(newSession.id), null);
      queryClient.setQueryData(qk.permissions(newSession.id), null);

      selectSession(newSession.id);
    },
    onError: () => {
      notify.error("Couldn't create the chat.");
    },
  });
}
