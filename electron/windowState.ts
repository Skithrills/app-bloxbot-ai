import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Rectangle } from "electron";

export const minimumWindowSize = { width: 520, height: 400 };

export type WindowMode = "normal" | "maximized" | "fullscreen";

interface WindowState {
  bounds: Rectangle;
  mode: WindowMode;
}

function isRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") return false;
  const { x, y, width, height } = value as Partial<Rectangle>;
  return (
    Number.isSafeInteger(x) &&
    Number.isSafeInteger(y) &&
    typeof width === "number" &&
    Number.isSafeInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isSafeInteger(height) &&
    height > 0
  );
}

function readState(path: string): WindowState | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object") return;
    const { bounds, mode } = value as Partial<WindowState>;
    if (isRectangle(bounds) && (mode === "normal" || mode === "maximized" || mode === "fullscreen")) {
      return { bounds, mode };
    }
  } catch {
    // A missing or damaged file uses the first-launch defaults.
  }
}

function overlapArea(bounds: Rectangle, area: Rectangle): number {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return Math.max(0, width) * Math.max(0, height);
}

export function loadWindowState(
  path: string,
  primaryWorkArea: Rectangle,
  workAreas: readonly Rectangle[],
): WindowState {
  const saved = readState(path);
  let workArea = primaryWorkArea;
  let greatestOverlap = 0;
  if (saved) {
    for (const area of workAreas) {
      const overlap = overlapArea(saved.bounds, area);
      if (overlap > greatestOverlap) {
        workArea = area;
        greatestOverlap = overlap;
      }
    }
  }

  const width = Math.min(workArea.width, Math.max(minimumWindowSize.width, saved?.bounds.width ?? 920));
  const height = Math.min(
    workArea.height,
    Math.max(minimumWindowSize.height, saved?.bounds.height ?? 600),
  );
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const keepPosition = saved && greatestOverlap > 0;

  return {
    bounds: {
      x: keepPosition
        ? Math.min(maxX, Math.max(workArea.x, saved.bounds.x))
        : Math.round((workArea.x + maxX) / 2),
      y: keepPosition
        ? Math.min(maxY, Math.max(workArea.y, saved.bounds.y))
        : Math.round((workArea.y + maxY) / 2),
      width,
      height,
    },
    mode: saved?.mode ?? "maximized",
  };
}

export function saveWindowState(path: string, state: WindowState): void {
  const temporaryPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporaryPath, JSON.stringify(state), "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Report the original write error.
    }
    throw error;
  }
}
