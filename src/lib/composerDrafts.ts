import type { SerializedEditorState } from "lexical";
import { type ComposerVideo, isComposerVideo } from "@/lib/composerVideos";
import type { ComposerImage } from "@/lib/toolImages";

export interface DraftAttachment extends ComposerImage {
  id: string;
  /** Set for a video, whose `dataUrl` is then the one frame shown for it. */
  video?: ComposerVideo;
}

export interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  editorState?: SerializedEditorState;
}

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: "", attachments: [] };

const LEGACY_DRAFTS_KEY = "bloxbot-kept-drafts";
const DRAFT_KEY_PREFIX = "bloxbot-composer-draft:";
const IMAGES_KEY_PREFIX = "bloxbot-composer-images:";
const drafts = new Map<string, ComposerDraft>();
const deletedSessions = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttachment(value: unknown): value is DraftAttachment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.dataUrl === "string" &&
    typeof value.mime === "string" &&
    typeof value.filename === "string" &&
    (value.video === undefined || isComposerVideo(value.video))
  );
}

function isEditorState(value: unknown): value is SerializedEditorState {
  return (
    isRecord(value) &&
    isRecord(value.root) &&
    value.root.type === "root" &&
    Array.isArray(value.root.children)
  );
}

function decodeDraft(content: unknown, images: unknown): ComposerDraft {
  const text = isRecord(content) && typeof content.text === "string" ? content.text : "";
  const attachments = Array.isArray(images) ? images.filter(isAttachment) : [];
  const state = isRecord(content) ? content.editorState : undefined;
  return { text, attachments, ...(isEditorState(state) ? { editorState: state } : {}) };
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function removeStoredValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // The in-memory draft still works when browser storage is unavailable.
  }
}

export function saveComposerDraft(sessionId: string, draft: ComposerDraft) {
  if (deletedSessions.has(sessionId)) return;
  const previous = drafts.get(sessionId);
  const key = `${DRAFT_KEY_PREFIX}${sessionId}`;
  const imagesKey = `${IMAGES_KEY_PREFIX}${sessionId}`;
  if (!draft.text && draft.attachments.length === 0) {
    drafts.delete(sessionId);
    removeStoredValue(key);
    removeStoredValue(imagesKey);
    return;
  }

  drafts.set(sessionId, draft);
  // Save text before images. An image can exceed the entire localStorage quota.
  if (draft.text !== previous?.text || draft.editorState !== previous?.editorState) {
    if (!draft.text) removeStoredValue(key);
    else {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ text: draft.text, editorState: draft.editorState }),
        );
      } catch {
        try {
          localStorage.setItem(key, JSON.stringify({ text: draft.text }));
        } catch {
          // Keep the full draft in memory if even plain text does not fit.
        }
      }
    }
  }
  if (draft.attachments === previous?.attachments) return;
  if (draft.attachments.length === 0) removeStoredValue(imagesKey);
  else {
    try {
      localStorage.setItem(imagesKey, JSON.stringify(draft.attachments));
    } catch {
      // Avoid restoring a stale set of images when the current set won't fit.
      removeStoredValue(imagesKey);
    }
  }
}

export function readComposerDraft(sessionId: string): ComposerDraft {
  const inMemory = drafts.get(sessionId);
  if (inMemory) return inMemory;
  const draft = decodeDraft(
    readJson(`${DRAFT_KEY_PREFIX}${sessionId}`),
    readJson(`${IMAGES_KEY_PREFIX}${sessionId}`),
  );
  if (draft.text || draft.attachments.length > 0) drafts.set(sessionId, draft);
  return draft;
}

type ComposerTextListener = (sessionId: string, text: string) => void;
const textListeners = new Set<ComposerTextListener>();

/** The open composer listens here for text to take up, such as a sent message being edited. */
export function onComposerText(listener: ComposerTextListener) {
  textListeners.add(listener);
  return () => {
    textListeners.delete(listener);
  };
}

/** Puts text into a chat's composer, after anything already written there. */
export function writeInComposer(sessionId: string, text: string) {
  for (const listener of textListeners) listener(sessionId, text);
}

export function deleteComposerDraft(sessionId: string) {
  saveComposerDraft(sessionId, EMPTY_COMPOSER_DRAFT);
  // An attachment read or rejected send can finish after the chat is deleted.
  deletedSessions.add(sessionId);
}

// The old renderer saved a single snapshot on unload. Migrate it once and leave
// the new snapshots in storage when the composer opens them.
export function migrateLegacyComposerDrafts() {
  const entries = readJson(LEGACY_DRAFTS_KEY);
  if (!Array.isArray(entries)) return;
  removeStoredValue(LEGACY_DRAFTS_KEY);
  const withImages: Array<[string, ComposerDraft]> = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isRecord(entry[1])) continue;
    const [id, content] = entry;
    const existing = readComposerDraft(id);
    if (existing.text || existing.attachments.length > 0) continue;
    const draft = decodeDraft(content, content.attachments);
    saveComposerDraft(id, { ...draft, attachments: [] });
    if (draft.attachments.length > 0) withImages.push([id, draft]);
  }
  for (const [id, draft] of withImages) saveComposerDraft(id, draft);
}

migrateLegacyComposerDrafts();
