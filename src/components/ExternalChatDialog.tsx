import { Dialog } from "radix-ui";
import { useState } from "react";
import { desktop } from "@/lib/desktop";
import type { ExternalChatSummary, ExternalChatTranscript } from "@/lib/externalChatTypes";
import type { ProjectFolder } from "@/types/desktop";

export function ExternalChatDialog({
  folders,
  copy,
  close,
}: {
  folders: readonly ProjectFolder[];
  copy: (chat: ExternalChatTranscript, directory?: string) => Promise<void>;
  close: () => void;
}) {
  const [query, setQuery] = useState(""),
    [folder, setFolder] = useState(""),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  const [list, setList] = useState<ExternalChatSummary[] | null>(null),
    [preview, setPreview] = useState<ExternalChatTranscript | null>(null);
  async function run(job: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await job();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read local chats.");
    } finally {
      setBusy(false);
    }
  }
  const button = "rounded border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50";
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[250] bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[251] max-h-[85vh] w-[min(32rem,90vw)] -translate-1/2 space-y-3 overflow-auto rounded-xl border bg-card p-5 text-card-foreground">
          <Dialog.Title className="font-medium">Import chats</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            Copy a local Codex or Claude Code conversation. This does not sync changes back to the
            original.
          </Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setPreview(null);
                if (query.trim().includes("://"))
                  setPreview(await desktop.readExternalChat(query.trim()));
                else setList(await desktop.listExternalChats(query.trim()));
              });
            }}
            className="flex gap-2"
          >
            <input
              aria-label="Chat link or search"
              placeholder="Paste a chat link or search local IDs"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPreview(null);
              }}
              disabled={busy}
              className="min-w-0 flex-1 rounded border bg-background p-2 text-sm"
            />
            <button disabled={busy} className={button}>
              Find
            </button>
          </form>
          {list && !preview && (
            <div className="max-h-52 overflow-auto">
              {!list.length
                ? "No matching local chats."
                : list.map((c) => (
                    <button
                      type="button"
                      key={c.ref}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => setPreview(await desktop.readExternalChat(c.ref)))
                      }
                      className="block w-full truncate rounded p-2 text-left text-sm hover:bg-accent"
                    >
                      {c.title} · {new Date(c.updatedAt).toLocaleDateString()}
                    </button>
                  ))}
            </div>
          )}
          {preview && (
            <>
              <h3 className="break-words font-medium">{preview.title}</h3>
              <p className="break-all text-xs">
                {preview.source} · {preview.messages.length} messages · {preview.cwd}
              </p>
              <blockquote className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-sm">
                {preview.messages[preview.messages.length - 1]?.text.slice(0, 700)}
              </blockquote>
              <p className="text-xs">
                {preview.warnings.join(" ")} Nothing is sent to a model until you send a message.
              </p>
              <label className="block text-sm">
                Copy into{" "}
                <select
                  className="rounded border bg-background p-1"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Default workspace</option>
                  {folders.map((f) => (
                    <option key={f.directory} value={f.directory}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {err && (
            <p role="alert" className="text-sm text-destructive">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={button} disabled={busy} onClick={close}>
              Cancel
            </button>
            {preview && (
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => void run(() => copy(preview, folder || undefined))}
              >
                Copy into BloxBot
              </button>
            )}
            {busy && <span role="status">Working…</span>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
