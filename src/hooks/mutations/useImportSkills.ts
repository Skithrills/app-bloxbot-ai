import { useMutation, useQueryClient } from "@tanstack/react-query";

import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { SkillImportResult } from "@/types/skillImport";

export interface SkillImportOutcome extends SkillImportResult {
  /** The skills were copied, but OpenCode couldn't be asked to read them again. */
  needsReload: boolean;
}

/** Copies the user's Codex and Claude Code skills into BloxBot, and has OpenCode pick them up. */
export function useImportSkills() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation<SkillImportOutcome, Error, void>({
    mutationFn: async () => {
      const result = await desktop.importSkills();
      const changed = result.imported.length + result.updated.length + result.removed.length > 0;
      if (!changed || !client) return { ...result, needsReload: false };
      // The copies are in place either way, so a reload that fails isn't an import that failed.
      const reloaded = await client.location.reload({ throwOnError: true }).then(
        () => true,
        () => false,
      );
      return { ...result, needsReload: !reloaded };
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.skillImport }),
        // Skills are offered as slash commands.
        queryClient.invalidateQueries({ queryKey: qk.commands }),
      ]),
  });
}
