import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Building2,
  ChevronRight,
  FileText,
  Globe,
  LoaderCircle,
  Palette,
  PartyPopper,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { FunSettings } from "@/components/AudioVisualizer";
import { BloxBotMascot } from "@/components/BloxBotMascot";
import PersonalisationSettings from "@/components/PersonalisationSettings";
import ProviderCheckPopover from "@/components/ProviderCheckPopover";
import ProviderConnectDialog from "@/components/ProviderConnectDialog";
import ProviderLogo from "@/components/ProviderLogo";
import SkillsSettings from "@/components/SkillsSettings";
import SubagentsSettings from "@/components/SubagentsSettings";
import { SubscriptionUsage } from "@/components/SubscriptionUsage";
import { ThreeDToolsTab } from "@/components/ThreeDToolsTab";
import { WhatsNew } from "@/components/WhatsNew";
import { useCheckProvider } from "@/hooks/mutations/useCheckProvider";
import { useSaveInstructions } from "@/hooks/mutations/useSaveInstructions";
import { useSaveModelSettings } from "@/hooks/mutations/useSaveModelSettings";
import { useSaveSystemPrompt } from "@/hooks/mutations/useSaveSystemPrompt";
import { useDisconnectProvider } from "@/hooks/mutations/useSetApiKey";
import { useEligibleModels } from "@/hooks/useEligibleModels";
import {
  useAllModels,
  useAllProviders,
  useAuthMethods,
  useConnectedProviders,
  useProviderList,
} from "@/hooks/useProviders";
import { useAnyChatBusy } from "@/hooks/useSessionStatuses";
import { useUpdater } from "@/hooks/useUpdater";
import { playChime } from "@/lib/chime";
import {
  COMPOSER_SHORTCUTS,
  type ComposerShortcut,
  composerShortcutLabel,
} from "@/lib/composerDelivery";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import { compareCatalogModels, isPaidModel, modelLabel } from "@/lib/modelChoice";
import { canOpenNotificationSettings, notify, openNotificationSettings } from "@/lib/notifications";
import {
  OPENAI_API_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
  OPENAI_SERVICE_TIERS,
} from "@/lib/openAiProfiles";
import type { Model } from "@/lib/opencode/types";
import { OPENCODE_GO, shouldRecommendOpenCodeGo } from "@/lib/opencodeGo";
import { connectHint, isFreeTier, providerDisplayName } from "@/lib/providerAuth";
import { checkModels, checkPreference, type ProviderCheckResult } from "@/lib/providerCheck";
import { qk } from "@/lib/queryKeys";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { ModelInfo, ProviderInfo } from "@/types";
import type { NotificationKinds } from "@/types/desktop";

// ── Popular providers (same order as OpenCode's web UI) ──────────────
const POPULAR_PROVIDERS = [
  "opencode",
  "opencode-go",
  "anthropic",
  "claude-agent",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
];

/** OpenCode Zen with only the built-in free models. */
const isFreeZen = isFreeTier;

/** OpenCode Zen with a key added in BloxBot, which falls back to the free models when removed. */
function hasZenKey(provider: ProviderInfo): boolean {
  return provider.id === "opencode" && provider.source === "api";
}

/** OpenCode Zen with a key from the environment or config, which BloxBot can't remove. */
function hasOutsideZenKey(provider: ProviderInfo): boolean {
  return provider.id === "opencode" && !isFreeZen(provider) && !hasZenKey(provider);
}

const PROVIDER_SKELETON_WIDTHS = ["w-1/3", "w-1/2", "w-1/4", "w-2/5"] as const;

const TECHNOLOGIES = [
  { name: "OpenCode", url: "https://opencode.ai", description: "AI coding engine" },
  {
    name: "Roblox Studio MCP",
    url: "https://create.roblox.com/docs/studio/mcp",
    description: "Official Studio MCP server",
  },
];

type SettingsTab =
  | "providers"
  | "subagents"
  | "threeD"
  | "workflow"
  | "personalisation"
  | "fun"
  | "instructions"
  | "notifications"
  | "privacy"
  | "about";

interface SettingsProps {
  onClose: () => void;
}

