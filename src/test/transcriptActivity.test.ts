import { describe, expect, it } from "vitest";
import { fileChangesIn, splitFilePath } from "@/lib/fileChanges";
import { lineDiff, patchLineCounts } from "@/lib/lineDiff";
import { messageDayAndTime, timeAgo, workedFor } from "@/lib/messageTime";
import { thinkingSummary } from "@/lib/thinkingSummary";
import type { MessageWithParts } from "@/types";

describe("thinking summaries", () => {
  it("uses the newest title of reasoning that is summarised in titled steps", () => {
    expect(thinkingSummary("**Reading the composer**\n\nLooking at how drafts are kept.")).toBe(
      "Reading the composer",
    );
    expect(
      thinkingSummary("**Reading the composer**\n\nDone.\n\n## Checking the `diff` view.\n\nNow"),
    ).toBe("Checking the diff view");
    // A title still arriving doesn't replace the one before it.
    expect(thinkingSummary("**Reading the composer**\n\nDone.\n\n**Checking the di")).toBe(
      "Reading the composer",
    );
    // Bold inside a sentence is emphasis, not a title.
    expect(thinkingSummary("I should **not** break drafts. Then test it.")).toBe(
      "I should not break drafts",
    );
  });

  it("falls back to the finished sentence that opens the newest paragraph", () => {
    const first = "The composer keeps drafts per chat. I can reuse that.";
    expect(thinkingSummary(first)).toBe("The composer keeps drafts per chat");
    expect(thinkingSummary(`${first}\n\nNow the send butt`)).toBe(
      "The composer keeps drafts per chat",
    );
    expect(thinkingSummary(`${first}\n\nNow the send button: it has two states.`)).toBe(
      "Now the send button",
    );
    expect(thinkingSummary(`A paragraph without an ending\n\n${first}`)).toBe(
      "The composer keeps drafts per chat",
    );
    const long = thinkingSummary(
      `${"The quick brown fox jumps over the lazy dog and ".repeat(3)}.`,
    );
    expect(long?.endsWith("…")).toBe(true);
    expect(long?.length).toBeLessThanOrEqual(73);
  });

  it("gives nothing when no reasoning has been shared yet", () => {
    expect(thinkingSummary("")).toBeNull();
    expect(thinkingSummary("Still writ")).toBeNull();
    expect(thinkingSummary("** **")).toBeNull();
  });
});

describe("message times", () => {
  it("names the day and gives the time on a 24-hour clock", () => {
    const now = new Date(2026, 10, 14, 15, 30).getTime();
    const at = (day: number, hour: number, minute: number, year = 2026) =>
      messageDayAndTime(new Date(year, 10, day, hour, minute).getTime(), now);
    expect(at(14, 14, 0)).toEqual({ day: "Today", time: "14:00" });
    expect(at(13, 23, 59).day).toBe("Yesterday");
    expect(at(13, 4, 14).time).toBe("04:14");
    expect(at(12, 21, 36)).toEqual({ day: "Thursday", time: "21:36" });
    expect(at(8, 9, 5).day).toBe("Sunday");
    // A week back the weekday would be ambiguous, so the date takes over.
    expect(at(7, 9, 5).day).toMatch(/7/);
    expect(at(7, 9, 5).day).not.toMatch(/2026|Saturday/);
    expect(at(7, 9, 5, 2025).day).toMatch(/2025/);
    expect(at(14, 0, 7).time).toBe("00:07");
  });

  it("says how long ago a message was sent", () => {
    const now = new Date(2026, 10, 14, 15, 30).getTime();
    const ago = (ms: number) => timeAgo(now - ms, now);
    expect(ago(20_000)).toBe("just now");
    expect(ago(5 * 60_000 + 30_000)).toBe("5 minutes ago");
    expect(ago(60 * 60_000)).toBe("1 hour ago");
    expect(ago(11.9 * 60 * 60_000)).toBe("11 hours ago");
    expect(ago(3 * 24 * 60 * 60_000)).toBe("3 days ago");
    // Past a month, the date.
    expect(ago(40 * 24 * 60 * 60_000)).toMatch(/5/);
    expect(ago(40 * 24 * 60 * 60_000)).not.toMatch(/ago/);
    // A clock that is a little behind doesn't put a message in the future.
    expect(timeAgo(now + 5000, now)).toBe("just now");
  });

  it("says how long work took", () => {
    expect(workedFor(200)).toBe("1s");
    expect(workedFor(32_000)).toBe("32s");
    expect(workedFor(142_000)).toBe("2m 22s");
    expect(workedFor(120_000)).toBe("2m");
    expect(workedFor(3_900_000)).toBe("1h 5m");
  });
});

