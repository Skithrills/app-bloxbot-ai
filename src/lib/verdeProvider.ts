// src/lib/verdeProvider.ts
export function isScriptClass(className: string): boolean {
  return className === "Script" || className === "LocalScript" || className === "ModuleScript";
}

export interface SortableNode {
  id: string;
  name: string;
  className: string;
}

export class InstanceSorter {
  private getServiceOrder(className: string): number {
    const serviceOrder = [
      "Workspace",
      "Players",
      "Lighting",
      "MaterialService",
      "ReplicatedFirst",
      "ReplicatedStorage",
      "ServerScriptService",
      "ServerStorage",
      "StarterGui",
      "StarterPack",
      "StarterPlayer",
      "Teams",
      "SoundService",
      "TextChatService",
      "TestService",
      "LocalizationService",
      "VoiceChatService",
      "VRService",
    ];
    const index = serviceOrder.indexOf(className);
    return index === -1 ? -1 : index;
  }

  public sortNodes(nodes: SortableNode[]): SortableNode[] {
    return nodes.sort((a, b) => {
      const aServiceOrder = this.getServiceOrder(a.className);
      const bServiceOrder = this.getServiceOrder(b.className);
      const aIsService = aServiceOrder !== -1;
      const bIsService = bServiceOrder !== -1;

      const aIsSpecial = a.className === "Camera" || a.className === "Terrain";
      const bIsSpecial = b.className === "Camera" || b.className === "Terrain";

      const aIsFolder = a.className === "Folder";
      const bIsFolder = b.className === "Folder";

      const aIsSpawnLocation = a.className === "SpawnLocation";
      const bIsSpawnLocation = b.className === "SpawnLocation";

      if (aIsService && bIsService) return aServiceOrder - bServiceOrder;
      if (aIsService && !bIsService) return -1;
      if (!aIsService && bIsService) return 1;

      if (aIsSpecial && bIsSpecial) {
        if (a.className === "Camera") return -1;
        if (b.className === "Camera") return 1;
        return 0;
      }
      if (aIsSpecial && !bIsSpecial) return -1;
      if (!aIsSpecial && bIsSpecial) return 1;

      if (aIsFolder && !bIsFolder) return -1;
      if (!aIsFolder && bIsFolder) return 1;

      if (aIsSpawnLocation && !bIsSpawnLocation) return -1;
      if (!aIsSpawnLocation && bIsSpawnLocation) return 1;

      return a.name.localeCompare(b.name);
    });
  }
}

export type Node = {
  id: string;
  name: string;
  className: string;
  parentId: string | null;
  children: string[];
};

export type Snapshot = {
  rootIds: string[];
  nodes: Node[];
};

export type ExplorerDeltaOp =
  | { type: "remove_node"; timestamp?: number; id: string }
  | { type: "update_node"; timestamp?: number; id: string; name?: string }
  | { type: "move_node"; timestamp?: number; id: string; newParentId: string | null }
  | {
      type: "add_subtree";
      timestamp?: number;
      rootId: string;
      parentId: string | null;
      nodes: Node[];
    };

const DELTA_OP_ORDER: Record<string, number> = {
  remove_node: 0,
  update_node: 1,
  move_node: 2,
  add_subtree: 3,
};

export class RobloxExplorerProvider {
  private nodesById: Map<string, Node> = new Map();
  private rootIds: string[] = [];
  private sorter: InstanceSorter;
  private onChangeCallbacks: (() => void)[] = [];

  constructor() {
    this.sorter = new InstanceSorter();
  }

  public onChange(callback: () => void): void {
    this.onChangeCallbacks.push(callback);
  }

  private fireChange(): void {
    for (const cb of this.onChangeCallbacks) {
      cb();
    }
  }

  public getNodeById(id: string): Node | undefined {
    return this.nodesById.get(id);
  }

  private deleteNodeAndDescendants(id: string): void {
    const node = this.nodesById.get(id);
    if (!node) return;
    for (const childId of node.children) {
      this.deleteNodeAndDescendants(childId);
    }
    this.nodesById.delete(id);
  }

  public getAllNodes(): Node[] {
    return Array.from(this.nodesById.values());
  }

  public getRootIds(): string[] {
    return this.rootIds;
  }

