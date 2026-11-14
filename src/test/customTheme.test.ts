import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_THEMES } from "@/lib/builtInThemes";
import {
  createCustomTheme,
  decodeTheme,
  EMPTY_THEME_LIBRARY,
  encodeTheme,
  THEME_COLOR_GROUPS,
  THEME_LIBRARY_MAX,
  THEME_NAME_MAX,
  THEME_SHARE_MAX_LENGTH,
  ThemeLibrarySchema,
} from "@/types/customTheme";

describe("custom themes", () => {
  it("creates an independently identifiable theme with stock defaults", () => {
    const theme = createCustomTheme("  My theme  ");

    expect(theme).toEqual({
      id: expect.any(String),
      name: "My theme",
      light: {},
      dark: {},
      uiFont: "default",
      codeFont: "default",
      fontScale: 100,
      radius: 8,
    });
    expect(createCustomTheme(theme.name).id).not.toBe(theme.id);
    expect(() => createCustomTheme("  ")).toThrow(/theme name/);
    expect(() => createCustomTheme("x".repeat(THEME_NAME_MAX + 1))).toThrow(/theme name/);
  });

  it("creates valid local IDs when only getRandomValues is available", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const theme = createCustomTheme("Fallback");
      const library = { activeId: theme.id, themes: [theme] };

      expect(theme.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(Schema.decodeUnknownSync(ThemeLibrarySchema)(library)).toEqual(library);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shares both palettes and appearance settings without including a local ID", () => {
    const original = {
      ...createCustomTheme("Evening"),
      light: { brand: "#aabbcc", "sidebar-ring": "#445566" },
      dark: { brand: "#102030", running: "#ABCDEF", "syntax-foreground": "#fedcba" },
      uiFont: "serif",
      codeFont: "courier",
      fontScale: 115,
      radius: 0,
    } as const;

    const json = encodeTheme(original);
    const imported = decodeTheme(json);

    expect(json).not.toContain(original.id);
    expect(imported.id).not.toBe(original.id);
    expect(encodeTheme(imported)).toBe(json);
    expect(decodeTheme(json.replace('"Evening"', '"  Evening  "')).name).toBe("Evening");
  });

  it("accepts every listed color in both palettes", () => {
    const keys = THEME_COLOR_GROUPS.flatMap(({ tokens }) => tokens.map(({ key }) => key));
    const palette = Object.fromEntries(keys.map((key) => [key, "#112233"]));
    const theme = { ...createCustomTheme("Complete"), light: palette, dark: palette };

    expect(new Set(keys).size).toBe(keys.length);
    expect(decodeTheme(encodeTheme(theme))).toMatchObject({ light: palette, dark: palette });
  });

  it.each([
    { light: { brand: "red" } },
    { light: { brand: "#112233\n" } },
    { dark: { background: "url(https://example.com)" } },
    { dark: { foreground: "var(--brand)" } },
    { light: { tap: "#112233" } },
    { dark: { "--brand": "#112233" } },
    { name: " " },
    { name: "x".repeat(THEME_NAME_MAX + 1) },
    { uiFont: "custom" },
    { codeFont: "custom" },
    { fontScale: 84 },
    { fontScale: 125.5 },
    { radius: 20.5 },
    { radius: -1 },
    { id: "local-id" },
  ])("rejects invalid or unexpected fields in shared themes (%o)", (patch) => {
    const { version, theme } = JSON.parse(encodeTheme(createCustomTheme("Example")));

    expect(() => decodeTheme(JSON.stringify({ version, theme: { ...theme, ...patch } }))).toThrow(
      /unsupported format or invalid settings/,
    );
  });

  it("rejects invalid JSON, unsupported versions, and oversized input", () => {
    const json = encodeTheme(createCustomTheme("Example"));

    expect(() => decodeTheme("not JSON")).toThrow(/valid theme JSON/);
    expect(() => decodeTheme(json.replace('"version": 1', '"version": 2'))).toThrow(
      /unsupported format/,
    );
    expect(() => decodeTheme(`${json}${" ".repeat(THEME_SHARE_MAX_LENGTH)}`)).toThrow(/too large/);
  });

  it("requires unique local IDs and a valid active theme in a bounded library", () => {
    const first = createCustomTheme("First");
    const second = createCustomTheme("Second");
    const parse = Schema.decodeUnknownSync(ThemeLibrarySchema);
    const library = { activeId: second.id, themes: [first, second] };

    expect(parse(EMPTY_THEME_LIBRARY)).toEqual(EMPTY_THEME_LIBRARY);
    expect(parse(library)).toEqual(library);
    expect(() => parse({ activeId: second.id, themes: [first] })).toThrow();
    expect(() => parse({ activeId: null, themes: [first, first] })).toThrow();
    expect(() =>
      parse({
        activeId: null,
        themes: Array.from({ length: THEME_LIBRARY_MAX + 1 }, () => createCustomTheme("Theme")),
      }),
    ).toThrow();
  });

  it("recognises built-in selection IDs without storing them as custom themes", () => {
    const parse = Schema.decodeUnknownSync(ThemeLibrarySchema);
    const legacySelection = Schema.decodeUnknownSync(
      Schema.Struct({ activeId: Schema.NullOr(Schema.UUID) }),
    );
    for (const { id } of BUILT_IN_THEMES) {
      const library = { activeId: null, activeBuiltInId: id, themes: [] };
      expect(parse(library)).toEqual(library);
      expect(legacySelection(library)).toEqual({ activeId: null });
    }
    const custom = createCustomTheme("Local");
    expect(() =>
      parse({ activeId: null, activeBuiltInId: "unknown-preset", themes: [] }),
    ).toThrow();
    expect(() =>
      parse({ activeId: custom.id, activeBuiltInId: "vesper", themes: [custom] }),
    ).toThrow();
    expect(() =>
      parse({ activeId: "vesper", themes: [{ ...createCustomTheme("Fake"), id: "vesper" }] }),
    ).toThrow();
  });
});
