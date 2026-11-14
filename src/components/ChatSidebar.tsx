import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Server,
  Settings2,
} from "lucide-react";
import { type DragEvent, type MouseEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProjectFolderDialog } from "@/components/ProjectFolderDialog";
import { RojoLauncher, useRojoServingCount } from "@/components/RojoLauncher";
import { MENU_ITEM, MENU_SURFACE } from "@/components/ui/menu";
import { useArchiveSession } from "@/hooks/mutations/useArchiveSession";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useDeleteSession } from "@/hooks/mutations/useDeleteSession";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";
import { useUnarchiveSession } from "@/hooks/mutations/useUnarchiveSession";
import {
  findProjectFolder,
  useProjectFolders,
  useSaveProjectFolders,
} from "@/hooks/useProjectFolders";
import { useSessionStatuses } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";
import type { Session } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { ProjectFolder } from "@/types/desktop";

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

/** Only a chat that is working gets a marker. */
function statusDot(status?: { type: string }): string {
  return status?.type === "busy" ? "bg-[var(--running)] animate-pulse" : "hidden";
}

/** Marks a drag as a chat from this list, so nothing else dropped on a folder is taken for one. */
const CHAT_DRAG_TYPE = "application/x-bloxbot-chat";
/** Where a chat outside every folder is dropped. A folder is named by its directory. */
const OTHER_CHATS = "";
const DROP_TARGET = "rounded-md bg-brand/10";
/**
 * Stands in for the faded copy of the row a browser drags by default, which BloxBot replaces with
 * a card of its own.
 */
const NO_DRAG_IMAGE = new Image();
NO_DRAG_IMAGE.src =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** Keeps the card clear of the pointer, so what is under it can still be read. */
const DRAG_CARD_OFFSET = 14;

