import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { useId, useRef } from "react";
import { loadConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import { placeName, useStudioTargetOptional } from "@/providers/StudioTargetProvider";
import {
  isActiveRojoServer,
  ROJO_HOST,
  ROJO_STANDALONE_PROJECT,
  type RojoServer,
  rojoManifestKey,
  rojoProjectFilesFor,
} from "@/types/rojo";

const serverKey = ["rojo-servers"] as const;
const addFilesKey = ["rojo-add-files"] as const;
const button =
  "rounded-md px-2.5 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const secondaryButton = `${button} hover:bg-accent`;
const primaryButton = `${button} bg-primary text-primary-foreground hover:bg-primary/90`;

const serverLabels: Record<RojoServer["status"], string> = {
  starting: "Starting…",
  running: "Serving",
  stopping: "Stopping…",
  stopped: "Stopped",
  error: "Error",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    : fallback;
}

export function useRojoServingCount() {
  const config = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const configured = [
    ROJO_STANDALONE_PROJECT,
    ...(config.data?.projectFolders ?? []).map(({ directory }) => directory),
  ].some((id) => rojoProjectFilesFor(config.data, id).length > 0);

  const servers = useQuery({
    queryKey: serverKey,
    queryFn: desktop.listRojoServers,
    refetchInterval: (query) =>
      configured || query.state.data?.some(isActiveRojoServer) ? 3000 : false,
  });
  if (!servers.isSuccess) return null;
  const serving = servers.data?.filter((server) => server.status === "running").length ?? 0;
  return configured || serving > 0 ? serving : null;
}

function manifestLabel(projectId: string, file: string): string {
  if (projectId === ROJO_STANDALONE_PROJECT) return file.split(/[\\/]/).pop() ?? file;
  const folder = `${projectId.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
  const manifest = file.replace(/\\/g, "/");
  const windows = /^(?:[a-z]:\/|\/\/)/i.test(folder);
  return (
    windows
      ? manifest.toLowerCase().startsWith(folder.toLowerCase())
      : manifest.startsWith(folder)
  )
    ? manifest.slice(folder.length)
    : file;
}

type ServerAction = "start" | "stop" | "remove";

function RojoManifest({
  projectId,
  projectFile,
  server,
  saved,
  statusUnavailable,
  reportedPort,
}: {
  projectId: string;
  projectFile: string;
  server: RojoServer | undefined;
  saved: boolean;
  statusUnavailable: boolean;
  reportedPort: number | undefined;
}) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const mutationKey = ["rojo-action", rojoManifestKey(projectId, projectFile)];
  const busy = useIsMutating({ mutationKey, exact: true }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: async (action: ServerAction) => {
      if (action === "start") {
        await desktop.startRojoServer(projectId, projectFile);
      } else if (action === "stop") {
        await desktop.stopRojoServer(projectId, projectFile);
      } else {
        await desktop.removeRojoProjectFile(projectId, projectFile);
        await queryClient.invalidateQueries({ queryKey: qk.config, exact: true });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: serverKey, exact: true }),
  });

  function run(action: ServerAction) {
    if (!queryClient.isMutating({ mutationKey, exact: true })) mutation.mutate(action);
  }

  const active = isActiveRojoServer(server);
  const port = server?.status === "running" ? server.port : null;
  const address = port === null ? null : `${ROJO_HOST}:${port}`;
  const label = manifestLabel(projectId, projectFile);
  const actionError = mutation.error && errorMessage(mutation.error, "Couldn’t update Rojo.");

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      notify.success("Rojo address copied");
    } catch {
      notify.error("Couldn’t copy the Rojo address");
    }
  }

  return (
    <section aria-labelledby={titleId} className="space-y-2 rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={titleId} className="break-words text-sm font-medium" title={projectFile}>
            {label}
          </h4>
          {projectId === ROJO_STANDALONE_PROJECT && label !== projectFile && (
            <p className="break-all text-xs text-muted-foreground">{projectFile}</p>
          )}
        </div>
        <output
          className={`shrink-0 text-xs ${address && !statusUnavailable ? "text-success" : "text-muted-foreground"}`}
        >
          {statusUnavailable ? "Status unavailable" : serverLabels[server?.status ?? "stopped"]}
        </output>
      </div>
      {address && !statusUnavailable && (
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <code>{address}</code>
          <button type="button" className={secondaryButton} onClick={() => void copyAddress()}>
            Copy address
          </button>
          {reportedPort === port && (
            <span className="text-muted-foreground">Studio reported this endpoint</span>
          )}
        </div>
      )}
      {actionError && (
        <p role="alert" className="break-words text-xs text-destructive">
          {actionError}
        </p>
      )}
      {server?.error && server.error !== actionError && (
        <p role="alert" className="break-words text-xs text-destructive">
          {server.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy || server?.status === "stopping"}
            onClick={() => run("stop")}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !saved || statusUnavailable}
            onClick={() => run("start")}
          >
            Start
          </button>
        )}
        {saved && (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy || active || statusUnavailable}
            onClick={() => run("remove")}
          >
            Remove
          </button>
        )}
        {server && (
          <details className="w-full text-xs">
            <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
              Server logs
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded border p-2 whitespace-pre-wrap break-words">
              {server.output || "No output yet."}
            </pre>
          </details>
        )}
      </div>
    </section>
  );
}

function RojoProject({
  projectId,
  name,
  projectFiles,
  servers,
  canManageFiles,
  statusUnavailable,
  reportedManifest,
}: {
  projectId: string;
  name: string;
  projectFiles: readonly string[];
  servers: readonly RojoServer[];
  canManageFiles: boolean;
  statusUnavailable: boolean;
  reportedManifest: { key: string; port: number } | undefined;
}) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const adding = useIsMutating({ mutationKey: addFilesKey, exact: true }) > 0;
  const addFiles = useMutation({
    mutationKey: addFilesKey,
    mutationFn: () => desktop.addRojoProjectFiles(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.config, exact: true }),
  });
  const files = new Map(projectFiles.map((file) => [rojoManifestKey(projectId, file), file]));
  const serversByFile = new Map(
    servers.map((server) => [rojoManifestKey(projectId, server.projectFile), server]),
  );
  const manifests = new Map(files);
  for (const [key, server] of serversByFile) {
    if (!manifests.has(key) && isActiveRojoServer(server)) manifests.set(key, server.projectFile);
  }

  return (
    <section aria-labelledby={titleId} className="space-y-2 rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={titleId} className="min-w-0 truncate text-sm font-medium" title={name}>
          {name}
        </h3>
        {canManageFiles && (
          <button
            type="button"
            className={`${secondaryButton} shrink-0`}
            disabled={adding}
            onClick={() => {
              if (!queryClient.isMutating({ mutationKey: addFilesKey, exact: true })) {
                addFiles.mutate();
              }
            }}
          >
            Add project files…
          </button>
        )}
      </div>
      {addFiles.error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {errorMessage(addFiles.error, "Couldn’t add Rojo project files.")}
        </p>
      )}
      {manifests.size === 0 && canManageFiles && (
        <p className="text-xs text-muted-foreground">No project files added.</p>
      )}
      {[...manifests].map(([key, file]) => (
        <RojoManifest
          key={key}
          projectId={projectId}
          projectFile={file}
          server={serversByFile.get(key)}
          saved={canManageFiles && files.has(key)}
          statusUnavailable={statusUnavailable}
          reportedPort={reportedManifest?.key === key ? reportedManifest.port : undefined}
        />
      ))}
    </section>
  );
}

export function RojoLauncher({ onClose }: { onClose: () => void }) {
  const opener = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const studioTarget = useStudioTargetOptional();
  const selected = studioTarget?.reconnecting ? null : studioTarget?.selected;
  const selectedIdentity = selected
    ? JSON.stringify([selected.key, selected.placeId, selected.label])
    : null;
  const studioCheck = useMutation({
    mutationFn: async (studio: NonNullable<typeof selected>) => {
      const connection = await desktop.readStudioRojoConnection(studio.key);
      if (
        studio.placeId &&
        studio.placeId !== "0" &&
        connection &&
        studio.placeId !== connection.placeId
      ) {
        throw new Error("The selected Studio changed places. Select it again to recheck.");
      }
      const server = queryClient
        .getQueryData<RojoServer[]>(serverKey)
        ?.find((server) => server.status === "running" && server.port === connection?.port);
      const manifest =
        server && connection
          ? { key: rojoManifestKey(server.projectId, server.projectFile), port: connection.port }
          : undefined;
      return { connection, manifest, checkedAt: new Date() };
    },
  });
  const checkedStudio = studioCheck.variables;
  const checkMatchesSelection =
    selectedIdentity !== null &&
    checkedStudio &&
    selectedIdentity ===
      JSON.stringify([checkedStudio.key, checkedStudio.placeId, checkedStudio.label]);
  const studioReport = checkMatchesSelection ? studioCheck.data : undefined;

  const servers = useQuery({
    queryKey: serverKey,
    queryFn: desktop.listRojoServers,
    refetchOnMount: "always",
    refetchInterval: 1000,
  });
  const projects = [
    { id: ROJO_STANDALONE_PROJECT, name: "Standalone project", saved: true },
    ...(config.data?.projectFolders ?? []).map((folder) => ({
      id: folder.directory,
      name: folder.name,
      saved: true,
    })),
  ];
  const projectIds = new Set(projects.map(({ id }) => id));
  for (const server of servers.data ?? []) {
    if (!projectIds.has(server.projectId) && isActiveRojoServer(server)) {
      projects.push({ id: server.projectId, name: server.projectId, saved: false });
      projectIds.add(server.projectId);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[250] bg-black/55" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-[251] flex max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-1/2 flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-2xl"
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <Dialog.Title className="text-base font-medium">Rojo server launcher</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            Add existing .project.json or .project.jsonc files. Start each server, then connect to
            its address in the Roblox Studio Rojo plugin.
          </Dialog.Description>
          <div className="mt-4 min-h-0 space-y-3 overflow-y-auto pr-1">
            {config.isError && (
              <p role="alert" className="text-xs text-destructive">
                Couldn’t load Rojo project settings.
              </p>
            )}
            {servers.isError && (
              <p role="alert" className="text-xs text-destructive">
                Couldn’t check Rojo servers. Retrying…
              </p>
            )}
            {projects.map(({ id, name, saved }) => (
              <RojoProject
                key={id}
                projectId={id}
                name={name}
                projectFiles={saved ? rojoProjectFilesFor(config.data, id) : []}
                servers={servers.data?.filter((server) => server.projectId === id) ?? []}
                canManageFiles={saved && config.isSuccess}
                statusUnavailable={servers.isPending || servers.isError}
                reportedManifest={studioReport?.manifest}
              />
            ))}
            <section aria-label="Studio connection" className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium">Studio connection</h3>
                  <p className="break-words text-xs text-muted-foreground">
                    {selected
                      ? placeName(selected.label)
                      : "Select a Studio window to check its connection."}
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={!selected || studioCheck.isPending}
                  onClick={() => {
                    if (selected && !studioCheck.isPending) studioCheck.mutate(selected);
                  }}
                >
                  {studioCheck.isPending ? "Checking Studio…" : "Check Studio connection"}
                </button>
              </div>
              {studioReport && (
                <output className="block text-xs text-muted-foreground">
                  {studioReport.connection
                    ? `Reported local port ${studioReport.connection.port} at ${studioReport.checkedAt.toLocaleTimeString()}. This check only reads the plugin’s reported address.`
                    : "No endpoint reported. Rojo may omit the address when Auto Connect Playtest Server is off."}
                </output>
              )}
              {checkMatchesSelection && studioCheck.error && (
                <p role="alert" className="text-xs text-destructive">
                  {errorMessage(studioCheck.error, "Couldn’t check the Studio connection.")}
                </p>
              )}
            </section>
          </div>
          <div className="mt-4 flex justify-end">
            <Dialog.Close type="button" className={secondaryButton}>
              Close
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
