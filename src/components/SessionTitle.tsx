import { useLayoutEffect, useRef, useState } from "react";
import { useRenameSession } from "@/hooks/mutations/useRenameSession";

export default function SessionTitle({
  sessionId,
  title,
}: {
  sessionId: string;
  title: string | null;
}) {
  const renameSession = useRenameSession();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const editing = draft !== null;
  const displayTitle =
    (renameSession.isPending ? renameSession.variables.title : title) || "Untitled";

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  function saveTitle() {
    const nextTitle = draft?.trim();
    setDraft(null);
    if (nextTitle && nextTitle !== title) {
      renameSession.mutate({ sessionID: sessionId, title: nextTitle });
    }
  }

  return (
    <h3 className="min-w-0 flex-1 text-lg font-medium">
      {editing ? (
        <input
          ref={inputRef}
          aria-label="Chat title"
          className="h-8 w-full max-w-xl rounded-md border border-ring bg-background px-1.5 outline-none"
          placeholder="Untitled"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              (event.key !== "Enter" && event.key !== "Escape")
            ) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            restoreFocusRef.current = true;
            if (event.key === "Enter") saveTitle();
            else setDraft(null);
          }}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          title="Rename chat"
          aria-disabled={renameSession.isPending || undefined}
          className="block h-8 max-w-full cursor-text truncate rounded-md border border-transparent px-1.5 text-left hover:bg-accent/50 focus-visible:outline-1 focus-visible:outline-ring"
          onClick={() => {
            if (!renameSession.isPending) setDraft(title ?? "");
          }}
        >
          {displayTitle}
        </button>
      )}
    </h3>
  );
}
