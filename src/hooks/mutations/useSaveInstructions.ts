import { useMutation, useQueryClient } from "@tanstack/react-query";

import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";

/** Saves what the user wants BloxBot to follow, and has OpenCode, which reads it once, pick it up. */
export function useSaveInstructions() {
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (text) => {
      await desktop.saveInstructions(text);
      await client?.instance.dispose({}, { throwOnError: true });
    },
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: qk.instructions });
    },
  });
}
