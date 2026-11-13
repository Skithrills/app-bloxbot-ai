import { Blob as NodeBlob } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightboxProvider, ImageThumbnails } from "@/components/ImageLightbox";
import { desktop } from "@/lib/desktop";
import { normalizeStudioToolImages } from "../../electron/services/ToolImages";

const pixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=";
const dataUrl = `data:image/png;base64,${pixel}`;
const image = { type: "image", mimeType: "image/png", data: pixel } as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Studio tool image results", () => {
  it("keeps native image and model results and converts a standalone image data URL", async () => {
    const model = { type: "text", text: "file:///work/models/Crate.glb" } as const;
    const result = await normalizeStudioToolImages("inspect_place", {
      content: [model, image, { type: "text", text: dataUrl }, { ...image, data: dataUrl }],
    });
    expect(result.content).toEqual([model, image, image, image]);
  });

  it("copies bytes from a capture path and typed image link within the capture root", async () => {
    const root = await mkdtemp(join(tmpdir(), "bloxbot-tool-image-"));
    try {
      const capture = join(root, "Screen Capture.png");
      await writeFile(capture, Buffer.from(pixel, "base64"));
      const text = { type: "text", text: capture } as const;
      expect(
        await normalizeStudioToolImages("screen_capture", { content: [text] }, [root]),
      ).toEqual({ content: [text, image] });
      const link = {
        type: "resource_link",
        name: "capture",
        mimeType: "image/png",
        uri: pathToFileURL(capture).href,
      } as const;
      expect(
        await normalizeStudioToolImages("other_vision_tool", { content: [link] }, [root]),
      ).toEqual({ content: [image] });
      expect(await normalizeStudioToolImages("other_tool", { content: [text] }, [root])).toEqual({
        content: [text],
      });
      const otherRoot = join(root, "restricted");
      await mkdir(otherRoot);
      expect(
        await normalizeStudioToolImages("screen_capture", { content: [text] }, [otherRoot]),
      ).toEqual({ content: [text] });
      expect(await readFile(capture)).toEqual(Buffer.from(pixel, "base64"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("tool image lightbox", () => {
  it("copies and saves PNG bytes from the image context menu", async () => {
    const png = Uint8Array.from(Buffer.from(pixel, "base64"));
    const exportToolImage = vi.spyOn(desktop, "exportToolImage").mockResolvedValue(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(new NodeBlob([png]) as unknown as Blob),
    );
    render(
      <ImageLightboxProvider>
        <ImageThumbnails images={[{ id: "capture", name: "Viewport", src: dataUrl }]} />
      </ImageLightboxProvider>,
    );
    const thumbnail = screen.getByRole("img", { name: "Viewport" });
    Object.defineProperties(thumbnail, {
      naturalWidth: { value: 2 },
      naturalHeight: { value: 1 },
    });
    for (const [label, action] of [
      ["Copy Image", "copy"],
      ["Save Image as PNG", "save"],
    ]) {
      fireEvent.contextMenu(thumbnail);
      fireEvent.click(await screen.findByRole("menuitem", { name: label }));
      await waitFor(() =>
        expect(exportToolImage).toHaveBeenLastCalledWith({ action, png, filename: "Viewport" }),
      );
    }
  });

  it("opens the correct transcript's image and exposes capture metadata and zoom", () => {
    const timestamp = Date.UTC(2026, 10, 12, 7, 30);
    render(
      <>
        <ImageLightboxProvider>
          <ImageThumbnails
            images={[
              {
                id: "main-capture",
                name: "Screen capture",
                src: dataUrl,
                capture: { timestamp, arguments: { capture_id: "ScreenCapture_1" } },
              },
            ]}
          />
        </ImageLightboxProvider>
        <ImageLightboxProvider>
          <ImageThumbnails
            images={[{ id: "child-capture", name: "Child capture", src: dataUrl }]}
          />
        </ImageLightboxProvider>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Screen capture" }));
    const dialog = within(screen.getByRole("dialog", { name: "Screen capture" }));
    const photo = dialog.getByRole("img", { name: "Screen capture" });
    Object.defineProperties(photo, {
      naturalWidth: { value: 1920 },
      naturalHeight: { value: 1080 },
      clientWidth: { value: 960 },
      clientHeight: { value: 540 },
    });
    fireEvent.load(photo);
    expect(photo).toHaveAttribute("src", dataUrl);
    expect(dialog.getByText("1920 × 1080 px")).toBeVisible();
    expect(dialog.getByText(new Date(timestamp).toLocaleString())).toHaveAttribute(
      "datetime",
      new Date(timestamp).toISOString(),
    );
    expect(dialog.getByText("Tool arguments")).toBeVisible();
    expect(dialog.getByText(/ScreenCapture_1/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Zoom in" }));
    expect(photo).toHaveStyle({ width: "1200px", height: "675px" });
    expect(dialog.getByRole("button", { name: "Copy Image" })).toBeEnabled();
    expect(dialog.getByRole("button", { name: "Save PNG" })).toBeEnabled();
    fireEvent.click(dialog.getByRole("button", { name: "Close image" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Child capture" }));
    expect(screen.getByRole("dialog", { name: "Child capture" })).toBeVisible();
  });
});
