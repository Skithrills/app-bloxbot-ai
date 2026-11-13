import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PersonalisationSettings from "@/components/PersonalisationSettings";
import { ThemeProvider } from "@/components/theme-provider";
import { qk } from "@/lib/queryKeys";
import { ACCENT_COLORS, DEFAULT_APP_CONFIG } from "@/types/desktop";

function open() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(qk.config, DEFAULT_APP_CONFIG);
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PersonalisationSettings />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("Settings: personalisation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.accent;
  });

  it("offers every accent by name and marks the one in use", () => {
    open();
    const choices = within(screen.getByRole("group", { name: "Accent colour" })).getAllByRole(
      "button",
    );
    expect(choices).toHaveLength(ACCENT_COLORS.length);
    expect(screen.getByRole("button", { name: "Blue", pressed: true })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("recolours the app and saves the choice", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Green" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Green", pressed: true })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Blue", pressed: false })).toBeInTheDocument();
    expect(document.documentElement.dataset.accent).toBe("green");

    const { desktop } = await import("@/lib/desktop");
    await waitFor(async () => {
      await expect(desktop.loadConfig()).resolves.toMatchObject({ accentColor: "green" });
    });
  });
});