const folderButtonClass =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-40";

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
  const archiveSession = useArchiveSession();
  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const unarchiveSession = useUnarchiveSession();
  const folders = useProjectFolders();
  const saveFolders = useSaveProjectFolders();
  const rojoServingCount = useRojoServingCount();
  const rojoLabel =
    rojoServingCount === null ? "Rojo launcher" : `Rojo launcher (${rojoServingCount} serving)`;
  const { client } = useOpenCodeClient();
  const queryClient = useQueryClient();
  const moveSession = useMutation({
    mutationFn: async ({ sessionID, directory }: { sessionID: string; directory?: string }) => {
      if (!client) throw new Error("No client");
      const { data } = await client.session.move({ sessionID, directory }, { throwOnError: true });
      return data;
    },
    onSuccess: (session) => {
      queryClient.setQueryData<Session[]>(qk.sessions, (current) =>
        current?.map((item) => (item.id === session.id ? session : item)),
      );
    },
    onError: () => notify.error("Couldn't move the chat."),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [snoozedExpanded, setSnoozedExpanded] = useState(false);
  const [rojoOpen, setRojoOpen] = useState(false);
  const [folderEditor, setFolderEditor] = useState<{
    folder: ProjectFolder;
    isNew: boolean;
  } | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    session: Session;
    x: number;
    y: number;
    trigger?: HTMLElement;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [draggedChat, setDraggedChat] = useState<Session | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** A chat dropped somewhere new, waiting for a yes. No directory means out of every folder. */
  const [moveTarget, setMoveTarget] = useState<{
    session: Session;
    directory?: string;
    name: string;
  } | null>(null);
  const cancelMoveRef = useRef<HTMLButtonElement>(null);
  const dragCardRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // The card follows the pointer without redrawing the list on every move.
  useEffect(() => {
    if (!draggedChat) return;
    const place = (x: number, y: number) => {
      const card = dragCardRef.current;
      if (card) {
        card.style.transform = `translate(${x + DRAG_CARD_OFFSET}px, ${y + DRAG_CARD_OFFSET}px)`;
      }
    };
    place(dragStartRef.current.x, dragStartRef.current.y);
    const follow = (event: globalThis.DragEvent) => place(event.clientX, event.clientY);
    document.addEventListener("dragover", follow);
    return () => document.removeEventListener("dragover", follow);
  }, [draggedChat]);
  const [transitioningSessionId, setTransitioningSessionId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const transitionTimerRef = useRef<number | null>(null);

  const { activeSessions, snoozedSessions } = useMemo(() => {
    const active: Session[] = [];
    const snoozed: Session[] = [];
    for (const session of sessions) {
      if (session.parentID) continue;
      (session.time.archived ? snoozed : active).push(session);
    }
    return { activeSessions: active, snoozedSessions: snoozed };
  }, [sessions]);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string | undefined, Session[]>();
    for (const session of activeSessions) {
      const directory = findProjectFolder(folders, session.directory)?.directory;
      const group = groups.get(directory);
      if (group) group.push(session);
      else groups.set(directory, [session]);
    }
    return groups;
  }, [activeSessions, folders]);

  function toggleFolder(directory: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  }

  function handleSelect(id: string) {
    onSessionSelect();
    selectSession(id);
  }

  function handleCreate(directory?: string | null) {
    onSessionSelect();
    if (directory) {
      setCollapsedFolders((current) => {
        const next = new Set(current);
        next.delete(directory);
        return next;
      });
    }
    createSession.mutate(directory);
  }

  async function chooseFolder() {
    setChoosingFolder(true);
    try {
      const directory = await desktop.chooseProjectFolder();
      if (!directory) return;
      const existing = findProjectFolder(folders, directory);
      const name = (directory.split(/[\\/]/).filter(Boolean).pop() ?? directory).slice(0, 128);
      setFolderEditor({
        folder: existing ?? { directory, name, studio: null },
        isNew: !existing,
      });
    } catch {
      notify.error("Couldn't open the project folder picker.");
    } finally {
      setChoosingFolder(false);
    }
  }

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      contextMenu.trigger?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeWithEscape);
    document.querySelector<HTMLElement>("#chat-actions button:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!deleteTarget) return;
    cancelDeleteRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDeleteTarget(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteTarget]);

  useEffect(() => {
    if (!moveTarget) return;
    cancelMoveRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoveTarget(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveTarget]);

  /** The folder a chat is in, as its directory, or {@link OTHER_CHATS} when it is in none. */
  const placeOf = (session: Session) =>
    findProjectFolder(folders, session.directory)?.directory ?? OTHER_CHATS;

  /** What a folder, or the list of other chats, needs to take a chat dragged onto it. */
  function dropHandlers(place: string, name: string) {
    const accepts = draggedChat !== null && placeOf(draggedChat) !== place;
    return {
      onDragOver: (event: DragEvent) => {
        if (!accepts || !event.dataTransfer.types.includes(CHAT_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropTarget !== place) setDropTarget(place);
      },
      onDragLeave: (event: DragEvent) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        setDropTarget((current) => (current === place ? null : current));
      },
      onDrop: (event: DragEvent) => {
        const session = draggedChat;
        setDropTarget(null);
        setDraggedChat(null);
        if (!accepts || !session) return;
        event.preventDefault();
        const status = sessionStatuses[session.id];
        if (status && status.type !== "idle") {
          notify.message("Wait for the chat to finish before moving it.");
          return;
        }
        setMoveTarget({ session, directory: place || undefined, name });
      },
    };
  }

  function confirmMove() {
    if (!moveTarget) return;
    moveSession.mutate({ sessionID: moveTarget.session.id, directory: moveTarget.directory });
    setMoveTarget(null);
  }

  useEffect(
    () => () => {
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    },
    [],
  );

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

  function handleSnooze(sessionID: string) {
    const status = sessionStatuses[sessionID];
    if (status && status.type !== "idle") return;
    setTransitioningSessionId(sessionID);
    transitionTimerRef.current = window.setTimeout(() => {
      archiveSession.mutate(sessionID, { onSettled: () => setTransitioningSessionId(null) });
      transitionTimerRef.current = null;
    }, 180);
  }

  function handleSnoozedSelect(sessionID: string) {
    handleSelect(sessionID);
  }

  function handleUnsnooze(sessionID: string) {
    setTransitioningSessionId(sessionID);
    transitionTimerRef.current = window.setTimeout(() => {
      unarchiveSession.mutate(sessionID, { onSettled: () => setTransitioningSessionId(null) });
      transitionTimerRef.current = null;
    }, 180);
  }

  function openContextMenu(event: MouseEvent, session: Session) {
    event.preventDefault();
    const trigger =
      event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : undefined;
    const position = trigger && event.type === "click" ? trigger.getBoundingClientRect() : null;
    setContextMenu({
      session,
      x: Math.max(0, Math.min(position?.right ?? event.clientX, window.innerWidth - 224)),
      y: Math.max(0, Math.min(position?.bottom ?? event.clientY, window.innerHeight - 240)),
      trigger,
    });
  }

  function handleSnoozedToggle() {
    setSnoozedExpanded((expanded) => {
      const nextExpanded = !expanded;
      return nextExpanded;
    });
  }

  function requestDelete(session: Session) {
    setDeleteTarget(session);
  }

  function cancelDelete() {
    setDeleteTarget(null);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteSession.mutate(deleteTarget.id);
    setDeleteTarget(null);
  }

  function renderChat(session: Session, index: number) {
    const isActive = session.id === activeSessionId;
    const isEditing = session.id === editingId;
    const status = sessionStatuses[session.id];

    return (
      <div
        key={session.id}
        className={
          transitioningSessionId === session.id ? "animate-slide-out-left" : "animate-slide-in-left"
        }
        style={{ animationDelay: `${index * 30}ms` }}
      >
        <div
          onContextMenu={(event) => openContextMenu(event, session)}
          className={`group relative mx-1 rounded-md transition-colors duration-150 ${
            draggedChat?.id === session.id ? "opacity-40" : ""
          } ${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          }`}
        >
          {isEditing ? (
            <div className="flex items-start gap-2 px-2 py-1.5">
              <div
                className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${statusDot(status)}`}
              />
              <div className="min-w-0 flex-1">
                <input
                  ref={editRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded bg-transparent px-1 text-sm outline-none ring-1 ring-sidebar-ring"
                />
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatTime(session.time.updated)}
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              aria-current={isActive ? "page" : undefined}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left"
              onClick={() => handleSelect(session.id)}
              // Drag a chat onto a folder, or onto the other chats, to move it there.
              draggable={folders.length > 0}
              onDragStart={(event) => {
                event.dataTransfer.setData(CHAT_DRAG_TYPE, session.id);
                event.dataTransfer.setData("text/plain", session.title || "Untitled");
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setDragImage?.(NO_DRAG_IMAGE, 0, 0);
                dragStartRef.current = { x: event.clientX, y: event.clientY };
                setDraggedChat(session);
              }}
              onDragEnd={() => {
                setDraggedChat(null);
                setDropTarget(null);
              }}
            >
              <div
                className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${statusDot(status)}`}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm leading-snug group-focus-within:pr-20 group-hover:pr-20"
                  title={session.title || undefined}
                >
                  {session.title || "Untitled"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatTime(session.time.updated)}
                </div>
              </div>
            </button>
          )}

          {!isEditing && (
            <div
              className={`absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md pl-4 pr-1.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 ${
                isActive
                  ? "bg-gradient-to-l from-accent from-60% to-transparent"
                  : "bg-gradient-to-l from-card from-60% to-transparent group-hover:from-accent/50"
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(session);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                title="Rename"
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
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSnooze(session.id);
                }}
                disabled={status !== undefined && status.type !== "idle"}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                title={status && status.type !== "idle" ? "Wait for session to finish" : "Snooze"}
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
                  <path d="M3 7h18" />
                  <path d="M5 7l1 13h12l1-13" />
                  <path d="M9 11h6" />
                  <path d="M8 4h8l1 3H7l1-3z" />
                </svg>
              </button>

              <button
                type="button"
                title="Chat actions"
                aria-haspopup="menu"
                onClick={(event) => openContextMenu(event, session)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <Ellipsis size={13} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      id="chat-sidebar"
      className="flex w-full min-w-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground"
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
              onClick={() => handleCreate()}
              disabled={createSession.isPending}
              className="mt-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="New chat"
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
          <div className="flex h-11 items-center justify-between px-3">
            <span className="text-sm font-medium text-sidebar-foreground/70">Chats</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => handleCreate(null)}
                disabled={createSession.isPending}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="New chat"
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
                type="button"
                onClick={chooseFolder}
                disabled={choosingFolder}
                className={folderButtonClass}
                title="Add project folder"
              >
                <FolderPlus size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={rojoLabel}
                aria-label={rojoLabel}
                className={`${folderButtonClass} ${rojoServingCount === null ? "" : "w-auto gap-1 px-1"}`}
                onClick={() => setRojoOpen(true)}
              >
                <Server size={15} aria-hidden="true" />
                {rojoServingCount !== null && (
                  <span
                    aria-hidden="true"
                    className={`rounded px-1 text-[10px] leading-4 tabular-nums ${rojoServingCount > 0 ? "bg-success/15 text-success" : "bg-sidebar-accent"}`}
                  >
                    {rojoServingCount}
                  </span>
                )}
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
            {folders.length === 0 &&
              activeSessions.length === 0 &&
              snoozedSessions.length === 0 && (
                <div className="animate-fade-in px-3 py-6 text-center text-xs text-muted-foreground">
                  No sessions yet.
                  <br />
                  Start a new one to begin.
                </div>
              )}
            {folders.map((folder) => {
              const expanded = !collapsedFolders.has(folder.directory);
              const matches = groupedSessions.get(folder.directory) ?? [];
              const FolderIcon = expanded ? FolderOpen : Folder;
              return (
                <section
                  key={folder.directory}
                  aria-label={folder.name}
                  data-drop-target={dropTarget === folder.directory || undefined}
                  className={`mb-2 transition-colors ${dropTarget === folder.directory ? DROP_TARGET : ""}`}
                  {...dropHandlers(folder.directory, folder.name)}
                >
                  <div className="flex items-center gap-0.5 px-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      title={folder.directory}
                      onClick={() => toggleFolder(folder.directory)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-xs font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    >
                      <ChevronRight
                        size={12}
                        aria-hidden="true"
                        className={expanded ? "shrink-0 rotate-90" : "shrink-0"}
                      />
                      <FolderIcon size={14} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                    <button
                      type="button"
                      title={`New chat in ${folder.name}`}
                      disabled={createSession.isPending}
                      onClick={() => handleCreate(folder.directory)}
                      className={folderButtonClass}
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      title={`Edit ${folder.name}`}
                      onClick={() => setFolderEditor({ folder, isNew: false })}
                      className={folderButtonClass}
                    >
                      <Settings2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                  {expanded && matches.length > 0 && (
                    // The gap keeps a hovered folder title apart from an open chat right under it.
                    <div className="ml-4 mt-1">{matches.map(renderChat)}</div>
                  )}
                </section>
              );
            })}
            {/* While a chat from a folder is dragged, this is here to drop it on even when empty. */}
            {folders.length > 0 &&
              ((groupedSessions.get(undefined)?.length ?? 0) > 0 ||
                (draggedChat !== null && placeOf(draggedChat) !== OTHER_CHATS)) && (
                <section
                  aria-label="Other chats"
                  data-drop-target={dropTarget === OTHER_CHATS || undefined}
                  className={`min-h-12 pb-1 transition-colors ${dropTarget === OTHER_CHATS ? DROP_TARGET : ""}`}
                  {...dropHandlers(OTHER_CHATS, "Other chats")}
                >
                  <h2 className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Other chats
                  </h2>
                  {groupedSessions.get(undefined)?.map(renderChat)}
                </section>
              )}
            {folders.length === 0 && groupedSessions.get(undefined)?.map(renderChat)}
          </div>

          {snoozedSessions.length > 0 && (
            <div className="shrink-0 border-t border-border/70">
              <button
                type="button"
                aria-expanded={snoozedExpanded}
                onClick={handleSnoozedToggle}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${snoozedExpanded ? "rotate-90" : ""}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Snoozed
                <span className="ml-auto font-normal tabular-nums">{snoozedSessions.length}</span>
              </button>

              {snoozedExpanded && (
                <div className="max-h-40 overflow-y-auto overflow-x-hidden pb-1">
                  {snoozedSessions.map((session) => (
                    <div
                      key={session.id}
                      onContextMenu={(event) => openContextMenu(event, session)}
                      className={`group relative mx-1 flex min-w-0 items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground ${
                        transitioningSessionId === session.id
                          ? "animate-slide-out-left"
                          : "animate-slide-in-left"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSnoozedSelect(session.id)}
                        className="min-w-0 flex-1 px-2 py-1.5 text-left"
                        title={`Open snoozed session ${session.title || "Untitled"}`}
                      >
                        <div className="truncate text-sm leading-snug opacity-80">
                          {session.title || "Untitled"}
                        </div>
                        {findProjectFolder(folders, session.directory) && (
                          <div className="truncate text-xs">
                            {findProjectFolder(folders, session.directory)?.name}
                          </div>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnsnooze(session.id)}
                        className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100"
                        title="Unsnooze"
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M3 7h18" />
                          <path d="M5 7l1 13h12l1-13" />
                          <path d="M9 11h6" />
                          <path d="M12 16v-5" />
                          <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="shrink-0 space-y-1 border-t border-sidebar-border px-3 py-2">
            <button
              onClick={onOpenSettings}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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

          {contextMenu &&
            createPortal(
              <div
                id="chat-actions"
                className={`fixed z-[200] max-h-60 w-56 overflow-y-auto ${MENU_SURFACE}`}
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onPointerDown={(event) => event.stopPropagation()}
                role="menu"
              >
                {folders.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs text-muted-foreground">Move chat to</div>
                    {folders.map((folder) => (
                      <button
                        key={folder.directory}
                        type="button"
                        role="menuitem"
                        className={MENU_ITEM}
                        title={folder.directory}
                        disabled={
                          moveSession.isPending ||
                          findProjectFolder(folders, contextMenu.session.directory) === folder ||
                          sessionStatuses[contextMenu.session.id]?.type === "busy"
                        }
                        onClick={() => {
                          moveSession.mutate({
                            sessionID: contextMenu.session.id,
                            directory: folder.directory,
                          });
                          setContextMenu(null);
                        }}
                      >
                        <Folder size={14} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                    {findProjectFolder(folders, contextMenu.session.directory) && (
                      <button
                        type="button"
                        role="menuitem"
                        className={MENU_ITEM}
                        disabled={
                          moveSession.isPending ||
                          sessionStatuses[contextMenu.session.id]?.type === "busy"
                        }
                        onClick={() => {
                          moveSession.mutate({ sessionID: contextMenu.session.id });
                          setContextMenu(null);
                        }}
                      >
                        Default workspace
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={`${MENU_ITEM} text-destructive`}
                  onClick={() => {
                    const session = contextMenu.session;
                    setContextMenu(null);
                    requestDelete(session);
                  }}
                >
                  Delete
                </button>
              </div>,
              document.body,
            )}

          {rojoOpen && <RojoLauncher onClose={() => setRojoOpen(false)} />}

          {folderEditor && (
            <ProjectFolderDialog
              folder={folderEditor.folder}
              isNew={folderEditor.isNew}
              onClose={() => setFolderEditor(null)}
              onSave={(folder) =>
                saveFolders.mutateAsync((current) =>
                  findProjectFolder(current, folder.directory)
                    ? current.map((item) => (item.directory === folder.directory ? folder : item))
                    : [...current, folder],
                )
              }
              onRemove={() =>
                saveFolders.mutateAsync((current) =>
                  current.filter((item) => item.directory !== folderEditor.folder.directory),
                )
              }
            />
          )}

          {draggedChat &&
            createPortal(
              <div
                ref={dragCardRef}
                aria-hidden="true"
                data-drag-card=""
                className="pointer-events-none fixed left-0 top-0 z-[400] w-60 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-xl"
              >
                <div className="truncate text-sm font-medium leading-snug">
                  {draggedChat.title || "Untitled"}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {dropTarget === null
                    ? "Drop on a folder to move it"
                    : `Move to ${
                        dropTarget === OTHER_CHATS
                          ? "Other chats"
                          : (findProjectFolder(folders, dropTarget)?.name ?? "this folder")
                      }`}
                </div>
              </div>,
              document.body,
            )}

          {moveTarget &&
            createPortal(
              <div
                className="animate-lightbox-backdrop fixed inset-0 z-[300] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setMoveTarget(null);
                }}
              >
                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="move-session-title"
                  aria-describedby="move-session-description"
                  className="animate-scale-in w-full max-w-sm rounded-xl border bg-card p-5 text-card-foreground shadow-2xl"
                >
                  <h2 id="move-session-title" className="text-base font-medium">
                    Move chat to {moveTarget.name}?
                  </h2>
                  <p
                    id="move-session-description"
                    className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
                  >
                    {moveTarget.directory
                      ? `“${moveTarget.session.title || "Untitled"}” will work in this folder from now on, and can read and change the files in it:`
                      : `“${moveTarget.session.title || "Untitled"}” will leave its folder and work in the default workspace from now on.`}
                  </p>
                  {moveTarget.directory && (
                    <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs">
                      <Folder size={13} aria-hidden="true" className="shrink-0" />
                      <span className="truncate" title={moveTarget.directory}>
                        {moveTarget.directory}
                      </span>
                    </p>
                  )}
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      ref={cancelMoveRef}
                      type="button"
                      onClick={() => setMoveTarget(null)}
                      className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmMove}
                      className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                    >
                      Move
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )}

          {deleteTarget &&
            createPortal(
              <div
                className="animate-lightbox-backdrop fixed inset-0 z-[300] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) cancelDelete();
                }}
              >
                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="delete-session-title"
                  aria-describedby="delete-session-description"
                  className="animate-scale-in w-full max-w-sm rounded-xl border bg-card p-5 text-card-foreground shadow-2xl"
                >
                  <h2 id="delete-session-title" className="text-base font-medium">
                    Delete chat?
                  </h2>
                  <p
                    id="delete-session-description"
                    className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
                  >
                    “{deleteTarget.title || "Untitled"}” and its full conversation history will be
                    permanently deleted. This cannot be undone.
                  </p>
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      ref={cancelDeleteRef}
                      type="button"
                      onClick={cancelDelete}
                      className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDelete}
                      className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
});

export default ChatSidebar;
