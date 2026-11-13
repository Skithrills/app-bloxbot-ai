import { Bot, Boxes, ChartPie, Play } from "lucide-react";
import {
  type CSSProperties,
  lazy,
  type MouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import ChatInput from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import ChatSidebar from "@/components/ChatSidebar";
import {
  CONTEXT_PANEL_ID,
  CONTEXT_TITLE_ID,
  ContextControl,
  ContextPanel,
} from "@/components/ContextPanel";
import Explorer from "@/components/Explorer";
import LoadingScreen from "@/components/LoadingScreen";
import PanelResizeHandle, { clampPanelWidth } from "@/components/PanelResizeHandle";
import PlaytestPanel from "@/components/PlaytestPanel";
import SessionTitle from "@/components/SessionTitle";
import SettingsSkeleton from "@/components/SettingsSkeleton";
import StudioNotice from "@/components/StudioNotice";
import StudioSetup from "@/components/StudioSetup";
import StudioTargetPicker from "@/components/StudioTargetPicker";
import SubagentDrawer, {
  SUBAGENT_COMPOSER_ID,
  SUBAGENT_LIST_TITLE_ID,
  SUBAGENT_ROW_ID_PREFIX,
} from "@/components/SubagentDrawer";
import { ChatGptUsageControl } from "@/components/SubscriptionUsage";
import { MENU_TRIGGER } from "@/components/ui/menu";
import { useCreateSession } from "@/hooks/mutations/useCreateSession";
import { useChatContext } from "@/hooks/useChatContext";
import { useClearBlankChats } from "@/hooks/useClearBlankChats";
import { useChatStudioUse } from "@/hooks/useMessages";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { useSessions } from "@/hooks/useSessions";
import { useStudioConnection } from "@/hooks/useStudioConnection";
import { desktop } from "@/lib/desktop";
import { setChatOnScreen, setSessionOpener } from "@/lib/sessionNotifications";
import { subagentsForSession } from "@/lib/sessionVisibility";
import type { AddComposerImage } from "@/lib/toolImages";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import { useExplorerReference } from "@/providers/ExplorerReferenceProvider";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import { useStudioTargetOptional } from "@/providers/StudioTargetProvider";

const loadSettings = () => import("@/components/Settings");
const Settings = lazy(loadSettings);
type SidePanel = "explorer" | "playtest" | "subagents";
const MIN_CHAT_WIDTH = 280;
const PLAYTEST_WIDTH = 288;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_EXPLORER_WIDTH = 220;
const MAX_EXPLORER_WIDTH = 560;
const MIN_CONTEXT_WIDTH = 220;
const MAX_CONTEXT_WIDTH = 560;
const MIN_SUBAGENT_WIDTH = 280;
const MAX_SUBAGENT_WIDTH = 680;

function Chat() {
  const { ready, initError } = useOpenCodeClient();
  const { activeSessionId, clearSession, selectSession } = useActiveSession();
  const attachImageRef = useRef<AddComposerImage>(null);
  const sessionStatus = useSessionStatus(activeSessionId);
  const isBusy = sessionStatus !== undefined && sessionStatus.type !== "idle";
  const createSession = useCreateSession();
  useClearBlankChats();
  const { data: allSessions } = useSessions();
  const studioConnection = useStudioConnection();
  const studioTarget = useStudioTargetOptional();
  const studioUse = useChatStudioUse();
  const reportStudioUse = studioTarget?.reportStudioUse;
  const studioStatus = studioTarget?.status;
  const started = studioUse?.started;
  const usedStudio = studioUse?.usedStudio;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the report waits for saved places, which the status follows
  useEffect(() => {
    if (started === undefined || usedStudio === undefined) return;
    reportStudioUse?.({ started, usedStudio });
  }, [reportStudioUse, started, usedStudio, studioStatus]);
  const hasSelectedStudio = studioTarget?.selected != null && studioTarget.status === "ready";
  // A chat whose place closed keeps its Explorer, which says what happened and comes back with it.
  const hasStudioTarget =
    hasSelectedStudio || (!!studioTarget?.missing && studioTarget.status !== "loading");

  // Get active session title from the sessions list
  const activeSession = allSessions?.find((s) => s.id === activeSessionId);
  const activeSessionTitle = activeSession?.title ?? null;
  const chatContext = useChatContext(activeSessionId, activeSession?.revert?.messageID);
  const [contextSessionID, setContextSessionID] = useState<string | null>(null);
  const showContext = !!activeSessionId && contextSessionID === activeSessionId;
  const contextTrigger = useRef<HTMLButtonElement | null>(null);
  const contextOpenedByHand = useRef(false);
  const subagentSessions = useMemo(
    () => (activeSessionId ? subagentsForSession(allSessions ?? [], activeSessionId) : []),
    [activeSessionId, allSessions],
  );
  const [subagentChoices, setSubagentChoices] = useState<
    Record<string, { open: boolean; selected: string | null }>
  >({});
  const subagentChoice = activeSessionId ? subagentChoices[activeSessionId] : undefined;
  const subagentsOpen = subagentChoice?.open === true;
  const setSubagentsOpen = useCallback(
    (open: boolean, selected?: string | null) => {
      if (!activeSessionId) return;
      setSubagentChoices((choices) => ({
        ...choices,
        [activeSessionId]: {
          open,
          selected:
            selected === undefined ? (choices[activeSessionId]?.selected ?? null) : selected,
        },
      }));
    },
    [activeSessionId],
  );
  const [preferredSubagentWidth, setPreferredSubagentWidth] = useState(384);
  const subagentToggleRef = useRef<HTMLButtonElement>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [preferredSidebarWidth, setPreferredSidebarWidth] = useState(285);
  const [preferredExplorerWidth, setPreferredExplorerWidth] = useState(288);
  const [preferredContextWidth, setPreferredContextWidth] = useState(320);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // Null until someone says. It opens by itself once a chat is about Studio, not just for one being
  // open, since it takes a lot of room from a chat about a website.
  const [explorerChoices, setExplorerChoices] = useState<Record<string, boolean>>({});
  const explorerChoice = activeSessionId ? (explorerChoices[activeSessionId] ?? null) : null;
  const setExplorerChoice = useCallback(
    (open: boolean) => {
      if (!activeSessionId) return;
      setExplorerChoices((choices) => ({ ...choices, [activeSessionId]: open }));
    },
    [activeSessionId],
  );
  const explorerCollapsed = !(
    explorerChoice ??
    (usedStudio === true || studioTarget?.missing != null || studioTarget?.studioChosen === true)
  );
  const [showSettings, setShowSettings] = useState(false);
  const [titlebarActions, setTitlebarActions] = useState<HTMLElement | null>(null);
  useEffect(() => setTitlebarActions(document.getElementById("titlebar-actions")), []);
  const [showStudioSetup, setShowStudioSetup] = useState(false);
  // From the picker the helper is already connected, so setup is done only once a Studio shows up.
  const [setupFromPicker, setSetupFromPicker] = useState(false);
  const [pickerRequest, setPickerRequest] = useState(0);
  const newChatRef = useRef<HTMLButtonElement>(null);
  // Setup is gone and took focus with it, so it goes to the message box, or New chat with no chat open.
  const focusWhatsNext = useCallback(() => {
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLElement>('[aria-label="Message"]');
      (box ?? newChatRef.current)?.focus();
    });
  }, []);
  const explorerToggleRef = useRef<HTMLButtonElement>(null);
  const [focusComposer, setFocusComposer] = useState(false);
  const [showPlaytest, setShowPlaytest] = useState(false);
  const desiredSidePanel: SidePanel | null = showPlaytest
    ? "playtest"
    : subagentsOpen && activeSession
      ? "subagents"
      : hasStudioTarget && !explorerCollapsed
        ? "explorer"
        : null;
  const [renderedSidePanel, setRenderedSidePanel] = useState<SidePanel | null>(null);
  const [sidePanelExiting, setSidePanelExiting] = useState(false);
  const sidePanelTimerRef = useRef<number | null>(null);
  // Context and Explorer share the available space in one layout change.
  const visibleSidePanel = showContext ? desiredSidePanel : renderedSidePanel;
  const explorerVisible = visibleSidePanel === "explorer";
  const sidePanelOverlay = viewportWidth <= 760;
  const contextOverlay = viewportWidth <= (explorerVisible ? 1160 : 880);
  // The chat comes first. When the window is made too narrow to fit Context beside it, Context
  // closes instead of covering the chat, and comes back once the window has room again. Only a
  // resize does this: opened by hand in a narrow window it still shows, over the chat.
  const contextRoomAt = desiredSidePanel === "explorer" ? 1160 : 880;
  const lastViewportWidth = useRef(viewportWidth);
  const contextHiddenFor = useRef<string | null>(null);
  useEffect(() => {
    const before = lastViewportWidth.current;
    lastViewportWidth.current = viewportWidth;
    const crowded = viewportWidth <= contextRoomAt;
    if (before === viewportWidth || crowded === before <= contextRoomAt) return;
    if (crowded) {
      if (!showContext) return;
      contextHiddenFor.current = activeSessionId;
      setContextSessionID(null);
    } else {
      if (contextHiddenFor.current && contextHiddenFor.current === activeSessionId) {
        setContextSessionID(activeSessionId);
      }
      contextHiddenFor.current = null;
    }
  }, [viewportWidth, contextRoomAt, showContext, activeSessionId]);
  const sidebarSpace = Math.floor(viewportWidth * 0.35);
  const sidebarMax = Math.min(
    MAX_SIDEBAR_WIDTH,
    sidebarSpace,
    visibleSidePanel === "playtest" && !sidePanelOverlay
      ? viewportWidth - MIN_CHAT_WIDTH - PLAYTEST_WIDTH
      : sidebarSpace,
  );
  const sidebarWidth = sidebarCollapsed
    ? 40
    : clampPanelWidth(preferredSidebarWidth, MIN_SIDEBAR_WIDTH, sidebarMax);
  const sidePanelSpace = sidePanelOverlay
    ? viewportWidth
    : viewportWidth - sidebarWidth - MIN_CHAT_WIDTH;
  const explorerMax = Math.min(
    MAX_EXPLORER_WIDTH,
    showContext && (!contextOverlay || sidePanelOverlay)
      ? sidePanelSpace - MIN_CONTEXT_WIDTH
      : sidePanelSpace,
  );
  const explorerWidth = clampPanelWidth(preferredExplorerWidth, MIN_EXPLORER_WIDTH, explorerMax);
  const subagentMax = Math.min(
    MAX_SUBAGENT_WIDTH,
    sidePanelOverlay ? sidePanelSpace : Math.min(sidePanelSpace, Math.floor(viewportWidth * 0.48)),
  );
  const subagentWidth = clampPanelWidth(preferredSubagentWidth, MIN_SUBAGENT_WIDTH, subagentMax);
  const contextSpace = viewportWidth - (explorerVisible ? explorerWidth : 0);
  const contextMax = Math.min(
    MAX_CONTEXT_WIDTH,
    contextOverlay ? contextSpace : contextSpace - sidebarWidth - MIN_CHAT_WIDTH,
  );
  const contextWidth = clampPanelWidth(preferredContextWidth, MIN_CONTEXT_WIDTH, contextMax);

  // Finishing setup is a decision to start, so it shouldn't need a second click.
  const { mutate: createChat } = createSession;
  const startFirstChat = useCallback(() => {
    if (!activeSessionId) createChat();
  }, [activeSessionId, createChat]);
  // Studio isn't required: BloxBot is also fine for small websites and the like.
  const [setupSkipped, setSetupSkipped] = useState<boolean | null>(null);
  useEffect(() => {
    void desktop.loadConfig().then(
      (config) => setSetupSkipped(config.studioSetupSkipped === true),
      () => setSetupSkipped(false),
    );
  }, []);
  const handleSkipSetup = useCallback(() => {
    setSetupSkipped(true);
    setShowStudioSetup(false);
    setFocusComposer(true);
    startFirstChat();
    focusWhatsNext();
    void desktop.patchConfig({ studioSetupSkipped: true });
  }, [focusWhatsNext, startFirstChat]);
  // Setup is for getting started. Once connected, Studio closing mustn't take over someone's chat.
  // Going elsewhere from the sidebar leaves setup, until the next launch.
  const [setupLeft, setSetupLeft] = useState(false);
  const everConnected = useRef(false);
  if (studioConnection.state === "connected") everConnected.current = true;
  const needsSetup =
    studioConnection.state === "waiting" &&
    setupSkipped !== true &&
    !everConnected.current &&
    !setupLeft;
  // Choosing a Studio means they're here for it after all, so the guidance can come back.
  const studioChoices = studioTarget?.studioChoices ?? 0;
  useEffect(() => {
    if (studioChoices === 0) return;
    setSetupSkipped((skipped) => {
      if (skipped) void desktop.patchConfig({ studioSetupSkipped: false });
      return skipped ? false : skipped;
    });
  }, [studioChoices]);
  // Choosing to work without Studio once is enough to stop asking on every new chat.
  const handleWorkedWithoutStudio = useCallback(() => {
    setSetupSkipped(true);
    void desktop.patchConfig({ studioSetupSkipped: true });
  }, []);
  // Setup is waiting on a Studio to appear, and nothing else checks with no chat open, or in a
  // chat working without Studio.
  const discoverStudios = studioTarget?.discover;
  const setupWatching = showStudioSetup;
  useEffect(() => {
    if (!setupWatching) return;
    const timer = window.setInterval(() => void discoverStudios?.(), 2_000);
    return () => window.clearInterval(timer);
  }, [setupWatching, discoverStudios]);
  const connectionPending =
    studioConnection.state !== "connected" &&
    (setupSkipped === null || (studioConnection.state === "checking" && !setupSkipped));

  const appScreen =
    showStudioSetup || (needsSetup && !connectionPending)
      ? "studio-setup"
      : connectionPending
        ? "studio-checking"
        : showSettings
          ? "settings"
          : !ready
            ? "loading"
            : activeSessionId
              ? "chat"
              : "home";

  useEffect(() => {
    setChatOnScreen(appScreen === "chat");
  }, [appScreen]);

  useEffect(() => {
    setSessionOpener((sessionID) => {
      setShowSettings(false);
      void selectSession(sessionID);
    });
  }, [selectSession]);

  useEffect(() => {
    if (needsSetup && !connectionPending) setShowStudioSetup(true);
  }, [needsSetup, connectionPending]);

  useEffect(() => {
    if (
      activeSessionId &&
      allSessions &&
      !allSessions.some((session) => session.id === activeSessionId)
    ) {
      clearSession();
    }
  }, [activeSessionId, allSessions, clearSession]);

  useEffect(() => {
    if (sidePanelTimerRef.current !== null) {
      window.clearTimeout(sidePanelTimerRef.current);
      sidePanelTimerRef.current = null;
    }
    if (desiredSidePanel === renderedSidePanel) {
      setSidePanelExiting(false);
      return;
    }
    if (renderedSidePanel !== null && !showContext) {
      setSidePanelExiting(true);
      sidePanelTimerRef.current = window.setTimeout(() => {
        setRenderedSidePanel(desiredSidePanel);
        setSidePanelExiting(false);
        sidePanelTimerRef.current = null;
      }, 180);
      return;
    }
    setRenderedSidePanel(desiredSidePanel);
    setSidePanelExiting(false);
  }, [desiredSidePanel, renderedSidePanel, showContext]);

  useEffect(
    () => () => {
      if (sidePanelTimerRef.current !== null) window.clearTimeout(sidePanelTimerRef.current);
    },
    [],
  );

  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);
  const handleOpenStudioSetup = useCallback(() => {
    setSetupFromPicker(true);
    setShowStudioSetup(true);
  }, []);
  const openPickerAfterSetup = useRef(false);
  const handleCloseStudioSetup = useCallback(() => {
    setSetupFromPicker(false);
    setShowStudioSetup(false);
    // The picker takes focus itself when it's what comes next, and an earlier setup's ask to focus
    // the message box mustn't take it back.
    if (openPickerAfterSetup.current) {
      setFocusComposer(false);
      return;
    }
    setFocusComposer(true);
    focusWhatsNext();
  }, [focusWhatsNext]);
  // The picker isn't on screen until setup has gone, so asking it to open has to wait until then.
  useEffect(() => {
    if (showStudioSetup || !openPickerAfterSetup.current) return;
    openPickerAfterSetup.current = false;
    setPickerRequest((request) => request + 1);
  }, [showStudioSetup]);
  // Connected isn't the end of it if this chat still has to be told which Studio to use.
  const needsStudioChoice =
    // The picker lives in a chat, so with none open there's nothing to choose in yet.
    !!activeSessionId &&
    (studioTarget?.missing != null ||
      studioTarget?.withoutStudio === true ||
      studioTarget?.unknownPlace === true ||
      (!studioTarget?.selected && (studioTarget?.targets.length ?? 0) > 1));
  const leaveSetup = useCallback(() => {
    setSetupLeft(true);
    setSetupFromPicker(false);
    setShowStudioSetup(false);
  }, []);
  const handleSessionSelect = useCallback(() => {
    setShowSettings(false);
    leaveSetup();
  }, [leaveSetup]);
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
    leaveSetup();
  }, [leaveSetup]);
  // Settings is its own chunk. Fetching it once the app has settled means it opens at once
  // instead of on the first click. Tests load it themselves when they open it.
  useEffect(() => {
    if (!ready || import.meta.env.MODE === "test") return;
    const timer = window.setTimeout(() => void loadSettings().catch(() => {}), 1200);
    return () => window.clearTimeout(timer);
  }, [ready]);
  // Someone who asked for the panel should land in it, not when it opens by itself.
  const explorerOpenedByHand = useRef(false);
  // Asked for again while it was still on its way out, it stays without ever having gone, so the
  // exit stopping counts as arriving too.
  useEffect(() => {
    if (renderedSidePanel !== "explorer" || sidePanelExiting || !explorerOpenedByHand.current) {
      return;
    }
    explorerOpenedByHand.current = false;
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[aria-label="Search Explorer"]')?.focus(),
    );
  }, [renderedSidePanel, sidePanelExiting]);
  const handleToggleExplorer = useCallback(() => {
    if (showPlaytest) {
      setShowPlaytest(false);
      explorerOpenedByHand.current = true;
      setExplorerChoice(true);
      return;
    }
    if (subagentsOpen) {
      setSubagentsOpen(false);
      explorerOpenedByHand.current = true;
      setExplorerChoice(true);
      return;
    }

    if (explorerCollapsed) explorerOpenedByHand.current = true;
    setExplorerChoice(explorerCollapsed);
  }, [showPlaytest, subagentsOpen, setSubagentsOpen, explorerCollapsed, setExplorerChoice]);
  const handleOpenPlaytest = useCallback(() => {
    if (!hasStudioTarget) return;
    setContextSessionID(null);
    setSubagentsOpen(false);
    setShowPlaytest(true);
  }, [hasStudioTarget, setSubagentsOpen]);
  const handleClosePlaytest = useCallback(() => {
    setShowPlaytest(false);
  }, []);
  const handleCloseContext = useCallback(() => {
    contextHiddenFor.current = null;
    setContextSessionID(null);
    if (contextTrigger.current?.isConnected) contextTrigger.current.focus();
    else focusWhatsNext();
  }, [focusWhatsNext]);
  const handleToggleContext = (event: MouseEvent<HTMLButtonElement>) => {
    if (showContext) {
      handleCloseContext();
      return;
    }
    if (showPlaytest) handleClosePlaytest();
    setSubagentsOpen(false);
    contextTrigger.current = event.currentTarget;
    contextOpenedByHand.current = true;
    contextHiddenFor.current = null;
    setContextSessionID(activeSessionId);
  };
  useEffect(() => {
    if (!showContext || !contextOpenedByHand.current) return;
    contextOpenedByHand.current = false;
    document.getElementById(CONTEXT_TITLE_ID)?.focus();
  }, [showContext]);
  const subagentFocusRequested = useRef<{ rootId: string; targetId: string } | null>(null);
  const handleCloseSubagents = useCallback(() => {
    subagentFocusRequested.current = null;
    setSubagentsOpen(false);
    subagentToggleRef.current?.focus();
  }, [setSubagentsOpen]);
  const handleOpenSubagent = useCallback(
    (id?: string) => {
      if (!activeSessionId) return;
      subagentFocusRequested.current = {
        rootId: activeSessionId,
        targetId: id ? SUBAGENT_COMPOSER_ID : SUBAGENT_LIST_TITLE_ID,
      };
      setShowPlaytest(false);
      setContextSessionID(null);
      setSubagentsOpen(true, id ?? null);
    },
    [activeSessionId, setSubagentsOpen],
  );
  const handleBackToSubagents = useCallback(
    (id: string) => {
      if (!activeSessionId) return;
      subagentFocusRequested.current = {
        rootId: activeSessionId,
        targetId: `${SUBAGENT_ROW_ID_PREFIX}${id}`,
      };
      setSubagentsOpen(true, null);
    },
    [activeSessionId, setSubagentsOpen],
  );
  useEffect(() => {
    if (renderedSidePanel !== "subagents" || sidePanelExiting || !subagentChoice?.open) return;
    const request = subagentFocusRequested.current;
    if (!request || request.rootId !== activeSessionId) return;
    subagentFocusRequested.current = null;
    const target =
      document.getElementById(request.targetId) ?? document.getElementById(SUBAGENT_LIST_TITLE_ID);
    target?.focus({ preventScroll: request.targetId === SUBAGENT_COMPOSER_ID });
  }, [activeSessionId, renderedSidePanel, sidePanelExiting, subagentChoice]);

  // One chat's plan shouldn't run in another.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each chat starts without it
  useEffect(() => {
    setShowPlaytest(false);
  }, [activeSessionId]);

  // The place closing can take the Explorer away with focus inside it, and without a word.
  const previousPanelRef = useRef(renderedSidePanel);
  const [panelNote, setPanelNote] = useState("");
  useEffect(() => {
    const previous = previousPanelRef.current;
    previousPanelRef.current = renderedSidePanel;
    if (hasStudioTarget) setPanelNote("");
    if (previous !== "explorer" || renderedSidePanel !== null) return;
    if (!hasStudioTarget) setPanelNote("Explorer closed.");
    if (document.activeElement === document.body) focusWhatsNext();
  }, [renderedSidePanel, hasStudioTarget, focusWhatsNext]);

  // A click on an object in a reply needs the Explorer to be showing.
  const { focusRequest, consumeFocus } = useExplorerReference();
  // Only when a click asks. setExplorerChoice changes with the chat, and that mustn't open the next
  // chat's Explorer.
  const setExplorerChoiceRef = useRef(setExplorerChoice);
  setExplorerChoiceRef.current = setExplorerChoice;
  const setSubagentsOpenRef = useRef(setSubagentsOpen);
  setSubagentsOpenRef.current = setSubagentsOpen;
  useEffect(() => {
    if (!focusRequest) return;
    setShowPlaytest(false);
    setSubagentsOpenRef.current(false);
    setExplorerChoiceRef.current(true);
  }, [focusRequest]);
  // A link still waiting for its object came from the chat being left, not the one coming up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dropped as the chat changes
  useEffect(() => {
    consumeFocus();
  }, [activeSessionId, consumeFocus]);

  // Settings brings its own sidebar, so the chat list steps aside for it.
  if (showSettings && !showStudioSetup && !needsSetup && !connectionPending) {
    return (
      <div className="flex min-h-0 flex-1 bg-sidebar">
        <Suspense fallback={<SettingsSkeleton onClose={handleSessionSelect} />}>
          <Settings onClose={handleSessionSelect} />
        </Suspense>
      </div>
    );
  }

  // Main chat UI
  return (
    <div className="relative flex min-h-0 flex-1 bg-sidebar">
      {titlebarActions && appScreen === "chat"
        ? createPortal(
            <>
              {hasStudioTarget && (
                <button
                  ref={explorerToggleRef}
                  type="button"
                  onClick={handleToggleExplorer}
                  className={`${MENU_TRIGGER} gap-1.5`}
                  aria-pressed={desiredSidePanel === "explorer"}
                  title={desiredSidePanel === "explorer" ? "Close Explorer" : "Open Explorer"}
                >
                  <Boxes aria-hidden="true" size={14} />
                  Explorer
                </button>
              )}
              {hasSelectedStudio ? (
                <button
                  type="button"
                  onClick={handleOpenPlaytest}
                  disabled={isBusy || !!studioTarget?.sendBlock}
                  className={`${MENU_TRIGGER} gap-1.5`}
                  aria-pressed={showPlaytest}
                  title={
                    studioTarget?.sendBlock ??
                    (isBusy ? "Wait for the agent to finish" : "Create a playtest plan")
                  }
                >
                  <Play aria-hidden="true" size={14} fill="currentColor" />
                  Playtest
                </button>
              ) : null}
              <button
                ref={subagentToggleRef}
                type="button"
                onClick={() => (subagentsOpen ? handleCloseSubagents() : handleOpenSubagent())}
                className={`${MENU_TRIGGER} gap-1.5`}
                aria-expanded={subagentsOpen}
                aria-controls="subagent-drawer"
                title={subagentsOpen ? "Close subagent chats" : "Open subagent chats"}
              >
                <Bot aria-hidden="true" size={14} />
                <span className="max-[680px]:sr-only">Subagents</span>
              </button>
              <button
                type="button"
                onClick={handleToggleContext}
                className={`${MENU_TRIGGER} gap-1.5 aria-expanded:bg-accent aria-expanded:text-foreground`}
                aria-expanded={showContext}
                aria-controls={CONTEXT_PANEL_ID}
                title={showContext ? "Close Context" : "Open Context"}
              >
                <ChartPie aria-hidden="true" size={14} />
                <span className="max-[680px]:sr-only">Context</span>
              </button>
              <ChatGptUsageControl />
            </>,
            titlebarActions,
          )
        : null}
      <div
        className="relative flex shrink-0 motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out has-[hr:focus]:transition-none"
        style={{ width: sidebarWidth }}
      >
        <ChatSidebar
          collapsed={sidebarCollapsed}
          onToggle={handleToggleSidebar}
          onSessionSelect={handleSessionSelect}
          onOpenSettings={handleOpenSettings}
        />
        {!sidebarCollapsed && (
          <PanelResizeHandle
            label="Resize chat sidebar"
            controls="chat-sidebar"
            edge="right"
            width={sidebarWidth}
            min={MIN_SIDEBAR_WIDTH}
            max={sidebarMax}
            onResize={setPreferredSidebarWidth}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-t-xl border-x border-t bg-background">
        {showStudioSetup || (needsSetup && !connectionPending) ? (
          <StudioSetup
            connected={
              studioConnection.state === "connected" &&
              (!studioTarget || studioTarget.status === "ready")
            }
            checking={studioConnection.checking}
            problem={studioConnection.problem}
            onCheck={() => {
              void studioConnection.checkAgain();
              if (setupFromPicker) void studioTarget?.discover();
            }}
            onContinue={() => {
              if (needsStudioChoice) openPickerAfterSetup.current = true;
              handleCloseStudioSetup();
              startFirstChat();
            }}
            onDismiss={setupFromPicker ? handleCloseStudioSetup : undefined}
            onSkip={setupFromPicker ? undefined : handleSkipSetup}
            needsChoice={needsStudioChoice}
          />
        ) : connectionPending ? (
          <LoadingScreen message="Finding Roblox Studio" animation="dots" />
        ) : !ready ? (
          <LoadingScreen message="Initializing..." />
        ) : !activeSessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="animate-fade-in-up text-center">
              <h2 className="text-xl font-medium text-foreground">What would you like to build?</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Start a new chat, or pick up where you left off.
              </p>
              <button
                ref={newChatRef}
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
                New chat
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-11 shrink-0 items-center justify-between gap-3 px-3">
              <SessionTitle
                key={activeSessionId}
                sessionId={activeSessionId}
                title={activeSessionTitle}
              />
              <div className="flex max-w-[45%] shrink-0">
                <StudioTargetPicker
                  onOpenSetup={handleOpenStudioSetup}
                  onWorkedWithoutStudio={handleWorkedWithoutStudio}
                  openRequest={pickerRequest}
                />
              </div>
            </div>

            <ChatMessages
              onOpenSubagent={handleOpenSubagent}
              onAddImage={(image) => attachImageRef.current?.(image) ?? false}
            />
            <StudioNotice
              quiet={studioUse?.started === true || setupSkipped === true}
              onWorkedWithoutStudio={handleWorkedWithoutStudio}
              onOpenSetup={handleOpenStudioSetup}
              onOpenPicker={() => setPickerRequest((request) => request + 1)}
            />
            <ChatInput
              onOpenSettings={handleOpenSettings}
              focusOnMount={focusComposer}
              attachImageRef={attachImageRef}
              contextControl={
                <ContextControl
                  value={chatContext}
                  expanded={showContext}
                  onToggle={handleToggleContext}
                />
              }
            />
          </>
        )}

        {initError && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {initError}
          </div>
        )}
      </div>
      <output className="sr-only">{panelNote}</output>
      {showContext && appScreen === "chat" ? (
        <div
          className={`flex min-h-0 shrink-0 animate-panel-grow-in overflow-hidden ${
            contextOverlay ? "absolute inset-y-0 z-30 shadow-xl" : "relative"
          }`}
          style={
            {
              width: contextWidth,
              "--side-panel-width": `${contextWidth}px`,
              right: contextOverlay ? (explorerVisible ? explorerWidth : 0) : undefined,
            } as CSSProperties
          }
        >
          {/* Full width from the first frame: the wrapper grows and uncovers it. */}
          <div className="relative flex min-h-0 shrink-0" style={{ width: contextWidth }}>
            <PanelResizeHandle
              label="Resize Context panel"
              controls={CONTEXT_PANEL_ID}
              edge="left"
              width={contextWidth}
              min={MIN_CONTEXT_WIDTH}
              max={contextMax}
              onResize={setPreferredContextWidth}
            />
            <ContextPanel value={chatContext} busy={isBusy} onClose={handleCloseContext} />
          </div>
        </div>
      ) : null}
      {visibleSidePanel && activeSessionId && !showSettings && !showStudioSetup ? (
        <div
          className={`flex min-h-0 shrink-0 ${
            sidePanelOverlay ? "absolute inset-y-0 right-0 z-20 shadow-xl" : "relative"
          } ${
            visibleSidePanel === "subagents"
              ? "w-[var(--side-panel-width)] overflow-clip"
              : "w-72 overflow-hidden"
          } ${
            explorerVisible
              ? sidePanelExiting && !showContext
                ? "animate-panel-grow-out"
                : "animate-panel-grow-in"
              : sidePanelExiting
                ? "animate-side-panel-out"
                : "animate-side-panel-in"
          }`}
          style={
            explorerVisible
              ? ({
                  width: explorerWidth,
                  "--side-panel-width": `${explorerWidth}px`,
                } as CSSProperties)
              : visibleSidePanel === "subagents"
                ? ({ "--side-panel-width": `${subagentWidth}px` } as CSSProperties)
                : undefined
          }
        >
          {explorerVisible ? (
            // Full width from the first frame, and the line that parts it from Context.
            <div
              className={`relative flex min-h-0 shrink-0 ${showContext ? "border-l" : ""}`}
              style={{ width: explorerWidth }}
            >
              {(!sidePanelExiting || showContext) && (
                <PanelResizeHandle
                  label="Resize Explorer panel"
                  controls="chat-explorer"
                  edge="left"
                  width={explorerWidth}
                  min={MIN_EXPLORER_WIDTH}
                  max={explorerMax}
                  onResize={setPreferredExplorerWidth}
                />
              )}
              <Explorer
                collapsed={false}
                sessionBusy={isBusy}
                onToggle={() => {
                  setExplorerChoice(false);
                  explorerToggleRef.current?.focus();
                }}
              />
            </div>
          ) : visibleSidePanel === "playtest" ? (
            <PlaytestPanel onClose={handleClosePlaytest} />
          ) : activeSession ? (
            <>
              {!sidePanelExiting && (
                <PanelResizeHandle
                  label="Resize subagent panel"
                  controls="subagent-drawer"
                  edge="left"
                  width={subagentWidth}
                  min={MIN_SUBAGENT_WIDTH}
                  max={subagentMax}
                  onResize={setPreferredSubagentWidth}
                />
              )}
              <SubagentDrawer
                root={activeSession}
                sessions={subagentSessions}
                selected={subagentChoice?.selected ?? null}
                onOpen={handleOpenSubagent}
                onBack={handleBackToSubagents}
                onClose={handleCloseSubagents}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default Chat;
