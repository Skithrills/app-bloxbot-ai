import type { Message } from "./opencode/types";

export const COMPOSER_SHORTCUTS = [
  "enter",
  "mod-enter",
  "alt-enter",
  "mod-shift-enter",
  "disabled",
] as const;

export type ComposerShortcut = (typeof COMPOSER_SHORTCUTS)[number];
export type ComposerDelivery = "steer" | "queue";
export type ComposerShortcuts = Readonly<Record<ComposerDelivery, ComposerShortcut>>;

export function isPendingInboxMessage(info: Message | undefined): boolean {
  return info?.role === "user" && info.inbox?.state === "pending";
}

export const DEFAULT_COMPOSER_SHORTCUTS: ComposerShortcuts = {
  steer: "enter",
  queue: "mod-enter",
};

export function composerShortcutLabel(shortcut: ComposerShortcut) {
  const mod = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  return {
    enter: "Enter",
    "mod-enter": `${mod}+Enter`,
    "alt-enter": "Alt+Enter",
    "mod-shift-enter": `${mod}+Shift+Enter`,
    disabled: "Disabled",
  }[shortcut];
}

export function getComposerDelivery(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  shortcuts: ComposerShortcuts,
): ComposerDelivery | undefined {
  if (event.key !== "Enter") return;
  const mod = event.ctrlKey || event.metaKey;
  let shortcut: ComposerShortcut;
  if (event.altKey) {
    if (mod || event.shiftKey) return;
    shortcut = "alt-enter";
  } else if (mod) {
    shortcut = event.shiftKey ? "mod-shift-enter" : "mod-enter";
  } else {
    if (event.shiftKey) return;
    shortcut = "enter";
  }
  if (shortcuts.steer === shortcut) return "steer";
  if (shortcuts.queue === shortcut) return "queue";
}
