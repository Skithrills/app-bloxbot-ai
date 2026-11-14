import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { BUILT_IN_THEMES, type BuiltInTheme } from "@/lib/builtInThemes";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import {
  type CustomTheme,
  EMPTY_THEME_LIBRARY,
  type ThemeLibrary,
  type ThemePalette,
} from "@/types/customTheme";
import { type AccentColor, DEFAULT_ACCENT_COLOR, type ThemePreference } from "@/types/desktop";

export type Theme = ThemePreference;
export type ResolvedTheme = "light" | "dark";

export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** The colours themselves live in index.css under `[data-accent]`. */
export const ACCENT_OPTIONS: ReadonlyArray<{ value: AccentColor; label: string }> = [
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "pink", label: "Pink" },
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
  { value: "teal", label: "Teal" },
];

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
};

type ThemeProviderState = {
  theme: Theme;
  appearanceTheme: ResolvedTheme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  accent: AccentColor | null;
  defaultAccent: AccentColor;
  setAccent: (accent: AccentColor | null) => void;
  presetAccent: BuiltInTheme | undefined;
  themeLibrary: ThemeLibrary;
  themeLibraryReady: boolean;
  builtInPreview: BuiltInTheme | null;
  saveThemeLibrary: (library: ThemeLibrary, appearance?: ResolvedTheme) => Promise<void>;
  previewTheme: (theme: CustomTheme | BuiltInTheme | null, mode?: ResolvedTheme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const uiFonts: Record<CustomTheme["uiFont"], string | undefined> = {
  default: undefined,
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Cascadia Mono", "SF Mono", monospace',
};

const codeFonts: Record<CustomTheme["codeFont"], string | undefined> = {
  default: undefined,
  system: 'ui-monospace, "Cascadia Mono", "SF Mono", monospace',
  courier: '"Courier New", Courier, monospace',
};

const presetAccentTokens = new Set([
  "brand",
  "brand-foreground",
  "brand-text",
  "ring",
  "sidebar-ring",
  "running",
]);

function applyTheme(
  root: HTMLElement,
  palette: ThemePalette,
  custom?: CustomTheme,
  replaceAccent = false,
) {
  const properties: Array<[string, string | undefined]> = Object.entries(palette)
    .filter(([token]) => !replaceAccent || !presetAccentTokens.has(token))
    .map(([token, value]) => [`--${token}`, value]);
  if (custom) {
    properties.push(
      ["--theme-ui-font", uiFonts[custom.uiFont]],
      ["--theme-code-font", codeFonts[custom.codeFont]],
      ["--theme-scale", `${custom.fontScale}%`],
      ["--radius", `${custom.radius}px`],
    );
  }
  for (const [token, value] of properties) {
    if (typeof value === "string") root.style.setProperty(token, value);
  }
  return () => {
    for (const [token, value] of properties) {
      if (typeof value === "string") root.style.removeProperty(token);
    }
  };
}

function subscribePrefersColorScheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }

  media.addListener(onChange);
  return () => media.removeListener(onChange);
}

