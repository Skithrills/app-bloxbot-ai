import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatGptUsageControl, SubscriptionUsage } from "@/components/SubscriptionUsage";
import {
  subscriptionWindowsForModel,
  useSubscriptionUsageForModel,
} from "@/hooks/useSubscriptionUsage";
import { OPENAI_API_PROVIDER, OPENAI_OAUTH_PROVIDER } from "@/lib/openAiProfiles";
import { qk } from "@/lib/queryKeys";
import { type AppConfig, DEFAULT_APP_CONFIG } from "@/types/desktop";
import type { SubscriptionWindow } from "@/types/subscriptionUsage";

const state = vi.hoisted(() => ({
  connected: [] as string[],
  readUsage: vi.fn(),
  config: {} as AppConfig,
}));
vi.mock("@/lib/config", () => ({
  loadConfig: async () => state.config,
  patchConfig: async (patch: Partial<AppConfig>) => {
    state.config = { ...state.config, ...patch };
  },
}));
vi.mock("@/hooks/useProviders", () => ({
  useConnectedProviders: () => state.connected,
}));
vi.mock("@/lib/desktop", () => ({
  desktop: { getSubscriptionUsage: state.readUsage },
}));

function renderUsage(ui = <SubscriptionUsage />) {
  const client = new QueryClient();
  client.setQueryDefaults(qk.config, { staleTime: Infinity });
  client.setQueryData(qk.config, state.config);
  function wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { ...render(ui, { wrapper }), client };
}

function ModelUsage({
  turn,
  modelKey = `${OPENAI_OAUTH_PROVIDER}/gpt-6.1-sol`,
}: {
  turn?: string;
  modelKey?: string;
}) {
  const { usage } = useSubscriptionUsageForModel(modelKey, turn);
  return <div data-testid="active-model-quota">{usage?.source}</div>;
}

const weekly: SubscriptionWindow = {
  id: "codex/secondary",
  label: "Weekly",
  usedPercent: 15,
  resetsAt: null,
};

