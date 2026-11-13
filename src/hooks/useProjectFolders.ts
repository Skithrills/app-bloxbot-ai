import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadConfig, patchConfig } from "@/lib/config";
import { qk } from "@/lib/queryKeys";
import type { AppConfig, ProjectFolder } from "@/types/desktop";

const EMPTY_FOLDERS: readonly ProjectFolder[] = [];

function folderKey(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  // Drive letters and UNC paths are case-insensitive on Windows.
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function findProjectFolder(
  folders: readonly ProjectFolder[],
  directory: string | undefined,
) {
  if (!directory) return undefined;
  const key = folderKey(directory);
  return folders.find((folder) => folderKey(folder.directory) === key);
}

export function useProjectFolders() {
  const { data } = useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
    select: (config) => config.projectFolders,
  });
  return data ?? EMPTY_FOLDERS;
}

export function useSaveProjectFolders() {
  const queryClient = useQueryClient();
  return useMutation({
    scope: { id: "project-folders" },
    mutationFn: async (update: (current: readonly ProjectFolder[]) => readonly ProjectFolder[]) => {
      const current = await queryClient.ensureQueryData({
        queryKey: qk.config,
        queryFn: loadConfig,
      });
      const projectFolders = update(current.projectFolders ?? EMPTY_FOLDERS);
      await patchConfig({ projectFolders });
      await queryClient.cancelQueries({ queryKey: qk.config, exact: true });
      queryClient.setQueryData<AppConfig>(qk.config, (config) => ({
        ...(config ?? current),
        projectFolders,
      }));
    },
  });
}
