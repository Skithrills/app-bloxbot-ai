import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultSkillSources,
  importSkills,
  isSafeSkillName,
  listImportableSkills,
  MANIFEST_FILE,
  SKILLS_FOLDER,
  skillDescription,
} from "../../electron/skillImport";

let home: string;
let configDirectory: string;
let skills: string;

const options = () => ({ sources: defaultSkillSources(home), configDirectory, home });

async function write(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

/** A skill in one of the tools' folders, such as `.codex`. */
async function skill(
  tool: string,
  name: string,
  body = "Body",
  files: Record<string, string> = {},
) {
  const folder = join(home, tool, "skills", name);
  await write(
    join(folder, "SKILL.md"),
    `---\nname: ${name}\ndescription: About ${name}\n---\n${body}\n`,
  );
  for (const [file, text] of Object.entries(files)) await write(join(folder, file), text);
  return folder;
}

const copied = (name: string, file = "SKILL.md") => readFile(join(skills, name, file), "utf8");
const everything = async (folder = skills) => (await readdir(folder)).sort();
const visible = async () => (await everything()).filter((name) => !name.startsWith("."));

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bloxbot-skills-"));
  configDirectory = join(home, "BloxBot", ".opencode", "config", "opencode");
  skills = join(configDirectory, SKILLS_FOLDER);
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("importing skills from Codex and Claude Code", () => {
  it("has nothing to offer, and creates nothing, when neither tool has skills", async () => {
    await expect(listImportableSkills(options())).resolves.toEqual({
      available: true,
      folder: "~/BloxBot/.opencode/config/opencode/skills",
      importable: [],
      installed: [],
      skipped: [],
    });
    const result = await importSkills(options());
    expect(result).toMatchObject({ imported: [], updated: [], removed: [], installed: [] });
    await expect(readdir(configDirectory)).rejects.toThrow();
  });

  it("copies each tool's skills, with their other files, and says where each came from", async () => {
    await skill(".claude", "from-claude");
    await skill(".codex", "from-codex", "Body", { "references/guide.md": "Guide" });
    await skill(".agents", "from-agents");
    // Not skills: a folder without SKILL.md, a loose file, and a tool's own hidden folder.
    await write(join(home, ".codex", "skills", "notes", "README.md"), "Notes");
    await write(join(home, ".codex", "skills", "loose.md"), "Loose");
    await write(join(home, ".codex", "skills", ".system", "builtin", "SKILL.md"), "Built in");

    const before = await listImportableSkills(options());
    expect(before.importable).toEqual([
      {
        name: "from-claude",
        description: "About from-claude",
        sources: ["Claude Code"],
        path: "~/.claude/skills/from-claude",
        status: "new",
      },
      {
        name: "from-codex",
        description: "About from-codex",
        sources: ["Codex"],
        path: "~/.codex/skills/from-codex",
        status: "new",
      },
      {
        name: "from-agents",
        description: "About from-agents",
        sources: ["Codex"],
        path: "~/.agents/skills/from-agents",
        status: "new",
      },
    ]);
    expect(before.installed).toEqual([]);

    const result = await importSkills(options());
    expect(result.imported).toEqual(["from-claude", "from-codex", "from-agents"]);
    expect(result.installed).toEqual([
      { name: "from-agents", description: "About from-agents", sources: ["Codex"] },
      { name: "from-claude", description: "About from-claude", sources: ["Claude Code"] },
      { name: "from-codex", description: "About from-codex", sources: ["Codex"] },
    ]);
    await expect(copied("from-codex", join("references", "guide.md"))).resolves.toBe("Guide");
    await expect(visible()).resolves.toEqual(["from-agents", "from-claude", "from-codex"]);

    const after = await listImportableSkills(options());
    expect(after.importable.map(({ status }) => status)).toEqual(["current", "current", "current"]);
  });

  it("syncs when run again: updates what changed, and removes what's gone from the source", async () => {
    const kept = await skill(".codex", "kept", "First", { "old.md": "Old" });
    const gone = await skill(".codex", "gone");
    await skill(".codex", "same");
    await importSkills(options());

    await writeFile(join(kept, "SKILL.md"), "---\ndescription: Second\n---\nSecond\n");
    await rm(join(kept, "old.md"));
    await writeFile(join(kept, "new.md"), "New");
    await rm(gone, { recursive: true });
    // BloxBot's copy is a copy, so editing it doesn't survive a sync that has something newer.
    await writeFile(join(skills, "kept", "SKILL.md"), "Edited in BloxBot");

    expect((await listImportableSkills(options())).importable).toMatchObject([
      { name: "kept", status: "changed" },
      { name: "same", status: "current" },
    ]);
    const result = await importSkills(options());
    expect(result).toMatchObject({
      imported: [],
      updated: ["kept"],
      removed: ["gone"],
      unchanged: ["same"],
      skipped: [],
    });
    await expect(copied("kept")).resolves.toContain("Second");
    await expect(copied("kept", "new.md")).resolves.toBe("New");
    await expect(copied("kept", "old.md")).rejects.toThrow();
    await expect(visible()).resolves.toEqual(["kept", "same"]);
    // Nothing is left behind from the swap.
    await expect(everything()).resolves.toEqual([MANIFEST_FILE, "kept", "same"]);

    await expect(importSkills(options())).resolves.toMatchObject({
      imported: [],
      updated: [],
      removed: [],
      unchanged: ["kept", "same"],
    });
  });

  it("leaves alone a skill the user put in BloxBot themselves", async () => {
    await write(join(skills, "mine", "SKILL.md"), "My own");
    await write(join(skills, "clash", "SKILL.md"), "My own clash");
    await write(join(skills, "loose.md"), "My loose skill");
    await skill(".codex", "clash");
    await skill(".codex", "loose");
    await skill(".codex", "fresh");

    expect((await listImportableSkills(options())).importable).toMatchObject([
      { name: "clash", status: "own" },
      { name: "fresh", status: "new" },
      { name: "loose", status: "own" },
    ]);
    const result = await importSkills(options());
    expect(result.imported).toEqual(["fresh"]);
    expect(result.skipped.map(({ name }) => name)).toEqual(["clash", "loose"]);
    await expect(copied("clash")).resolves.toBe("My own clash");
    await expect(copied("mine")).resolves.toBe("My own");
    expect(result.installed.map(({ name, sources }) => [name, sources])).toEqual([
      ["clash", []],
      ["fresh", ["Codex"]],
      ["loose", []],
      ["mine", []],
    ]);

    // With every source gone, only what was imported goes.
    await rm(join(home, ".codex"), { recursive: true });
    await expect(importSkills(options())).resolves.toMatchObject({ removed: ["fresh"] });
    await expect(visible()).resolves.toEqual(["clash", "loose.md", "mine"]);
  });

  it("treats everything as the user's own when its record of imports is lost", async () => {
    await skill(".codex", "one", "First");
    await importSkills(options());
    await writeFile(join(skills, MANIFEST_FILE), "not json");
    const source = await skill(".codex", "one", "Second");
    await skill(".codex", "two");

    const result = await importSkills(options());
    expect(result).toMatchObject({ imported: ["two"], updated: [], removed: [] });
    expect(result.skipped).toMatchObject([{ name: "one" }]);
    await expect(copied("one")).resolves.toContain("First");

    await rm(source, { recursive: true });
    await expect(importSkills(options())).resolves.toMatchObject({ removed: [] });
    await expect(visible()).resolves.toEqual(["one", "two"]);
  });

  it("keeps a copy the user edited when its source is removed", async () => {
    const source = await skill(".codex", "edited");
    await importSkills(options());
    await writeFile(join(skills, "edited", "SKILL.md"), "Edited in BloxBot");
    await rm(source, { recursive: true });

    const result = await importSkills(options());
    expect(result.removed).toEqual([]);
    expect(result.skipped).toMatchObject([{ name: "edited" }]);
    await expect(copied("edited")).resolves.toBe("Edited in BloxBot");
    // It's the user's from here on.
    expect(result.installed).toEqual([{ name: "edited", description: null, sources: [] }]);
  });

  it("copies only the chosen skills, and removes nothing, when given names", async () => {
    await skill(".codex", "first");
    const second = await skill(".codex", "second");
    await importSkills(options());
    await rm(second, { recursive: true });
    await skill(".codex", "third");
    await skill(".codex", "fourth");

    const result = await importSkills({ ...options(), names: ["third", "missing"] });
    expect(result).toMatchObject({ imported: ["third"], removed: [], unchanged: [] });
    expect(result.skipped.map(({ name }) => name)).toEqual(["missing"]);
    await expect(visible()).resolves.toEqual(["first", "second", "third"]);
  });

  it("offers a skill once when Claude Code's is a link to Codex's", async () => {
    const real = await skill(".agents", "shared");
    await mkdir(join(home, ".claude", "skills"), { recursive: true });
    // A junction needs no special rights on Windows, and is a plain link elsewhere.
    await symlink(real, join(home, ".claude", "skills", "shared"), "junction");
    // A separate folder with the same contents is the same skill too.
    await skill(".claude", "twin");
    await skill(".codex", "twin");
    // Different contents under one name: the first folder wins, and the other is reported.
    await skill(".claude", "clash", "Claude's");
    await skill(".codex", "clash", "Codex's");

    const list = await listImportableSkills(options());
    expect(list.importable.map(({ name, sources, path }) => [name, sources, path])).toEqual([
      ["clash", ["Claude Code"], "~/.claude/skills/clash"],
      ["shared", ["Claude Code", "Codex"], "~/.claude/skills/shared"],
      ["twin", ["Claude Code", "Codex"], "~/.claude/skills/twin"],
    ]);
    expect(list.skipped).toMatchObject([{ name: "clash" }]);

    const result = await importSkills(options());
    expect(result.imported).toEqual(["clash", "shared", "twin"]);
    await expect(copied("clash")).resolves.toContain("Claude's");
    // A copy, not a link, so it doesn't change with the source until the next import.
    await writeFile(join(real, "SKILL.md"), "Changed at the source");
    await expect(copied("shared")).resolves.toContain("About shared");
  });

  it("doesn't follow links inside a skill, and leaves out files that are too large", async () => {
    await write(join(home, "private", "secret.txt"), "Secret");
    const folder = await skill(".codex", "linked", "Body", { "big.bin": "", "fine.txt": "Fine" });
    await truncate(join(folder, "big.bin"), 5 * 1024 * 1024 + 1);
    await symlink(join(home, "private"), join(folder, "outside"), "junction");

    const result = await importSkills(options());
    expect(result.imported).toEqual(["linked"]);
    expect(result.skipped).toEqual([
      { name: "linked", reason: "Left out big.bin (over 5 MB), outside (a link)." },
    ]);
    await expect(everything(join(skills, "linked"))).resolves.toEqual(["SKILL.md", "fine.txt"]);
    // The same files are left out next time, so it counts as up to date.
    await expect(importSkills(options())).resolves.toMatchObject({ unchanged: ["linked"] });
  });

  it("refuses names that could land outside its folder", async () => {
    for (const name of ["..", ".", "", ".hidden", "a/b", "a\\b", "nul", "COM1.txt", "dot.", " x"]) {
      expect(isSafeSkillName(name), name).toBe(false);
    }
    for (const name of ["luau-coding", "Skill_2", "v1.2"]) {
      expect(isSafeSkillName(name), name).toBe(true);
    }

    await skill(".codex", "bad name");
    await skill(".codex", "good");
    await importSkills(options());
    // A record that was tampered with can't point a removal anywhere else.
    await write(join(home, "BloxBot", "precious", "SKILL.md"), "Precious");
    await writeFile(
      join(skills, MANIFEST_FILE),
      JSON.stringify({ version: 1, skills: { "../../../../precious": { hash: "x" } } }),
    );
    await rm(join(home, ".codex"), { recursive: true });

    const result = await importSkills(options());
    expect(result.removed).toEqual([]);
    await expect(readFile(join(home, "BloxBot", "precious", "SKILL.md"), "utf8")).resolves.toBe(
      "Precious",
    );
    await expect(visible()).resolves.toEqual(["good"]);
  });

  it("keeps an imported skill whose source can't be used this time", async () => {
    const folder = await skill(".codex", "big");
    await importSkills(options());
    await truncate(join(folder, "SKILL.md"), 5 * 1024 * 1024 + 1);

    const result = await importSkills(options());
    expect(result).toMatchObject({ removed: [], updated: [] });
    expect(result.skipped).toMatchObject([{ name: "big" }]);
    await expect(copied("big")).resolves.toContain("About big");
  });

  it("stops, changing nothing, when BloxBot's skills folder is a link", async () => {
    await skill(".codex", "one");
    await mkdir(join(home, "elsewhere"));
    await mkdir(configDirectory, { recursive: true });
    await symlink(join(home, "elsewhere"), skills, "junction");

    await expect(importSkills(options())).rejects.toThrow(/link/);
    await expect(readdir(join(home, "elsewhere"))).resolves.toEqual([]);
  });

  it("stops when a source is something it can't read, rather than removing its skills", async () => {
    await skill(".codex", "one");
    await importSkills(options());
    const sources = [{ label: "Codex" as const, directory: join(home, "nul\0bad") }];

    await expect(importSkills({ ...options(), sources })).rejects.toThrow();
    await expect(visible()).resolves.toEqual(["one"]);
  });
});

describe("a skill's description", () => {
  it("reads plain, quoted and block descriptions, and gives up quietly otherwise", () => {
    expect(skillDescription("---\nname: a\ndescription: Plain text\n---\nBody")).toBe("Plain text");
    expect(skillDescription('---\r\ndescription: "Quoted: yes"\r\n---\r\n')).toBe("Quoted: yes");
    expect(
      skillDescription("---\ndescription: >-\n  First line\n  second line\nname: a\n---\n"),
    ).toBe("First line second line");
    expect(skillDescription("---\nname: a\n---\nBody")).toBeNull();
    expect(skillDescription("No frontmatter")).toBeNull();
  });
});
