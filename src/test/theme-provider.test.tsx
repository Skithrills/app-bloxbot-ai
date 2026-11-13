import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { qk } from "@/lib/queryKeys";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
}

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme, accent, setAccent } = useTheme();
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
      detailedAnalytics: "disabled",
      analyticsNoticeVersion: 2,
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
    queryClient.setQueryData(qk.config, { ...DEFAULT_APP_CONFIG, analyticsNoticeVersion: 2 });

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
});
