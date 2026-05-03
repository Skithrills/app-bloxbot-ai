/**
 * Zustand store for the Explorer & Properties panel.
 * Fetches the live DataModel from the connected Roblox Studio plugin
 * via the MCP bridge.
 */
import { create } from "zustand";
import type { InstanceNode, InstanceProperty } from "@/lib/studioApi";
import * as studioApi from "@/lib/studioApi";

// ── Types ──────────────────────────────────────────────────────────────

/** Info about a connected Verde peer (Studio session). */
export interface VerdePeer {
  addr: string;
  label: string;
  isActive: boolean;
}

/** A node added to chat context via "Add to Chat" */
export interface ChatContextNode {
  id: string;
  name: string;
  className: string;
}

/** Position of the panel — left or right of the chat area. */
export type PanelSide = "left" | "right";

interface ExplorerState {
  // ── Panel chrome ──────────────────────────────────────────────────
  panelVisible: boolean;
  panelSide: PanelSide;
  /** Width of the panel in pixels */
  panelWidth: number;
  /** Height split ratio (0-1) — fraction of height for the Explorer section */
  explorerHeightRatio: number;

  // ── Explorer tree ─────────────────────────────────────────────────
  rootNodes: InstanceNode[];
  /** Children loaded for a given path */
  childrenByPath: Record<string, InstanceNode[]>;
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  lastSelectedPath: string | null;
  isLoading: boolean;
  treeError: string | null;
  searchQuery: string;

  // ── Connection state ──────────────────────────────────────────────
  studioConnected: boolean;
  connectedPeerCount: number;
  activePeerLabel: string | null;
  peers: VerdePeer[];

  // ── Properties ────────────────────────────────────────────────────
  propertiesFor: string | null;
  propertiesClassName: string | null;
  properties: InstanceProperty[];
  propertiesLoading: boolean;
  propertiesError: string | null;

  // ── Settings ──────────────────────────────────────────────────────
  settings: {
    incrementNames: boolean;
  };

  // ── Chat context ("Add to Chat" from Explorer) ────────────────────
  chatContextNodes: ChatContextNode[];

  // ── Actions ───────────────────────────────────────────────────────
  togglePanel: () => void;
  setPanelSide: (side: PanelSide) => void;
  setPanelWidth: (width: number) => void;
  setExplorerHeightRatio: (ratio: number) => void;
  setSearchQuery: (query: string) => void;
  setSetting: <K extends keyof ExplorerState["settings"]>(
    key: K,
    value: ExplorerState["settings"][K],
  ) => void;

  loadRootNodes: () => Promise<void>;
  expandNode: (path: string) => Promise<void>;
  collapseNode: (path: string) => void;
  selectNode: (path: string, className: string, ctrlKey: boolean, shiftKey: boolean) => void;
  setSelectedPaths: (paths: string[]) => void;
  clearSelection: () => void;

