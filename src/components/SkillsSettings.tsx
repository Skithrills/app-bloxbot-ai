import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useImportSkills } from "@/hooks/mutations/useImportSkills";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import type { SkillImportList, SkillImportResult } from "@/types/skillImport";

const skills = (count: number) => `${count} skill${count === 1 ? "" : "s"}`;

/** "Imported 14 skills, 2 updated, 1 removed", or why there was nothing to do. */
export function importSummary(result: SkillImportResult): string {
  const changes = (
    [
      ["imported", result.imported.length],
      ["updated", result.updated.length],
      ["removed", result.removed.length],
    ] as const
  ).filter(([, count]) => count > 0);
  if (changes.length === 0) {
    return result.unchanged.length > 0 ? "Everything is already up to date" : "Nothing to import";
  }
  return changes
    .map(([verb, count], index) =>
      index === 0
        ? `${verb[0].toUpperCase()}${verb.slice(1)} ${skills(count)}`
        : `${count} ${verb}`,
    )
    .join(", ");
}

function foundSummary(list: SkillImportList): string {
  if (!list.available) return "Importing skills needs the desktop app.";
  if (list.importable.length === 0) return "No skills found in those folders.";
  const waiting = list.importable.filter(
    ({ status }) => status === "new" || status === "changed",
  ).length;
  return `${skills(list.importable.length)} found, ${waiting === 0 ? "all up to date" : `${waiting} to import`}.`;
}

/** The one-click import of the user's Codex and Claude Code skills, and what BloxBot has. */
export default function SkillsSettings({ chatRunning }: { chatRunning: boolean }) {
  const {
    data: list,
    isPending: loading,
    error: unreadable,
  } = useQuery<SkillImportList>({
    queryKey: qk.skillImport,
    queryFn: () => desktop.listImportableSkills(),
  });
  const importSkills = useImportSkills();
  const [open, setOpen] = useState(false);
  const outcome = importSkills.data;
  const installed = list?.installed ?? outcome?.installed ?? [];
  const leftOut = outcome?.skipped ?? list?.skipped ?? [];

  const runImport = () => {
    importSkills.mutate(undefined, {
      onSuccess: (result) => {
        setOpen(true);
        if (result.needsReload) {
          notify.message("Skills imported", {
            description: "Type /reload in a chat to start using them.",
          });
        } else {
          notify.success(importSummary(result));
        }
      },
      onError: (error) => {
        notify.error("Couldn't import your skills", { description: error.message });
      },
    });
  };

  let status: string;
  if (importSkills.isPending) status = "Importing…";
  else if (outcome) {
    status = `${importSummary(outcome)}.${outcome.needsReload ? " Type /reload in a chat to start using them." : ""}`;
  } else if (loading) status = "Looking for skills…";
  else if (list) status = foundSummary(list);
  else status = `Couldn't read your skills folders. ${unreadable?.message ?? ""}`.trim();

  return (
    <section aria-labelledby="skills-heading" className="mt-8 border-t pt-4">
      <h5 id="skills-heading" className="text-sm font-medium text-foreground">
        Skills
      </h5>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Copies the skills in ~/.claude/skills, ~/.codex/skills and ~/.agents/skills into BloxBot.
        BloxBot keeps its own copies, so import again after you change one.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          disabled={!list?.available || importSkills.isPending || chatRunning}
          onClick={runImport}
          className="h-8 shrink-0 rounded-lg bg-foreground px-3 text-xs text-background transition-opacity disabled:opacity-30"
        >
          Import from Codex and Claude Code
        </button>
        <output className="min-w-0 text-xs text-muted-foreground">
          {chatRunning && !importSkills.isPending && !outcome
            ? "Importing waits for your chats to finish."
            : status}
        </output>
      </div>

      {leftOut.length > 0 && (
        <div className="mt-3 text-xs leading-relaxed text-muted-foreground">
          <div id="skills-left-out" className="font-medium">
            Left out
          </div>
          <ul aria-labelledby="skills-left-out" className="mt-1 space-y-1">
            {leftOut.map(({ name, reason }) => (
              <li key={`${name}:${reason}`} className="break-words">
                <span className="text-foreground">{name}</span>: {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {installed.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="skills-installed"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              aria-hidden="true"
              size={12}
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            />
            {skills(installed.length)} in BloxBot
          </button>
          {open && (
            <ul id="skills-installed" className="mt-2 divide-y rounded-lg border bg-card">
              {installed.map((skill) => (
                <li key={skill.name} className="flex items-baseline gap-4 px-3.5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-foreground">{skill.name}</span>
                    {skill.description && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {skill.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {skill.sources.length > 0 ? skill.sources.join(", ") : "Added by you"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
