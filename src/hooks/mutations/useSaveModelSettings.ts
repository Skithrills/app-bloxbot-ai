import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type AppConfig, loadConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { ModelSettingsPatch } from "@/types/desktop";

export function useSaveModelSettings() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: ModelSettingsPatch) => {
      await desktop.setModelSettings(patch);
      const previous = queryClient.getQueryData<AppConfig>(qk.config);
      queryClient.setQueryData(
        qk.config,
        previous ? { ...previous, ...patch } : await loadConfig(),
      );
      try {
        await client?.location.reload({ throwOnError: true });
        await queryClient.invalidateQueries({ queryKey: qk.providers });
      } catch {
        notify.error("Settings saved. Reopen BloxBot to apply them in OpenCode.");
      }
    },
    onError: () => notify.error("Could not save model settings."),
  });
}
