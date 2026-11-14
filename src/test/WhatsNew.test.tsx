import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsNew } from "@/components/WhatsNew";
import { desktop } from "@/lib/desktop";

function renderWhatsNew() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  render(
    <QueryClientProvider client={client}>
      <WhatsNew />
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: "Release history" });
}

describe("WhatsNew", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the title-bar button hidden after opening until a different version is installed", async () => {
    const getVersion = vi.spyOn(desktop, "getVersion").mockResolvedValue("0.16.4");
    vi.spyOn(desktop, "listReleaseHistory").mockResolvedValue([]);
    const renderTitleBar = () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={client}>
          <WhatsNew titleBar />
          <WhatsNew />
        </QueryClientProvider>,
      );
    };
    const first = renderTitleBar();
    fireEvent.click(await screen.findByRole("button", { name: "What’s new" }));
    await screen.findByText("No releases are available yet.");
    await vi.waitFor(async () => {
      expect((await desktop.loadConfig()).whatsNewSeenVersion).toBe("0.16.4");
    });
    fireEvent.click(screen.getByRole("button", { name: "Close release history" }));
    expect(screen.queryByRole("button", { name: "What’s new" })).not.toBeInTheDocument();
    first.unmount();
    const restarted = renderTitleBar();
    fireEvent.click(screen.getByRole("button", { name: "Release history" }));
    await screen.findByText("No releases are available yet.");
    fireEvent.click(screen.getByRole("button", { name: "Close release history" }));
    expect(screen.queryByRole("button", { name: "What’s new" })).not.toBeInTheDocument();
    restarted.unmount();
    getVersion.mockResolvedValue("0.16.5");
    renderTitleBar();
    expect(await screen.findByRole("button", { name: "What’s new" })).toBeVisible();
  });

  it("loads on demand and renders the release Markdown without installer links or embedded media", async () => {
    const fetchHistory = vi.spyOn(desktop, "listReleaseHistory").mockResolvedValue([
      {
        version: "v0.16.3",
        publishedAt: "2026-11-13T13:22:52Z",
        body: '## Download BloxBot\r\n\r\n- [Windows](https://example.com/app.exe)\r\n\r\n### Added\r\n\r\n- **Video attachments.** Use the `Tab` shortcut. [Learn more](https://example.com/video)\r\n\r\n![Preview](https://example.com/img.png)\r\n\r\n<iframe src="https://example.com"></iframe>',
        url: "https://github.com/Skithrills/app-bloxbot-ai/releases/tag/v0.16.3",
      },
      {
        version: "v0.15.5",
        publishedAt: "2026-11-13T02:33:15Z",
        body: "# First shared fork release\n\n## What's included\n\n- Animated cat mascot",
        url: "https://github.com/Skithrills/app-bloxbot-ai/releases/tag/v0.15.5",
      },
    ]);
    const trigger = renderWhatsNew();
    expect(fetchHistory).not.toHaveBeenCalled();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "What’s new" });
    expect(await within(dialog).findByRole("heading", { name: "Added" })).toBeVisible();
    expect(within(dialog).getByText("Video attachments.").tagName).toBe("STRONG");
    expect(within(dialog).getByText("Tab").tagName).toBe("CODE");
    expect(within(dialog).getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "https://example.com/video",
    );
    expect(within(dialog).getByText("Animated cat mascot").tagName).toBe("LI");
    expect(within(dialog).getByText("Video attachments.").closest("article")).toHaveTextContent(
      "v0.16.3",
    );
    expect(within(dialog).getByRole("link", { name: "View v0.15.5 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Skithrills/app-bloxbot-ai/releases/tag/v0.15.5",
    );
    expect(within(dialog).queryByRole("link", { name: "Windows" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
    expect(dialog.querySelector("iframe")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close release history" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(within(screen.getByRole("dialog")).getByText("Video attachments.")).toBeVisible();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps the GitHub link available on failure and supports retry", async () => {
    const fetchHistory = vi
      .spyOn(desktop, "listReleaseHistory")
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce([]);

    fireEvent.click(renderWhatsNew());
    expect(screen.getByRole("status")).toHaveTextContent("Loading release history");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load release history.");
    expect(screen.getByRole("link", { name: "Release history on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Skithrills/app-bloxbot-ai/releases",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No releases are available yet.")).toBeVisible();
    expect(fetchHistory).toHaveBeenCalledTimes(2);
  });
});
