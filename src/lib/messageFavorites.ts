const FAVORITES_PREFIX = "bloxbot-message-favorites:";

export function loadMessageFavorites(sessionId: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(`${FAVORITES_PREFIX}${sessionId}`) ?? "null",
    );
    if (Array.isArray(stored)) {
      return new Set(stored.filter((value): value is string => typeof value === "string"));
    }
  } catch {
    // Invalid or unavailable storage starts with an empty set.
  }
  return new Set();
}

export function saveMessageFavorites(sessionId: string, favorites: ReadonlySet<string>) {
  if (!favorites.size) {
    clearMessageFavorites(sessionId);
    return;
  }
  try {
    localStorage.setItem(`${FAVORITES_PREFIX}${sessionId}`, JSON.stringify([...favorites]));
  } catch {
    // The rail still holds the current state while storage is unavailable.
  }
}

export function clearMessageFavorites(sessionId: string) {
  try {
    localStorage.removeItem(`${FAVORITES_PREFIX}${sessionId}`);
  } catch {
    // Storage may be disabled.
  }
}