  public getSortedChildren(parentId: string | null): Node[] {
    let nodes: Node[];
    if (parentId === null) {
      nodes = this.rootIds
        .map((rootId) => this.nodesById.get(rootId))
        .filter((node): node is Node => node !== undefined);
    } else {
      const parent = this.nodesById.get(parentId);
      if (!parent) return [];
      const childArr = Array.isArray(parent.children)
        ? parent.children
        : (Object.values(parent.children || {}) as string[]);
      nodes = childArr
        .map((childId) => this.nodesById.get(childId as string))
        .filter((node): node is Node => node !== undefined);
    }
    return this.sorter.sortNodes(nodes) as Node[];
  }

  public setSnapshot(snapshot: Snapshot): void {
    const nextNodesById = new Map<string, Node>();
    // Handle both array (standalone Verde) and object/map (BloxBot plugin) formats
    const nodesSource = (snapshot as any).nodes;
    const nodesArray = Array.isArray(nodesSource)
      ? nodesSource
      : Object.values(nodesSource || {});
    for (const node of nodesArray) {
      if (!node || !node.id) continue;
      node.children = Array.isArray(node.children)
        ? node.children
        : (Object.values(node.children || {}) as string[]);
      nextNodesById.set(node.id, node);
    }
    this.nodesById = nextNodesById;
    this.rootIds = Array.isArray(snapshot.rootIds)
      ? snapshot.rootIds
      : (Object.values(snapshot.rootIds || {}) as string[]);
    this.fireChange();
  }

  public applyDelta(ops: ExplorerDeltaOp[], addedRootIds?: string[]): void {
    if (this.nodesById.size === 0) return;

    const sorted = [...ops].sort((a, b) => {
      const t = (a.timestamp ?? 0) - (b.timestamp ?? 0);
      if (t !== 0) return t;
      return (DELTA_OP_ORDER[a.type] ?? 99) - (DELTA_OP_ORDER[b.type] ?? 99);
    });

    for (const op of sorted) {
      switch (op.type) {
        case "remove_node": {
          const node = this.nodesById.get(op.id);
          if (node?.parentId) {
            const parent = this.nodesById.get(node.parentId);
            if (parent) {
              const i = parent.children.indexOf(op.id);
              if (i >= 0) parent.children.splice(i, 1);
            }
          } else {
            const i = this.rootIds.indexOf(op.id);
            if (i >= 0) this.rootIds.splice(i, 1);
          }
          this.deleteNodeAndDescendants(op.id);
          break;
        }
        case "update_node": {
          const node = this.nodesById.get(op.id);
          if (node && op.name !== undefined) node.name = op.name;
          break;
        }
        case "move_node": {
          const node = this.nodesById.get(op.id);
          if (!node) break;
          if (node.parentId) {
            const oldParent = this.nodesById.get(node.parentId);
            if (oldParent) {
              const i = oldParent.children.indexOf(op.id);
              if (i >= 0) oldParent.children.splice(i, 1);
            }
          } else {
            const i = this.rootIds.indexOf(op.id);
            if (i >= 0) this.rootIds.splice(i, 1);
          }
          node.parentId = op.newParentId;
          if (op.newParentId !== null) {
            const newParent = this.nodesById.get(op.newParentId);
            if (newParent) newParent.children.push(op.id);
          } else {
            this.rootIds.push(op.id);
          }
          break;
        }
        case "add_subtree": {
          for (const n of op.nodes) {
            const children = Array.isArray(n.children)
              ? n.children
              : (Object.values(n.children || {}) as string[]);
            this.nodesById.set(n.id, { ...n, children: [...children] });
          }
          const rootNode = this.nodesById.get(op.rootId);
          if (rootNode) rootNode.parentId = op.parentId;
          if (op.parentId !== null) {
            const parent = this.nodesById.get(op.parentId);
            if (parent && !parent.children.includes(op.rootId)) {
              parent.children.push(op.rootId);
            }
          } else if (!this.rootIds.includes(op.rootId)) {
            this.rootIds.push(op.rootId);
          }
          break;
        }
      }
    }

    if (addedRootIds?.length) {
      for (const id of addedRootIds) {
        if (!this.rootIds.includes(id)) this.rootIds.push(id);
      }
    }

    this.fireChange();
  }
}

