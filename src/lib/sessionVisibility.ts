import type { Session } from "@/lib/opencode/types";

export function isVisibleSession(session: Session): boolean {
  return session.metadata?.bloxbotHidden !== true;
}

export function subagentsForSession(sessions: readonly Session[], rootId: string): Session[] {
  const childrenByParent = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.parentID || !isVisibleSession(session)) continue;
    const siblings = childrenByParent.get(session.parentID);
    if (siblings) siblings.push(session);
    else childrenByParent.set(session.parentID, [session]);
  }
  const seen = new Set([rootId]);
  function childrenOf(parentId: string): Session[] {
    return (childrenByParent.get(parentId) ?? []).flatMap((child) => {
      if (seen.has(child.id)) return [];
      seen.add(child.id);
      return [child, ...childrenOf(child.id)];
    });
  }
  return childrenOf(rootId);
}

export function isSessionInThread(
  sessions: readonly Session[] | undefined,
  sessionId: string,
  rootId: string | null,
): boolean {
  if (!rootId) return false;
  const seen = new Set<string>();
  let id: string | undefined = sessionId;
  while (id && !seen.has(id)) {
    if (id === rootId) return true;
    seen.add(id);
    id = sessions?.find((session) => session.id === id)?.parentID;
  }
  return false;
}
