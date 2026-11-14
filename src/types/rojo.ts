export const ROJO_HOST = "127.0.0.1";
export const ROJO_STANDALONE_PROJECT = "";

export function rojoManifestKey(projectId: string, projectFile: string): string {
  const file = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(projectFile)
    ? projectFile.replace(/\\/g, "/").toLowerCase()
    : projectFile;
  return JSON.stringify([projectId, file]);
}

export function rojoProjectFilesFor(
  settings:
    | {
        rojoProjectFiles?: Readonly<Record<string, string>>;
        rojoManifests?: Readonly<Record<string, readonly string[]>>;
      }
    | undefined,
  projectId: string,
): readonly string[] {
  const saved = settings?.rojoManifests?.[projectId];
  const legacy = settings?.rojoProjectFiles?.[projectId];
  return saved ?? (legacy ? [legacy] : []);
}

export interface StudioRojoConnection {
  port: number;
  placeId: string | null;
}

export interface RojoServer {
  projectId: string;
  projectFile: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  port: number | null;
  error: string | null;
  output: string;
  needsStop?: boolean;
}

export function isActiveRojoServer(server?: RojoServer): boolean {
  return (
    server?.needsStop === true ||
    server?.status === "starting" ||
    server?.status === "running" ||
    server?.status === "stopping"
  );
}
