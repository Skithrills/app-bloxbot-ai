import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useContextFiles, useWriteContextSettings } from "@/hooks/useContextFiles";

const PRIORITIES = ["critical", "normal", "background"] as const;

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-500",
  normal: "text-foreground",
  background: "text-muted-foreground",
};

function ContextTab() {
  const { data: files, isLoading, error, refetch } = useContextFiles();
  const writeSettings = useWriteContextSettings();
  const [maxTokens, setMaxTokens] = useState(2000);
  const [localFiles, setLocalFiles] = useState<
    Array<{ name: string; enabled: boolean; priority: string; tokens: number }>
  >([]);
  const [autoCodebase, setAutoCodebase] = useState(false);
  const [workspaceDir, setWorkspaceDir] = useState<string>("");
  const [isChangingDir, setIsChangingDir] = useState(false);

  // Load current workspace dir
  useEffect(() => {
    invoke<string>("get_workspace_dir")
      .then((dir) => setWorkspaceDir(dir))
      .catch(() => setWorkspaceDir(""));
  }, []);

  // Sync local state when data arrives
  useMemo(() => {
    if (!files) return;
    if (localFiles.length === 0 && files.length > 0) {
      setLocalFiles(
        files.map((f) => ({
          name: f.name,
          enabled: f.enabled,
          priority: f.priority,
          tokens: f.tokens,
        }))
      );
    }
  }, [files]);

  const totalTokens = useMemo(
    () => localFiles.filter((f) => f.enabled).reduce((sum, f) => sum + f.tokens, 0),
    [localFiles]
  );

  const budgetPercent = Math.min((totalTokens / maxTokens) * 100, 100);
  const budgetColor =
    budgetPercent > 90 ? "bg-red-500" : budgetPercent > 70 ? "bg-yellow-500" : "bg-green-500";

  const handleToggle = useCallback((name: string) => {
    setLocalFiles((prev) =>
      prev.map((f) => (f.name === name ? { ...f, enabled: !f.enabled } : f))
    );
  }, []);

  const handlePriorityChange = useCallback((name: string, priority: string) => {
    setLocalFiles((prev) =>
      prev.map((f) => (f.name === name ? { ...f, priority } : f))
    );
  }, []);

  const handleSave = useCallback(() => {
    writeSettings.mutate({
      maxTokens,
      files: localFiles.map((f) => ({
        name: f.name,
        enabled: f.enabled,
        priority: f.priority,
      })),
      autoCodebase,
    });
  }, [maxTokens, localFiles, autoCodebase, writeSettings]);

  const handleChangeWorkspaceDir = useCallback(async () => {
    setIsChangingDir(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: workspaceDir || undefined,
      });
      if (typeof selected === "string" && selected !== workspaceDir) {
        await invoke<string>("set_workspace_dir", { path: selected });
        setWorkspaceDir(selected);
        toast.success("Workspace directory updated");
        // Refresh context files from new location
        refetch();
      }
    } catch (e) {
      toast.error(`Failed to change directory: ${e}`);
    } finally {
      setIsChangingDir(false);
    }
  }, [workspaceDir, refetch]);

  const hasChanges = useMemo(() => {
    if (!files) return false;
    if (localFiles.length !== files.length) return false;
    const filesChanged = localFiles.some((lf, i) => {
      const rf = files[i];
      return (
        lf.name !== rf.name ||
        lf.enabled !== rf.enabled ||
        lf.priority !== rf.priority
      );
    });
    return filesChanged || autoCodebase !== (files as any).autoCodebase;
  }, [files, localFiles, autoCodebase]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading context files...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <span className="text-sm text-red-500">Failed to load context files</span>
        <button
          className="rounded px-3 py-1 text-xs bg-accent hover:bg-accent/80"
          onClick={() => refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm text-muted-foreground">
          No context files found.
        </div>
        <div className="text-xs text-muted-foreground/60 max-w-xs">
          Create <code className="text-[10px] bg-muted px-1 rounded">.md</code> files in{" "}
          <code className="text-[10px] bg-muted px-1 rounded">.bloxbot/context/</code> to inject
          project context into the AI prompt.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div>
        <h4 className="text-sm font-semibold">Context Management</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Control which files are injected into the AI prompt and set priority tiers.
        </p>
      </div>

      {/* Working Directory */}
      <div className="rounded-lg border bg-card p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium">Working Directory</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate" title={workspaceDir}>
            {workspaceDir || "Default (~/BloxBot)"}
          </div>
        </div>
        <button
          onClick={handleChangeWorkspaceDir}
          disabled={isChangingDir}
          className="inline-flex h-6 shrink-0 items-center rounded bg-accent px-2 text-[11px] font-medium hover:bg-accent/80 disabled:opacity-50"
        >
          {isChangingDir ? "..." : "Change"}
        </button>
      </div>

      {/* Budget bar */}
      <div className="rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium">Token Budget</span>
          <span className="text-xs text-muted-foreground">
            {totalTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${budgetColor}`}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-muted-foreground">Max:</span>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            className="h-6 w-20 rounded border bg-background px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
            min={100}
            step={100}
          />
          <span className="text-[10px] text-muted-foreground">tokens</span>
        </div>
      </div>

      {/* Auto codebase toggle */}
      <div className="rounded-lg border bg-card p-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-medium">Auto codebase.md</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Automatically generate codebase.md from the Studio explorer tree
          </div>
        </div>
        <button
          onClick={() => setAutoCodebase((v) => !v)}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
            autoCodebase ? "bg-foreground" : "bg-border"
          }`}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-background transition-transform ${
              autoCodebase ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* File list */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span className="flex-1">File</span>
          <span className="w-16 text-right">Tokens</span>
          <span className="w-20 text-right">Priority</span>
          <span className="w-10 text-right">On</span>
        </div>
        {localFiles.map((file) => (
          <div
            key={file.name}
            className={`flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-xs transition-colors ${
              file.enabled ? "text-foreground" : "text-muted-foreground/50"
            }`}
          >
            <span className="flex-1 truncate font-medium">{file.name}.md</span>
            <span className="w-16 text-right text-muted-foreground">
              {file.tokens.toLocaleString()}
            </span>
            <select
              value={file.priority}
              onChange={(e) => handlePriorityChange(file.name, e.target.value)}
              className={`w-20 h-6 rounded border bg-background px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring ${PRIORITY_COLORS[file.priority] || ""}`}
              disabled={!file.enabled}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <div className="w-10 text-right">
              <button
                onClick={() => handleToggle(file.name)}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  file.enabled ? "bg-foreground" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-background transition-transform ${
                    file.enabled ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Save button */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {hasChanges ? "Unsaved changes" : "All changes saved"}
        </span>
        <button
          onClick={handleSave}
          disabled={!hasChanges || writeSettings.isPending}
          className="inline-flex h-7 items-center gap-1 rounded bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {writeSettings.isPending ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

export default ContextTab;