function Settings({ onClose }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>("providers");

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 bg-sidebar">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @xl:flex-row">
        {/* Takes the chat list's place, so there is only ever one sidebar. When
          the window is narrow it becomes a row of tabs on top. */}
        <div className="flex shrink-0 flex-col @xl:w-56">
          <div className="flex h-11 shrink-0 items-center gap-1 px-2">
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Back to chat"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h3 className="text-sm font-medium">Settings</h3>
          </div>
          <div className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-2 @xl:flex-col @xl:gap-0.5 @xl:overflow-visible @xl:pt-1">
            <div className="hidden px-2 py-1.5 text-xs text-muted-foreground @xl:block">AI</div>
            <button
              onClick={() => setTab("providers")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "providers"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Providers
            </button>
            <button
              type="button"
              onClick={() => setTab("subagents")}
              className={`flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors ${
                tab === "subagents"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <UsersRound aria-hidden="true" size={13} />
              Subagents
            </button>
            <button
              type="button"
              onClick={() => setTab("threeD")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "threeD"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Box aria-hidden="true" size={13} />
              3D tools
            </button>
            <button
              type="button"
              onClick={() => setTab("instructions")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "instructions"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h5" />
              </svg>
              Instructions
            </button>

            <div className="mt-3 hidden px-2 py-1.5 text-xs text-muted-foreground @xl:block">
              App
            </div>
            <button
              type="button"
              onClick={() => setTab("notifications")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "notifications"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              Notifications
            </button>
            <button
              onClick={() => setTab("workflow")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "workflow"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              Workflow
            </button>
            <button
              type="button"
              onClick={() => setTab("personalisation")}
              className={`flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors ${
                tab === "personalisation"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Palette size={13} aria-hidden="true" />
              Personalisation
            </button>
            <button
              type="button"
              onClick={() => setTab("fun")}
              className={`flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors ${
                tab === "fun"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <PartyPopper size={13} aria-hidden="true" />
              Fun
            </button>
            <button
              onClick={() => setTab("about")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "about"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              About
            </button>
            <button
              type="button"
              onClick={() => setTab("privacy")}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 h-8 text-left text-sm transition-colors ${
                tab === "privacy"
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Privacy
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-t-xl border-x border-t bg-background">
          {tab === "providers" && <ProvidersTab />}
          {tab === "subagents" && <SubagentsSettings />}
          {tab === "threeD" && <ThreeDToolsTab />}
          {tab === "workflow" && <WorkflowTab />}
          {tab === "personalisation" && <PersonalisationSettings />}
          {tab === "fun" && <FunSettings />}
          {tab === "instructions" && <InstructionsTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "privacy" && <PrivacyTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Providers Tab — connected ones with their models, then every other provider, searchable
// ═══════════════════════════════════════════════════════════════════════

function ProvidersTab() {
  const allProviders = useAllProviders();
  const connectedProviders = useConnectedProviders();
  const authMethods = useAuthMethods();
  const disconnectMutation = useDisconnectProvider();

  const [connecting, setConnecting] = useState<ProviderInfo | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [checks, setChecks] = useState<Record<string, "checking" | ProviderCheckResult>>({});
  const checkMutation = useCheckProvider();
  const providerList = useProviderList();
  const {
    selectedModel,
    hiddenModels,
    hideFreeModels,
    modelCatalogOrder,
    paidDefaultModel,
    savingModelSettings,
    setHideFreeModels,
    setModelCatalogOrder,
    setPaidDefaultModel,
    toggleModelVisibility,
  } = usePreferences();
  const paidModels = useEligibleModels()
    .filter((model) => providerList && isPaidModel(providerList, `${model.providerId}/${model.id}`))
    .sort(
      (a, b) =>
        a.providerName.localeCompare(b.providerName) ||
        a.providerId.localeCompare(b.providerId) ||
        compareCatalogModels(a, b, modelCatalogOrder),
    );
  const { data: appConfig } = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const saveModelSettings = useSaveModelSettings();
  const chatBusy = useAnyChatBusy();
  const allModels = useAllModels();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // Bumped whenever a provider's credential changes, so a check that was
  // running for the old credential can't report onto the new one.
  const checkGeneration = useRef<Record<string, number>>({});
  const [checkPickerFor, setCheckPickerFor] = useState<string | null>(null);

  function forgetCheck(providerId: string) {
    checkGeneration.current[providerId] = (checkGeneration.current[providerId] ?? 0) + 1;
    setChecks((prev) => {
      const { [providerId]: _stale, ...rest } = prev;
      return rest;
    });
  }

  // A provider's chat models, the user's chat model or the provider's default
  // first. Kept in a ref so the toast's check, clicked later, sees the models
  // the new credential unlocked.
  const checkModelsFor = useRef<(providerId: string) => Model[]>(() => []);
  checkModelsFor.current = (providerId) => {
    const provider = providerList?.all.find((p) => p.id === providerId);
    if (!provider || !providerList) return [];
    return checkModels(
      provider,
      checkPreference(providerId, selectedModel, providerList.default),
    ).filter((model) => !hideFreeModels || isPaidModel(providerList, `${providerId}/${model.id}`));
  };

  async function runCheck(provider: ProviderInfo, model: Model | undefined) {
    const generation = (checkGeneration.current[provider.id] ?? 0) + 1;
    checkGeneration.current[provider.id] = generation;
    let result: ProviderCheckResult;
    if (!model) {
      result = {
        ok: false,
        message: "This provider has no chat models to test with.",
        keyRejected: false,
      };
    } else {
      setChecks((prev) => ({ ...prev, [provider.id]: "checking" }));
      try {
        result = await checkMutation.mutateAsync({ providerID: provider.id, modelID: model.id });
      } catch {
        result = {
          ok: false,
          message: "BloxBot couldn't run the check. Try again.",
          keyRejected: false,
          modelName: model.name,
        };
      }
    }
    if (checkGeneration.current[provider.id] !== generation) return;
    setChecks((prev) => ({ ...prev, [provider.id]: result }));
  }

  function handleConnected(provider: ProviderInfo) {
    // A new credential makes any earlier or running check stale.
    forgetCheck(provider.id);
    setExpanded((current) => new Set([...current, provider.id]));
    notify.success(`${provider.name} connected`, {
      name: "provider_connected",
      action: {
        label: "Check it works",
        // Opens the picker rather than checking a guessed model: only the
        // user knows which models their key or plan includes.
        onClick: () => setCheckPickerFor(provider.id),
      },
    });
  }

  async function handleDisconnect(provider: ProviderInfo) {
    setDisconnecting(provider.id);
    try {
      await disconnectMutation.mutateAsync(provider.id);
      forgetCheck(provider.id);
      notify.success(
        hasZenKey(provider) && !hideFreeModels
          ? "OpenCode Zen key removed. The free models are still available."
          : "Provider disconnected",
      );
    } catch {
      notify.error("Failed to disconnect");
    } finally {
      setDisconnecting(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (p: ProviderInfo, label = p.name) =>
      !needle || label.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle),
    [needle],
  );

  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of allModels) {
      if (
        hideFreeModels &&
        (!providerList || !isPaidModel(providerList, `${model.providerId}/${model.id}`))
      ) {
        continue;
      }
      groups.set(model.providerId, [...(groups.get(model.providerId) ?? []), model]);
    }
    for (const models of groups.values()) {
      models.sort((a, b) => compareCatalogModels(a, b, modelCatalogOrder));
    }
    return groups;
  }, [allModels, hideFreeModels, modelCatalogOrder, providerList]);
  const matchingModels = (providerId: string) =>
    (modelsByProvider.get(providerId) ?? []).filter((model) =>
      `${model.name} ${model.id}`.toLowerCase().includes(needle),
    );

  const matchesProvider = (p: ProviderInfo) =>
    matches(p, providerDisplayName(p)) || (needle && matchingModels(p.id).length > 0);
  const openAiProfiles = [OPENAI_OAUTH_PROVIDER, OPENAI_API_PROVIDER].flatMap((id) =>
    allProviders.filter((p) => p.id === id && matchesProvider(p)),
  );
  const connected = allProviders.filter(
    (p) =>
      connectedProviders.includes(p.id) &&
      p.id !== OPENAI_OAUTH_PROVIDER &&
      p.id !== OPENAI_API_PROVIDER &&
      (!hideFreeModels || !isFreeZen(p)) &&
      matchesProvider(p),
  );

  const goProvider = allProviders.find((p) => p.id === OPENCODE_GO.providerId);
  const recommendGo =
    !!goProvider &&
    !hideFreeModels &&
    !needle &&
    shouldRecommendOpenCodeGo(allProviders.filter((p) => connectedProviders.includes(p.id)));

  function setUpGo() {
    if (!goProvider) return;
    setConnecting(goProvider);
  }

  // Popular first in OpenCode's order, then everything else alphabetically
  const { popular, others } = useMemo(() => {
    const pop: ProviderInfo[] = [];
    const oth: ProviderInfo[] = [];
    for (const p of allProviders) {
      if (p.id === OPENAI_OAUTH_PROVIDER || p.id === OPENAI_API_PROVIDER) continue;
      // With only the free models connected, Zen is still offered as its own
      // provider: a key turns the same OpenCode provider into a Zen account.
      if ((connectedProviders.includes(p.id) && !isFreeZen(p)) || !matches(p)) continue;
      // The recommendation card already offers Go.
      if (recommendGo && p.id === OPENCODE_GO.providerId) continue;
      if (POPULAR_PROVIDERS.includes(p.id)) {
        pop.push(p);
      } else {
        oth.push(p);
      }
    }
    pop.sort((a, b) => POPULAR_PROVIDERS.indexOf(a.id) - POPULAR_PROVIDERS.indexOf(b.id));
    oth.sort((a, b) => a.name.localeCompare(b.name));
    return { popular: pop, others: oth };
  }, [allProviders, connectedProviders, matches, recommendGo]);

  const nothingMatches =
    allProviders.length > 0 &&
    openAiProfiles.length + connected.length + popular.length + others.length === 0;

  function renderAvailable(provider: ProviderInfo) {
    return (
      <div key={provider.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <ProviderLogo providerId={provider.id} />
        <div className="min-w-[7rem] flex-1">
          <div className="truncate text-sm font-medium">{provider.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {connectHint(provider.id, authMethods[provider.id])}
          </div>
        </div>
        <button
          aria-label={
            provider.id === OPENAI_API_PROVIDER || provider.id === OPENAI_OAUTH_PROVIDER
              ? `Connect ${provider.name}`
              : undefined
          }
          onClick={() =>
            provider.id === OPENCODE_GO.providerId ? setUpGo() : setConnecting(provider)
          }
          className="shrink-0 whitespace-nowrap rounded-md bg-secondary px-3 py-1 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Connect
        </button>
      </div>
    );
  }

  function renderConnected(provider: ProviderInfo) {
    const check = checks[provider.id];
    const models = modelsByProvider.get(provider.id) ?? [];
    const nameMatches = matches(provider, providerDisplayName(provider));
    const listed = needle && !nameMatches ? matchingModels(provider.id) : models;
    const modelsOpen = expanded.has(provider.id) || (!!needle && !nameMatches);
    const shownCount = models.filter(
      (model) => !hiddenModels.has(`${model.providerId}/${model.id}`),
    ).length;
    return (
      <div key={provider.id} className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ProviderLogo providerId={provider.id} />
          <div className="min-w-[7rem] flex-1">
            <div className="truncate text-sm font-medium">{providerDisplayName(provider)}</div>
            {isFreeZen(provider) && (
              <div className="truncate text-xs text-muted-foreground">Provided by OpenCode</div>
            )}
            {provider.id === OPENAI_API_PROVIDER && provider.source === "env" && (
              <div className="truncate text-xs text-muted-foreground">From OPENAI_API_KEY</div>
            )}
          </div>
          {check && check !== "checking" && (
            <span
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                check.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${check.ok ? "bg-success" : "bg-destructive"}`}
              />
              {check.ok ? "Working" : "Not working"}
            </span>
          )}
          <ProviderCheckPopover
            providerName={providerDisplayName(provider)}
            models={checkModelsFor.current(provider.id)}
            checking={check === "checking"}
            open={checkPickerFor === provider.id}
            onOpenChange={(open) => setCheckPickerFor(open ? provider.id : null)}
            onCheck={(model) => runCheck(provider, model)}
          />
          {provider.id === OPENAI_API_PROVIDER && (
            <button
              type="button"
              onClick={() => setConnecting(provider)}
              className="shrink-0 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
            >
              {provider.source === "env" ? "Add key" : "Change key"}
            </button>
          )}
          {isFreeZen(provider) ||
          hasOutsideZenKey(provider) ||
          (provider.id === OPENAI_API_PROVIDER && provider.source === "env") ? null : (
            <button
              aria-label={
                provider.id === OPENAI_API_PROVIDER || provider.id === OPENAI_OAUTH_PROVIDER
                  ? `Disconnect ${provider.name}`
                  : undefined
              }
              onClick={() => handleDisconnect(provider)}
              disabled={disconnecting === provider.id}
              className="shrink-0 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              {disconnecting === provider.id
                ? "..."
                : hasZenKey(provider)
                  ? "Remove key"
                  : "Disconnect"}
            </button>
          )}
        </div>
        {check && check !== "checking" && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground @md:pl-8">
            {check.ok ? (
              `Works with ${check.modelName}.`
            ) : (
              <>
                {check.modelName && `Didn't work with ${check.modelName}. `}
                <span className="text-destructive">{check.message}</span>
                {check.keyRejected && !isFreeZen(provider) && (
                  <button
                    onClick={() => setConnecting(provider)}
                    className="ml-1.5 font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Reconnect
                  </button>
                )}
              </>
            )}
          </p>
        )}
        {models.length > 0 && (
          <div className="mt-1.5 @md:pl-8">
            <button
              type="button"
              aria-expanded={modelsOpen}
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(provider.id)) next.delete(provider.id);
                  else next.add(provider.id);
                  return next;
                })
              }
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                aria-hidden="true"
                size={12}
                className={`transition-transform ${modelsOpen ? "rotate-90" : ""}`}
              />
              {shownCount === models.length
                ? `${models.length} ${models.length === 1 ? "model" : "models"}`
                : `${shownCount} of ${models.length} models shown`}
            </button>
            {modelsOpen && (
              <div className="mt-1 space-y-0.5">
                {listed.map((model) => {
                  const modelKey = `${model.providerId}/${model.id}`;
                  const isVisible = !hiddenModels.has(modelKey);
                  return (
                    <button
                      key={modelKey}
                      type="button"
                      role="switch"
                      aria-checked={isVisible}
                      aria-label={`Show ${model.name} in the chat`}
                      onClick={() => toggleModelVisibility(modelKey)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent/60"
                    >
                      <span className="truncate text-xs">{model.name}</span>
                      <span
                        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                          isVisible ? "bg-foreground" : "bg-border"
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 rounded-full bg-background transition-transform ${
                            isVisible ? "translate-x-3.5" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium text-foreground">Providers</h4>

      <SubscriptionUsage />

      <section className="mt-4" aria-labelledby="model-preferences-heading">
        <h5
          id="model-preferences-heading"
          className="mb-1.5 text-xs font-medium text-muted-foreground"
        >
          Models
        </h5>
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          <SettingSwitch
            label="Hide free models"
            checked={Boolean(hideFreeModels)}
            disabled={savingModelSettings}
            onChange={setHideFreeModels}
          />
          <label className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs">
            <span>Model order</span>
            <select
              value={modelCatalogOrder}
              onChange={(event) =>
                setModelCatalogOrder(event.target.value === "newest" ? "newest" : "name")
              }
              className="rounded-md border bg-background px-2 py-1"
            >
              <option value="name">Name (A–Z)</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
          <label className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs">
            <span>Paid default model</span>
            <select
              value={paidDefaultModel ?? ""}
              onChange={(event) => setPaidDefaultModel(event.target.value || null)}
              className="min-w-0 max-w-full rounded-md border bg-background px-2 py-1"
            >
              <option value="">Automatic</option>
              {paidDefaultModel &&
                !paidModels.some(
                  (model) => `${model.providerId}/${model.id}` === paidDefaultModel,
                ) && (
                  <option value={paidDefaultModel} disabled>
                    Saved model unavailable
                  </option>
                )}
              {paidModels.map((model) => (
                <option
                  key={`${model.providerId}/${model.id}`}
                  value={`${model.providerId}/${model.id}`}
                >
                  {modelLabel(model)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {allProviders.length > 0 && (
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${allProviders.length} providers and your models`}
            aria-label="Search providers"
            className="h-8 w-full rounded-md border bg-transparent pr-2 pl-8 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {recommendGo && (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <ProviderLogo providerId={OPENCODE_GO.providerId} className="hidden @md:flex" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Want more than the free models?</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                OpenCode Go has strong open models like Kimi, GLM and DeepSeek, from{" "}
                {OPENCODE_GO.goPrice}.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  onClick={() => setUpGo()}
                  className="whitespace-nowrap rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Set up OpenCode Go
                </button>
                <button
                  onClick={() => {
                    desktop.openUrl(OPENCODE_GO.plansUrl).catch(() => {});
                  }}
                  className="whitespace-nowrap text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                >
                  Compare plans
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {openAiProfiles.length > 0 && (
        <section className="mt-6" aria-labelledby="openai-profiles-heading">
          <h5
            id="openai-profiles-heading"
            className="mb-1.5 text-xs font-medium text-muted-foreground"
          >
            OpenAI
          </h5>
          <div className="divide-y rounded-lg border bg-card">
            {openAiProfiles.map((provider) =>
              connectedProviders.includes(provider.id)
                ? renderConnected(provider)
                : renderAvailable(provider),
            )}
            {openAiProfiles.some((provider) => provider.id === OPENAI_API_PROVIDER) && (
              <label className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs">
                <div>
                  <span className="block">API service tier</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    GPT-6.1 Sol and GPT-6 Astra
                  </span>
                </div>
                <select
                  value={appConfig?.openAiApiServiceTier ?? "auto"}
                  disabled={chatBusy || saveModelSettings.isPending}
                  onChange={(event) => {
                    const tier = OPENAI_SERVICE_TIERS.find((entry) => entry === event.target.value);
                    if (tier) saveModelSettings.mutate({ openAiApiServiceTier: tier });
                  }}
                  className="rounded-md border bg-background px-2 py-1 disabled:opacity-50"
                >
                  <option value="auto">Auto (project default)</option>
                  <option value="default">Default (standard)</option>
                  <option value="ultrafast">Ultrafast</option>
                </select>
              </label>
            )}
          </div>
        </section>
      )}

      {/* Connected providers */}
      {connected.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Connected</div>
          <div className="divide-y rounded-lg border bg-card">{connected.map(renderConnected)}</div>
        </div>
      )}

      {popular.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Popular</div>
          <div className="divide-y rounded-lg border bg-card">{popular.map(renderAvailable)}</div>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            {popular.length > 0 || connected.length > 0 ? "More providers" : "Providers"}
          </div>
          <div className="divide-y rounded-lg border bg-card">{others.map(renderAvailable)}</div>
        </div>
      )}

      {nothingMatches && (
        <div className="mt-8 text-center text-xs text-muted-foreground">
          No provider matches “{query.trim()}”.
          <button
            onClick={() => setQuery("")}
            className="ml-1 text-foreground underline-offset-2 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      {allProviders.length === 0 && (
        <div className="mt-6 space-y-2" aria-busy="true">
          <span className="sr-only">Loading providers</span>
          {PROVIDER_SKELETON_WIDTHS.map((width) => (
            <div
              key={width}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-3"
            >
              <div className="skeleton size-7 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className={`skeleton h-3 rounded ${width}`} />
                <div className="skeleton h-2.5 w-2/5 rounded" />
              </div>
              <div className="skeleton h-7 w-16 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      )}

      {connecting && (
        <ProviderConnectDialog
          provider={connecting}
          onClose={() => setConnecting(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Workflow Tab
// ═══════════════════════════════════════════════════════════════════════

function WorkflowTab() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const workflowSettings = useMutation({
    mutationFn: (patch: Partial<AppConfig>) => patchConfig(patch),
    onSuccess: (_result, patch) => {
      queryClient.setQueryData<AppConfig>(qk.config, (current) =>
        current ? { ...current, ...patch } : current,
      );
    },
    onError: () => notify.error("Couldn't save workflow settings"),
  });
  const nextMessageEnabled = config?.composerPredictions === true;
  const autocompleteEnabled = (config?.composerAutocomplete ?? nextMessageEnabled) === true;
  const predictionSource = config?.composerPredictionSource ?? "free";
  const predictionModelHint =
    "Uses a verified free OpenCode Zen model. Your selected chat model stays separate.";
  const {
    effortControl,
    setEffortControl,
    composerShortcuts,
    savingComposerShortcuts,
    setComposerShortcuts,
  } = usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium text-foreground">Workflow</h4>

      <fieldset className="mt-6">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
          Reasoning effort control
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(["slider", "dropdown"] as const).map((control) => (
            <button
              key={control}
              type="button"
              onClick={() => setEffortControl(control)}
              aria-pressed={effortControl === control}
              className="rounded-lg border border-border bg-card px-3 py-2.5 text-center text-xs text-muted-foreground capitalize transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-foreground/40 aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground"
            >
              {control}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-6" disabled={savingComposerShortcuts}>
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
          Busy chat shortcuts
        </legend>
        <div className="divide-y rounded-lg border bg-card">
          {(["steer", "queue"] as const).map((action) => (
            <label
              key={action}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              {action === "steer" ? "Steer at next step" : "Queue after current turn"}
              <select
                value={composerShortcuts[action]}
                className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
                onChange={(event) => {
                  const shortcut = event.target.value as ComposerShortcut;
                  const other = action === "steer" ? "queue" : "steer";
                  const next = { ...composerShortcuts, [action]: shortcut };
                  if (shortcut !== "disabled" && next[other] === shortcut) {
                    next[other] = composerShortcuts[action];
                  }
                  setComposerShortcuts(next);
                }}
              >
                {COMPOSER_SHORTCUTS.map((shortcut) => (
                  <option key={shortcut} value={shortcut}>
                    {composerShortcutLabel(shortcut)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          These apply while a turn is running. Assigning a shortcut in use swaps the two.
        </p>
      </fieldset>
      <div className="mt-6">
        <h5 className="mb-1.5 text-xs font-medium text-muted-foreground">Composer suggestions</h5>
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          <SettingSwitch
            label="Next-message predictions"
            title={
              predictionSource === "free"
                ? predictionModelHint
                : "Uses the selected model’s provider and may count toward its usage or charges."
            }
            checked={nextMessageEnabled}
            disabled={!config || workflowSettings.isPending}
            onChange={(enabled) =>
              workflowSettings.mutate({
                composerPredictions: enabled,
                ...(config?.composerAutocomplete === undefined && {
                  composerAutocomplete: autocompleteEnabled,
                }),
              })
            }
          />
          <label className="flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-xs">
            Next-message model
            <select
              aria-describedby="next-message-model-help"
              value={predictionSource}
              disabled={!config || workflowSettings.isPending}
              className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
              onChange={(event) =>
                workflowSettings.mutate({
                  composerPredictionSource: event.target.value === "chat" ? "chat" : "free",
                })
              }
            >
              <option value="free">Free OpenCode Zen</option>
              <option value="chat">Use chat model</option>
            </select>
          </label>
          <SettingSwitch
            label="Autocomplete"
            title={predictionModelHint}
            checked={autocompleteEnabled}
            disabled={!config || workflowSettings.isPending}
            onChange={(enabled) => workflowSettings.mutate({ composerAutocomplete: enabled })}
          />
          <SettingSwitch
            label="Composer prediction status"
            checked={config?.composerPredictionDebug === true}
            disabled={!config || workflowSettings.isPending}
            onChange={(enabled) => workflowSettings.mutate({ composerPredictionDebug: enabled })}
          />
        </div>
        <p id="next-message-model-help" className="mt-1.5 text-xs text-muted-foreground">
          {predictionSource === "chat"
            ? "New next-message suggestions use your selected model and may count toward its provider’s usage limits or charges. OpenAI fast aliases use the standard model when available. Your provider’s configured service tier applies. A saved suggestion is reused for the same turn."
            : "Next-message predictions use a verified free OpenCode Zen model and the latest completed reply. A saved suggestion is reused for the same turn."}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Autocomplete uses a verified free OpenCode Zen model. Press Tab to accept suggestions.
        </p>
      </div>
      <div className="mt-6 overflow-hidden rounded-lg border bg-card">
        <SettingSwitch
          label="Model switch warning"
          checked={config?.hideModelSwitchWarning !== true}
          disabled={!config || workflowSettings.isPending}
          onChange={(enabled) => workflowSettings.mutate({ hideModelSwitchWarning: !enabled })}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Privacy Tab
// ═══════════════════════════════════════════════════════════════════════

function InstructionsTab() {
  const { data: saved, isError: unreadable } = useQuery<string>({
    queryKey: qk.instructions,
    queryFn: () => desktop.readInstructions(),
  });
  const saveInstructions = useSaveInstructions();
  // Saving reloads OpenCode, which every running chat depends on.
  const chatRunning = useAnyChatBusy();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved ?? "";

  const save = () => {
    saveInstructions.mutate(text, {
      onSuccess: () => {
        // Anything typed while this was saving stays, still to be saved.
        setDraft((current) => (current === text ? null : current));
        notify.success("Instructions saved");
      },
      onError: (error) => {
        notify.error("Couldn't save your instructions", { description: error.message });
      },
    });
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium text-foreground">Instructions</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        What BloxBot should always keep in mind, in every chat.
      </p>

      <textarea
        aria-label="Instructions"
        value={text}
        disabled={unreadable}
        onChange={(event) => setDraft(event.target.value)}
        rows={10}
        placeholder="Keep scripts in ServerScriptService. Explain changes simply."
        className="mt-6 w-full resize-y rounded-lg border bg-card p-3.5 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/30"
      />

      <div className="mt-3 flex items-center justify-end gap-3">
        {unreadable && (
          <span className="text-xs text-muted-foreground">
            Couldn't read your saved instructions.
          </span>
        )}
        {chatRunning && !unreadable && (
          <span className="text-xs text-muted-foreground">
            Saving waits for your chats to finish.
          </span>
        )}
        <button
          type="button"
          disabled={
            unreadable ||
            chatRunning ||
            saveInstructions.isPending ||
            draft === null ||
            draft === (saved ?? "")
          }
          onClick={save}
          className="h-8 rounded-lg bg-foreground px-3 text-xs text-background transition-opacity disabled:opacity-30"
        >
          Save
        </button>
      </div>

      <SkillsSettings chatRunning={chatRunning} />

      <SystemPromptSection chatRunning={chatRunning} />
    </div>
  );
}

function SystemPromptSection({ chatRunning }: { chatRunning: boolean }) {
  const { data: config } = useQuery<AppConfig>({ queryKey: qk.config, queryFn: loadConfig });
  const saveSystemPrompt = useSaveSystemPrompt();
  const saved = config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  const customized = (config?.systemPrompt ?? null) !== null;

  const save = (systemPrompt: string | null) => {
    saveSystemPrompt.mutate(systemPrompt, {
      onSuccess: () => {
        // A reset applies to everything. Anything typed while a save ran stays, still to be saved.
        setDraft((current) => (systemPrompt === null || current === systemPrompt ? null : current));
        notify.success(systemPrompt === null ? "System prompt reset" : "System prompt saved");
      },
      onError: (error) => {
        notify.error("Couldn't save the system prompt", { description: error.message });
      },
    });
  };

  return (
    <div className="mt-8 border-t pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden="true"
          size={12}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        />
        System prompt
        {customized && <span className="text-warning">(changed)</span>}
      </button>

      {open && (
        <>
          <p className="mt-3 rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
            Not recommended. BloxBot can get worse at Studio work, and your next message costs more
            because the AI has to rebuild its cache. Use Instructions instead.
          </p>

          <textarea
            aria-label="System prompt"
            value={text}
            onChange={(event) => setDraft(event.target.value)}
            rows={12}
            className="mt-3 w-full resize-y rounded-lg border bg-card p-3.5 text-xs leading-relaxed text-foreground outline-none focus:border-foreground/30"
          />

          <div className="mt-3 flex items-center justify-end gap-2">
            {(customized || text !== DEFAULT_SYSTEM_PROMPT) && (
              <button
                type="button"
                disabled={chatRunning || saveSystemPrompt.isPending}
                onClick={() => (customized ? save(null) : setDraft(null))}
                className="h-8 rounded-lg border bg-card px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50"
              >
                Reset to default
              </button>
            )}
            <button
              type="button"
              disabled={chatRunning || saveSystemPrompt.isPending || !text.trim() || text === saved}
              onClick={() => save(text === DEFAULT_SYSTEM_PROMPT ? null : text)}
              className="h-8 rounded-lg bg-foreground px-3 text-xs text-background transition-opacity disabled:opacity-30"
            >
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const NOTIFICATION_KINDS: ReadonlyArray<{ kind: keyof NotificationKinds; label: string }> = [
  { kind: "finished", label: "A chat finishes" },
  { kind: "waiting", label: "A chat needs your answer or approval" },
  { kind: "failed", label: "A chat runs into a problem" },
  { kind: "app", label: "An update is ready or the connection is lost" },
];

function SettingSwitch({
  label,
  title,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  title?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      title={title}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/60 disabled:opacity-50"
    >
      <span className="text-xs">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-brand" : "bg-border"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function NotificationsTab() {
  const { notifications, setNotificationKind, setNotificationSound } = usePreferences();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium text-foreground">Notifications</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Sent while BloxBot isn't the app in front.
      </p>

      <div className="mt-6">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Notify me when</div>
        <div className="divide-y rounded-lg border bg-card">
          {NOTIFICATION_KINDS.map(({ kind, label }) => (
            <SettingSwitch
              key={kind}
              label={label}
              checked={notifications.kinds[kind]}
              onChange={(enabled) => {
                setNotificationKind(kind, enabled);
              }}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-card">
        <SettingSwitch
          label="Play a sound"
          checked={notifications.sound}
          onChange={(enabled) => {
            setNotificationSound(enabled);
            if (enabled) playChime();
          }}
        />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {canOpenNotificationSettings() && (
          <button
            type="button"
            onClick={openNotificationSettings}
            className="h-8 rounded-lg border bg-card px-3 text-xs transition-colors hover:bg-accent"
          >
            Open system settings
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void notify.test();
          }}
          className="h-8 rounded-lg border bg-card px-3 text-xs transition-colors hover:bg-accent"
        >
          Send a test notification
        </button>
      </div>
    </div>
  );
}

function PrivacyTab() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <div className="mb-5 flex justify-center">
        <BloxBotMascot size={96} animated />
      </div>
      <h4 className="text-lg font-medium text-foreground">Privacy</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        This fork does not send app analytics or error reports. Your selected AI provider receives
        the context needed to process your requests.
      </p>
    </div>
  );
}

const PRIVACY_POLICY_URL = "https://bloxbot.ai/privacy";
const TERMS_URL = "https://bloxbot.ai/terms";

// ═══════════════════════════════════════════════════════════════════════
// About Tab
// ═══════════════════════════════════════════════════════════════════════

const ABOUT_LINKS = [
  { name: "Paralov", url: "https://paralov.com/", icon: Building2 },
  { name: "Studs.gg", url: "https://studs.gg/", icon: Globe },
  { name: "Privacy Policy", url: PRIVACY_POLICY_URL, icon: Shield },
  { name: "Terms of Service", url: TERMS_URL, icon: FileText },
];

function AboutTab() {
  const { data: appVersion } = useQuery({
    queryKey: qk.appVersion,
    queryFn: () => desktop.getVersion(),
    staleTime: Infinity,
  });
  const {
    result,
    update,
    checking,
    downloading,
    checkError,
    installError,
    checkForUpdates,
    installUpdate,
  } = useUpdater();
  const updateError = downloading ? undefined : (checkError ?? (update ? installError : undefined));

  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium text-foreground">About BloxBot</h4>

      {/* Version & update check */}
      <div className="mt-6">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Version</div>
        <div className="rounded-lg border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium">
                BloxBot{appVersion && <span> v{appVersion}</span>}
              </span>
            </div>
            {!downloading && result?.status !== "unsupported" && (
              <button
                type="button"
                onClick={checkForUpdates}
                disabled={checking}
                aria-busy={checking}
                className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                <RefreshCw
                  size={11}
                  className={checking ? "motion-safe:animate-spin" : undefined}
                  aria-hidden="true"
                />
                {checking ? "Checking..." : "Check for updates"}
              </button>
            )}
            {downloading && (
              <output className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle size={12} className="motion-safe:animate-spin" aria-hidden="true" />
                Installing...
              </output>
            )}
          </div>

          {result?.status === "up-to-date" && !checkError && (
            <output className="mt-2 block text-xs text-success">
              Up to date. Latest release v{result.version}.
            </output>
          )}
          {result?.status === "no-releases" && !checkError && (
            <output className="mt-2 block text-xs text-muted-foreground">
              No stable BloxBot releases have been published yet.
            </output>
          )}
          {result?.status === "unsupported" && (
            <output className="mt-2 block text-xs text-muted-foreground">
              Update checks are available in installed BloxBot builds.
            </output>
          )}
          {update && !downloading && (
            <div className="mt-3 flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-xs">
                <span className="font-medium">v{update.version}</span>{" "}
                <span className="text-muted-foreground">is available</span>
              </span>
              <button
                type="button"
                onClick={installUpdate}
                className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                {installError ? "Retry install" : "Install & Restart"}
              </button>
            </div>
          )}

          {updateError && (
            <output className="mt-3 block rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {updateError}
            </output>
          )}
          <div className="mt-3 border-t pt-2">
            <WhatsNew />
          </div>
        </div>
      </div>

      {/* Built with */}
      <div className="mt-6">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Built with</div>
        <div className="rounded-lg border bg-card">
          {TECHNOLOGIES.map((tech, idx) => (
            <div key={tech.name}>
              {idx > 0 && <div className="mx-3.5 h-px bg-border" />}
              <a
                href={tech.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between px-3.5 py-2.5 transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <span className="text-xs font-medium">{tech.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{tech.description}</span>
                </div>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted-foreground"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="mt-6">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Links</div>
        <div className="space-y-1.5">
          <a
            href={"https://bloxbot.ai/"}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Website
          </a>
          <a
            href="https://github.com/paralov/app-bloxbot-ai"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
          {ABOUT_LINKS.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 w-full items-center gap-2 rounded-lg border bg-card px-3.5 text-xs transition-colors hover:bg-accent"
            >
              <link.icon className="size-3" />
              {link.name}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Settings;
