import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
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
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(theme: Theme): ResolvedTheme {
  const root = window.document.documentElement;
  const resolved = resolveTheme(theme);
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  return resolved;
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
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(defaultTheme),
  );
  // Follows the saved config, which setAccent updates before the file is written.
  const accent = configData?.accentColor ?? DEFAULT_ACCENT_COLOR;

  useEffect(() => {
    if (!configData) return;
    setThemeState(configData.theme);
  }, [configData]);

  useEffect(() => {
    window.document.documentElement.dataset.accent = accent;
  }, [accent]);

  const setAccent = useCallback(
    (next: AccentColor) => {
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
    [queryClient],
  );

  useEffect(() => {
    const sync = () => setResolvedTheme(applyTheme(theme));
    sync();

    if (theme !== "system") return;
    return subscribePrefersColorScheme(sync);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      setResolvedTheme(applyTheme(next));
      // Keep the cached config in step, or the next setting saved would bring the old theme back.
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, theme: next } : config,
      );
      patchConfig({ theme: next }).catch(() => {});
    },
    [queryClient],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, accent, setAccent }),
    [theme, resolvedTheme, setTheme, accent, setAccent],
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
