import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme-provider";

vi.mock("@/hooks/useProviders", () => ({
  useAllProviders: () => [],
  useConnectedProviders: () => [],
  useAllModels: () => [],
  useAuthMethods: () => ({}),
  useProviderList: () => undefined,
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    selectedModel: null,
    hiddenModels: new Set<string>(),
    toggleModelVisibility: () => {},
  }),
}));

import Settings from "@/components/Settings";

describe("Settings: the Instructions tab", () => {
  it("offers the skills import under the instructions, above the system prompt", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider>
          <Settings onClose={() => {}} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Instructions" }));

    const editor = await screen.findByLabelText("Instructions");
    const heading = screen.getByRole("heading", { name: "Skills" });
    const button = screen.getByRole("button", { name: "Import from Codex and Claude Code" });
    const systemPrompt = screen.getByRole("button", { name: "System prompt" });
    const follows = (first: Element, second: Element) =>
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(editor, heading)).toBeTruthy();
    expect(follows(heading, button)).toBeTruthy();
    expect(follows(button, systemPrompt)).toBeTruthy();

    // This runs in a browser, where there are no folders to import from.
    expect(await screen.findByText("Importing skills needs the desktop app.")).toBeInTheDocument();
    expect(button).toBeDisabled();
  });
});
