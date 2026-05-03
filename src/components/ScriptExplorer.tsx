import { useCallback, useMemo, useState } from "react";

import { useGameTree, type GameTreeNode } from "@/hooks/useGameTree";

interface TreeItem {
  path: string;
  name: string;
  className: string;
  children: TreeItem[];
  isScript: boolean;
}

function buildTree(nodes: GameTreeNode[]): TreeItem[] {
  const root: TreeItem = { path: "game", name: "game", className: "DataModel", children: [], isScript: false };
  const map = new Map<string, TreeItem>();
  map.set("game", root);

  for (const node of nodes) {
    const parts = node.fullPath.split(".");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join(".") || "game";

    const item: TreeItem = {
      path: node.fullPath,
      name,
      className: node.className,
      children: [],
      isScript: ["Script", "LocalScript", "ModuleScript"].includes(node.className),
    };
    map.set(node.fullPath, item);

    const parent = map.get(parentPath);
    if (parent) {
      parent.children.push(item);
    }
  }

  // Sort: folders first, then scripts, alphabetically within each group
  function sortChildren(item: TreeItem) {
    item.children.sort((a, b) => {
      const aIsFolder = !a.isScript;
      const bIsFolder = !b.isScript;
      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    item.children.forEach(sortChildren);
  }
  sortChildren(root);

  return root.children;
}

interface ScriptExplorerProps {
  onOpenScript: (path: string) => void;
  activePath?: string | null;
}

function TreeNode({
  item,
  depth,
  onOpenScript,
  activePath,
}: {
  item: TreeItem;
  depth: number;
  onOpenScript: (path: string) => void;
  activePath?: string | null;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = item.children.length > 0;
  const isActive = activePath === item.path;

  const handleClick = useCallback(() => {
    if (item.isScript) {
      onOpenScript(item.path);
    } else if (hasChildren) {
      setExpanded((v) => !v);
    }
  }, [item, hasChildren, onOpenScript]);

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] transition-colors ${
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-foreground hover:bg-accent/50"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        {hasChildren && !item.isScript && (
          <span className="inline-block w-3 text-[9px] text-muted-foreground">
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {item.isScript ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        )}
        <span className="truncate">{item.name}</span>
        <span className="ml-auto text-[9px] text-muted-foreground opacity-50">
          {item.className}
        </span>
      </button>
      {expanded && hasChildren && (
        <div>
          {item.children.map((child) => (
            <TreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              onOpenScript={onOpenScript}
              activePath={activePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptExplorer({ onOpenScript, activePath }: ScriptExplorerProps) {
  const { data, isLoading, error, refetch } = useGameTree(true);
  const tree = useMemo(() => (data?.nodes ? buildTree(data.nodes) : []), [data]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
        Loading game tree...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-2">
        <span className="text-[11px] text-red-500">Failed to load game tree</span>
        <button
          className="rounded px-2 py-1 text-[10px] bg-accent hover:bg-accent/80"
          onClick={() => refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b bg-card px-2">
        <span className="text-[11px] font-medium">Explorer</span>
        <button
          className="rounded p-1 text-[9px] text-muted-foreground hover:bg-accent"
          onClick={() => refetch()}
          title="Refresh"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 overflow-auto p-1">
        {tree.length === 0 ? (
          <div className="p-2 text-[11px] text-muted-foreground">
            No scripts found. Make sure Roblox Studio is open with MCP enabled.
          </div>
        ) : (
          tree.map((item) => (
            <TreeNode
              key={item.path}
              item={item}
              depth={0}
              onOpenScript={onOpenScript}
              activePath={activePath}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default ScriptExplorer;
