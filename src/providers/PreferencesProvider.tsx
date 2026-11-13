import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSaveModelSettings } from "@/hooks/mutations/useSaveModelSettings";
import { useProviderList } from "@/hooks/useProviders";
import { useSessions } from "@/hooks/useSessions";
import { type ComposerShortcuts, DEFAULT_COMPOSER_SHORTCUTS } from "@/lib/composerDelivery";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import {
  goneReason,
  isPaidModel,
  listedModel,
  modelName,
  pickPaidModel,
  replacementModel,
  supportedVariant,
} from "@/lib/modelChoice";
import { notify, setNotificationPreferences } from "@/lib/notifications";
import { toAppProviderID } from "@/lib/openAiProfiles";
import { qk } from "@/lib/queryKeys";
import { splitModelKey } from "@/lib/splitModelKey";
import { useActiveSession } from "@/providers/ActiveSessionProvider";
import type {
  ChatModelSelection,
  EffortControl,
  ModelCatalogOrder,
  NotificationKinds,
} from "@/types/desktop";

interface NotificationPreferences {
  kinds: NotificationKinds;
  sound: boolean;
}

/** Someone who turned everything off before kinds existed keeps it all off. */
function kindsFromConfig(config: AppConfig | null): NotificationKinds {
  if (config?.notificationKinds) return config.notificationKinds;
  const enabled = config?.systemNotifications ?? true;
  return { finished: enabled, waiting: enabled, failed: enabled, app: enabled };
}