export type WebviewNode = {
  id: string;
  name: string;
  className: string;
  children: string[];
  isScript: boolean;
  parentId: string | null;
};

export function buildUpdateTreePayload(
  provider: RobloxExplorerProvider,
  selectedIds: string[] = [],
): any {
  const all = provider.getAllNodes();
  const nodes: Record<string, WebviewNode> = {};
  for (const n of all) {
    const sorted = provider.getSortedChildren(n.id);
    nodes[n.id] = {
      id: n.id,
      name: n.name,
      className: n.className,
      children: sorted.map((c) => c.id),
      isScript: isScriptClass(n.className),
      parentId: n.parentId,
    };
  }
  const roots = provider.getSortedChildren(null);
  return {
    type: "updateTree",
    nodes,
    rootIds: roots.map((c) => c.id),
    selectedIds,
  };
}

export function translateToVerdePlugin(
  payload: any,
  options?: { incrementNames?: boolean },
): any | null {
  if (!payload || !payload.type) return null;

  const operationId = crypto.randomUUID();

  switch (payload.type) {
    case "setProperty":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "set_property",
          nodeId: payload.nodeId,
          propertyName: payload.propertyName,
          propertyValue: payload.propertyValue,
        },
      };
    case "createInstance":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "create_instance",
          parentId: payload.parentId,
          className: payload.className,
        },
      };
    case "renameInstance":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "rename_instance",
          nodeId: payload.nodeId,
          newName: payload.newName,
        },
      };
    case "reparentNode":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "move_node",
          nodeId: payload.nodeId,
          newParentId: payload.newParentId,
        },
      };

    // ── Tags ─────────────────────────────────────────────────────
    case "addTag":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "add_tag",
          nodeId: payload.nodeId,
          tagName: payload.tagName,
        },
      };
    case "removeTag":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "remove_tag",
          nodeId: payload.nodeId,
          tagName: payload.tagName,
        },
      };

    // ── Attributes ───────────────────────────────────────────────
    case "addAttribute":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "add_attribute",
          nodeId: payload.nodeId,
          attributeName: payload.attributeName,
          attributeType: payload.attributeType,
        },
      };
    case "removeAttribute":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "remove_attribute",
          nodeId: payload.nodeId,
          attributeName: payload.attributeName,
        },
      };
    case "setAttribute":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "set_attribute",
          nodeId: payload.nodeId,
          attributeName: payload.attributeName,
          attributeValue: payload.attributeValue,
        },
      };
    case "renameAttribute":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "rename_attribute",
          nodeId: payload.nodeId,
          oldName: payload.oldName,
          newName: payload.newName,
        },
      };

    // ── Sound playback ───────────────────────────────────────────
    case "playSound":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "play_sound",
          nodeId: payload.nodeId,
        },
      };
    case "stopSound":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "stop_sound",
          nodeId: payload.nodeId,
        },
      };
    case "setSoundTimePosition":
      return {
        type: "operation",
        operationId,
        operation: {
          type: "set_sound_time_position",
          nodeId: payload.nodeId,
          timePosition: payload.timePosition,
        },
      };

    // ── Commands ─────────────────────────────────────────────────
    case "runCommand": {
      const cmdMap: Record<string, string> = {
        "verde.deleteInstance": "delete_instance",
        "verde.copyInstance": "copy_instance",
        "verde.pasteInstance": "paste_instance",
        "verde.duplicateInstance": "duplicate_instance",
        "verde.addInstance": "add_instance",
        "verde.undo": "undo",
        "verde.redo": "redo",
      };
      const opType = cmdMap[payload.command];
      if (opType) {
        const op: any = {
          type: opType,
          nodeId: payload.nodeId,
        };
        if (opType === "duplicate_instance") {
          op.incrementName = options?.incrementNames ?? false;
        }
        if (opType === "paste_instance") {
          // Node ID is actually targetNodeId for pasting
          delete op.nodeId;
          op.targetNodeId = payload.nodeId;
          op.incrementName = options?.incrementNames ?? false;
        }
        return {
          type: "operation",
          operationId,
          operation: op,
        };
      }
      return null;
    }
    case "selectionChanged":
    case "scriptActivated":
      return payload;
    default:
      return payload;
  }
}