  loadProperties: (path: string, className: string) => Promise<void>;
  setProperty: (path: string, name: string, value: unknown) => Promise<void>;
  createInstance: (parentPath: string, className: string, name?: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  setChatContext: (nodes: ChatContextNode[]) => void;
  removeChatContextNode: (id: string) => void;
  clearChatContext: () => void;

  // ── Connection actions ─────────────────────────────────────────────
  setStudioConnection: (connected: boolean, peerCount: number, activeLabel: string | null) => void;
  setPeers: (peers: VerdePeer[]) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Flatten the tree into a path-ordered list for Shift+Click range selection. */
function flattenVisiblePaths(
  nodes: InstanceNode[],
  expandedPaths: Set<string>,
  childrenByPath: Record<string, InstanceNode[]>,
): string[] {
  const result: string[] = [];
  function walk(list: InstanceNode[]) {
    for (const node of list) {
      result.push(node.path);
      if (expandedPaths.has(node.path)) {
        const children = childrenByPath[node.path] ?? node.children ?? [];
        walk(children);
      }
    }
  }
  walk(nodes);
  return result;
}

// ── Store ───────────────────────────────────────────────────────────────

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────
  panelVisible: false,
  panelSide: "right",
  panelWidth: 280,
  explorerHeightRatio: 0.55,

  rootNodes: [],
  childrenByPath: {},
  expandedPaths: new Set(),
  selectedPaths: new Set(),
  lastSelectedPath: null,
  isLoading: false,
  treeError: null,
  searchQuery: "",

  studioConnected: false,
  connectedPeerCount: 0,
  activePeerLabel: null,
  peers: [],

  propertiesFor: null,
  propertiesClassName: null,
  properties: [],
  propertiesLoading: false,
  propertiesError: null,

  settings: {
    incrementNames: false,
  },

  chatContextNodes: [],

  // ── Panel chrome actions ──────────────────────────────────────────

  togglePanel: () => {
    const wasVisible = get().panelVisible;
    set({ panelVisible: !wasVisible });
    // Auto-load tree on first open
    if (!wasVisible && get().rootNodes.length === 0) {
      get().loadRootNodes();
    }
  },

  setPanelSide: (side) => set({ panelSide: side }),
  setPanelWidth: (width) => set({ panelWidth: Math.max(200, Math.min(600, width)) }),
  setExplorerHeightRatio: (ratio) =>
    set({ explorerHeightRatio: Math.max(0.15, Math.min(0.85, ratio)) }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSetting: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),

  // ── Tree actions ──────────────────────────────────────────────────

  loadRootNodes: async () => {
    // Disabled: We now use Verde WebSocket via ExplorerPanel.tsx
    return;
  },

  expandNode: async (path) => {
    const s = get();
    const next = new Set(s.expandedPaths);
    next.add(path);
    set({ expandedPaths: next });

    // Only fetch if we haven't already
    if (!s.childrenByPath[path]) {
      try {
        const children = await studioApi.getInstanceChildren(path);
        set((state) => ({
          childrenByPath: { ...state.childrenByPath, [path]: children },
        }));
      } catch (err) {
        console.error(`[explorer] Failed to expand ${path}:`, err);
      }
    }
  },

  collapseNode: (path) => {
    const next = new Set(get().expandedPaths);
    next.delete(path);
    set({ expandedPaths: next });
  },

  selectNode: (path, className, ctrlKey, shiftKey) => {
    const s = get();

    if (shiftKey && s.lastSelectedPath) {
      // Range selection
      const visible = flattenVisiblePaths(s.rootNodes, s.expandedPaths, s.childrenByPath);
      const from = visible.indexOf(s.lastSelectedPath);
      const to = visible.indexOf(path);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        const next = ctrlKey ? new Set(s.selectedPaths) : new Set<string>();
        for (let i = start; i <= end; i++) {
          next.add(visible[i]);
        }
        set({ selectedPaths: next });
      }
    } else if (ctrlKey) {
      // Toggle single
      const next = new Set(s.selectedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      set({ selectedPaths: next, lastSelectedPath: path });
    } else {
      // Single select
      set({
        selectedPaths: new Set([path]),
        lastSelectedPath: path,
      });
    }

    // Load properties for the clicked node (always, regardless of multi-select)
    get().loadProperties(path, className);
  },

  clearSelection: () =>
    set({
      selectedPaths: new Set(),
      lastSelectedPath: null,
      propertiesFor: null,
      properties: [],
    }),

  setSelectedPaths: (paths: string[]) => {
    set({
      selectedPaths: new Set(paths),
      lastSelectedPath: paths.length > 0 ? paths[paths.length - 1] : null,
    });
  },

  // ── Properties actions ────────────────────────────────────────────

  loadProperties: async (path, className) => {
    set({
      propertiesFor: path,
      propertiesClassName: className,
      propertiesLoading: true,
      propertiesError: null,
    });
    try {
      const props = await studioApi.getInstanceProperties(path);
      // Only update if this is still the active selection
      if (get().propertiesFor === path) {
        set({ properties: props, propertiesLoading: false });
      }
    } catch (err) {
      console.error(`[explorer] Failed to load properties for ${path}:`, err);
      if (get().propertiesFor === path) {
        set({
          propertiesLoading: false,
          propertiesError: typeof err === "string" ? err : String(err),
        });
      }
    }
  },

  setProperty: async (path, name, value) => {
    const { properties, propertiesFor, propertiesClassName } = get();
    try {
      // Optimistic UI update
      if (propertiesFor === path) {
        const nextProps = properties.map((p) => (p.name === name ? { ...p, value } : p));
        set({ properties: nextProps });
      }

      await studioApi.setProperty(path, name, value);
    } catch (err) {
      console.error(`[explorer] Failed to set property ${name} on ${path}:`, err);
      // Revert optimisitic update on error
      if (propertiesFor === path && propertiesClassName) {
        get().loadProperties(path, propertiesClassName);
      }
      throw err;
    }
  },

  createInstance: async (parentPath, className, name) => {
    try {
      await studioApi.createInstance(className, parentPath, name);
      // We force a refresh of the parent's children locally by removing it from childrenByPath
      // and letting the tree re-fetch it if expanded.
      const s = get();
      if (s.expandedPaths.has(parentPath)) {
        // Remove from cache
        const nextChildren = { ...s.childrenByPath };
        delete nextChildren[parentPath];
        set({ childrenByPath: nextChildren });
        // Re-expand to fetch
        await s.expandNode(parentPath);
      } else {
        // If not expanded, just expand it so the new child is visible
        await get().expandNode(parentPath);
      }
    } catch (err) {
      console.error(`[explorer] Failed to create instance ${className} under ${parentPath}:`, err);
      throw err;
    }
  },

  refreshTree: async () => {
    // Keep expanded paths to preserve tree state UI structure
    set({ childrenByPath: {} });
    await get().loadRootNodes();

    // Re-fetch all expanded children in the background
    const s = get();
    const expanded = Array.from(s.expandedPaths);
    for (const path of expanded) {
      if (path.includes(".")) {
        // Only simple re-fetches; deeper restores might need nested logic if parents changed names.
        studioApi
          .getInstanceChildren(path)
          .then((children: InstanceNode[]) => {
            set((state) => ({
              childrenByPath: { ...state.childrenByPath, [path]: children },
            }));
          })
          .catch(() => {});
      }
    }
  },

  setChatContext: (nodes) =>
    set((state) => {
      // Merge: don't add duplicates
      const existing = new Set(state.chatContextNodes.map((n) => n.id));
      const merged = [...state.chatContextNodes];
      for (const node of nodes) {
        if (!existing.has(node.id)) {
          merged.push(node);
          existing.add(node.id);
        }
      }
      return { chatContextNodes: merged };
    }),
  removeChatContextNode: (id) =>
    set((state) => ({
      chatContextNodes: state.chatContextNodes.filter((n) => n.id !== id),
    })),
  clearChatContext: () => set({ chatContextNodes: [] }),

  // ── Connection actions ─────────────────────────────────────────────
  setStudioConnection: (connected, peerCount, activeLabel) => {
    const wasConnected = get().studioConnected;
    set({
      studioConnected: connected,
      connectedPeerCount: peerCount,
      activePeerLabel: activeLabel,
    });
    // When transitioning from connected to disconnected, clear all
    // tree/property data — Studio is the source of truth, so stale
    // data must never be displayed.
    if (wasConnected && !connected) {
      set({
        rootNodes: [],
        childrenByPath: {},
        expandedPaths: new Set(),
        selectedPaths: new Set(),
        lastSelectedPath: null,
        propertiesFor: null,
        propertiesClassName: null,
        properties: [],
        propertiesError: null,
      });
    }
  },
  setPeers: (peers) => set({ peers }),
}));
