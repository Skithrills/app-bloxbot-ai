/**
 * Minimal stub for studio API types used by explorerStore.
 * The Verde WebSocket system in ExplorerPanel.tsx replaces the MCP-based
 * tree loading, so these functions are no longer actively used.
 */

export interface InstanceNode {
  name: string;
  className: string;
  path: string;
  children?: InstanceNode[];
}

export interface InstanceProperty {
  name: string;
  value: unknown;
  type: string;
  category?: string;
  readOnly?: boolean;
}

export async function getInstanceChildren(_instancePath: string): Promise<InstanceNode[]> {
  return [];
}

export async function getInstanceProperties(_instancePath: string): Promise<InstanceProperty[]> {
  return [];
}

export async function setProperty(_path: string, _name: string, _value: unknown): Promise<void> {
  // no-op
}

export async function createInstance(
  _className: string,
  _parentPath: string,
  _name?: string,
): Promise<void> {
  // no-op
}

export async function executeLuau(_code: string): Promise<unknown> {
  return {};
}
