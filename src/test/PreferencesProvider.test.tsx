import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ patchConfig: vi.fn(), loadConfig: vi.fn() }));

vi.mock("@/lib/config", () => ({
  loadConfig: mocks.loadConfig,
  patchConfig: mocks.patchConfig,
}));
vi.mock("posthog-js/dist/module.full.no-external.js", () => ({
  default: { capture: vi.fn(), register: vi.fn() },
}));
const providers = vi.hoisted(() => ({
  list: undefined as unknown,
  connected: [] as string[],
}));
vi.mock("@/hooks/useProviders", () => ({
  useConnectedProviders: () => providers.connected,
  useProviderList: () => providers.list,
}));

import { notify } from "@/lib/notifications";
import type { Session } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import { ActiveSessionProvider, useActiveSession } from "@/providers/ActiveSessionProvider";
import { PreferencesProvider, usePreferences } from "@/providers/PreferencesProvider";
import { DEFAULT_APP_CONFIG } from "@/types/desktop";

function renderPreferences(sessions: Session[] = []) {
  const client = new QueryClient();
  client.setQueryData(qk.sessions, sessions);
  const activeSessionIdRef = { current: null as string | null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ActiveSessionProvider activeSessionIdRef={activeSessionIdRef}>
        <PreferencesProvider>{children}</PreferencesProvider>
      </ActiveSessionProvider>
    </QueryClientProvider>
  );
  return renderHook(() => ({ ...usePreferences(), ...useActiveSession() }), { wrapper });
}

describe("the saved model", () => {
  const capabilities = { toolcall: true, input: { text: true }, output: { text: true } };
  const freeTier = {
    id: "opencode",
    name: "OpenCode Zen",
    source: "custom",
    models: {
      "flash-free": { id: "flash-free", name: "Flash Free", status: "active", capabilities },
      "crouton-alpha-free": {
        id: "crouton-alpha-free",
        name: "Crouton",
        status: "alpha",
        capabilities,
        variants: { high: {} },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patchConfig.mockResolvedValue(undefined);
    providers.connected = ["opencode"];
    providers.list = {
      all: [freeTier],
      connected: ["opencode"],
      default: { opencode: "flash-free" },
    };
  });
  afterEach(() => {
    providers.connected = [];
    providers.list = undefined;
  });

  it("moves to the default model, and says so, when OpenCode no longer lists it", async () => {
    const message = vi.spyOn(notify, "message");
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      lastModel: "opencode/nemotron-3-ultra-free",
    });
    const { result } = renderPreferences();

    await waitFor(() => expect(result.current.selectedModel).toBe("opencode/flash-free"));
    expect(mocks.patchConfig).toHaveBeenCalledWith({
      lastModel: "opencode/flash-free",
      lastModelVariant: null,
    });
    expect(message).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledWith("nemotron-3-ultra-free is no longer available", {
      description: "This chat now uses Flash Free.",
    });
  });

  it("doesn't bring back a model refused in the user's region", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      lastModel: "opencode/crouton-alpha-free",
      unavailableModels: ["opencode/crouton-alpha-free"],
    });
    const { result } = renderPreferences();

    await waitFor(() => expect(result.current.selectedModel).toBe("opencode/flash-free"));
    await waitFor(() =>
      expect(result.current.unavailableModels.has("opencode/crouton-alpha-free")).toBe(true),
    );
  });

  it("keeps a listed model, and remembers one refused in the region once", async () => {
    const message = vi.spyOn(notify, "message");
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      lastModel: "opencode/crouton-alpha-free",
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.selectedModel).toBe("opencode/crouton-alpha-free"));

    act(() => result.current.markModelUnavailable("opencode/crouton-alpha-free"));
    act(() => result.current.markModelUnavailable("opencode/crouton-alpha-free"));

    await waitFor(() =>
      expect(result.current.unavailableModels.has("opencode/crouton-alpha-free")).toBe(true),
    );
    const saves = mocks.patchConfig.mock.calls.filter(([patch]) => "unavailableModels" in patch);
    expect(saves).toEqual([[{ unavailableModels: ["opencode/crouton-alpha-free"] }]]);
    // Its card offers the switch, so the chat isn't moved out from under it.
    expect(result.current.selectedModel).toBe("opencode/crouton-alpha-free");
    expect(message).not.toHaveBeenCalled();
  });

  it("drops the variant when switching to another model, as it may not have one", async () => {
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      lastModel: "opencode/crouton-alpha-free",
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.selectedModel).toBe("opencode/crouton-alpha-free"));

    act(() => result.current.setSelectedVariant("high"));
    await waitFor(() => expect(result.current.selectedVariant).toBe("high"));
    act(() => result.current.setSelectedModel("opencode/crouton-alpha-free"));
    expect(result.current.selectedVariant).toBe("high");

    act(() => result.current.setSelectedModel("opencode/flash-free"));
    await waitFor(() => expect(result.current.selectedVariant).toBeNull());
  });

  it("restores two chats independently across remount and only uses supported effort", async () => {
    const persisted = { ...DEFAULT_APP_CONFIG, analyticsNoticeVersion: 99 };
    mocks.loadConfig.mockResolvedValue(persisted);
    mocks.patchConfig.mockImplementation(async (patch) => Object.assign(persisted, patch));
    const sessions = [
      { id: "one" },
      { id: "two" },
      {
        id: "old",
        model: { id: "crouton-alpha-free", providerID: "opencode", variant: "max" },
      },
    ] as Session[];

    const first = renderPreferences(sessions);
    await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalled());
    await act(async () => first.result.current.selectSession("one"));
    act(() => first.result.current.setSelectedModel("opencode/crouton-alpha-free", "high"));
    await act(async () => first.result.current.selectSession("two"));
    act(() => first.result.current.setSelectedModel("opencode/flash-free"));
    first.unmount();

    const { result } = renderPreferences(sessions);
    await act(async () => result.current.selectSession("two"));
    await waitFor(() => expect(result.current.selectedModel).toBe("opencode/flash-free"));
    expect(result.current.selectedVariant).toBeNull();
    await act(async () => result.current.selectSession("one"));
    expect(result.current.selectedModel).toBe("opencode/crouton-alpha-free");
    expect(result.current.selectedVariant).toBe("high");
    await act(async () => result.current.selectSession("old"));
    expect(result.current.selectedModel).toBe("opencode/crouton-alpha-free");
    expect(result.current.selectedVariant).toBeNull();
  });

  it("keeps a retired chat's selection when all replacements are hidden or ineligible", async () => {
    const message = vi.spyOn(notify, "message");
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      hiddenModels: ["opencode/flash-free"],
      chatModels: { retired: { key: "opencode/retired-free", variant: "high" } },
    });
    const { result } = renderPreferences();
    await act(async () => result.current.selectSession("retired"));
    await waitFor(() =>
      expect(result.current.modelSelectionMessage).toMatch(/Choose an available model/),
    );
    expect(result.current.selectedModel).toBeNull();
    expect(message).toHaveBeenCalledWith("retired-free is no longer available", {
      description: "Choose an available model to continue this chat.",
    });
    expect(mocks.patchConfig).not.toHaveBeenCalled();
  });
});

