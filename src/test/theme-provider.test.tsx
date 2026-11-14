import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { qk } from "@/lib/queryKeys";
import { createCustomTheme } from "@/types/customTheme";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme, accent, setAccent, previewTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="accent">{accent}</span>
      <button type="button" onClick={() => setAccent("violet")}>
        violet
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        system
      </button>
      <button
        type="button"
        onClick={() =>
          previewTheme(
            { ...createCustomTheme("Preview"), light: { foreground: "#123456" } },
            "light",
          )
        }
      >
        preview
      </button>
      <button type="button" onClick={() => previewTheme(null)}>
        cancel preview
      </button>
    </div>
  );
}

function renderThemeProvider(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("light", "dark");
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove("light", "dark");
    vi.unstubAllGlobals();
  });

  it("applies the dark class and persists preference via AppConfig", async () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(qk.config, {
      lastModel: null,
      hiddenModels: [],
      theme: "system",
    });

    renderThemeProvider(queryClient);

    await act(async () => {
      screen.getByRole("button", { name: "dark" }).click();
    });

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    const { desktop } = await import("@/lib/desktop");
    await waitFor(async () => {
      await expect(desktop.loadConfig()).resolves.toMatchObject({ theme: "dark" });
    });
  });

  it("applies the accent colour, saves it, and keeps it when other settings change", async () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(qk.config, { ...DEFAULT_APP_CONFIG });

    renderThemeProvider(queryClient);
    expect(screen.getByTestId("accent")).toHaveTextContent("blue");
    expect(document.documentElement.dataset.accent).toBe("blue");

    await act(async () => {
      screen.getByRole("button", { name: "violet" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("accent")).toHaveTextContent("violet"));
    expect(document.documentElement.dataset.accent).toBe("violet");

    const { desktop } = await import("@/lib/desktop");
    await waitFor(async () => {
      await expect(desktop.loadConfig()).resolves.toMatchObject({ accentColor: "violet" });
    });

    // Another setting writing to the cached config must not put the old accent back.
    act(() => {
      queryClient.setQueryData(qk.config, (config: typeof DEFAULT_APP_CONFIG | undefined) =>
        config ? { ...config, composerPredictions: true } : config,
      );
    });
    await waitFor(() =>
      expect(queryClient.getQueryData<typeof DEFAULT_APP_CONFIG>(qk.config)).toMatchObject({
        composerPredictions: true,
        accentColor: "violet",
      }),
    );
    expect(screen.getByTestId("accent")).toHaveTextContent("violet");
    expect(document.documentElement.dataset.accent).toBe("violet");
  });

  it("applies the saved palette for each system mode and cleans up preview overrides", async () => {
    const media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", () => media);
    const theme = {
      ...createCustomTheme("Slate"),
      light: { background: "#eeeeff" },
      dark: { background: "#111122", "syntax-foreground": "#999999" },
      uiFont: "serif" as const,
      codeFont: "courier" as const,
      fontScale: 115,
      radius: 0,
    };
    const queryClient = makeQueryClient();
    queryClient.setQueryData(qk.config, {
      ...DEFAULT_APP_CONFIG,
      themeLibrary: { activeId: theme.id, themes: [theme] },
    });
    renderThemeProvider(queryClient);
    const { style } = document.documentElement;
    expect(style.getPropertyValue("--background")).toBe("#eeeeff");
    expect(style.getPropertyValue("--theme-scale")).toBe("115%");
    expect(style.getPropertyValue("--radius")).toBe("0px");
    expect(style.getPropertyValue("--theme-ui-font")).toContain("Georgia");
    expect(style.getPropertyValue("--theme-code-font")).toContain("Courier New");

    act(() => {
      media.matches = true;
      media.dispatchEvent(new Event("change"));
    });
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(style.getPropertyValue("--background")).toBe("#111122");
    expect(style.getPropertyValue("--syntax-foreground")).toBe("#999999");

    fireEvent.click(screen.getByRole("button", { name: "preview", exact: true }));
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(style.getPropertyValue("--foreground")).toBe("#123456");
    expect(style.getPropertyValue("--background")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "cancel preview" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(style.getPropertyValue("--foreground")).toBe("");
    expect(style.getPropertyValue("--background")).toBe("#111122");
  });

  it("restores the default palette immediately and keeps saved themes for reuse", async () => {
    const theme = { ...createCustomTheme("Low contrast"), light: { foreground: "#ffffff" } };
    const queryClient = makeQueryClient();
    queryClient.setQueryData(qk.config, {
      ...DEFAULT_APP_CONFIG,
      theme: "light",
      themeLibrary: { activeId: theme.id, themes: [theme] },
    });
    renderThemeProvider(queryClient);
    const { style } = document.documentElement;
    await waitFor(() => expect(style.getPropertyValue("--foreground")).toBe("#ffffff"));

    fireEvent.keyDown(window, { code: "Digit0", shiftKey: true, ctrlKey: true });
    expect(style.getPropertyValue("--foreground")).toBe("");
    const { desktop } = await import("@/lib/desktop");
    await waitFor(async () => {
      await expect(desktop.loadConfig()).resolves.toMatchObject({
        themeLibrary: { activeId: null, themes: [theme] },
      });
    });
  });
});
