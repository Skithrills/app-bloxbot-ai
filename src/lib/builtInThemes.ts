import type { ThemeColorKey, ThemePalette } from "@/types/customTheme";

type ThemeColors = {
  background: string;
  card: string;
  popover: string;
  sidebar: string;
  muted: string;
  hover: string;
  message: string;
  code: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  input: string;
  primaryForeground: string;
  brand: string;
  brandForeground: string;
  brandText: string;
  success: string;
  warning: string;
  info: string;
  destructive: string;
  chartAccent: string;
};

function createPalette(
  colors: ThemeColors,
): Record<Exclude<ThemeColorKey, "syntax-foreground">, string> {
  return {
    background: colors.background,
    foreground: colors.foreground,
    card: colors.card,
    "card-foreground": colors.foreground,
    popover: colors.popover,
    "popover-foreground": colors.foreground,
    muted: colors.muted,
    "muted-foreground": colors.mutedForeground,
    border: colors.border,
    input: colors.input,
    brand: colors.brand,
    "brand-foreground": colors.brandForeground,
    "brand-text": colors.brandText,
    primary: colors.foreground,
    "primary-foreground": colors.primaryForeground,
    secondary: colors.muted,
    "secondary-foreground": colors.foreground,
    accent: colors.hover,
    "accent-foreground": colors.foreground,
    ring: colors.brand,
    sidebar: colors.sidebar,
    "sidebar-foreground": colors.foreground,
    "sidebar-accent": colors.hover,
    "sidebar-accent-foreground": colors.foreground,
    "sidebar-border": colors.border,
    "sidebar-ring": colors.brand,
    "user-message": colors.message,
    "user-message-foreground": colors.foreground,
    "syntax-background": colors.code,
    "diff-add": colors.success,
    "diff-remove": colors.destructive,
    destructive: colors.destructive,
    "destructive-foreground": colors.primaryForeground,
    success: colors.success,
    warning: colors.warning,
    info: colors.info,
    running: colors.brand,
    "chart-1": colors.info,
    "chart-2": colors.chartAccent,
    "chart-3": colors.destructive,
    "chart-4": colors.success,
    "chart-5": colors.warning,
  };
}

// The upstream palettes are adapted to BloxBot's surfaces and semantic text roles.
// GitHub Light/Dark token colors remain under Shiki's control.
export const BUILT_IN_THEMES = [
  {
    id: "vesper",
    name: "Vesper",
    mode: "dark",
    author: "Rauno Freiberg",
    source: "https://github.com/raunofreiberg/vesper",
    palette: createPalette({
      background: "#101010",
      card: "#1c1c1c",
      popover: "#232323",
      sidebar: "#161616",
      muted: "#232323",
      hover: "#282828",
      message: "#28241f",
      code: "#101010",
      foreground: "#ffffff",
      mutedForeground: "#adadad",
      border: "#363432",
      input: "#76726c",
      primaryForeground: "#101010",
      brand: "#ffc799",
      brandForeground: "#101010",
      brandText: "#ffc799",
      success: "#99ffe4",
      warning: "#ffd39e",
      info: "#a9cfff",
      destructive: "#ff8d8d",
      chartAccent: "#cbb2eb",
    }),
  },
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    author: "Dracula Theme",
    source: "https://draculatheme.com/spec",
    palette: createPalette({
      background: "#282a36",
      card: "#343746",
      popover: "#363848",
      sidebar: "#21222c",
      muted: "#343746",
      hover: "#3c3e4c",
      message: "#3c364e",
      code: "#191a23",
      foreground: "#f8f8f2",
      mutedForeground: "#b4c0e4",
      border: "#484b60",
      input: "#898ba2",
      primaryForeground: "#21222c",
      brand: "#bd93f9",
      brandForeground: "#21222c",
      brandText: "#d7b9ff",
      success: "#50fa7b",
      warning: "#ffbf7d",
      info: "#8be9fd",
      destructive: "#ffb3b3",
      chartAccent: "#bd93f9",
    }),
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    mode: "dark",
    author: "Ethan Schoonover",
    source: "https://ethanschoonover.com/solarized/",
    palette: createPalette({
      background: "#002b36",
      card: "#073642",
      popover: "#093946",
      sidebar: "#00232d",
      muted: "#073642",
      hover: "#0b3d49",
      message: "#103e4e",
      code: "#001a23",
      foreground: "#c5d0cf",
      mutedForeground: "#a5b3b3",
      border: "#22515c",
      input: "#75949d",
      primaryForeground: "#00232d",
      brand: "#69bafa",
      brandForeground: "#00232d",
      brandText: "#93cefb",
      success: "#8bd17f",
      warning: "#e8bd59",
      info: "#6ad1c6",
      destructive: "#ffa7a2",
      chartAccent: "#aeb2f3",
    }),
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    author: "Enkia",
    source: "https://github.com/tokyo-night/tokyo-night-vscode-theme",
    palette: createPalette({
      background: "#1a1b26",
      card: "#202330",
      popover: "#272a38",
      sidebar: "#16161e",
      muted: "#272a38",
      hover: "#2f3447",
      message: "#252d45",
      code: "#14141b",
      foreground: "#c0caf5",
      mutedForeground: "#a9b4dc",
      border: "#363b54",
      input: "#78819d",
      primaryForeground: "#16161e",
      brand: "#7aa2f7",
      brandForeground: "#16161e",
      brandText: "#a4bfff",
      success: "#9ece6a",
      warning: "#ebbb79",
      info: "#7dcfff",
      destructive: "#ffa4b4",
      chartAccent: "#bb9af7",
    }),
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    mode: "light",
    author: "Catppuccin",
    source: "https://catppuccin.com/palette/#latte",
    palette: createPalette({
      background: "#eff1f5",
      card: "#f5f6f9",
      popover: "#f7f8fb",
      sidebar: "#e6e9ef",
      muted: "#e6e9ef",
      hover: "#dce0e8",
      message: "#dee5f5",
      code: "#fafbfc",
      foreground: "#4c4f69",
      mutedForeground: "#4f506a",
      border: "#bcc0cc",
      input: "#74778b",
      primaryForeground: "#ffffff",
      brand: "#1b59da",
      brandForeground: "#ffffff",
      brandText: "#1146ad",
      success: "#255b14",
      warning: "#744607",
      info: "#0f5581",
      destructive: "#9d102e",
      chartAccent: "#8839ef",
    }),
  },
  {
    id: "everforest-dark",
    name: "Everforest Dark",
    mode: "dark",
    author: "sainnhe",
    source: "https://github.com/sainnhe/everforest",
    palette: createPalette({
      background: "#2d353b",
      card: "#343f44",
      popover: "#374247",
      sidebar: "#232a2e",
      muted: "#39454a",
      hover: "#3d484d",
      message: "#38443e",
      code: "#192024",
      foreground: "#ded2b7",
      mutedForeground: "#b9c5bb",
      border: "#536066",
      input: "#909d97",
      primaryForeground: "#232a2e",
      brand: "#a7c080",
      brandForeground: "#232a2e",
      brandText: "#d2e5ad",
      success: "#cfe5a5",
      warning: "#f3d69e",
      info: "#b4e0d9",
      destructive: "#ffcbca",
      chartAccent: "#d7b4cb",
    }),
  },
] as const satisfies readonly {
  id: string;
  name: string;
  mode: "light" | "dark";
  palette: ThemePalette;
  source: string;
  author: string;
}[];

export type BuiltInTheme = (typeof BUILT_IN_THEMES)[number];
