import { invoke } from "@tauri-apps/api/core";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import Chat from "@/components/Chat";
import ErrorBoundary from "@/components/ErrorBoundary";
import ThemeToggle from "@/components/ThemeToggle";
import { Toaster } from "@/components/ui/sonner";
import { useUpdater } from "@/hooks/useUpdater";
import { ActiveSessionProvider } from "@/providers/ActiveSessionProvider";
import { OpenCodeClientProvider } from "@/providers/OpenCodeClientProvider";
import { PreferencesProvider, usePreferences } from "@/providers/PreferencesProvider";
import { QueryProvider } from "@/providers/QueryProvider";

const DebugPanel = lazy(() => import("@/components/DebugPanel"));
const ScriptEditor = lazy(() => import("@/components/ScriptEditor"));
const ExplorerPanel = lazy(() => import("@/components/ExplorerPanel"));
const FileSystemExplorer = lazy(() => import("@/components/FileSystemExplorer"));

// ── Tab Types ──────────────────────────────────────────────────

interface Tab {
  id: string;
  type: "chat" | "script";
  label: string;
  path?: string;
  locked: boolean;
}

function AppInner() {
  useUpdater();
  const [debugOpen, setDebugOpen] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "chat", type: "chat", label: "Chat", locked: true },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("chat");
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const { resolvedTheme } = usePreferences();
  const [explorerMode, setExplorerMode] = useState<"studio" | "files">("studio");

  // Apply dark class to <html> whenever resolved theme changes
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolvedTheme]);

  // Clear stale auto-generated context on startup
  useEffect(() => {
    invoke("clear_auto_context").catch(() => {
      // silently ignore — auto-context is optional
    });
  }, []);

  const handleOpenScript = useCallback((path: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.type === "script" && t.path === path);
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      const newTab: Tab = {
        id: `script-${path}`,
        type: "script",
        label: path.split(".").pop() ?? path,
        path,
        locked: false,
      };
      setActiveTabId(newTab.id);
      return [...prev, newTab];
    });
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (!tab || tab.locked) return prev;
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          // Activate the previous tab
          const idx = prev.findIndex((t) => t.id === tabId);
          const fallback = prev[idx - 1] ?? prev[idx + 1];
          if (fallback) setActiveTabId(fallback.id);
        }
        return next;
      });
      // Clean up dirty tracking
      setDirtyPaths((prev) => {
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab?.path) return prev;
        const next = new Set(prev);
        next.delete(tab.path);
        return next;
      });
    },
    [activeTabId, tabs]
  );

  const handleDirtyChange = useCallback((path: string, isDirty: boolean) => {
    setDirtyPaths((prev) => {
      const next = new Set(prev);
      if (isDirty) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <main className="flex h-full flex-col overflow-hidden">
      {/* Title Bar */}
      <div
        className="flex h-9 shrink-0 items-center justify-end gap-2 border-b bg-card px-3"
        data-tauri-drag-region
      >
        <ThemeToggle />
        <button
          className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors ${
            debugOpen
              ? "bg-stone-800 text-stone-200"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          onClick={() => setDebugOpen((v) => !v)}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" x2="20" y1="19" y2="19" />
          </svg>
          Output
        </button>
      </div>

      {/* Tab Bar + Main Content + Right Sidebar */}
      <div className="flex min-h-0 flex-1">
        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-card px-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`group flex h-7 max-w-[160px] shrink-0 items-center gap-1 rounded-t px-2 text-[11px] transition-colors ${
                  tab.id === activeTabId
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
                onClick={() => setActiveTabId(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1 && !tab.locked) {
                    e.preventDefault();
                    handleCloseTab(tab.id);
                  }
                }}
              >
                <span className="truncate">
                  {tab.type === "script" && tab.path && dirtyPaths.has(tab.path) ? "• " : ""}
                  {tab.label}
                </span>
                {tab.locked && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="opacity-50">
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                  </svg>
                )}
                {!tab.locked && (
                  <span
                    className="ml-1 rounded px-0.5 text-[9px] opacity-0 hover:bg-red-500/20 hover:text-red-500 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex min-h-0 flex-1">
            {activeTab?.type === "chat" && (
              <ErrorBoundary>
                <Chat />
              </ErrorBoundary>
            )}
            {activeTab?.type === "script" && activeTab.path && (
              <ErrorBoundary>
                <Suspense fallback={null}>
                  <ScriptEditor
                    path={activeTab.path}
                    onDirtyChange={handleDirtyChange}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
        </div>

        {/* Right sidebar — Explorer */}
        <div className="w-[280px] shrink-0 border-l bg-card">
          <div className="flex h-8 items-center justify-between border-b px-2">
            <div className="flex items-center gap-1">
              <button
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  explorerMode === "studio"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
                onClick={() => setExplorerMode("studio")}
              >
                Studio
              </button>
              <button
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  explorerMode === "files"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
                onClick={() => setExplorerMode("files")}
              >
                Files
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={null}>
              {explorerMode === "studio" ? (
                <ExplorerPanel
                  onOpenScript={handleOpenScript}
                  activePath={activeTab?.type === "script" ? activeTab.path : undefined}
                />
              ) : (
                <FileSystemExplorer
                  onOpenFile={(path, _name) => handleOpenScript(path)}
                  activeFilePath={activeTab?.type === "script" ? activeTab.path : undefined}
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>

      {/* Debug panel */}
      {debugOpen && (
        <div className="shrink-0 border-t" style={{ height: "30%" }}>
          <Suspense fallback={null}>
            <DebugPanel onClose={() => setDebugOpen(false)} />
          </Suspense>
        </div>
      )}

      <Toaster />
    </main>
  );
}

function App() {
  const activeSessionIdRef = useRef<string | null>(null);

  return (
    <QueryProvider>
      <OpenCodeClientProvider activeSessionIdRef={activeSessionIdRef}>
        <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
          <PreferencesProvider>
            <AppInner />
          </PreferencesProvider>
        </ActiveSessionProvider>
      </OpenCodeClientProvider>
    </QueryProvider>
  );
}

export default App;
