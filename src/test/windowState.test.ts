import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWindowState, saveWindowState } from "../../electron/windowState";

const primary = { x: 0, y: 0, width: 1600, height: 900 };
const secondary = { x: -1600, y: 0, width: 1600, height: 900 };

describe("window state", () => {
  let directory: string;
  let statePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "bloxbot-window-"));
    statePath = join(directory, "window-state.json");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("opens maximized with centered normal bounds if the file is missing or invalid", () => {
    const expected = {
      bounds: { x: 340, y: 150, width: 920, height: 600 },
      mode: "maximized",
    };
    expect(loadWindowState(statePath, primary, [primary])).toEqual(expected);
    writeFileSync(statePath, '{"bounds":{"width":null},"mode":"normal"}');
    expect(loadWindowState(statePath, primary, [primary])).toEqual(expected);
  });

  it.each([
    "normal",
    "maximized",
    "fullscreen",
  ] as const)("restores %s with its normal bounds on a connected monitor", (mode) => {
    const bounds = { x: -1400, y: 100, width: 1000, height: 650 };
    saveWindowState(statePath, { bounds, mode });
    expect(loadWindowState(statePath, primary, [primary, secondary])).toEqual({ bounds, mode });
  });

  it("centers saved bounds on the primary monitor when the previous monitor is gone", () => {
    saveWindowState(statePath, {
      bounds: { x: -1450, y: 100, width: 1000, height: 650 },
      mode: "maximized",
    });
    expect(loadWindowState(statePath, primary, [primary])).toEqual({
      bounds: { x: 300, y: 125, width: 1000, height: 650 },
      mode: "maximized",
    });
  });

  it("replaces the last state and fits bounds within a smaller display work area", () => {
    const workArea = { x: 40, y: 20, width: 800, height: 580 };
    saveWindowState(statePath, {
      bounds: { x: 100, y: 100, width: 800, height: 550 },
      mode: "maximized",
    });
    saveWindowState(statePath, {
      bounds: { x: 100, y: 100, width: 1000, height: 650 },
      mode: "normal",
    });
    expect(loadWindowState(statePath, workArea, [workArea])).toEqual({
      bounds: workArea,
      mode: "normal",
    });
  });
});
