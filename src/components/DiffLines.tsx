const LINE = {
  "+": "border-emerald-500 bg-emerald-500/10",
  "-": "border-red-500 bg-red-500/10",
  "@": "border-transparent text-muted-foreground/70",
  " ": "border-transparent",
} as const;

/**
 * A change, a line at a time: green for what was put in and red for what was taken out. Each line
 * keeps its sign beside it, so the colour isn't the only thing telling them apart.
 */
export function DiffLines({ text }: { text: string }) {
  return (
    <div className="app-scrollbar max-h-72 overflow-auto rounded-md bg-muted/50 py-1 font-mono text-xs leading-relaxed text-muted-foreground">
      {text.split("\n").map((line, index) => {
        const sign = line[0] === "+" || line[0] === "-" || line[0] === "@" ? line[0] : " ";
        return (
          <div key={index} className={`flex min-w-0 border-l-2 ${LINE[sign]}`}>
            <span aria-hidden="true" className="w-5 shrink-0 select-none text-center opacity-70">
              {sign === "@" ? "" : sign === "-" ? "−" : sign}
            </span>
            <span className="sr-only">
              {sign === "+" ? "Added: " : sign === "-" ? "Removed: " : ""}
            </span>
            <span
              className={`min-w-0 flex-1 whitespace-pre-wrap break-words pr-2 ${sign === "+" || sign === "-" ? "text-foreground" : ""}`}
            >
              {(sign === "@" ? line : line.slice(1)) || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Lines put in and taken out, as "+3 −1". Muted until `quiet` is off or its row is pointed at. */
export function DiffStat({
  added,
  removed,
  quiet = false,
}: {
  added: number;
  removed: number;
  /** Stays the colour of its row until the row is hovered or focused. */
  quiet?: boolean;
}) {
  if (added + removed === 0) return null;
  return (
    <span className="flex shrink-0 gap-1.5 text-xs tabular-nums">
      <span
        title={`${added} ${added === 1 ? "line" : "lines"} added`}
        className={quiet ? QUIET_ADDED : ADDED}
      >
        +{added}
      </span>
      <span
        title={`${removed} ${removed === 1 ? "line" : "lines"} removed`}
        className={quiet ? QUIET_REMOVED : REMOVED}
      >
        −{removed}
      </span>
    </span>
  );
}

// Written out in full: Tailwind only makes the classes it can find as whole words.
const ADDED = "text-emerald-600 dark:text-emerald-400";
const REMOVED = "text-red-600 dark:text-red-400";
const QUIET_ADDED =
  "opacity-70 transition-colors group-hover/row:text-emerald-600 group-hover/row:opacity-100 group-focus-visible/row:text-emerald-600 group-focus-visible/row:opacity-100 dark:group-hover/row:text-emerald-400 dark:group-focus-visible/row:text-emerald-400";
const QUIET_REMOVED =
  "opacity-70 transition-colors group-hover/row:text-red-600 group-hover/row:opacity-100 group-focus-visible/row:text-red-600 group-focus-visible/row:opacity-100 dark:group-hover/row:text-red-400 dark:group-focus-visible/row:text-red-400";