describe("edit line counts", () => {
  it("counts only the lines that changed, leaving the lines around them as context", () => {
    expect(lineDiff("import a\nimport c", "import a\nimport b\nimport c")).toEqual({
      text: " import a\n+import b\n import c",
      added: 1,
      removed: 0,
    });
    expect(lineDiff("one\ntwo\nthree\nfour", "one\n2\nthree\n4")).toEqual({
      text: " one\n-two\n+2\n three\n-four\n+4",
      added: 2,
      removed: 2,
    });
    expect(lineDiff("", "new\nfile")).toEqual({ text: "+new\n+file", added: 2, removed: 0 });
    expect(lineDiff("gone", "")).toEqual({ text: "-gone", added: 0, removed: 1 });
    expect(lineDiff("same", "same")).toEqual({ text: " same", added: 0, removed: 0 });
  });

  it("still counts an edit too large to compare line by line", () => {
    const before = Array.from({ length: 600 }, (_, index) => `old ${index}`).join("\n");
    const after = Array.from({ length: 600 }, (_, index) => `new ${index}`).join("\n");
    const diff = lineDiff(`top\n${before}\nend`, `top\n${after}\nend`);
    expect(diff).toMatchObject({ added: 600, removed: 600 });
    expect(diff.text.startsWith(" top\n-old 0\n")).toBe(true);
    expect(diff.text.endsWith("+new 599\n end")).toBe(true);
  });

  it("adds up what a turn's finished edits, writes and patches did to each file", () => {
    const tool = (name: string, input: object, status = "completed") => ({
      type: "tool",
      tool: name,
      state: { status, input },
    });
    const turn = [
      { info: { role: "user" }, parts: [tool("edit", { filePath: "ignored", newString: "x" })] },
      {
        info: { role: "assistant" },
        parts: [
          tool("edit", {
            filePath: "C:\\game\\src\\Door.luau",
            oldString: "a\nb",
            newString: "a\nc",
          }),
          tool("write", { filePath: "C:/game/README.md", content: "# Game\nHello\n" }),
          tool("edit", { filePath: "C:/game/src/Door.luau", oldString: "", newString: "d" }),
          tool(
            "edit",
            { filePath: "C:/game/failed.luau", oldString: "a", newString: "b" },
            "error",
          ),
          tool("edit", { filePath: "C:/game/same.luau", oldString: "a", newString: "a" }),
          tool("mcp_files_patch", {
            patchText:
              "*** Begin Patch\n*** Update File: src/Key.luau\n@@\n-old\n+new\n+more\n*** Add File: src/New.luau\n+first\n*** End Patch",
          }),
        ],
      },
    ] as unknown as MessageWithParts[];
    expect(fileChangesIn(turn)).toEqual([
      { file: "C:/game/src/Door.luau", added: 2, removed: 1, diffs: [" a\n-b\n+c", "+d"] },
      { file: "C:/game/README.md", added: 2, removed: 0, diffs: ["+# Game\n+Hello"] },
      { file: "src/Key.luau", added: 2, removed: 1, diffs: ["@@\n-old\n+new\n+more"] },
      { file: "src/New.luau", added: 1, removed: 0, diffs: ["+first"] },
    ]);

    expect(splitFilePath("C:\\Game\\src\\ui\\Door.luau", "c:/game/")).toEqual({
      folder: "src/ui/",
      name: "Door.luau",
    });
    expect(splitFilePath("D:/other/Door.luau", "C:/game")).toEqual({
      folder: "D:/other/",
      name: "Door.luau",
    });
    expect(splitFilePath("README.md")).toEqual({ folder: "", name: "README.md" });
  });

  it("counts a patch's lines without its file headers", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@",
      "-old",
      "+new",
      "+more",
      " same",
      "*** End Patch",
    ].join("\n");
    expect(patchLineCounts(patch)).toEqual({ added: 2, removed: 1 });
  });
});
