import { describe, expect, it, vi } from "vitest";
import { listReleaseHistory } from "../../electron/appUpdater";

function githubRelease(tag: string, publishedAt = "2026-11-13T02:33:15Z") {
  return {
    tag_name: tag,
    published_at: publishedAt,
    body: "### Added\n\n- Release notes",
    html_url: "https://example.com/ignored",
    draft: false,
    prerelease: false,
  };
}

describe("listReleaseHistory", () => {
  it("collects only published stable fork releases down to v0.15.5 across pages", async () => {
    const fetchRelease = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          [
            githubRelease("v0.16.0", "2026-11-13T03:15:22Z"),
            githubRelease("v0.16.3", "2026-11-13T13:22:52Z"),
            { ...githubRelease("v0.16.4"), draft: true },
            { ...githubRelease("v0.16.5"), prerelease: true },
            { ...githubRelease("v0.16.6"), published_at: null },
            githubRelease("v0.16.7-rc.1"),
          ],
          { headers: { link: '<https://example.com/ignored>; rel="next"' } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          [githubRelease("v0.15.5"), githubRelease("v0.15.4"), githubRelease("v0.6.0")],
          { headers: { link: '<https://example.com/ignored>; rel="next"' } },
        ),
      );

    const history = await listReleaseHistory(fetchRelease);

    expect(history.map(({ version }) => version)).toEqual(["v0.16.3", "v0.16.0", "v0.15.5"]);
    expect(history[0]).toEqual({
      version: "v0.16.3",
      publishedAt: "2026-11-13T13:22:52Z",
      body: "### Added\n\n- Release notes",
      url: "https://github.com/Skithrills/app-bloxbot-ai/releases/tag/v0.16.3",
    });
    expect(fetchRelease.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/Skithrills/app-bloxbot-ai/releases?per_page=30&page=1",
      "https://api.github.com/repos/Skithrills/app-bloxbot-ai/releases?per_page=30&page=2",
    ]);
  });

  it("reports GitHub errors rather than presenting an empty release history", async () => {
    const fetchRelease = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(listReleaseHistory(fetchRelease)).rejects.toThrow(
      "Could not load the BloxBot release history.",
    );
  });
});
