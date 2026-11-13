import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";

import { desktop } from "@/lib/desktop";
import { qk } from "@/lib/queryKeys";

const CHECK_INTERVAL = 30 * 60 * 1000;
const UPDATE_INSTALL = ["install-app-update"] as const;

export function useUpdater(automatic = false) {
  const client = useQueryClient();
  const check = useQuery({
    queryKey: qk.appUpdate,
    queryFn: () => desktop.checkForUpdate(),
    enabled: automatic,
    retry: false,
    staleTime: CHECK_INTERVAL,
    refetchInterval: automatic
      ? ({ state }) => (state.data?.status === "unsupported" ? false : CHECK_INTERVAL)
      : false,
    refetchOnWindowFocus: ({ state }) =>
      state.data?.status !== "unsupported" &&
      Date.now() - Math.max(state.dataUpdatedAt, state.errorUpdatedAt) >= CHECK_INTERVAL,
  });
  const install = useMutation({
    mutationKey: UPDATE_INSTALL,
    mutationFn: () => desktop.installUpdate(),
  });
  const installs = useMutationState({
    filters: { mutationKey: UPDATE_INSTALL },
    select: ({ state }) => state,
  });
  const lastInstall = installs[installs.length - 1];

  const update = check.data?.status === "available" ? check.data.update : null;
  const downloading = lastInstall?.status === "pending" || lastInstall?.status === "success";

  return {
    result: check.data,
    update,
    downloading,
    checking: check.isFetching,
    checkError: check.error?.message,
    installError: lastInstall?.error?.message,
    checkForUpdates: () => void check.refetch({ cancelRefetch: false }),
    installUpdate: () => {
      if (update && !downloading && !client.isMutating({ mutationKey: UPDATE_INSTALL })) {
        install.mutate();
      }
    },
  };
}
