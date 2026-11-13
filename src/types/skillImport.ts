/** The tool a skill is copied from. `~/.codex/skills` and `~/.agents/skills` are both Codex. */
export type SkillSourceLabel = "Claude Code" | "Codex";

/**
 * `new` isn't in BloxBot yet, `changed` differs from the copy BloxBot imported, `current` matches
 * it, and `own` is a skill of the same name that BloxBot didn't import, which is left alone.
 */
export type ImportableSkillStatus = "new" | "changed" | "current" | "own";

export interface ImportableSkill {
  /** The skill's folder name, which is also its name in BloxBot. */
  name: string;
  description: string | null;
  /** Every tool this skill was found in, when they share one folder or have identical copies. */
  sources: readonly SkillSourceLabel[];
  /** The home-relative folder it is copied from. */
  path: string;
  status: ImportableSkillStatus;
}

export interface InstalledSkill {
  name: string;
  description: string | null;
  /** Empty for a skill BloxBot didn't import. */
  sources: readonly SkillSourceLabel[];
}

/** A skill, or part of one, that was left out, with the reason in plain words. */
export interface SkippedSkill {
  name: string;
  reason: string;
}

export interface SkillImportList {
  /** False outside the desktop app, where there are no folders to read. */
  available: boolean;
  /** BloxBot's own skills folder, home-relative. */
  folder: string;
  importable: readonly ImportableSkill[];
  installed: readonly InstalledSkill[];
  skipped: readonly SkippedSkill[];
}

export interface SkillImportResult {
  imported: readonly string[];
  updated: readonly string[];
  removed: readonly string[];
  unchanged: readonly string[];
  skipped: readonly SkippedSkill[];
  installed: readonly InstalledSkill[];
}