describe("reasoning effort control preference", () => {
  it("loads the saved control and persists subsequent changes", async () => {
    vi.clearAllMocks();
    mocks.patchConfig.mockResolvedValue(undefined);
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      effortControl: "dropdown",
    });
    const { result } = renderPreferences();

    await waitFor(() => expect(result.current.effortControl).toBe("dropdown"));
    act(() => result.current.setEffortControl("slider"));
    await waitFor(() => expect(result.current.effortControl).toBe("slider"));
    expect(mocks.patchConfig).toHaveBeenCalledWith({ effortControl: "slider" });
  });
});

it("uses the default busy shortcuts and persists a changed binding for each action", async () => {
  vi.clearAllMocks();
  mocks.patchConfig.mockResolvedValue(undefined);
  mocks.loadConfig.mockResolvedValue({ ...DEFAULT_APP_CONFIG, analyticsNoticeVersion: 99 });
  const { result } = renderPreferences();

  await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalled());
  expect(result.current.composerShortcuts).toEqual({ steer: "enter", queue: "mod-enter" });
  const changed = { steer: "mod-enter", queue: "alt-enter" } as const;
  act(() => result.current.setComposerShortcuts(changed));
  await waitFor(() => expect(result.current.composerShortcuts).toEqual(changed));
  expect(mocks.patchConfig).toHaveBeenCalledWith({ composerShortcuts: changed });
});

describe("notification preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      analyticsNoticeVersion: 99,
      detailedAnalytics: "enabled",
    });
  });

  it("doesn't let an older failed save undo a newer choice", async () => {
    let failFirst: (error: Error) => void = () => {};
    mocks.patchConfig.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        }),
    );
    mocks.patchConfig.mockResolvedValue(undefined);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <PreferencesProvider>{children}</PreferencesProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => usePreferences(), { wrapper });
    // Choices are only meaningful once what was saved has loaded, which replaces the defaults.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalled());
    await act(async () => {});

    act(() => result.current.setNotificationKind("finished", false));
    act(() => result.current.setNotificationKind("waiting", false));
    await act(async () => failFirst(new Error("disk busy")));

    expect(result.current.notifications.kinds).toMatchObject({ finished: false, waiting: false });
  });

  it("puts a choice back when its own save fails", async () => {
    mocks.patchConfig.mockRejectedValue(new Error("disk busy"));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <PreferencesProvider>{children}</PreferencesProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => usePreferences(), { wrapper });
    // Choices are only meaningful once what was saved has loaded, which replaces the defaults.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalled());
    await act(async () => {});

    await act(async () => result.current.setNotificationKind("finished", false));

    expect(result.current.notifications.kinds.finished).toBe(true);
  });
});
