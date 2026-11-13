import { useMemo } from "react";
import { useAllModels, useProviderList } from "@/hooks/useProviders";
import { isPaidModel } from "@/lib/modelChoice";
import { usePreferences } from "@/providers/PreferencesProvider";

/** Model picker and profile dropdowns share visibility and billing rules. */
export function useEligibleModels({ includeUnavailable = false } = {}) {
  const allModels = useAllModels();
  const list = useProviderList();
  const { hideFreeModels, hiddenModels, unavailableModels } = usePreferences();
  return useMemo(
    () =>
      allModels.filter((model) => {
        if (!list?.connected.includes(model.providerId)) return false;
        const key = `${model.providerId}/${model.id}`;
        return (
          model.status !== "deprecated" &&
          !hiddenModels.has(key) &&
          (includeUnavailable || !unavailableModels.has(key)) &&
          (!hideFreeModels || isPaidModel(list, key))
        );
      }),
    [allModels, hideFreeModels, hiddenModels, includeUnavailable, list, unavailableModels],
  );
}
