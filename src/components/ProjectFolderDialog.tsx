import { Dialog } from "radix-ui";
import { type FormEvent, useState } from "react";
import { placeName, useStudioTargetOptional } from "@/providers/StudioTargetProvider";
import type { ProjectFolder } from "@/types/desktop";

const secondaryButton = "rounded-md px-3 py-1.5 text-xs hover:bg-accent";
const primaryButton =
  "rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50";

export function ProjectFolderDialog({
  folder,
  isNew,
  onClose,
  onSave,
  onRemove,
}: {
  folder: ProjectFolder;
  isNew: boolean;
  onClose: () => void;
  onSave: (folder: ProjectFolder) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const studioTarget = useStudioTargetOptional();
  const [name, setName] = useState(folder.name);
  const [studio, setStudio] = useState(folder.studio);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const targets = studioTarget?.targets ?? [];
  const choices =
    studio && !targets.some((target) => target.key === studio.key) ? [studio, ...targets] : targets;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || (!removing && !name.trim())) return;
    setSaving(true);
    setError("");
    try {
      if (removing) await onRemove();
      else await onSave({ ...folder, name: name.trim(), studio });
      onClose();
    } catch {
      setError("Couldn't save the change. Try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[250] bg-black/55" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[251] w-[calc(100%-2rem)] max-w-sm -translate-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-2xl">
          <Dialog.Title className="text-base font-medium">
            {removing
              ? "Remove project folder?"
              : isNew
                ? "Add project folder"
                : "Edit project folder"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 break-all text-xs text-muted-foreground">
            {removing
              ? "Your chats and files stay on disk. The chats will appear outside the project group."
              : folder.directory}
          </Dialog.Description>
          <form onSubmit={submit} className="mt-4 space-y-3">
            {!removing && (
              <>
                <label className="block space-y-1 text-xs">
                  <span>Project name</span>
                  <input
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={128}
                    required
                  />
                </label>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor="project-folder-studio" className="text-xs">
                      Studio place for new chats
                    </label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => void studioTarget?.discover()}
                    >
                      Refresh
                    </button>
                  </div>
                  <select
                    id="project-folder-studio"
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                    value={studio?.key ?? ""}
                    onChange={(event) =>
                      setStudio(choices.find((target) => target.key === event.target.value) ?? null)
                    }
                  >
                    <option value="">Use chat's Studio selection</option>
                    {choices.map((target) => (
                      <option value={target.key} key={target.key}>
                        {placeName(target.label)}
                        {target.detail ? ` · ${target.detail}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {!isNew && !removing && (
                <button
                  type="button"
                  disabled={saving}
                  className={`mr-auto text-destructive ${secondaryButton}`}
                  onClick={() => setRemoving(true)}
                >
                  Remove…
                </button>
              )}
              <button type="button" disabled={saving} className={secondaryButton} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || (!removing && !name.trim())}
                className={primaryButton}
              >
                {removing ? "Remove folder" : isNew ? "Add folder" : "Save"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
