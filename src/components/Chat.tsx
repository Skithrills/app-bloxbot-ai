import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import AutoApproveWarning from "@/components/AutoApproveWarning";
import ChatInput from "@/components/ChatInput";
import ChatSidebar from "@/components/ChatSidebar";
import LoadingScreen from "@/components/LoadingScreen";
import SessionStatsPanel from "@/components/SessionStatsPanel";
import { useAbort } from "@/hooks/mutations/useAbort";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";
import { useSendMessage } from "@/hooks/mutations/useSendMessage";
import { useApprovalMode } from "@/hooks/useApprovalMode";
import { useIsBusy } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { usePreferences } from "@/providers/PreferencesProvider";

interface QueuedMessage {
  text: string;
  images?: Array<{ mime: string; url: string; filename?: string }>;
}

const Settings = lazy(() => import("@/components/Settings"));
const ChatMessages = lazy(() => import("@/components/ChatMessages"));

function Chat() {
  const { ready, initError } = useOpenCodeClient();
  const { activeSessionId } = useActiveSession();
  const isBusy = useIsBusy(activeSessionId);
  const createSession = useCreateSession();
  const { data: allSessions } = useSessions();

  // Get active session title from the sessions list
  const activeSessionTitle = allSessions?.find((s) => s.id === activeSessionId)?.title ?? null;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showAutoApproveWarning, setShowAutoApproveWarning] = useState(false);
  const statsPanelRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const sendMessage = useSendMessage();
  const abort = useAbort();
  const renameSession = useRenameSession();
  const { sendMode } = usePreferences();
  const { setApprovalMode } = useApprovalMode();

  // ── Editable title ───────────────────────────────────────────────────

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // ── Agent completion stats ───────────────────────────────────────────

  const [completionStats, setCompletionStats] = useState<{
    duration: number;
    toolCount: number;
  } | null>(null);
  const busyStartTimeRef = useRef<number | null>(null);
  const statsFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Message queue drain guard ────────────────────────────────────────

  const isDrainingQueueRef = useRef(false);
  const drainTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Message queue (buffered while busy) ──────────────────────────────

  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const messageQueueRef = useRef(messageQueue);
  messageQueueRef.current = messageQueue;

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clear queue on session switch
  useEffect(() => {
    setMessageQueue([]);
  }, [activeSessionId]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Auto-send queued messages when the model becomes idle
  useEffect(() => {
    if (isBusy || !activeSessionId || sendMode === "instant") return;
    if (isDrainingQueueRef.current) return;

    const queue = messageQueueRef.current;
    if (queue.length === 0) return;

    const [next, ...rest] = queue;
    isDrainingQueueRef.current = true;
    clearTimeout(drainTimeoutRef.current);
    drainTimeoutRef.current = setTimeout(() => {
      isDrainingQueueRef.current = false;
    }, 10000);
    setMessageQueue(rest);
    sendMessage.mutate(next);
  }, [isBusy, activeSessionId, sendMessage, sendMode]);

  // Clear queue drain flag once the backend acknowledges busy state
  useEffect(() => {
    if (isBusy) {
      isDrainingQueueRef.current = false;
      clearTimeout(drainTimeoutRef.current);
    }
  }, [isBusy]);

  // Track agent run duration and tool count
  useEffect(() => {
    if (isBusy) {
      busyStartTimeRef.current = Date.now();
      setCompletionStats(null);
    } else if (busyStartTimeRef.current !== null) {
      const duration = (Date.now() - busyStartTimeRef.current) / 1000;
      busyStartTimeRef.current = null;

      // Count tool parts in the most recent assistant message
      let toolCount = 0;
      if (activeSessionId) {
        const cache = queryClient.getQueryData<MessagesCache>(qk.messages(activeSessionId));
        if (cache && cache.messageIds.length > 0) {
          const lastId = cache.messageIds[cache.messageIds.length - 1];
          const lastMsg = cache.messagesById[lastId];
          if (lastMsg && lastMsg.info.role === "assistant") {
            toolCount = lastMsg.parts.filter((p) => p.type === "tool").length;
          }
        }
      }

      setCompletionStats({ duration: Math.round(duration * 10) / 10, toolCount });
      clearTimeout(statsFadeTimeoutRef.current);
      statsFadeTimeoutRef.current = setTimeout(() => setCompletionStats(null), 8000);
    }

    return () => clearTimeout(statsFadeTimeoutRef.current);
  }, [isBusy, activeSessionId, queryClient]);

  const handleQueueSubmit = useCallback(
    (message: QueuedMessage) => {
      if (sendMode === "instant") {
        if (isBusy) abort.mutate();
        sendMessage.mutate(message);
        return;
      }

      if (!isBusy) {
        sendMessage.mutate(message);
        return;
      }

      // Busy — queue based on mode
      if (sendMode === "wait") {
        if (messageQueueRef.current.length > 0) return; // Only one slot in wait mode
        setMessageQueue([message]);
      } else {
        setMessageQueue((prev) => [...prev, message]);
      }
    },
    [sendMode, isBusy, sendMessage, abort],
  );

  const handleSendNow = useCallback(
    (index: number) => {
      const msg = messageQueueRef.current[index];
      if (!msg) return;
      setMessageQueue((prev) => prev.filter((_, i) => i !== index));
      if (isBusy) abort.mutate();
      sendMessage.mutate(msg);
    },
    [isBusy, sendMessage, abort],
  );

  const handleCancel = useCallback((index: number) => {
    setMessageQueue((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);
  const handleSessionSelect = useCallback(() => setShowSettings(false), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), []);

  // ── Auto-Approve warning ─────────────────────────────────────────────

  const handleAutoApproveRequested = useCallback(() => {
    setShowAutoApproveWarning(true);
  }, []);

  const handleAutoApproveConfirm = useCallback(() => {
    setShowAutoApproveWarning(false);
    setApprovalMode("auto-approve");
  }, [setApprovalMode]);

  const handleAutoApproveCancel = useCallback(() => {
    setShowAutoApproveWarning(false);
  }, []);

  // Main chat UI
  return (
    <div className="flex min-h-0 flex-1">
      <ChatSidebar
        collapsed={sidebarCollapsed}
        onToggle={handleToggleSidebar}
        onSessionSelect={handleSessionSelect}
        onOpenSettings={handleOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {showSettings ? (
          <Suspense fallback={<LoadingScreen message="Loading settings..." />}>
            <Settings onClose={handleSessionSelect} />
          </Suspense>
        ) : !ready ? (
          <LoadingScreen message="Initializing..." />
        ) : !activeSessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="animate-fade-in-up text-center">
              <h2 className="font-serif text-2xl italic text-foreground">
                What would you like to build?
              </h2>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Create a new session or pick one from the sidebar to continue where you left off.
              </p>
              <button
                onClick={() => createSession.mutate()}
                className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New Session
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative flex h-10 shrink-0 items-center gap-3 border-b px-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onBlur={() => {
                      if (editTitleValue.trim() && activeSessionId) {
                        renameSession.mutate({
                          sessionID: activeSessionId,
                          title: editTitleValue.trim(),
                        });
                      }
                      setIsEditingTitle(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (editTitleValue.trim() && activeSessionId) {
                          renameSession.mutate({
                            sessionID: activeSessionId,
                            title: editTitleValue.trim(),
                          });
                        }
                        setIsEditingTitle(false);
                      }
                      if (e.key === "Escape") setIsEditingTitle(false);
                    }}
                    className="h-7 flex-1 rounded bg-background px-2 text-xs font-semibold outline-none ring-1 ring-ring"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEditTitleValue(activeSessionTitle || "Untitled");
                      setIsEditingTitle(true);
                    }}
                    className="truncate text-xs font-semibold hover:underline"
                    title="Click to rename"
                  >
                    {activeSessionTitle || "Untitled"}
                  </button>
                )}
                {isBusy && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-amber-600">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    Working
                  </span>
                )}
                {!isBusy && completionStats && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-emerald-600 animate-fade-in">
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
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Done in {completionStats.duration}s
                    {completionStats.toolCount > 0 && (
                      <span className="text-muted-foreground">
                        · {completionStats.toolCount} tool{completionStats.toolCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="ml-auto flex items-center">
                <button
                  onClick={() => setShowStats((p) => !p)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Session stats"
                  aria-label="Toggle session stats"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                </button>
              </div>
              {showStats && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowStats(false)} />
                  <div ref={statsPanelRef} className="absolute right-4 top-full z-50 mt-1">
                    <SessionStatsPanel onClose={() => setShowStats(false)} />
                  </div>
                </>
              )}
            </div>

            <Suspense fallback={<LoadingScreen message="Loading chat..." />}>
              <ChatMessages pendingMessages={messageQueue} />
            </Suspense>
            <ChatInput
              messageQueue={messageQueue}
              onQueueSubmit={handleQueueSubmit}
              onSendNow={handleSendNow}
              onCancel={handleCancel}
              abort={abort}
              onAutoApproveRequested={handleAutoApproveRequested}
            />
          </>
        )}

        {initError && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {initError}
          </div>
        )}

        {showAutoApproveWarning && (
          <AutoApproveWarning
            onConfirm={handleAutoApproveConfirm}
            onCancel={handleAutoApproveCancel}
          />
        )}
      </div>
    </div>
  );
}

export default Chat;
