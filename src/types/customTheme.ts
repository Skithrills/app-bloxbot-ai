import { Schema } from "effect";
import { BUILT_IN_THEMES } from "../lib/builtInThemes";

export const THEME_COLOR_GROUPS = [
  {
    label: "Surfaces and text",
    tokens: [
      { key: "background", label: "Window" },
      { key: "foreground", label: "Window text" },
      { key: "card", label: "Card" },
      { key: "card-foreground", label: "Card text" },
      { key: "popover", label: "Menu" },
      { key: "popover-foreground", label: "Menu text" },
      { key: "muted", label: "Muted surface" },
      { key: "muted-foreground", label: "Muted text" },
      { key: "border", label: "Borders" },
      { key: "input", label: "Input borders" },
    ],
  },
  {
    label: "Accent and controls",
    tokens: [
      { key: "brand", label: "Accent fill" },
      { key: "brand-foreground", label: "Text on accent" },
      { key: "brand-text", label: "Accent text" },
      { key: "primary", label: "Primary control" },
      { key: "primary-foreground", label: "Primary control text" },
      { key: "secondary", label: "Secondary control" },
      { key: "secondary-foreground", label: "Secondary control text" },
      { key: "accent", label: "Hover surface" },
      { key: "accent-foreground", label: "Hover text" },
      { key: "ring", label: "Focus ring" },
    ],
  },
  {
    label: "Sidebar",
    tokens: [
      { key: "sidebar", label: "Sidebar" },
      { key: "sidebar-foreground", label: "Sidebar text" },
      { key: "sidebar-accent", label: "Sidebar hover surface" },
      { key: "sidebar-accent-foreground", label: "Sidebar hover text" },
      { key: "sidebar-border", label: "Sidebar borders" },
      { key: "sidebar-ring", label: "Sidebar focus ring" },
    ],
  },
  {
    label: "Chat and code",
    tokens: [
      { key: "user-message", label: "User message" },
      { key: "user-message-foreground", label: "User message text" },
      { key: "syntax-background", label: "Code background" },
      { key: "syntax-foreground", label: "Code text override" },
      { key: "diff-add", label: "Added line text" },
      { key: "diff-remove", label: "Removed line text" },
    ],
  },
  {
    label: "Status",
    tokens: [
      { key: "destructive", label: "Error and destructive actions" },
      { key: "destructive-foreground", label: "Text on destructive actions" },
      { key: "success", label: "Success" },
      { key: "warning", label: "Warning" },
      { key: "info", label: "Information" },
      { key: "running", label: "Running" },
    ],
  },
  {
    label: "Context chart",
    tokens: [
      { key: "chart-1", label: "Input" },
      { key: "chart-2", label: "Cache read" },
      { key: "chart-3", label: "Cache write" },
      { key: "chart-4", label: "Output" },
      { key: "chart-5", label: "Reasoning" },
    ],
  },
] as const;

