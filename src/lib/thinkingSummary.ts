const MAX_LENGTH = 72;

/** A whole line that is a title: "**Checking the composer**" or "## Checking the composer". */
const TITLE = /^[ \t]*(?:\*\*([^*\n]+)\*\*|#{1,6}[ \t]+([^\n]+?))[ \t]*$/gm;

function tidy(label: string): string {
  const plain = label
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,]+$/, "");
  if (plain.length <= MAX_LENGTH) return plain;
  const cut = plain.slice(0, MAX_LENGTH);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), MAX_LENGTH / 2)).trimEnd()}…`;
}

/**
 * What a model is working on, read from the reasoning it shares, to show in place of "Thinking".
 * Models that summarise their reasoning title each step, and the newest title is the answer.
 * Reasoning without titles gives the sentence its newest paragraph opens with, once that sentence
 * is whole. A model that shares no reasoning gives nothing, and the label stays as it was.
 */
export function thinkingSummary(reasoning: string): string | null {
  let title: string | undefined;
  for (const match of reasoning.matchAll(TITLE)) title = match[1] ?? match[2];
  if (title?.trim()) return tidy(title) || null;

  const paragraphs = reasoning.split(/\n[ \t]*\n/);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index].trim();
    // A sentence still being written would make the label change with every word.
    const sentence = /^(.+?[.!?:])(?=\s|$)/s.exec(paragraph)?.[1];
    const written = sentence ?? (index < paragraphs.length - 1 ? paragraph : "");
    const label = tidy(written);
    if (label) return label;
  }
  return null;
}
