import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { openAiBillingLabel } from "@/lib/openAiProfiles";
import type {
  ProviderAuthMethod,
  ProviderAuthResponse,
  ProviderListResponse,
} from "@/lib/opencode/types";

import { providerDisplayName } from "@/lib/providerAuth";
import { qk } from "@/lib/queryKeys";
import { useOpenCodeClient } from "@/providers/OpenCodeClientProvider";
import type { ModelInfo, ProviderInfo } from "@/types";

type ProvidersData = ProviderListResponse & {
  authMethods?: Record<string, ProviderAuthMethod[]>;
};

function useProvidersQuery() {
  const { client } = useOpenCodeClient();

  return useQuery<ProvidersData>({
    queryKey: qk.providers,
    queryFn: async () => {
      if (!client) throw new Error("No client");
      const [provRes, authRes] = await Promise.all([
        client.provider.list({}, { throwOnError: true }),
        client.provider
          .auth({}, { throwOnError: true })
          .catch(() => ({ data: undefined as ProviderAuthResponse | undefined })),
      ]);
      if (!provRes.data) throw new Error("No provider data");
      if (authRes.data) {
        return { ...provRes.data, authMethods: authRes.data };
      }
      return provRes.data;
    },
    enabled: !!client,
  });
}

export function useAllProviders(): ProviderInfo[] {
  const { data } = useProvidersQuery();
  if (!data?.all) return [];
  return data.all.map((p) => ({ id: p.id, name: p.name, env: p.env, source: p.source }));
}

/** OpenCode's provider list as it comes, with each model's full details. */
export function useProviderList(): ProviderListResponse | undefined {
  return useProvidersQuery().data;
}

export function useConnectedProviders(): string[] {
  const { data } = useProvidersQuery();
  return data?.connected ?? [];
}

export function useAllModels(): ModelInfo[] {
  const { data } = useProvidersQuery();
  return useMemo(
    () =>
      data?.all.flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          id: model.id,
          name: model.name,
          providerId: provider.id,
          providerName: providerDisplayName(provider),
          billingLabel: openAiBillingLabel(provider.id, model.serviceTier),
          releasedAt: model.releasedAt,
          status: model.status,
          variants: model.variants,
        })),
      ) ?? [],
    [data],
  );
}

export function useAuthMethods(): Record<string, ProviderAuthMethod[]> {
  const { data } = useProvidersQuery();
  return data?.authMethods ?? {};
}
