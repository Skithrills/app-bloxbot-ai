import { useIsFetching } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import { createPortal } from "react-dom";
import { memo, useEffect, useRef, useState } from "react";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

interface ChatSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onSessionSelect: () => void;
  onOpenSettings: () => void;
}

function formatTime(timestamp: number): string {
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function statusDot(status?: { type: string }): string {
  if (!status) return "bg-stone-300";
  switch (status.type) {
    case "busy":
      return "bg-amber-400 animate-pulse";
    case "idle":
      return "bg-stone-300";
    default:
      return "bg-stone-300";
  }
}

const SessionLoadingIndicator = ({ sessionId }: { sessionId: string }) => {
  const isFetching = useIsFetching({ queryKey: qk.messages(sessionId) }) > 0;
  if (!isFetching) return null;
  return <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />;
};

const ChatSidebar = memo(function ChatSidebar({
  collapsed,
  onToggle,
  onSessionSelect,
  onOpenSettings,
}: ChatSidebarProps) {
  const { data: sessions = [] } = useSessions();
  const { activeSessionId, selectSession } = useActiveSession();
  const { data: sessionStatuses = {} } = useSessionStatuses();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const isSessionsLoading = useIsFetching({ queryKey: [qk.sessions] }) > 0;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    function onClick() {
      setOpenMenuId(null);
      setMenuPosition(null);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openMenuId]);

  const rootSessions = sessions.filter((s) => !s.parentID);
  const childSessions = sessions.filter((s) => s.parentID);
  const childMap = new Map<string, typeof sessions>();
  for (const child of childSessions) {
    const pid = child.parentID;
    if (!pid) continue;
    const list = childMap.get(pid) ?? [];
    list.push(child);
    childMap.set(pid, list);
  }

  // Menu session data
  const menuSession = rootSessions.find((s) => s.id === openMenuId);
  const menuChildren = menuSession ? childMap.get(menuSession.id) ?? [] : [];
  const menuHasChildren = menuChildren.length > 0;
  const menuIsExpanded = menuSession ? expandedParents.has(menuSession.id) : false;

  function handleSelect(id: string) {
    onSessionSelect();
    selectSession(id);
  }

  function handleCreate() {
    onSessionSelect();
    createSession.mutate();
  }

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    const activeChild = childSessions.find((s) => s.id === activeSessionId);
    const parentID = activeChild?.parentID;
    if (parentID) {
      setExpandedParents((prev) => {
        if (prev.has(parentID)) return prev;
        return new Set(prev).add(parentID);
      });
    }
  }, [activeSessionId, childSessions]);

  function startRename(session: { id: string; title?: string }) {
    setEditingId(session.id);
    setEditValue(session.title || "Untitled");
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      renameSession.mutate({ sessionID: editingId, title: editValue.trim() });
    }
    setEditingId(null);
  }

  function toggleParent(pid: string) {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  return (
    <div
      className={`flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-out ${
        collapsed ? "w-10" : "w-64"
      }`}
    >
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center justify-between py-2">
          <div className="flex flex-col items-center">
            <button
              onClick={onToggle}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Expand sidebar"
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
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              onClick={handleCreate}
              className="mt-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New session"
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <button
            onClick={onOpenSettings}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Settings"
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div className="flex h-10 items-center justify-between border-b px-3">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sessions
              {isSessionsLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleCreate}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="New session"
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
              </button>
              <button
                onClick={onToggle}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Collapse sidebar"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
            {sessions.length === 0 && (
              <div className="animate-fade-in px-3 py-6 text-center text-xs text-muted-foreground">
                No sessions yet.
                <br />
                Start a new one to begin.
              </div>
            )}
            {rootSessions.map((session, index) => {
              const isActive = session.id === activeSessionId;
              const isEditing = session.id === editingId;
              const status = sessionStatuses[session.id];
              const children = childMap.get(session.id) ?? [];
              const isExpanded = expandedParents.has(session.id);

              return (
                <div
                  key={session.id}
                  className="animate-slide-in-left"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <div
                    className={`relative mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ${
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    }`}
                    onClick={() => !isEditing && handleSelect(session.id)}
                  >
                    {status?.type === "busy" && (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-400" />
                    )}
                    {status?.type !== "busy" && (
                      <div
                        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${statusDot(status)}`}
                      />
                    )}
                    <div className="min-w-0 flex-1 overflow-hidden mr-1">
                      {isEditing ? (
                        <input
                          ref={editRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="w-full rounded bg-background px-1 text-xs outline-none ring-1 ring-ring"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="truncate text-xs font-medium leading-snug">
                          {session.title || "Untitled"}
                          <SessionLoadingIndicator sessionId={session.id} />
                        </div>
                      )}
                    </div>
                    <div className="relative ml-auto shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openMenuId === session.id) {
                            setOpenMenuId(null);
                            setMenuPosition(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPosition({ top: rect.bottom, right: window.innerWidth - rect.right });
                            setOpenMenuId(session.id);
                          }
                        }}
                        className="flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground"
                        title="More"
                      >
                        <MoreHorizontal width={14} height={14} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && children.map((child) => {
                    const cActive = child.id === activeSessionId;
                    const cStatus = sessionStatuses[child.id];
                    return (
                      <div
                        key={child.id}
                        className={`mx-1 ml-4 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ${
                          cActive
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                        }`}
                        onClick={() => handleSelect(child.id)}
                      >
                        {cStatus?.type === "busy" && (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-400" />
                        )}
                        {cStatus?.type !== "busy" && (
                          <Bot className="mt-1.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium leading-snug">
                            {child.title || "Untitled"}
                            <SessionLoadingIndicator sessionId={child.id} />
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {formatTime(child.time.updated)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="shrink-0 border-t px-3 py-2">
            <button
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </button>
          </div>
        </>
      )}
      {openMenuId && menuPosition && menuSession && createPortal(
        <div
          className="fixed z-[9999]"
          style={{ top: menuPosition.top, right: menuPosition.right }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-36 rounded-md border bg-card py-1 shadow-lg">
            {menuHasChildren && (
              <button
                onClick={() => {
                  toggleParent(menuSession.id);
                  setOpenMenuId(null);
                  setMenuPosition(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
              >
                {menuIsExpanded ? (
                  <ChevronDown width={12} height={12} />
                ) : (
                  <ChevronRight width={12} height={12} />
                )}
                {menuIsExpanded ? "Collapse" : "Expand"}
              </button>
            )}
            <button
              onClick={() => {
                startRename(menuSession);
                setOpenMenuId(null);
                setMenuPosition(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
              Rename
            </button>
            <button
              onClick={() => {
                deleteSession.mutate(openMenuId);
                setOpenMenuId(null);
                setMenuPosition(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-accent"
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default ChatSidebar;