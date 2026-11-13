import type { AppUpdater, UpdateCheckResult } from "electron-updater";
import type { AppUpdateCheck } from "../src/types/appUpdate.js";

const latestReleaseUrl = "https://api.github.com/repos/Skithrills/app-bloxbot-ai/releases/latest";

export async function checkForAppUpdate(
  checkForUpdates: () => Promise<Pick<UpdateCheckResult, "isUpdateAvailable" | "updateInfo"> | null>,
  fetchRelease: (url: string, init: RequestInit) => Promise<Pick<Response, "status">>,
): Promise<AppUpdateCheck> {
  let result: Awaited<ReturnType<typeof checkForUpdates>>;
  try {
    result = await checkForUpdates();
  } catch (cause) {
    const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
    if (code === "ENOENT") {
      throw new Error(
        "This BloxBot build is missing its update configuration. Install the latest BloxBot release from Skithrills/app-bloxbot-ai.",
        { cause },
      );
    }
    if (code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND") {
      throw new Error(
        "The latest BloxBot release is missing the update metadata for this platform.",
        { cause },
      );
    }
    // GitHub's Atom feed can contain Git tags even before a GitHub release is published.
    if (
      code === "ERR_UPDATER_INVALID_RELEASE_FEED" ||
      code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" ||
      code === "ERR_UPDATER_NO_PUBLISHED_VERSIONS" ||
      (code === "ERR_XML_MISSED_ELEMENT" &&
        cause instanceof Error &&
        cause.message === "No published versions on GitHub")
    ) {
      const release = await fetchRelease(latestReleaseUrl, {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
      if (release?.status === 404) {
        return { status: "no-releases" };
      }
    }
    throw new Error("Could not check the BloxBot fork for updates. Try again later.", { cause });
  }
  if (!result) return { status: "unsupported" };
  const { version, releaseNotes } = result.updateInfo;
  if (!result.isUpdateAvailable) return { status: "up-to-date", version };
  return {
    status: "available",
    update: { version, body: typeof releaseNotes === "string" ? releaseNotes : null },
  };
}

export async function installAppUpdate(
  updater: Pick<AppUpdater, "downloadUpdate" | "quitAndInstall"> & {
    once(event: "error", listener: (error: Error) => void): void;
    removeListener(event: "error", listener: (error: Error) => void): void;
  },
): Promise<void> {
  try {
    await updater.downloadUpdate();
  } catch (cause) {
    throw new Error("Could not download the BloxBot update. Try again.", { cause });
  }

  // The Windows installer reports launch failures synchronously through the error event.
  let installError: Error | undefined;
  const onError = (error: Error) => {
    installError = error;
  };
  updater.once("error", onError);
  try {
    updater.quitAndInstall(false, true);
    if (installError) throw installError;
  } catch (cause) {
    throw new Error("Could not start the BloxBot installer. Try again.", { cause });
  } finally {
    updater.removeListener("error", onError);
  }
}
