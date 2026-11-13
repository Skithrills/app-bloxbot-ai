import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  ImportableSkillStatus,
  InstalledSkill,
  SkillImportList,
  SkillImportResult,
  SkillSourceLabel,
  SkippedSkill,
} from "../src/types/skillImport";
import { displayPath } from "./instructionFiles";

/**
 * The folder under OpenCode's config directory that it reads skills from, as
 * `skills/<name>/SKILL.md`. OpenCode also reads `skill/`, and ignores names that start with a dot.
 */
export const SKILLS_FOLDER = "skills";
/** Which skills this import put there. Its dot keeps OpenCode from reading it. */
export const MANIFEST_FILE = ".bloxbot-imported.json";

const SKILL_FILE = "SKILL.md";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_FILES = 2_000;
const MAX_DEPTH = 12;
const IGNORED_FOLDERS = new Set([".git", "node_modules"]);
// Dot folders, so OpenCode, which watches the skills folder, never reads a half-copied skill.
const STAGING_PREFIX = ".importing-";
const REPLACED_PREFIX = ".replaced-";
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const SOURCE_LABELS: readonly SkillSourceLabel[] = ["Claude Code", "Codex"];

export interface SkillSource {
  label: SkillSourceLabel;
  directory: string;
}

export interface SkillImportOptions {
  sources: readonly SkillSource[];
  /** OpenCode's config directory, which BloxBot's skills folder sits in. */
  configDirectory: string;
  home: string;
}

interface SkillFile {
  segments: string[];
  path: string;
}

interface FolderContents {
  files: SkillFile[];
  hash: string;
  leftOut: string[];
}

interface FoundSkill {
  name: string;
  /** Where its files really are, behind any junction or link. */
  folder: string;
  path: string;
  sources: SkillSourceLabel[];
  description: string | null;
  contents: FolderContents;
}

interface ManifestEntry {
  name: string;
  sources: SkillSourceLabel[];
  path: string;
  /** What was copied, so a copy the user has edited since can be told apart. */
  hash: string;
}

type Manifest = Map<string, ManifestEntry>;
type Destination = "missing" | "folder" | "other";

interface ImportPlan {
  skillsDirectory: string;
  manifest: Manifest;
  found: FoundSkill[];
  statuses: Map<string, ImportableSkillStatus>;
  skipped: SkippedSkill[];
  /** Every skill folder a source still has, including ones that couldn't be used this time. */
  present: Set<string>;
}

class SkillRejected extends Error {}

/** Where Claude Code and Codex keep the user's skills. */
export function defaultSkillSources(home: string): SkillSource[] {
  return [
    { label: "Claude Code", directory: join(home, ".claude", "skills") },
    { label: "Codex", directory: join(home, ".codex", "skills") },
    { label: "Codex", directory: join(home, ".agents", "skills") },
  ];
}

/** A name that is one plain folder on every platform, so a copy can't land anywhere else. */
export function isSafeSkillName(name: string): boolean {
  return SKILL_NAME.test(name) && !name.endsWith(".") && !WINDOWS_DEVICE_NAME.test(name);
}

/** The description in a skill's frontmatter, as one line. */
export function skillDescription(markdown: string): string | null {
  const frontmatter = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  if (frontmatter === undefined) return null;
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith("description:"));
  if (index < 0) return null;
  let value = lines[index].slice("description:".length).trim();
  if (value === "" || /^[>|][+-]?$/.test(value)) {
    // A block: the indented lines that follow.
    const block: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (line.trim() === "") continue;
      if (!/^\s/.test(line)) break;
      block.push(line.trim());
    }
    value = block.join(" ");
  } else {
    value = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return value ? value.slice(0, 300) : null;
}

// Windows and macOS treat `Skill` and `skill` as one folder.
const key = (name: string) => name.toLowerCase();
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sameFolder = (left: string, right: string) =>
  process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;

async function orMissing<A>(read: Promise<A>): Promise<A | null> {
  return read.catch((error) => {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    throw error;
  });
}

/** Windows briefly refuses to move or remove what an antivirus or a watcher has open. */
async function whenFree<A>(run: () => Promise<A>): Promise<A> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const busy = ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(errorCode(error) ?? "");
      if (!busy || attempt >= 4) throw error;
      await new Promise((done) => setTimeout(done, 50 * (attempt + 1)));
    }
  }
}

