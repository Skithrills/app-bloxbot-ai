import { describe, expect, it } from "vitest";
import {
  attachmentsToSend,
  isComposerVideo,
  isVideoFile,
  MAX_VIDEO_FRAMES,
  splitVideoNotes,
  videoFrameTimes,
} from "@/lib/composerVideos";

const frame = (time: number) => ({ dataUrl: `data:image/jpeg;base64,${time}`, time });

describe("composer videos", () => {
  it("recognises videos by type, and by name when Windows gives no type", () => {
    expect(isVideoFile({ type: "video/mp4", name: "clip.mp4" })).toBe(true);
    expect(isVideoFile({ type: "", name: "Recording.MKV" })).toBe(true);
    expect(isVideoFile({ type: "image/png", name: "clip.mp4" })).toBe(false);
    expect(isVideoFile({ type: "", name: "notes.txt" })).toBe(false);
  });

  it("takes a frame a second from the middle of equal stretches, within its limits", () => {
    expect(videoFrameTimes(8)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
    // A short clip still gets enough frames to show movement, and a long one doesn't get more.
    expect(videoFrameTimes(1)).toEqual([0.125, 0.375, 0.625, 0.875]);
    const long = videoFrameTimes(600);
    expect(long).toHaveLength(MAX_VIDEO_FRAMES);
    expect(long[0]).toBe(18.75);
    expect(long[long.length - 1]).toBeLessThan(600);
    expect(videoFrameTimes(Number.NaN)).toEqual([0]);
    expect(videoFrameTimes(0)).toEqual([0]);
  });

  it("sends a video as its frames with a note saying which images they are", () => {
    const image = { dataUrl: "data:image/png;base64,AA==", mime: "image/png", filename: "a.png" };
    const video = {
      dataUrl: "poster",
      mime: "video/mp4",
      filename: 'my "best" clip].mp4',
      video: { duration: 7.75, frames: [frame(1), frame(3), frame(5)] },
    };
    const single = {
      dataUrl: "poster",
      mime: "video/webm",
      filename: "long.webm",
      video: { duration: 125, frames: [frame(62.5)] },
    };
    const { images, notes } = attachmentsToSend([image, video, single]);
    expect(images.map(({ mime, filename }) => [mime, filename])).toEqual([
      ["image/png", "a.png"],
      ["image/jpeg", 'my "best" clip].mp4 frame 1.jpg'],
      ["image/jpeg", 'my "best" clip].mp4 frame 2.jpg'],
      ["image/jpeg", 'my "best" clip].mp4 frame 3.jpg'],
      ["image/jpeg", "long.webm frame 1.jpg"],
    ]);
    expect(images[1].url).toBe(frame(1).dataUrl);
    expect(notes).toEqual([
      "[Video \"my 'best' clip'.mp4\" (0:08): attached images 2–4 are still frames from it, taken at 1.0s, 3.0s, 5.0s. Its audio is not included.]",
      '[Video "long.webm" (2:05): attached image 5 is a still frame from it, taken at 1:03. Its audio is not included.]',
    ]);

    // What was sent reads back as the message and which of its images are each video's frames.
    expect(splitVideoNotes(`What happens here?\n\n${notes.join("\n\n")}`)).toEqual({
      text: "What happens here?",
      videos: [
        { name: "my 'best' clip'.mp4", length: "0:08", first: 1, last: 3 },
        { name: "long.webm", length: "2:05", first: 4, last: 4 },
      ],
    });
    expect(splitVideoNotes("  Just text [Video]  ")).toEqual({
      text: "  Just text [Video]  ",
      videos: [],
    });
    expect(attachmentsToSend([image])).toEqual({
      images: [{ mime: "image/png", url: image.dataUrl, filename: "a.png" }],
      notes: [],
    });
  });

  it("only restores a stored video that still has its frames", () => {
    expect(isComposerVideo({ duration: 2, frames: [frame(1)] })).toBe(true);
    expect(isComposerVideo({ duration: 2, frames: [] })).toBe(false);
    expect(isComposerVideo({ duration: "2", frames: [frame(1)] })).toBe(false);
    expect(isComposerVideo({ duration: 2, frames: [{ dataUrl: 5, time: 1 }] })).toBe(false);
    expect(isComposerVideo(null)).toBe(false);
  });
});
