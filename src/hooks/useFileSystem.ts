import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import type { FileNode } from "@/lib/fileSystemTypes";

export function useFileSystem() {
  const openFolder = useCallback(async (): Promise<string | null> => {
    try {
      const result = await invoke<string | null>("file_system_open_folder_dialog", {});
      return result;
    } catch (e) {
      console.error("Failed to open folder dialog:", e);
      return null;
    }
  }, []);

  const saveFolder = useCallback(async (folderPath: string): Promise<void> => {
    try {
      await invoke("file_system_open_folder", { folderPath });
    } catch (e) {
      console.error("Failed to save folder:", e);
      throw e;
    }
  }, []);

  const readDir = useCallback(async (
    folderPath: string,
    relativePath?: string
  ): Promise<FileNode[]> => {
    try {
      const result = await invoke<FileNode[]>("file_system_read_dir", {
        folderPath,
        relativePath: relativePath || null,
      });
      return result;
    } catch (e) {
      console.error("Failed to read directory:", e);
      throw e;
    }
  }, []);

  const readFile = useCallback(async (filePath: string): Promise<string> => {
    try {
      const result = await invoke<string>("file_system_read_file", { filePath });
      return result;
    } catch (e) {
      console.error("Failed to read file:", e);
      throw e;
    }
  }, []);

  const writeFile = useCallback(async (filePath: string, content: string): Promise<void> => {
    try {
      await invoke("file_system_write_file", { filePath, content });
    } catch (e) {
      console.error("Failed to write file:", e);
      throw e;
    }
  }, []);

  const getOpenFolders = useCallback(async (): Promise<string[]> => {
    try {
      const result = await invoke<string[]>("file_system_get_open_folders");
      return result;
    } catch (e) {
      console.error("Failed to get open folders:", e);
      return [];
    }
  }, []);

  return {
    openFolder,
    saveFolder,
    readDir,
    readFile,
    writeFile,
    getOpenFolders,
  };
}
