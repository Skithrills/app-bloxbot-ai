import type { AppUpdater, UpdateCheckResult } from "electron-updater";
import type { AppUpdateCheck, ForkRelease } from "../src/types/appUpdate.js";

const repository = "Skithrills/app-bloxbot-ai";
const releasesApiUrl = `https://api.github.com/repos/${repository}/releases`;
const earliestReleaseTag = "v0.15.5";

function parseForkRelease(entry: unknown): ForkRelease | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const { tag_name, published_at, draft, prerelease, body } = entry as Record<string, unknown>;
  if (
    draft !== false ||
    prerelease !== false ||
    typeof tag_name !== "string" ||
    typeof published_at !== "string" ||
    !Number.isFinite(Date.parse(published_at))
  ) {
    return undefined;
  }

  const version = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag_name);
  if (!version) return undefined;
  const [, major, minor, patch] = version.map(Number);
  if (major === 0 && (minor < 15 || (minor === 15 && patch < 5))) return undefined;

  return {
    version: tag_name,
    publishedAt: published_at,
    body: typeof body === "string" ? body : "",
    url: `https://github.com/${repository}/releases/tag/${tag_name}`,
  };
}

export async function listReleaseHistory(
  fetchRelease: (url: string, init: RequestInit) => Promise<Response>,
): Promise<readonly ForkRelease[]> {
  const releases = new Map<string, ForkRelease>();
  const signal = AbortSignal.timeout(10_000);
  try {
    for (let page = 1; page <= 10; page++) {
      const response = await fetchRelease(`${releasesApiUrl}?per_page=30&page=${page}`, {
        headers: { accept: "application/vnd.github+json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

      const entries: unknown = await response.json();
      if (!Array.isArray(entries)) throw new Error("The GitHub response is missing its release list");
      for (const entry of entries) {
        const release = parseForkRelease(entry);
        if (release && !releases.has(release.version)) {
          releases.set(release.version, release);
        }
      }

      const hasNextPage = /;\s*rel="next"/.test(response.headers.get("link") ?? "");
      if (releases.has(earliestReleaseTag) || !hasNextPage) {
        return [...releases.values()].sort(
          (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
        );
      }
    }
    throw new Error("The release history exceeded the GitHub page limit");
  } catch (cause) {
    throw new Error("Could not load the BloxBot release history.", { cause });
  }
}

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
      const release = await fetchRelease(`${releasesApiUrl}/latest`, {
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
