import { useState, useCallback, useEffect } from "react";
import { useFileSystem } from "@/hooks/useFileSystem";
import type { FileNode } from "@/lib/fileSystemTypes";

// ── Roblox Script Icons (SVG) ────────────────────────────────

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d={open
          ? "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
          : "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
        }
        fill={open ? "#4fc3f7" : "none"}
        stroke="#4fc3f7"
      />
    </svg>
  );
}

function ModuleScriptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#0d7e83" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">
        M
      </text>
    </svg>
  );
}

function ServerScriptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#e67e22" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">
        S
      </text>
    </svg>
  );
}

function LocalScriptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#2ecc71" />
      <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">
        L
      </text>
    </svg>
  );
}

function FileIcon({ fileType }: { fileType: string }) {
  if (fileType === "ModuleScript") return <ModuleScriptIcon />;
  if (fileType === "ServerScript") return <ServerScriptIcon />;
  if (fileType === "LocalScript") return <LocalScriptIcon />;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// ── FileSystemExplorer Props ──────────────────────────────────

interface FileSystemExplorerProps {
  onOpenFile: (path: string, name: string) => void;
  activeFilePath?: string | null;
}

// ── TreeNode Component ────────────────────────────────────────

function TreeNode({
  node,
  depth,
  onOpenFile,
  activeFilePath,
  basePath,
  readDir,
}: {
  node: FileNode;
  depth: number;
  onOpenFile: (path: string, name: string) => void;
  activeFilePath?: string | null;
  basePath: string;
  readDir: (folderPath: string, relativePath?: string) => Promise<FileNode[]>;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [children, setChildren] = useState<FileNode[] | null>(node.children || null);
  const [loading, setLoading] = useState(false);
  const isActive = activeFilePath === node.path;

  const handleClick = useCallback(async () => {
    if (node.is_dir) {
      setExpanded((v) => !v);
      if (!children && !loading) {
        setLoading(true);
        try {
          const relativePath = node.path.replace(basePath, "").replace(/^[/\\]/, "");
          const result = await readDir(basePath, relativePath || undefined);
          setChildren(result);
        } catch (e) {
          console.error("Failed to read directory:", e);
        } finally {
          setLoading(false);
        }
      }
    } else {
      onOpenFile(node.path, node.name);
    }
  }, [node, children, loading, onOpenFile, basePath, readDir]);

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] transition-colors ${
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-foreground hover:bg-accent/50"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        {node.is_dir ? (
          <>
            <span className="inline-block w-3 text-[9px] text-muted-foreground">
              {expanded ? "▼" : "▶"}
            </span>
            <FolderIcon open={expanded} />
          </>
        ) : (
          <>
            <span className="inline-block w-3" />
            <FileIcon fileType={node.file_type} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.is_dir && (
        <div>
          {loading && (
            <div className="px-4 py-1 text-[10px] text-muted-foreground">Loading...</div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
              basePath={basePath}
              readDir={readDir}
            />
          ))}
          {!loading && (!children || children.length === 0) && (
            <div className="px-4 py-1 text-[10px] text-muted-foreground">Empty folder</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileSystemExplorer Component ───────────────────────────────

export default function FileSystemExplorer({
  onOpenFile,
  activeFilePath,
}: FileSystemExplorerProps) {
  const [openFolders, setOpenFolders] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderContents, setFolderContents] = useState<Record<string, FileNode[]>>({});
  const [loading, setLoading] = useState(false);
  
  const { openFolder, saveFolder, readDir, getOpenFolders } = useFileSystem();

  const loadOpenFolders = useCallback(async () => {
    try {
      const folders = await getOpenFolders();
      setOpenFolders(folders);
      // Auto-expand and load first level
      for (const folder of folders) {
        if (!folderContents[folder]) {
          loadFolderContents(folder);
        }
      }
    } catch (e) {
      console.error("Failed to get open folders:", e);
    }
  }, [getOpenFolders, folderContents]);

  const loadFolderContents = useCallback(async (folderPath: string) => {
    try {
      const contents = await readDir(folderPath);
      setFolderContents((prev) => ({ ...prev, [folderPath]: contents }));
      setExpandedFolders((prev) => ({ ...prev, [folderPath]: true }));
    } catch (e) {
      console.error("Failed to read folder:", e);
    }
  }, [readDir]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openFolder();
      if (!selected) return;

      setLoading(true);
      await saveFolder(selected);
      await loadFolderContents(selected);
      setOpenFolders((prev) => [...prev, selected]);
    } catch (e) {
      console.error("Failed to open folder:", e);
    } finally {
      setLoading(false);
    }
  }, [openFolder, saveFolder, loadFolderContents]);

  // Load open folders on mount
  useEffect(() => {
    loadOpenFolders();
  }, [loadOpenFolders]);

  const handleToggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
    // Load contents if not loaded
    if (!folderContents[folderPath]) {
      loadFolderContents(folderPath);
    }
  }, [folderContents, loadFolderContents]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b bg-card px-2">
        <span className="text-[11px] font-medium">File Explorer</span>
        <button
          className="rounded p-1 text-[9px] text-muted-foreground hover:bg-accent"
          onClick={handleOpenFolder}
          title="Open Folder"
          disabled={loading}
        >
          {loading ? "..." : "📁"}
        </button>
      </div>

      {/* Folder List */}
      <div className="flex-1 overflow-auto p-1">
        {openFolders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
            <span className="text-[11px] text-muted-foreground">No folder open</span>
            <button
              className="rounded bg-primary px-3 py-1 text-[10px] text-primary-foreground hover:bg-primary/90"
              onClick={handleOpenFolder}
              disabled={loading}
            >
              Open Folder
            </button>
          </div>
        ) : (
          openFolders.map((folder) => (
            <div key={folder} className="mb-2">
              <button
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent/50"
                onClick={() => handleToggleFolder(folder)}
              >
                <span className="inline-block w-3 text-[9px] text-muted-foreground">
                  {expandedFolders[folder] ? "▼" : "▶"}
                </span>
                <FolderIcon open={!!expandedFolders[folder]} />
                <span className="truncate text-[10px] font-medium">
                  {folder.split(/[/\\]/).pop()}
                </span>
              </button>
              {expandedFolders[folder] && (
                <div>
                  {!folderContents[folder] && (
                    <div className="px-4 py-1 text-[10px] text-muted-foreground">Loading...</div>
                  )}
                  {folderContents[folder]?.map((node) => (
                    <TreeNode
                      key={node.path}
                      node={node}
                      depth={1}
                      onOpenFile={onOpenFile}
                      activeFilePath={activeFilePath}
                      basePath={folder}
                      readDir={readDir}
                    />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
