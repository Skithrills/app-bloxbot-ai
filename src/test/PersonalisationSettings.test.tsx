import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PersonalisationSettings from "@/components/PersonalisationSettings";
import { ThemeProvider } from "@/components/theme-provider";
import { qk } from "@/lib/queryKeys";
import { createCustomTheme, encodeTheme } from "@/types/customTheme";
import { ACCENT_COLORS, DEFAULT_APP_CONFIG } from "@/types/desktop";

function open() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(qk.config, DEFAULT_APP_CONFIG);
  const settings = (visible: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{visible && <PersonalisationSettings />}</ThemeProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(settings(true));
  return { close: () => rerender(settings(false)) };
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
    expect(choices.filter((choice) => choice.getAttribute("aria-pressed") === "true")).toHaveLength(
      1,
    );
  });

  it("sets colour mode alongside themes and saves an accent for a single preset", async () => {
    open();
    const mode = within(screen.getByRole("group", { name: "Colour mode" }));
    fireEvent.click(mode.getByRole("button", { name: "Dark" }));
    expect(mode.getByRole("button", { name: "Dark", pressed: true })).toBeVisible();
    const select = screen.getByRole("combobox", { name: "Theme" });
    const preset = within(select).getByRole("option", { name: /Dracula/ });
    fireEvent.change(select, { target: { value: preset.getAttribute("value") } });
    const root = document.documentElement;
    const brand = root.style.getPropertyValue("--brand");
    const background = root.style.getPropertyValue("--background");
    expect(brand).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    await waitFor(() => expect(root.dataset.accent).toBe("green"));
    expect(root.style.getPropertyValue("--brand")).toBe("");
    expect(root.style.getPropertyValue("--background")).toBe(background);
    const { desktop } = await import("@/lib/desktop");
    expect((await desktop.loadConfig()).presetAccentColors).toEqual({ dracula: "green" });
    fireEvent.click(screen.getByRole("button", { name: "Dracula accent" }));
    await waitFor(() => expect(root.style.getPropertyValue("--brand")).toBe(brand));
    expect((await desktop.loadConfig()).presetAccentColors).toEqual({});
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

  it("previews light and dark drafts independently and restores saved appearance on cancel", () => {
    const { close } = open();
    const root = document.documentElement;
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    fireEvent.change(screen.getByLabelText("Window", { exact: true }), {
      target: { value: "#eeeedd" },
    });
    expect(root.style.getPropertyValue("--background")).toBe("#eeeedd");

    const palette = within(screen.getByRole("group", { name: "Palette" }));
    fireEvent.click(palette.getByRole("button", { name: "Dark", exact: true }));
    expect(root).toHaveClass("dark");
    expect(screen.getByLabelText("Window", { exact: true })).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Window", { exact: true }), {
      target: { value: "#111120" },
    });
    expect(root.style.getPropertyValue("--background")).toBe("#111120");

    fireEvent.click(screen.getByRole("checkbox", { name: "Live app preview" }));
    expect(root).toHaveClass("light");
    expect(root.style.getPropertyValue("--background")).toBe("");
    fireEvent.click(screen.getByRole("checkbox", { name: "Live app preview" }));
    expect(root.style.getPropertyValue("--background")).toBe("#111120");

    fireEvent.click(palette.getByRole("button", { name: "Light", exact: true }));
    expect(root.style.getPropertyValue("--background")).toBe("#eeeedd");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(root.style.getPropertyValue("--background")).toBe("");
    expect(screen.getByRole("combobox", { name: "Theme" })).toHaveDisplayValue("Default");

    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    fireEvent.change(screen.getByLabelText("Window", { exact: true }), {
      target: { value: "#eeeedd" },
    });
    expect(root.style.getPropertyValue("--background")).toBe("#eeeedd");
    close();
    expect(root.style.getPropertyValue("--background")).toBe("");
  });

  it("previews built-ins without saving, then applies and resets one without using a library slot", async () => {
    const { close } = open();
    const { desktop } = await import("@/lib/desktop");
    const theme = screen.getByRole("combobox", { name: "Theme", exact: true });
    const root = document.documentElement;
    const builtIns = within(screen.getByRole("group", { name: "Built-in themes" }));
    expect(builtIns.getAllByRole("option").map(({ textContent }) => textContent)).toEqual([
      "Vesper",
      "Dracula",
      "Solarized Dark",
      "Tokyo Night",
      "Catppuccin Latte",
      "Everforest Dark",
    ]);

    fireEvent.change(theme, { target: { value: "tokyo-night" } });
    expect(root).toHaveClass("dark");
    expect(root.style.getPropertyValue("--background")).toBe("#1a1b26");
    expect(screen.getByRole("link", { name: "Enkia" })).toHaveAttribute(
      "href",
      "https://github.com/tokyo-night/tokyo-night-vscode-theme",
    );
    expect((await desktop.loadConfig()).themeLibrary).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(theme).toHaveDisplayValue("Default");
    expect(root).toHaveClass("light");
    expect(root.style.getPropertyValue("--background")).toBe("");
    expect(theme).toHaveFocus();

    fireEvent.change(theme, { target: { value: "vesper" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply theme" }));
    await waitFor(() => expect(theme).toBeEnabled());
    expect(theme).toHaveDisplayValue("Vesper");
    expect((await desktop.loadConfig()).themeLibrary).toEqual({
      activeId: null,
      activeBuiltInId: "vesper",
      themes: [],
    });
    expect(screen.queryByRole("button", { name: "Apply theme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete", exact: true })).not.toBeInTheDocument();

    fireEvent.change(theme, { target: { value: "catppuccin-latte" } });
    expect(root).toHaveClass("light");
    expect(root.style.getPropertyValue("--background")).toBe("#eff1f5");
    close();
    expect(root).toHaveClass("dark");
    expect(root.style.getPropertyValue("--background")).toBe("#101010");

    fireEvent.keyDown(window, { code: "Digit0", shiftKey: true, ctrlKey: true });
    expect(root).toHaveClass("light");
    expect(root.style.getPropertyValue("--background")).toBe("");
    await waitFor(async () => {
      expect((await desktop.loadConfig()).themeLibrary).toEqual({ activeId: null, themes: [] });
    });
  });

  it("saves a separate editable copy and keeps the original preset intact", async () => {
    open();
    const root = document.documentElement;
    const theme = screen.getByRole("combobox", { name: "Theme", exact: true });
    const { desktop } = await import("@/lib/desktop");
    fireEvent.change(theme, { target: { value: "vesper" } });
    fireEvent.click(screen.getByRole("button", { name: "Create editable copy" }));
    expect(screen.getByRole("textbox", { name: "Theme name" })).toHaveValue("Vesper (copy)");
    expect(screen.getByRole("button", { name: "Dark", pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Window", { exact: true })).toHaveValue("#101010");

    fireEvent.change(screen.getByLabelText("Window", { exact: true }), {
      target: { value: "#181511" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    await waitFor(() => expect(theme).toHaveDisplayValue("Vesper (copy)"));
    const saved = await desktop.loadConfig();
    expect(saved.theme).toBe("dark");
    expect(saved.themeLibrary?.themes).toHaveLength(1);
    expect(saved.themeLibrary?.themes[0]).toMatchObject({
      id: saved.themeLibrary?.activeId,
      name: "Vesper (copy)",
      light: {},
      dark: { background: "#181511" },
    });
    expect(root.style.getPropertyValue("--background")).toBe("#181511");

    fireEvent.change(theme, { target: { value: "vesper" } });
    expect(root.style.getPropertyValue("--background")).toBe("#101010");
    fireEvent.keyDown(window, { code: "Digit0", shiftKey: true, ctrlKey: true });
    expect(theme).toHaveDisplayValue("Default");
    expect(screen.queryByRole("button", { name: "Cancel preview" })).not.toBeInTheDocument();
    await waitFor(async () => {
      expect((await desktop.loadConfig()).themeLibrary).toEqual({
        activeId: null,
        themes: saved.themeLibrary?.themes,
      });
    });
  });

  it("imports an editable copy and saves, exports and deletes it", async () => {
    open();
    const root = document.documentElement;
    const original = { ...createCustomTheme("Tea"), light: { background: "#eeccee" } };
    const { desktop } = await import("@/lib/desktop");
    fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
    fireEvent.change(screen.getByLabelText("Import theme JSON"), { target: { value: "{}" } });
    fireEvent.click(screen.getByRole("button", { name: "Import theme" }));
    expect(screen.getByRole("alert")).toHaveTextContent("unsupported format");

    fireEvent.change(screen.getByLabelText("Import theme JSON"), {
      target: { value: encodeTheme(original) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import theme" }));
    expect(screen.getByRole("textbox", { name: "Theme name" })).toHaveValue("Tea");
    fireEvent.change(screen.getByRole("textbox", { name: "Theme name" }), {
      target: { value: "Green tea" },
    });
    fireEvent.change(screen.getByLabelText("Window", { exact: true }), {
      target: { value: "#broken" },
    });
    expect(screen.getByRole("button", { name: "Save and apply" })).toBeDisabled();
    expect(root.style.getPropertyValue("--background")).toBe("#eeccee");
    fireEvent.click(screen.getByRole("button", { name: "Reset window", exact: true }));
    expect(root.style.getPropertyValue("--background")).toBe("");
    fireEvent.change(screen.getByLabelText("Window", { exact: true }), {
      target: { value: "#ddffaa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Theme", exact: true })).toBeEnabled(),
    );
    const saved = (await desktop.loadConfig()).themeLibrary;
    expect(saved.activeId).not.toBe(original.id);
    expect(saved.themes).toHaveLength(1);
    expect(saved.themes[0]).toMatchObject({
      name: "Green tea",
      light: { background: "#ddffaa" },
    });
    expect(root.style.getPropertyValue("--background")).toBe("#ddffaa");

    fireEvent.click(screen.getByRole("button", { name: "Export", exact: true }));
    expect(screen.getByLabelText("Export theme JSON")).toHaveValue(encodeTheme(saved.themes[0]));
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Delete theme", exact: true }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Theme", exact: true })).toHaveDisplayValue(
        "Default",
      ),
    );
    expect((await desktop.loadConfig()).themeLibrary).toEqual({ activeId: null, themes: [] });
    expect(root.style.getPropertyValue("--background")).toBe("");
  });
});