interface PreferencesContextValue {
  selectedModel: string | null;
  selectedVariant: string | null;
  modelSelectionMessage: string | null;
  modelCatalogOrder: ModelCatalogOrder;
  effortControl: EffortControl;
  composerShortcuts: ComposerShortcuts;
  savingComposerShortcuts: boolean;
  hiddenModels: Set<string>;
  hideFreeModels: boolean;
  savingModelSettings: boolean;
  paidDefaultModel: string | null;
  /** Models refused in the user's region. */
  unavailableModels: Set<string>;
  setSelectedModel: (modelID: string, variant?: string | null) => void;
  setSelectedVariant: (variant: string | null) => void;
  setModelCatalogOrder: (order: ModelCatalogOrder) => void;
  forgetChatModel: (sessionID: string) => void;
  setEffortControl: (control: EffortControl) => void;
  setComposerShortcuts: (shortcuts: ComposerShortcuts) => void;
  setHideFreeModels: (hide: boolean) => void;
  setPaidDefaultModel: (key: string | null) => void;
  toggleModelVisibility: (modelKey: string) => void;
  markModelUnavailable: (modelKey: string) => void;
  notifications: NotificationPreferences;
  setNotificationKind: (kind: keyof NotificationKinds, enabled: boolean) => void;
  setNotificationSound: (enabled: boolean) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used within a PreferencesProvider");
  return context;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { mutate: saveModelSettings, isPending: savingModelSettings } = useSaveModelSettings();
  const { data: configData } = useQuery<AppConfig>({
    queryKey: qk.config,
    queryFn: loadConfig,
  });
  const { activeSessionId } = useActiveSession();
  const { data: sessions } = useSessions();
  const nativeModel = sessions?.find(({ id }) => id === activeSessionId)?.model;
  const modelCatalogOrder = configData?.modelCatalogOrder ?? "name";
  const effortControl = configData?.effortControl ?? "slider";
  const composerShortcuts = configData?.composerShortcuts ?? DEFAULT_COMPOSER_SHORTCUTS;
  const { mutate: setComposerShortcuts, isPending: savingComposerShortcuts } = useMutation({
    mutationFn: (shortcuts: ComposerShortcuts) => patchConfig({ composerShortcuts: shortcuts }),
    onSuccess: (_, shortcuts) =>
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, composerShortcuts: shortcuts } : config,
      ),
    onError: () => notify.error("Could not save message shortcuts."),
  });
  const { mutate: setEffortControl } = useMutation({
    mutationFn: (control: EffortControl) => patchConfig({ effortControl: control }),
    scope: { id: "effort-control" },
    onSuccess: (_, control) =>
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, effortControl: control } : config,
      ),
    onError: () => {
      notify.error("Could not save the reasoning effort control.");
    },
  });

  const hiddenModels = useMemo(() => new Set(configData?.hiddenModels), [configData?.hiddenModels]);
  const unavailableModels = useMemo(
    () => new Set(configData?.unavailableModels),
    [configData?.unavailableModels],
  );
  // The regional error card lets the user switch during this launch.
  const recentlyUnavailable = useRef(new Set<string>());
  const reportedReplacement = useRef(new Map<string | null, string>());

  const [notifications, setNotifications] = useState<NotificationPreferences>(() => ({
    kinds: kindsFromConfig(null),
    sound: true,
  }));
  const notificationsRef = useRef(notifications);
  const notificationSaveRef = useRef(0);

  const providerList = useProviderList();
  const hideFreeModels = configData?.hideFreeModels ?? false;
  const paidDefaultModel = configData?.paidDefaultModel ?? null;
  const savedChatModel = activeSessionId ? configData?.chatModels?.[activeSessionId] : undefined;
  const chatChoice =
    savedChatModel ??
    (nativeModel && {
      key: `${toAppProviderID(nativeModel.providerID)}/${nativeModel.id}`,
      variant: nativeModel.variant ?? null,
    });
  const preferred =
    chatChoice ??
    (configData?.lastModel
      ? { key: configData.lastModel, variant: configData.lastModelVariant ?? null }
      : undefined);
  const preferredProvider = preferred && splitModelKey(preferred.key)[0];
  const connected = preferredProvider && providerList?.connected.includes(preferredProvider);
  const reason =
    providerList && preferred && goneReason(providerList, preferred.key, unavailableModels);
  const needsReplacement = Boolean(
    connected &&
      (reason === "retired" ||
        (reason === "region" && preferred && !recentlyUnavailable.current.has(preferred.key))),
  );
  const replacement =
    needsReplacement && connected && providerList && preferred
      ? replacementModel(providerList, preferred.key, {
          hidden: hiddenModels,
          unavailable: unavailableModels,
          hideFreeModels,
        })
      : null;
  const allowed =
    connected &&
    preferred &&
    providerList &&
    !hiddenModels.has(preferred.key) &&
    (!hideFreeModels || isPaidModel(providerList, preferred.key));
  const paidFallback =
    hideFreeModels && providerList && !replacement && !allowed && !needsReplacement
      ? pickPaidModel(providerList, {
          preferred: [paidDefaultModel, configData?.lastPaidModel],
          hidden: hiddenModels,
          unavailable: unavailableModels,
        })
      : null;
  const selectedModel =
    replacement?.key ??
    (!needsReplacement && allowed ? preferred.key : null) ??
    paidFallback?.key ??
    null;
  const selectedVariant =
    selectedModel && preferred && providerList && (replacement || preferred.key === selectedModel)
      ? supportedVariant(listedModel(providerList, selectedModel), preferred.variant)
      : null;
  const modelSelectionMessage =
    activeSessionId && (!providerList || !configData)
      ? "Waiting for model settings to load."
      : providerList && preferred && !selectedModel && (chatChoice || needsReplacement)
        ? "Choose an available model to continue this chat."
        : null;

  const setHideFreeModels = useCallback(
    (hide: boolean) => saveModelSettings({ hideFreeModels: hide }),
    [saveModelSettings],
  );

  const setPaidDefaultModel = useCallback(
    (key: string | null) => {
      patchConfig({ paidDefaultModel: key })
        .then(() =>
          queryClient.setQueryData<AppConfig>(qk.config, (config) =>
            config ? { ...config, paidDefaultModel: key } : config,
          ),
        )
        .catch(() => notify.error("Could not save the paid default model."));
    },
    [queryClient],
  );

  const applyNotifications = useCallback((next: NotificationPreferences) => {
    setNotifications(next);
    setNotificationPreferences(next.kinds, next.sound);
  }, []);
  const saveNotifications = useCallback(
    (next: NotificationPreferences) => {
      const previous = notificationsRef.current;
      const save = ++notificationSaveRef.current;
      notificationsRef.current = next;
      applyNotifications(next);
      patchConfig({ notificationKinds: next.kinds, notificationSound: next.sound }).catch(() => {
        // A newer choice has already saved everything, this one's change included.
        if (save !== notificationSaveRef.current) return;
        notificationsRef.current = previous;
        applyNotifications(previous);
      });
    },
    [applyNotifications],
  );
  const setNotificationKind = useCallback(
    (kind: keyof NotificationKinds, enabled: boolean) => {
      const current = notificationsRef.current;
      saveNotifications({ ...current, kinds: { ...current.kinds, [kind]: enabled } });
    },
    [saveNotifications],
  );
  const setNotificationSound = useCallback(
    (sound: boolean) => saveNotifications({ ...notificationsRef.current, sound }),
    [saveNotifications],
  );

  useEffect(() => {
    if (!configData) return;
    const loaded = { kinds: kindsFromConfig(configData), sound: configData.notificationSound };
    notificationsRef.current = loaded;
    applyNotifications(loaded);
  }, [applyNotifications, configData]);

  const saveModelChoice = useCallback(
    (sessionID: string | null, choice: ChatModelSelection, updateDefault: boolean) => {
      const config = queryClient.getQueryData<AppConfig>(qk.config);
      if (!config) return;
      const patch: Partial<AppConfig> = {};
      if (sessionID) patch.chatModels = { ...config.chatModels, [sessionID]: choice };
      if (updateDefault) {
        patch.lastModel = choice.key;
        patch.lastModelVariant = choice.variant;
        if (providerList && isPaidModel(providerList, choice.key)) patch.lastPaidModel = choice.key;
      }
      queryClient.setQueryData<AppConfig>(qk.config, { ...config, ...patch });
      patchConfig(patch).catch(() => notify.error("Could not save the model selection."));
    },
    [providerList, queryClient],
  );

  const replacedKey = needsReplacement && connected ? preferred?.key : undefined;
  const replacementKey = replacement?.key;
  const replacementName = replacement?.name;
  useEffect(() => {
    if (!configData || !providerList || !replacedKey) return;
    const report = `${replacedKey}\n${replacementKey ?? ""}`;
    if (reportedReplacement.current.get(activeSessionId) === report) return;
    reportedReplacement.current.set(activeSessionId, report);
    if (replacementKey) {
      saveModelChoice(
        activeSessionId,
        { key: replacementKey, variant: selectedVariant },
        !activeSessionId,
      );
    }
    const name = modelName(providerList, replacedKey);
    notify.message(
      reason === "region"
        ? `${name} isn't offered in your region`
        : `${name} is no longer available`,
      {
        description: replacementName
          ? `This chat now uses ${replacementName}.`
          : "Choose an available model to continue this chat.",
      },
    );
  }, [
    activeSessionId,
    configData,
    providerList,
    reason,
    replacedKey,
    replacementKey,
    replacementName,
    saveModelChoice,
    selectedVariant,
  ]);

  const setSelectedModel = useCallback(
    (modelID: string, variant?: string | null) => {
      if (
        !providerList?.connected.includes(splitModelKey(modelID)[0]) ||
        hiddenModels.has(modelID) ||
        (hideFreeModels && !isPaidModel(providerList, modelID))
      )
        return;
      const model = listedModel(providerList, modelID);
      if (!model || model.status === "deprecated") return;
      const effort = variant === undefined && selectedModel === modelID ? selectedVariant : variant;
      reportedReplacement.current.delete(activeSessionId);
      saveModelChoice(
        activeSessionId,
        { key: modelID, variant: supportedVariant(model, effort ?? null) },
        true,
      );
    },
    [
      activeSessionId,
      hiddenModels,
      hideFreeModels,
      providerList,
      saveModelChoice,
      selectedModel,
      selectedVariant,
    ],
  );

  const setSelectedVariant = useCallback(
    (variant: string | null) => {
      if (selectedModel) setSelectedModel(selectedModel, variant);
    },
    [selectedModel, setSelectedModel],
  );

  const forgetChatModel = useCallback(
    (sessionID: string) => {
      reportedReplacement.current.delete(sessionID);
      const config = queryClient.getQueryData<AppConfig>(qk.config);
      if (!config?.chatModels?.[sessionID]) return;
      const chatModels = { ...config.chatModels };
      delete chatModels[sessionID];
      queryClient.setQueryData<AppConfig>(qk.config, { ...config, chatModels });
      patchConfig({ chatModels }).catch(() => {});
    },
    [queryClient],
  );

  const setModelCatalogOrder = useCallback(
    (order: ModelCatalogOrder) => {
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, modelCatalogOrder: order } : config,
      );
      patchConfig({ modelCatalogOrder: order }).catch(() =>
        notify.error("Could not save the model order."),
      );
    },
    [queryClient],
  );

  const toggleModelVisibility = useCallback(
    (modelKey: string) => {
      const next = new Set(hiddenModels);
      if (next.has(modelKey)) {
        next.delete(modelKey);
      } else {
        next.add(modelKey);
      }
      queryClient.setQueryData<AppConfig>(qk.config, (config) =>
        config ? { ...config, hiddenModels: [...next] } : config,
      );
      patchConfig({ hiddenModels: [...next] }).catch(() => {});
    },
    [hiddenModels, queryClient],
  );

  const markModelUnavailable = useCallback(
    (modelKey: string) => {
      const config = queryClient.getQueryData<AppConfig>(qk.config);
      if (!config || config.unavailableModels?.includes(modelKey)) return;
      recentlyUnavailable.current.add(modelKey);
      const unavailableModels = [...(config.unavailableModels ?? []), modelKey];
      queryClient.setQueryData<AppConfig>(qk.config, { ...config, unavailableModels });
      patchConfig({ unavailableModels }).catch(() => {});
    },
    [queryClient],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      selectedModel,
      selectedVariant,
      modelSelectionMessage,
      modelCatalogOrder,
      effortControl,
      composerShortcuts,
      savingComposerShortcuts,
      hiddenModels,
      hideFreeModels,
      savingModelSettings,
      paidDefaultModel,
      unavailableModels,
      notifications,
      setSelectedModel,
      setSelectedVariant,
      setModelCatalogOrder,
      forgetChatModel,
      setEffortControl,
      setComposerShortcuts,
      setHideFreeModels,
      setPaidDefaultModel,
      toggleModelVisibility,
      markModelUnavailable,
      setNotificationKind,
      setNotificationSound,
    }),
    [
      selectedModel,
      selectedVariant,
      modelSelectionMessage,
      modelCatalogOrder,
      effortControl,
      composerShortcuts,
      savingComposerShortcuts,
      hiddenModels,
      hideFreeModels,
      savingModelSettings,
      paidDefaultModel,
      unavailableModels,
      notifications,
      setSelectedModel,
      setSelectedVariant,
      setModelCatalogOrder,
      forgetChatModel,
      setEffortControl,
      setComposerShortcuts,
      setHideFreeModels,
      setPaidDefaultModel,
      toggleModelVisibility,
      markModelUnavailable,
      setNotificationKind,
      setNotificationSound,
    ],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
