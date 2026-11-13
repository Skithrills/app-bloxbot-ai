import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSaveModelSettings } from "@/hooks/mutations/useSaveModelSettings";
import { useEligibleModels } from "@/hooks/useEligibleModels";
import { useAnyChatBusy } from "@/hooks/useSessionStatuses";
import { loadConfig } from "@/lib/config";
import { effortLabel } from "@/lib/effort";
import { modelLabel } from "@/lib/modelChoice";
import { qk } from "@/lib/queryKeys";
import { SUBAGENT_PROFILES } from "@/lib/subagentProfiles";

type ProfileOverrides = {
  subagentModels: Record<string, string>;
  subagentEfforts: Record<string, string>;
};

export default function SubagentsSettings() {
  const { data: config } = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const models = useEligibleModels();
  const busy = useAnyChatBusy();
  const [draft, setDraft] = useState<ProfileOverrides | null>(null);
  const overrides = draft ?? {
    subagentModels: config?.subagentModels ?? {},
    subagentEfforts: config?.subagentEfforts ?? {},
  };
  const save = useSaveModelSettings();

  return (
    <section
      className="space-y-5 px-4 py-6 @xl:px-6 @xl:py-8"
      aria-labelledby="subagent-models-heading"
    >
      <div>
        <h2 id="subagent-models-heading" className="text-lg font-semibold">
          Subagent profiles
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the model and effort each role uses. General is the default worker for delegated
          tasks.
        </p>
      </div>
      <div className="divide-y rounded-xl border">
        {SUBAGENT_PROFILES.map((profile) => {
          const override = overrides.subagentModels[profile.id] ?? "";
          const variant = overrides.subagentEfforts[profile.id] ?? "";
          const model = models.find((entry) => `${entry.providerId}/${entry.id}` === override);
          const variants = Object.keys(model?.variants ?? {});
          const unavailable = Boolean(override && !model);
          const effortUnavailable = Boolean(variant && !variants.includes(variant));
          return (
            <div key={profile.id} className="grid gap-2 p-4 sm:grid-cols-2 sm:items-center">
              <div>
                <label htmlFor={profile.id} className="text-sm font-medium">
                  {profile.name}
                </label>
                <p className="mt-1 text-xs text-muted-foreground">{profile.description}</p>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,auto)] gap-2">
                <select
                  id={profile.id}
                  value={unavailable ? "saved-unavailable" : override}
                  disabled={!config || save.isPending}
                  className="min-w-0 rounded-md border bg-background px-2.5 py-2 text-sm"
                  onChange={(event) => {
                    const subagentModels = { ...overrides.subagentModels };
                    const subagentEfforts = { ...overrides.subagentEfforts };
                    if (event.target.value) subagentModels[profile.id] = event.target.value;
                    else delete subagentModels[profile.id];
                    delete subagentEfforts[profile.id];
                    setDraft({ subagentModels, subagentEfforts });
                  }}
                >
                  {unavailable && (
                    <option value="saved-unavailable" disabled>
                      Saved model unavailable
                    </option>
                  )}
                  <option value="">Inherit the parent model</option>
                  {models.map((entry) => (
                    <option
                      key={`${entry.providerId}/${entry.id}`}
                      value={`${entry.providerId}/${entry.id}`}
                    >
                      {modelLabel(entry)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${profile.name} effort`}
                  value={effortUnavailable ? "saved-unavailable" : variant}
                  disabled={!config || save.isPending || (variants.length === 0 && !variant)}
                  className="min-w-0 rounded-md border bg-background px-2 py-2 text-sm disabled:opacity-60"
                  onChange={(event) => {
                    const subagentEfforts = { ...overrides.subagentEfforts };
                    if (event.target.value) subagentEfforts[profile.id] = event.target.value;
                    else delete subagentEfforts[profile.id];
                    setDraft({ ...overrides, subagentEfforts });
                  }}
                >
                  {effortUnavailable && (
                    <option value="saved-unavailable" disabled>
                      Unavailable
                    </option>
                  )}
                  <option value="">{override ? "Auto" : "Inherit"}</option>
                  {variants.map((id) => (
                    <option value={id} key={id}>
                      {effortLabel(id)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!draft || busy || save.isPending}
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
          onClick={() => {
            if (draft) save.mutate(draft, { onSuccess: () => setDraft(null) });
          }}
        >
          {save.isPending ? "Saving…" : "Save subagent profiles"}
        </button>
        {busy && draft && (
          <span className="text-xs text-muted-foreground">
            Changes can be saved when chats are idle.
          </span>
        )}
        {save.isSuccess && !draft && (
          <output className="text-xs text-muted-foreground">Subagent profiles saved.</output>
        )}
        {save.isError && (
          <span role="alert" className="text-xs text-destructive">
            Could not apply subagent profiles.
          </span>
        )}
      </div>
    </section>
  );
}