export function ThemeProvider({ children, defaultTheme = "system" }: ThemeProviderProps) {
  const { data: configData } = useQuery({
    queryKey: qk.config,
    queryFn: loadConfig,
  });

  const queryClient = useQueryClient();
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [preview, setPreview] = useState<{
    theme: CustomTheme | BuiltInTheme;
    mode?: ResolvedTheme;
  } | null>(null);
  const [previewSuppressed, setPreviewSuppressed] = useState(false);
  // Recovery is immediate, including when the settings file can't be written.
  const [recovered, setRecovered] = useState(false);
  const savedLibrary = configData?.themeLibrary ?? EMPTY_THEME_LIBRARY;
  const themeLibrary = useMemo(
    () => (recovered ? { activeId: null, themes: savedLibrary.themes } : savedLibrary),
    [recovered, savedLibrary],
  );
  const savedTheme =
    BUILT_IN_THEMES.find(({ id }) => id === themeLibrary.activeBuiltInId) ??
    themeLibrary.themes.find(({ id }) => id === themeLibrary.activeId);
  const visiblePreview = previewSuppressed ? null : preview;
  const builtInPreview =
    visiblePreview && "palette" in visiblePreview.theme ? visiblePreview.theme : null;
  const appliedTheme = visiblePreview?.theme ?? savedTheme;
  const builtIn = appliedTheme && "palette" in appliedTheme ? appliedTheme : undefined;
  const presetAccent =
    builtInPreview ?? (savedTheme && "palette" in savedTheme ? savedTheme : undefined);
  const appearanceTheme = theme === "system" ? systemTheme : theme;
  const resolvedTheme = builtIn?.mode ?? visiblePreview?.mode ?? appearanceTheme;
  const themeLibraryReady = configData !== undefined;
  // Follows the saved config, which setAccent updates before the file is written.
  const defaultAccent = configData?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const appliedPresetAccent = builtIn && configData?.presetAccentColors?.[builtIn.id];
  const accent = presetAccent
    ? (configData?.presetAccentColors?.[presetAccent.id] ?? null)
    : defaultAccent;

  useEffect(() => {
    if (!configData) return;
    setThemeState(configData.theme);
  }, [configData]);

  useLayoutEffect(() => {
    window.document.documentElement.dataset.accent = appliedPresetAccent || defaultAccent;
  }, [appliedPresetAccent, defaultAccent]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    if (appliedTheme) {
      return "palette" in appliedTheme
        ? applyTheme(root, appliedTheme.palette, undefined, Boolean(appliedPresetAccent))
        : applyTheme(root, appliedTheme[resolvedTheme], appliedTheme);
    }
  }, [resolvedTheme, appliedTheme, appliedPresetAccent]);

  const previewTheme = useCallback(
    (draft: CustomTheme | BuiltInTheme | null, mode?: ResolvedTheme) => {
      if (!draft || "palette" in draft) setPreviewSuppressed(false);
      setPreview(draft ? { theme: draft, mode } : null);
    },
    [],
  );

  const { mutateAsync: saveLibrary } = useMutation({
    scope: { id: "theme-library" },
    mutationFn: async ({
      library: requested,
      appearance,
    }: {
      library: ThemeLibrary | null;
      appearance?: ResolvedTheme;
    }) => {
      const current = queryClient.getQueryData<AppConfig>(qk.config)?.themeLibrary;
      const library = requested ?? { activeId: null, themes: current?.themes ?? [] };
      if (requested === null && !current?.activeId && !current?.activeBuiltInId) return;
      const patch = { themeLibrary: library, ...(appearance ? { theme: appearance } : {}) };
      await patchConfig(patch);
      await queryClient.cancelQueries({ queryKey: qk.config, exact: true });
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, ...patch } : config,
      );
      if (appearance) setThemeState(appearance);
    },
    onSuccess: () => setRecovered(false),
  });

  const saveThemeLibrary = useCallback(
    (library: ThemeLibrary, appearance?: ResolvedTheme) => saveLibrary({ library, appearance }),
    [saveLibrary],
  );

  useEffect(() => {
    function restoreDefault(event: KeyboardEvent) {
      if (
        event.code !== "Digit0" ||
        !event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.repeat
      ) {
        return;
      }
      event.preventDefault();
      setPreview(null);
      setPreviewSuppressed(true);
      setRecovered(true);
      // Queue behind any in-flight save and preserve the library that save wrote.
      void saveLibrary({ library: null }).catch(() => {
        notify.error("Couldn't save the default theme");
      });
    }
    window.addEventListener("keydown", restoreDefault, true);
    return () => window.removeEventListener("keydown", restoreDefault, true);
  }, [saveLibrary]);

  const { mutate: savePresetAccent } = useMutation({
    scope: { id: "preset-accent" },
    mutationFn: async ({ id, color }: { id: string; color: AccentColor | null }) => {
      const presetAccentColors = {
        ...queryClient.getQueryData<AppConfig>(qk.config)?.presetAccentColors,
      };
      if (color === null) delete presetAccentColors[id];
      else presetAccentColors[id] = color;
      await patchConfig({ presetAccentColors });
      await queryClient.cancelQueries({ queryKey: qk.config, exact: true });
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, presetAccentColors } : config,
      );
    },
    onError: () => notify.error("Couldn't save the accent colour"),
  });

  const setAccent = useCallback(
    (next: AccentColor | null) => {
      if (presetAccent) {
        savePresetAccent({ id: presetAccent.id, color: next });
        return;
      }
      if (!next) return;
      const previous = queryClient.getQueryData<AppConfig>(qk.config)?.accentColor;
      const show = (accentColor: AccentColor) =>
        queryClient.setQueryData<AppConfig>(qk.config, (config) =>
          config ? { ...config, accentColor } : config,
        );
      show(next);
      patchConfig({ accentColor: next }).catch(() => {
        // Only undo our own choice: a later pick may already have replaced it.
        if (previous && queryClient.getQueryData<AppConfig>(qk.config)?.accentColor === next) {
          show(previous);
        }
        notify.error("Couldn't save the accent colour");
      });
    },
    [presetAccent, queryClient, savePresetAccent],
  );

  useEffect(() => {
    const sync = () => setSystemTheme(getSystemTheme());
    return subscribePrefersColorScheme(sync);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      // Keep the cached config in step, or the next setting saved would bring the old theme back.
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, theme: next } : config,
      );
      patchConfig({ theme: next }).catch(() => {});
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({
      theme,
      appearanceTheme,
      resolvedTheme,
      setTheme,
      accent,
      defaultAccent,
      setAccent,
      presetAccent,
      themeLibrary,
      themeLibraryReady,
      builtInPreview,
      saveThemeLibrary,
      previewTheme,
    }),
    [
      theme,
      appearanceTheme,
      resolvedTheme,
      setTheme,
      accent,
      defaultAccent,
      setAccent,
      presetAccent,
      themeLibrary,
      themeLibraryReady,
      builtInPreview,
      saveThemeLibrary,
      previewTheme,
    ],
  );

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeProviderContext)?.resolvedTheme ?? "light";
}