/** The files of one skill, without following links, which could lead out of its folder. */
async function readFolder(root: string): Promise<FolderContents> {
  const files: SkillFile[] = [];
  const leftOut: string[] = [];
  const hash = createHash("sha256");
  const visit = async (segments: string[]): Promise<void> => {
    for (const name of (await readdir(join(root, ...segments))).sort()) {
      const next = [...segments, name];
      const path = join(root, ...next);
      const shown = next.join("/");
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        leftOut.push(`${shown} (a link)`);
      } else if (info.isDirectory()) {
        if (IGNORED_FOLDERS.has(name)) continue;
        if (next.length > MAX_DEPTH) leftOut.push(`${shown} (nested too deeply)`);
        else await visit(next);
      } else if (info.isFile()) {
        if (info.size > MAX_FILE_BYTES) {
          leftOut.push(`${shown} (over 5 MB)`);
          continue;
        }
        if (files.length >= MAX_SKILL_FILES) {
          throw new SkillRejected(`It has more than ${MAX_SKILL_FILES} files.`);
        }
        hash.update(`${shown}\0${info.size}\0`);
        hash.update(await readFile(path));
        files.push({ segments: next, path });
      }
    }
  };
  await visit([]);
  return { files, hash: hash.digest("hex"), leftOut };
}

async function findSkills(
  sources: readonly SkillSource[],
  home: string,
): Promise<Pick<ImportPlan, "found" | "skipped" | "present">> {
  const found = new Map<string, FoundSkill>();
  const skipped: SkippedSkill[] = [];
  const present = new Set<string>();

  for (const source of sources) {
    const shownSource = displayPath(source.directory, home);
    // A folder that isn't there has no skills. One that can't be read stops everything, or the
    // skills imported from it would look removed.
    const names = await orMissing(readdir(source.directory)).catch((error) => {
      throw new Error(`Couldn't read ${shownSource}: ${errorMessage(error)}`);
    });

    for (const name of (names ?? []).sort()) {
      // Dot folders hold a tool's own files, such as Codex's built-in skills.
      if (name.startsWith(".")) continue;
      const reached = join(source.directory, name);
      const add = (reason: string) => skipped.push({ name, reason });

      let folder: string;
      try {
        // Claude Code's skills are often junctions to Codex's, which `realpath` follows.
        const real = await orMissing(realpath(reached));
        if (real === null || !(await stat(real)).isDirectory()) continue;
        if ((await orMissing(lstat(join(real, SKILL_FILE)))) === null) continue;
        folder = real;
      } catch (error) {
        present.add(key(name));
        add(`Couldn't read ${shownSource}/${name}: ${errorMessage(error)}`);
        continue;
      }

      present.add(key(name));
      if (!isSafeSkillName(name)) {
        add("Its folder name has characters BloxBot can't use.");
        continue;
      }
      const earlier = found.get(key(name));
      const label = (skill: FoundSkill) => {
        if (!skill.sources.includes(source.label)) skill.sources.push(source.label);
      };
      if (earlier && sameFolder(earlier.folder, folder)) {
        label(earlier);
        continue;
      }

      let contents: FolderContents;
      try {
        contents = await readFolder(folder);
      } catch (error) {
        add(
          error instanceof SkillRejected
            ? error.message
            : `Couldn't read it: ${errorMessage(error)}`,
        );
        continue;
      }
      const skillFile = contents.files.find(
        (file) => file.segments.length === 1 && file.segments[0] === SKILL_FILE,
      );
      if (!skillFile) {
        add(`Its ${SKILL_FILE} is a link or is too large.`);
        continue;
      }
      if (earlier) {
        if (earlier.contents.hash === contents.hash) label(earlier);
        else {
          add(`${shownSource} has a different skill with this name. BloxBot uses ${earlier.path}.`);
        }
        continue;
      }

      found.set(key(name), {
        name,
        folder,
        path: `${shownSource}/${name}`,
        sources: [source.label],
        description: skillDescription(await readFile(skillFile.path, "utf8")),
        contents,
      });
      if (contents.leftOut.length > 0) add(`Left out ${contents.leftOut.join(", ")}.`);
    }
  }

  // One order, whichever folder a skill turned up in first.
  const skills = [...found.values()].map((skill) => ({
    ...skill,
    sources: SOURCE_LABELS.filter((label) => skill.sources.includes(label)),
  }));
  return { found: skills, skipped, present };
}

/** Missing or damaged means nothing counts as imported, so nothing gets replaced or removed. */
async function readManifest(skillsDirectory: string): Promise<Manifest> {
  const manifest: Manifest = new Map();
  let skills: unknown;
  try {
    skills = JSON.parse(await readFile(join(skillsDirectory, MANIFEST_FILE), "utf8"))?.skills;
  } catch {
    return manifest;
  }
  if (skills === null || typeof skills !== "object") return manifest;
  for (const [name, value] of Object.entries(skills)) {
    const entry = value as Partial<Omit<ManifestEntry, "name">> | null;
    if (!isSafeSkillName(name) || typeof entry?.hash !== "string") continue;
    manifest.set(key(name), {
      name,
      sources: SOURCE_LABELS.filter((label) => [entry.sources].flat().includes(label)),
      path: typeof entry.path === "string" ? entry.path : "",
      hash: entry.hash,
    });
  }
  return manifest;
}

