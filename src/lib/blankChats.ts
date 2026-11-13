/**
 * New chats that nothing has been sent in yet. They last for the run of BloxBot that made them.
 * The next launch removes the ones that still have nothing in them and nothing typed, so only a
 * chat with something written in its message box is kept.
 */
const STORAGE_KEY = "bloxbot-blank-chats";

function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: readonly string[]) {
  try {
    if (ids.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage every blank chat is kept, which is how it was before.
  }
}

// What earlier runs left, read before this run adds its own.
let leftover: string[] | undefined;

/** The blank chats earlier runs left behind. Handed over once, to whoever clears them up. */
export function takeLeftoverBlankChats(): string[] {
  const ids = leftover ?? read();
  leftover = [];
  return ids;
}

export function trackBlankChat(sessionID: string) {
  leftover ??= read();
  const ids = read();
  if (!ids.includes(sessionID)) write([...ids, sessionID]);
}

/** Something was sent in it, or it's gone, so it's no longer a blank chat to clear up. */
export function untrackBlankChat(sessionID: string) {
  const ids = read();
  if (ids.includes(sessionID)) write(ids.filter((id) => id !== sessionID));
}

export function resetBlankChatsForTest() {
  leftover = undefined;
}
