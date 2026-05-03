export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[] | null;
  file_type: string; // "ModuleScript", "ServerScript", "LocalScript", "Folder", "Other"
}

export interface FileSystemMention {
  path: string;
  name: string;
  content: string;
}