async function writeManifest(skillsDirectory: string, manifest: Manifest): Promise<void> {
  const path = join(skillsDirectory, MANIFEST_FILE);
  const skills = Object.fromEntries(
    [...manifest.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, ...entry }) => [name, entry]),
  );
  // Replaced in one step, so a write that fails partway leaves the old list alone.
  const draft = `${path}.saving`;
  try {
    await writeFile(draft, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`);
    await whenFree(() => rename(draft, path));
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
}

/** The one place a skill may be written to or removed from. */
function destinationPath(skillsDirectory: string, name: string): string {
  const path = resolve(skillsDirectory, name);
  if (!isSafeSkillName(name) || dirname(path) !== resolve(skillsDirectory)) {
    throw new Error(`"${name}" can't be used as a skill's folder name.`);
  }
  return path;
}

/** `other` is a link, a file, or a loose `<name>.md` skill, all of which are the user's own. */
async function destinationOf(skillsDirectory: string, name: string): Promise<Destination> {
  const path = destinationPath(skillsDirectory, name);
  const info = await orMissing(lstat(path));
  if (info) return info.isDirectory() && !info.isSymbolicLink() ? "folder" : "other";
  return (await orMissing(lstat(`${path}.md`))) ? "other" : "missing";
}

async function planImport(options: SkillImportOptions): Promise<ImportPlan> {
  const skillsDirectory = join(options.configDirectory, SKILLS_FOLDER);
  const [skills, manifest] = await Promise.all([
    findSkills(options.sources, options.home),
    readManifest(skillsDirectory),
  ]);
  const statuses = new Map<string, ImportableSkillStatus>();
  for (const skill of skills.found) {
    const destination = await destinationOf(skillsDirectory, skill.name);
    let status: ImportableSkillStatus;
    if (destination === "missing") status = "new";
    // Only a folder this import put there is ever replaced.
    else if (destination === "other" || !manifest.has(key(skill.name))) status = "own";
    else {
      const copy = await readFolder(join(skillsDirectory, skill.name)).catch(() => null);
      status = copy?.hash === skill.contents.hash ? "current" : "changed";
    }
    statuses.set(key(skill.name), status);
  }
  return { skillsDirectory, manifest, statuses, ...skills };
}

/** Every skill OpenCode would load from BloxBot's folder, and which tool each came from. */
async function installedSkills(
  skillsDirectory: string,
  manifest: Manifest,
): Promise<InstalledSkill[]> {
  const installed: InstalledSkill[] = [];
  for (const name of ((await orMissing(readdir(skillsDirectory))) ?? []).sort()) {
    if (name.startsWith(".")) continue;
    const path = join(skillsDirectory, name);
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory()) {
      const text = await readFile(join(path, SKILL_FILE), "utf8").catch(() => null);
      if (text === null) continue;
      const linked = (await lstat(path)).isSymbolicLink();
      installed.push({
        name,
        description: skillDescription(text),
        sources: linked ? [] : (manifest.get(key(name))?.sources ?? []),
      });
    } else if (info?.isFile() && name.endsWith(".md")) {
      const text = await readFile(path, "utf8").catch(() => "");
      installed.push({ name: name.slice(0, -3), description: skillDescription(text), sources: [] });
    }
  }
  return installed;
}

/** Copies into a hidden folder first, then swaps it in, so a failed copy leaves the old skill. */
async function installSkill(skillsDirectory: string, skill: FoundSkill): Promise<void> {
  const destination = destinationPath(skillsDirectory, skill.name);
  const token = randomUUID().slice(0, 8);
  const staging = join(skillsDirectory, `${STAGING_PREFIX}${skill.name}-${token}`);
  const replaced = join(skillsDirectory, `${REPLACED_PREFIX}${skill.name}-${token}`);
  try {
    for (const file of skill.contents.files) {
      // Checked again, in case it was swapped for a link or grew since it was listed.
      const info = await lstat(file.path);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        throw new Error(`${file.segments.join("/")} changed while it was being copied.`);
      }
      const target = join(staging, ...file.segments);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(file.path, target);
    }
    const replacing = (await destinationOf(skillsDirectory, skill.name)) === "folder";
    if (replacing) await whenFree(() => rename(destination, replaced));
    try {
      await whenFree(() => rename(staging, destination));
    } catch (error) {
      if (replacing) await whenFree(() => rename(replaced, destination)).catch(() => undefined);
      throw error;
    }
    await rm(replaced, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

/** What the sources offer, and what BloxBot has, without changing anything. */
export async function listImportableSkills(options: SkillImportOptions): Promise<SkillImportList> {
  const plan = await planImport(options);
  return {
    available: true,
    folder: displayPath(plan.skillsDirectory, options.home),
    importable: plan.found.map(({ name, description, sources, path }) => ({
      name,
      description,
      sources,
      path,
      status: plan.statuses.get(key(name)) ?? "new",
    })),
    installed: await installedSkills(plan.skillsDirectory, plan.manifest),
    skipped: plan.skipped,
  };
}

/**
 * Copies skills into BloxBot's own folder. Running it again is the sync: a skill that changed at
 * its source replaces the copy, and, when everything is imported rather than chosen `names`, a
 * copy whose source is gone is removed. Only skills in the manifest, which this wrote, are ever
 * replaced or removed.
 */
export async function importSkills(
  options: SkillImportOptions & { names?: readonly string[] },
): Promise<SkillImportResult> {
  // Everything is read before anything is written.
  const plan = await planImport(options);
  const { skillsDirectory, manifest } = plan;
  const folder = await orMissing(lstat(skillsDirectory));
  if (folder && (folder.isSymbolicLink() || !folder.isDirectory())) {
    const shown = displayPath(skillsDirectory, options.home);
    throw new Error(`${shown} is a link or a file, so nothing was copied into it.`);
  }

  const wanted = options.names ? new Set(options.names.map(key)) : null;
  const chosen = (name: string) => wanted === null || wanted.has(key(name));
  const result = {
    imported: [] as string[],
    updated: [] as string[],
    removed: [] as string[],
    unchanged: [] as string[],
    skipped: plan.skipped.filter((skill) => chosen(skill.name)),
  };
  const skip = (name: string, reason: string) => result.skipped.push({ name, reason });
  for (const name of options.names ?? []) {
    if (!plan.present.has(key(name))) skip(name, "It isn't in your Codex or Claude Code folders.");
  }

  let changed = false;
  try {
    // Left behind only when BloxBot closed, or a folder was in use, in the middle of an import.
    for (const name of (await orMissing(readdir(skillsDirectory))) ?? []) {
      if (!name.startsWith(STAGING_PREFIX) && !name.startsWith(REPLACED_PREFIX)) continue;
      const leftover = join(skillsDirectory, name);
      await rm(leftover, { recursive: true, force: true }).catch(() => undefined);
    }

    for (const skill of plan.found.filter((found) => chosen(found.name))) {
      const status = plan.statuses.get(key(skill.name));
      if (status === "own") {
        skip(skill.name, "BloxBot already has its own skill with this name, which was left alone.");
        continue;
      }
      const entry: ManifestEntry = {
        name: skill.name,
        sources: skill.sources,
        path: skill.path,
        hash: skill.contents.hash,
      };
      if (status === "current") {
        result.unchanged.push(skill.name);
      } else {
        try {
          await mkdir(skillsDirectory, { recursive: true });
          await installSkill(skillsDirectory, skill);
        } catch (error) {
          skip(skill.name, `Couldn't copy it: ${errorMessage(error)}`);
          continue;
        }
        (status === "changed" ? result.updated : result.imported).push(skill.name);
      }
      if (JSON.stringify(manifest.get(key(skill.name))) !== JSON.stringify(entry)) {
        manifest.set(key(skill.name), entry);
        changed = true;
      }
    }

    // Choosing some skills only copies those. Removing is for a full sync.
    for (const [id, entry] of wanted === null ? [...manifest] : []) {
      if (plan.present.has(id)) continue;
      manifest.delete(id);
      changed = true;
      if ((await destinationOf(skillsDirectory, entry.name)) !== "folder") continue;
      const path = destinationPath(skillsDirectory, entry.name);
      const copy = await readFolder(path).catch(() => null);
      if (copy?.hash !== entry.hash) {
        skip(entry.name, "Its source is gone, but BloxBot's copy was edited, so it was kept.");
        continue;
      }
      try {
        await rm(path, { recursive: true, maxRetries: 3 });
        result.removed.push(entry.name);
      } catch (error) {
        manifest.set(id, entry);
        skip(entry.name, `Couldn't remove it: ${errorMessage(error)}`);
      }
    }
  } finally {
    // Also after a failure, so what was already copied isn't later mistaken for the user's own.
    if (changed) await writeManifest(skillsDirectory, manifest);
  }

  return { ...result, installed: await installedSkills(skillsDirectory, manifest) };
}
