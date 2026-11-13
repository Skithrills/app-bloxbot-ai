import { memo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Shared remark plugins for chat markdown (module-level to keep a stable reference). */
export const REMARK_PLUGINS = [remarkGfm];

const block =
  (className: string) =>
  ({ children }: { children?: ReactNode }) => <span className={className}>{children}</span>;

/**
 * Compact markdown rendering for previews that sit inside interactive controls.
 * Every element renders as a span so the output stays valid phrasing content,
 * links are plain text, and images collapse to their alt text.
 */
const previewComponents: Components = {
  p: block("md-preview-block"),
  h1: block("md-preview-block md-preview-heading"),
  h2: block("md-preview-block md-preview-heading"),
  h3: block("md-preview-block md-preview-heading"),
  h4: block("md-preview-block md-preview-heading"),
  h5: block("md-preview-block md-preview-heading"),
  h6: block("md-preview-block md-preview-heading"),
  blockquote: block("md-preview-block md-preview-quote"),
  ul: block("md-preview-block md-preview-list"),
  ol: block("md-preview-block md-preview-list md-preview-ordered"),
  li: block("md-preview-item"),
  pre: block("md-preview-block md-preview-pre"),
  code: block("md-preview-code"),
  a: block("md-preview-link"),
  table: block("md-preview-block"),
  thead: block(""),
  tbody: block(""),
  tr: block("md-preview-block"),
  th: block("md-preview-cell"),
  td: block("md-preview-cell"),
  hr: () => null,
  br: () => " ",
  img: ({ alt }) => alt || "Image",
  input: ({ checked }) => (checked ? "[x] " : "[ ] "),
};

export const MarkdownPreview = memo(function MarkdownPreview({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} components={previewComponents} skipHtml>
      {text}
    </Markdown>
  );
});
