import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES } from "@/lib/builtInThemes";
import { isThemeColor, THEME_COLOR_GROUPS } from "@/types/customTheme";

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function composite(over: number[], under: number[], opacity: number): number[] {
  return over.map((channel, index) => channel * opacity + under[index] * (1 - opacity));
}

function luminance(color: number[]): number {
  const [red, green, blue] = color.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: number[], background: number[]): number {
  const a = luminance(foreground) + 0.05;
  const b = luminance(background) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

const surfaces = [
  "background",
  "card",
  "popover",
  "muted",
  "secondary",
  "accent",
  "sidebar",
  "sidebar-accent",
  "user-message",
] as const;

const textPairs = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["user-message-foreground", "user-message"],
  ["brand-foreground", "brand"],
  ["primary-foreground", "primary"],
  ["destructive-foreground", "destructive"],
] as const;

describe.each(BUILT_IN_THEMES)("built-in theme $name", ({ palette }) => {
  it("maps every palette token and lets Shiki supply syntax foregrounds", () => {
    const expectedKeys = THEME_COLOR_GROUPS.flatMap(({ tokens }) => tokens.map(({ key }) => key))
      .filter((key) => key !== "syntax-foreground")
      .sort();
    expect(Object.keys(palette).sort()).toEqual(expectedKeys);
    expect(Object.values(palette).every(isThemeColor)).toBe(true);
  });

  it("keeps text readable on panels, messages, and filled controls", () => {
    for (const [foreground, background] of textPairs) {
      expect(
        contrast(rgb(palette[foreground]), rgb(palette[background])),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of surfaces) {
      expect(
        contrast(rgb(palette["muted-foreground"]), rgb(palette[surface])),
        surface,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(rgb(palette["brand-text"]), rgb(palette[surface])),
        surface,
      ).toBeGreaterThanOrEqual(4.5);
    }
    const code = rgb(palette["syntax-background"]);
    const fallback = composite(rgb(palette["muted-foreground"]), code, 0.8);
    expect(contrast(fallback, code), "plain code fallback").toBeGreaterThanOrEqual(4.5);
  });

  it("keeps status badges and diff text readable over their tinted surfaces", () => {
    for (const surface of surfaces) {
      const background = rgb(palette[surface]);
      for (const role of ["success", "warning", "info", "destructive"] as const) {
        const foreground = rgb(palette[role]);
        const tint = composite(foreground, background, 0.15);
        expect(contrast(foreground, tint), `${role} on tinted ${surface}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      for (const role of ["diff-add", "diff-remove"] as const) {
        expect(
          contrast(rgb(palette[role]), background),
          `${role} count on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
        const diffLine = composite(rgb(palette[role]), background, 0.1);
        expect(
          contrast(rgb(palette.foreground), diffLine),
          `${role} line on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps focus rings, status indicators, and chart marks visible", () => {
    for (const surface of surfaces) {
      for (const control of ["ring", "sidebar-ring", "input", "running"] as const) {
        expect(
          contrast(rgb(palette[control]), rgb(palette[surface])),
          `${control} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
    const chartColors = [
      palette["chart-1"],
      palette["chart-2"],
      palette["chart-3"],
      palette["chart-4"],
      palette["chart-5"],
    ];
    expect(new Set(chartColors).size).toBe(chartColors.length);
    for (const color of chartColors) {
      expect(contrast(rgb(color), rgb(palette.popover)), color).toBeGreaterThanOrEqual(3);
    }
  });
});