const available = () => ({ status: "available", checkedAt: Date.now(), windows: [weekly] });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("Subscription usage", () => {
  beforeEach(() => {
    state.readUsage.mockReset();
    state.connected = [];
    state.config = { ...DEFAULT_APP_CONFIG };
  });
  afterEach(() => vi.useRealTimers());

  it("does not request subscription usage for API-key providers", () => {
    state.connected = [OPENAI_API_PROVIDER, "anthropic"];
    renderUsage();
    expect(screen.queryByRole("heading", { name: "Subscription usage" })).toBeNull();
    expect(state.readUsage).not.toHaveBeenCalled();
  });

  it("shows a previous reading with its real reset time and can refresh it", async () => {
    state.connected = [OPENAI_OAUTH_PROVIDER, "claude-agent"];
    const checkedAt = Date.now() - 60_000;
    const resetsAt = Date.now() - 30_000;
    state.readUsage.mockImplementation(async (provider: string) =>
      provider === "codex"
        ? {
            status: "available",
            checkedAt,
            windows: [
              { id: "primary", label: "5-hour window", usedPercent: 27, resetsAt },
              { id: "secondary", label: "Weekly", usedPercent: 41, resetsAt: null },
            ],
          }
        : { status: "unsupported" },
    );
    renderUsage();
    expect(await screen.findByText("73% left")).toBeInTheDocument();
    expect(screen.getByText(/Last reported reset/).querySelector("time")).toHaveAttribute(
      "datetime",
      new Date(resetsAt).toISOString(),
    );
    expect(screen.getByText("Reset time unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Previous reading/)).toBeInTheDocument();
    expect(await screen.findByText(/does not report subscription limits/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh ChatGPT Subscription usage" }));
    expect(state.readUsage.mock.calls.filter(([provider]) => provider === "codex")).toHaveLength(2);
    expect(state.readUsage).not.toHaveBeenCalledWith("codex-cli");
  });

  it("explains a token-sharing sign-in and links to the provider's usage page", async () => {
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.readUsage.mockResolvedValue({ status: "usage_not_shared" });
    renderUsage(<ChatGptUsageControl />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /ChatGPT subscription usage · View usage in ChatGPT/,
      }),
    );
    expect(await screen.findByText(/does not share remaining quota or reset times/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Open ChatGPT Usage" })).toHaveAttribute(
      "href",
      "https://chatgpt.com/settings/usage",
    );
    expect(screen.queryByRole("button", { name: /Refresh/ })).not.toBeInTheDocument();
    expect(state.readUsage.mock.calls).toEqual([["codex"]]);
  });

  it("shows the weekly ring and shares one reading between settings and the title bar", async () => {
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.readUsage.mockResolvedValue(available());
    renderUsage(
      <>
        <SubscriptionUsage />
        <ChatGptUsageControl />
        <ModelUsage />
      </>,
    );
    const ring = await screen.findByRole("button", {
      name: "ChatGPT subscription usage · Weekly · 85% left",
    });
    expect(ring).toHaveAttribute("title", "Weekly · 85% left");
    expect(state.readUsage.mock.calls).toEqual([["codex"]]);
    expect(screen.getByTestId("active-model-quota")).toHaveTextContent("codex");
    fireEvent.click(ring);
    expect(await screen.findByRole("dialog", { name: "ChatGPT subscription usage" })).toBeVisible();
  });

  it("opts in to a separately labelled CLI account, remembers it, and stops on opt-out", async () => {
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.readUsage.mockImplementation(async (source: string) =>
      source === "codex-cli" ? available() : { status: "usage_not_shared" },
    );
    const { unmount } = renderUsage(
      <>
        <SubscriptionUsage />
        <ChatGptUsageControl />
        <ModelUsage />
      </>,
    );
    expect(await screen.findByText(/does not share remaining quota/)).toBeVisible();
    expect(state.readUsage).not.toHaveBeenCalledWith("codex-cli");
    fireEvent.click(screen.getByRole("button", { name: "Read Codex CLI usage" }));
    expect(await screen.findByText("85% left")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Codex CLI account" })).toBeVisible();
    expect(screen.getByText(/may differ from BloxBot/)).toBeVisible();
    expect(screen.getByTestId("active-model-quota")).toHaveTextContent("codex-cli");
    expect(
      screen.getByRole("button", {
        name: /ChatGPT subscription usage · Codex CLI · Weekly · 85% left/,
      }),
    ).toBeVisible();
    expect(state.readUsage.mock.calls).toEqual([["codex"], ["codex-cli"]]);
    expect(state.config.codexCliUsageEnabled).toBe(true);
    unmount();

    renderUsage();
    expect(await screen.findByText("85% left")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Stop reading Codex CLI usage" }));
    expect(await screen.findByText(/does not share remaining quota/)).toBeVisible();
    expect(screen.queryByText("85% left")).toBeNull();
    expect(state.config.codexCliUsageEnabled).toBe(false);
  });

  it("refreshes an opted-in CLI reading automatically and shows missing-CLI guidance", async () => {
    vi.useFakeTimers();
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.config.codexCliUsageEnabled = true;
    state.readUsage.mockResolvedValueOnce(available()).mockResolvedValue({ status: "cli_missing" });
    renderUsage();
    await tick(1);
    expect(state.readUsage.mock.calls).toEqual([["codex-cli"]]);
    await tick(60_000);
    expect(state.readUsage.mock.calls).toEqual([["codex-cli"], ["codex-cli"]]);
    expect(screen.getByText(/Codex CLI is required/)).toBeVisible();
    expect(screen.queryByText("85% left")).toBeNull();
  });

  it("clears the old account’s cached reading when the BloxBot connection disconnects", async () => {
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.readUsage
      .mockResolvedValueOnce(available())
      .mockResolvedValueOnce({ status: "unavailable" });
    const { client, rerender } = renderUsage();
    expect(await screen.findByText("85% left")).toBeInTheDocument();
    state.connected = [];
    rerender(<SubscriptionUsage />);
    await waitFor(() =>
      expect(
        client.getQueryCache().findAll({ queryKey: qk.subscriptionUsage(OPENAI_OAUTH_PROVIDER) }),
      ).toHaveLength(0),
    );
    state.connected = [OPENAI_OAUTH_PROVIDER];
    rerender(<SubscriptionUsage />);
    expect(await screen.findByText(/Usage is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("85% left")).not.toBeInTheDocument();
  });

  it("coalesces completed turns within the cooldown and polls while active", async () => {
    vi.useFakeTimers();
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.readUsage.mockImplementation(async () => available());
    const { rerender } = renderUsage(<ModelUsage turn="old-turn" />);
    await tick(1);
    expect(state.readUsage).toHaveBeenCalledTimes(1);

    rerender(<ModelUsage turn="next-turn" />);
    await tick(10_000);
    rerender(<ModelUsage turn="last-turn" />);
    await tick(4_998);
    expect(state.readUsage).toHaveBeenCalledTimes(1);
    await tick(2);
    expect(state.readUsage).toHaveBeenCalledTimes(2);

    await tick(60_000);
    expect(state.readUsage).toHaveBeenCalledTimes(3);
  });

  it("refreshes on foreground focus when due and backs off after a failed read", async () => {
    vi.useFakeTimers();
    state.connected = [OPENAI_OAUTH_PROVIDER];
    state.readUsage
      .mockResolvedValueOnce(available())
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce(available());
    renderUsage();
    await tick(1);
    fireEvent(window, new Event("focus"));
    expect(state.readUsage).toHaveBeenCalledTimes(1);

    await tick(15_000);
    fireEvent(window, new Event("focus"));
    fireEvent(window, new Event("focus"));
    await tick(1);
    expect(state.readUsage).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Refresh failed/)).toBeInTheDocument();

    await tick(15_000);
    fireEvent(window, new Event("focus"));
    expect(state.readUsage).toHaveBeenCalledTimes(2);
    await tick(45_000);
    expect(state.readUsage).toHaveBeenCalledTimes(3);
  });

  it("keeps the failure cooldown when switching away from and back to a subscription model", async () => {
    vi.useFakeTimers();
    state.connected = [OPENAI_OAUTH_PROVIDER, OPENAI_API_PROVIDER];
    state.readUsage
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce(available());
    const { rerender } = renderUsage(<ModelUsage />);
    await tick(1);

    const apiModel = <ModelUsage modelKey={`${OPENAI_API_PROVIDER}/gpt-6.1-sol`} />;
    rerender(apiModel);
    rerender(<ModelUsage />);
    await tick(1);
    expect(state.readUsage).toHaveBeenCalledTimes(1);

    rerender(apiModel);
    await tick(60_000);
    rerender(<ModelUsage />);
    await tick(1);
    expect(state.readUsage).toHaveBeenCalledTimes(2);
  });

  it("uses model-specific quota when available and ignores unrelated scopes", () => {
    const scoped = { ...weekly, id: "gpt-6.1-sol/secondary" };
    const unrelated = { ...weekly, id: "review/secondary" };
    expect(
      subscriptionWindowsForModel("codex", [weekly, scoped, unrelated], "gpt-6.1-sol"),
    ).toEqual([scoped]);
    expect(
      subscriptionWindowsForModel("codex", [weekly, scoped, unrelated], "gpt-6-astra"),
    ).toEqual([weekly]);

    const claudeWeekly = { ...weekly, id: "seven_day" };
    const opus = { ...weekly, id: "model/Opus" };
    const sonnet = { ...weekly, id: "model/Sonnet" };
    expect(
      subscriptionWindowsForModel("claude", [claudeWeekly, opus, sonnet], "claude-opus-4-7"),
    ).toEqual([claudeWeekly, opus]);
  });
});