export const THEME_UI_FONTS = [
  { value: "default", label: "Inter (default)" },
  { value: "system", label: "System" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Monospace" },
] as const;

export const THEME_CODE_FONTS = [
  { value: "default", label: "JetBrains Mono (default)" },
  { value: "system", label: "System monospace" },
  { value: "courier", label: "Courier New" },
] as const;

export const THEME_NAME_MAX = 60;
export const THEME_LIBRARY_MAX = 30;
export const THEME_SHARE_MAX_LENGTH = 16_384;
export const THEME_FONT_SCALE_MIN = 85;
export const THEME_FONT_SCALE_MAX = 125;
export const THEME_RADIUS_MIN = 0;
export const THEME_RADIUS_MAX = 20;

export type ThemeColorKey = (typeof THEME_COLOR_GROUPS)[number]["tokens"][number]["key"];

const hexColorPattern = /^#[0-9a-f]{6}$/i;
export function isThemeColor(value: string): boolean {
  return value.length === 7 && hexColorPattern.test(value);
}

const OptionalHexColor = Schema.optional(Schema.String.pipe(Schema.filter(isThemeColor)));
const colorFields = Object.fromEntries(
  THEME_COLOR_GROUPS.flatMap(({ tokens }) => tokens.map(({ key }) => [key, OptionalHexColor])),
) as Record<ThemeColorKey, typeof OptionalHexColor>;
const ThemePaletteSchema = Schema.Struct(colorFields);
export type ThemePalette = typeof ThemePaletteSchema.Type;

const ThemeNameSchema = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(THEME_NAME_MAX));
const SharedThemeSchema = Schema.Struct({
  name: ThemeNameSchema,
  light: ThemePaletteSchema,
  dark: ThemePaletteSchema,
  uiFont: Schema.Literal(...THEME_UI_FONTS.map(({ value }) => value)),
  codeFont: Schema.Literal(...THEME_CODE_FONTS.map(({ value }) => value)),
  fontScale: Schema.Number.pipe(
    Schema.int(),
    Schema.between(THEME_FONT_SCALE_MIN, THEME_FONT_SCALE_MAX),
  ),
  radius: Schema.Number.pipe(Schema.int(), Schema.between(THEME_RADIUS_MIN, THEME_RADIUS_MAX)),
});
const CustomThemeSchema = Schema.Struct({ id: Schema.UUID, ...SharedThemeSchema.fields });
export type CustomTheme = typeof CustomThemeSchema.Type;

const BuiltInThemeId = Schema.Literal(...BUILT_IN_THEMES.map(({ id }) => id));

export const ThemeLibrarySchema = Schema.Struct({
  activeId: Schema.NullOr(Schema.UUID),
  activeBuiltInId: Schema.optional(BuiltInThemeId),
  themes: Schema.Array(CustomThemeSchema).pipe(Schema.maxItems(THEME_LIBRARY_MAX)),
}).pipe(
  Schema.filter(({ activeId, activeBuiltInId, themes }) => {
    const ids = new Set(themes.map(({ id }) => id));
    // Keep activeId a local UUID or null so the previous preview can still read the library.
    return (
      ids.size === themes.length && (activeId === null || (!activeBuiltInId && ids.has(activeId)))
    );
  }),
);
export type ThemeLibrary = typeof ThemeLibrarySchema.Type;

export const EMPTY_THEME_LIBRARY: ThemeLibrary = { activeId: null, themes: [] };

function createThemeId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createCustomTheme(name: string): CustomTheme {
  const parsedName = Schema.decodeUnknownOption(ThemeNameSchema)(name);
  if (parsedName._tag === "None") {
    throw new Error(`Enter a theme name between 1 and ${THEME_NAME_MAX} characters.`);
  }

  return {
    id: createThemeId(),
    name: parsedName.value,
    light: {},
    dark: {},
    uiFont: "default",
    codeFont: "default",
    fontScale: 100,
    radius: 8,
  };
}

const ThemeShareSchema = Schema.Struct({
  version: Schema.Literal(1),
  theme: SharedThemeSchema,
});
const parseThemeShare = Schema.decodeUnknownOption(ThemeShareSchema, { onExcessProperty: "error" });

export function encodeTheme({ id: _id, ...theme }: CustomTheme): string {
  const share = parseThemeShare({ version: 1, theme });
  if (share._tag === "None") throw new Error("This theme has invalid settings.");
  return JSON.stringify(share.value, null, 2);
}

export function decodeTheme(text: string): CustomTheme {
  if (text.length > THEME_SHARE_MAX_LENGTH) throw new Error("The theme JSON is too large.");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The theme could not be read. Paste valid theme JSON.");
  }

  const share = parseThemeShare(data);
  if (share._tag === "None") {
    throw new Error("The theme has an unsupported format or invalid settings.");
  }
  return { id: createThemeId(), ...share.value.theme };
}
