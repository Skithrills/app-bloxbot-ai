import { Blob as NodeBlob } from "node:buffer";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLightboxProvider, ImageThumbnails } from "@/components/ImageLightbox";
import { readVideoSound } from "@/components/VideoPlayer";
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

  it("plays a sent video with BloxBot's controls, and steps between it and images in one gallery", async () => {
    localStorage.clear();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (
      this: HTMLMediaElement,
    ) {
      fireEvent.play(this);
    });
    const frame = (id: string) => ({ id, name: `${id}.jpg`, src: dataUrl });
    const { container } = render(
      <ImageLightboxProvider>
        <ImageThumbnails
          images={[{ id: "notes", name: "notes.png", src: dataUrl }]}
          videos={[
            {
              name: "clip.mp4",
              length: "0:08",
              src: "bloxbot-video://local/C%3A%5Cclips%5Cclip.mp4",
              frames: [frame("f1"), frame("f2")],
            },
            // Its file's place isn't known, so its frames are what there is to open.
            { name: "old.mp4", length: "0:03", frames: [frame("g1")] },
          ]}
        />
      </ImageLightboxProvider>,
    );
    const inline = container.querySelector("video");
    expect(inline).toHaveAttribute("src", "bloxbot-video://local/C%3A%5Cclips%5Cclip.mp4");
    // The browser's own controls stay off. These are the app's.
    expect(inline).not.toHaveAttribute("controls");
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    if (!inline) throw new Error("Expected a video");
    fireEvent.pause(inline);

    // Videos start silent. Turning the sound on, and how loud, is kept for the next one.
    expect(inline.muted).toBe(true);
    const volume = screen.getByRole("slider", { name: "Volume" });
    expect(volume).toHaveAttribute("aria-valuetext", "Muted");
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(inline.muted).toBe(false);
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(volume, { target: { value: "0.4" } });
    expect(inline.volume).toBeCloseTo(0.4);
    expect(volume).toHaveAttribute("aria-valuetext", "40%");
    expect(readVideoSound()).toEqual({ volume: 0.4, muted: false });
    fireEvent.keyDown(volume, { key: "ArrowUp" });
    expect(readVideoSound().volume).toBeCloseTo(0.5);
    // Dragged down to nothing is muted, and unmuting from there comes back audible.
    fireEvent.change(volume, { target: { value: "0" } });
    expect(readVideoSound()).toEqual({ volume: 0, muted: true });
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(readVideoSound()).toEqual({ volume: 0.5, muted: false });
    expect(screen.getByRole("button", { name: "Open old.mp4, 1 frames" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open clip.mp4" }));
    const dialog = within(screen.getByRole("dialog", { name: "clip.mp4" }));
    // The next video opens with the sound as it was left.
    expect(screen.getByRole("dialog").querySelector("video")?.volume).toBeCloseTo(0.5);
    expect(dialog.getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "50%");
    expect(dialog.getByText("1 / 2")).toBeVisible();
    expect(dialog.getByRole("button", { name: "Full screen" })).toBeVisible();
    expect(dialog.getByRole("button", { name: "Playback speed, 1×" })).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Playback speed, 1×" }));
    expect(dialog.getByRole("button", { name: "Playback speed, 1.5×" })).toBeVisible();
    // Arrow keys inside the player move through the video, and not on to the next attachment.
    fireEvent.keyDown(dialog.getByRole("slider", { name: "Seek" }), { key: "ArrowRight" });
    expect(dialog.getByText("1 / 2")).toBeVisible();
    fireEvent.click(dialog.getByRole("button", { name: "Next image" }));
    const next = within(screen.getByRole("dialog", { name: "notes.png" }));
    expect(next.getByText("2 / 2")).toBeVisible();
    expect(next.getByRole("img", { name: "notes.png" })).toBeVisible();
    fireEvent.click(next.getByRole("button", { name: "Previous image" }));
    expect(screen.getByRole("dialog", { name: "clip.mp4" })).toBeVisible();

    // Right-clicking the picture saves a copy of the video from where it is on disk.
    const saveVideo = vi.spyOn(desktop, "saveVideo").mockResolvedValue(true);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Play clip.mp4" }));
    expect(await screen.findByRole("menuitem", { name: "Copy Frame" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Save Frame as PNG" })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: "Save Video As…" }));
    await waitFor(() =>
      expect(saveVideo).toHaveBeenCalledExactlyOnceWith(
        "bloxbot-video://local/C%3A%5Cclips%5Cclip.mp4",
      ),
    );

    // Once the file has gone, the frame that stood for the video is shown in its place.
    const playing = screen.getByRole("dialog").querySelector("video");
    if (!playing) throw new Error("Expected the gallery's video");
    fireEvent.error(playing);
    expect(screen.getByText(/file has moved or been deleted/)).toBeVisible();
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
