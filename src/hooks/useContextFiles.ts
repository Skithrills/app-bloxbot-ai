import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

import { qk } from "@/lib/queryKeys";

export interface ContextFileInfo {
  name: string;
  tokens: number;
  enabled: boolean;
  priority: string;
}

export interface ContextFileConfig {
  name: string;
  enabled: boolean;
  priority: string;
}

export interface ContextSettings {
  maxTokens: number;
  files: ContextFileConfig[];
  autoCodebase: boolean;
}

/**
 * List all markdown context files with their settings and token estimates.
 */
export function useContextFiles() {
  return useQuery<ContextFileInfo[]>({
    queryKey: qk.contextFiles,
    queryFn: async () => {
      return await invoke<ContextFileInfo[]>("list_context_files");
    },
    staleTime: 5000,
  });
}

/**
 * Write context settings to `.settings.json`.
 */
export function useWriteContextSettings() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ContextSettings>({
    mutationFn: async (settings) => {
      await invoke("write_context_settings", {
        maxTokens: settings.maxTokens,
        files: settings.files,
        autoCodebase: settings.autoCodebase,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.contextFiles });
    },
  });
}

/**
 * Generate codebase.md from a Verde snapshot payload.
 */
export function useGenerateCodebaseContext() {
  return useMutation<void, Error, unknown>({
    mutationFn: async (snapshot) => {
      await invoke("generate_codebase_context", { snapshot });
    },
  });
}
