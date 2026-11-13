import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachmentsToSend, localVideoUrl, splitVideoNotes } from "@/lib/composerVideos";
import { localVideoPath, serveLocalVideo } from "../../electron/localVideo";

let folder: string;
let clip: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "bloxbot-video-"));
  clip = join(folder, "my clip (1).mp4");
  await writeFile(clip, "0123456789");
  await writeFile(join(folder, "notes.txt"), "secret");
});

afterAll(() => rm(folder, { recursive: true, force: true }));

describe("local video playback", () => {
  it("names only video files on this disk", () => {
    expect(localVideoPath(localVideoUrl(clip))).toBe(clip);
    expect(localVideoPath(localVideoUrl(join(folder, "notes.txt")))).toBeNull();
    expect(localVideoPath(localVideoUrl("clip.mp4"))).toBeNull();
    expect(localVideoPath(`bloxbot-video://elsewhere/${encodeURIComponent(clip)}`)).toBeNull();
    expect(localVideoPath(`https://local/${encodeURIComponent(clip)}`)).toBeNull();
    expect(localVideoPath("not a url")).toBeNull();
  });

  it("serves the whole file, or the range of bytes a player asks for", async () => {
    const whole = await serveLocalVideo(new Request(localVideoUrl(clip)));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(await whole.text()).toBe("0123456789");

    const ranged = (range: string) =>
      serveLocalVideo(new Request(localVideoUrl(clip), { headers: { range } }));
    const middle = await ranged("bytes=2-5");
    expect(middle.status).toBe(206);
    expect(middle.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(middle.headers.get("content-length")).toBe("4");
    expect(await middle.text()).toBe("2345");
    expect(await (await ranged("bytes=7-")).text()).toBe("789");
    expect(await (await ranged("bytes=-3")).text()).toBe("789");
    expect(await (await ranged("bytes=8-99")).text()).toBe("89");
    const past = await ranged("bytes=50-60");
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");
  });

  it("answers 404 for a file that is gone or isn't a video", async () => {
    const missing = new Request(localVideoUrl(join(folder, "gone.mp4")));
    expect((await serveLocalVideo(missing)).status).toBe(404);
    const other = new Request(localVideoUrl(join(folder, "notes.txt")));
    expect((await serveLocalVideo(other)).status).toBe(404);
  });

  it("tells the model where the file is and reads that back for the player", () => {
    const frames = [{ dataUrl: "data:image/jpeg;base64,AA==", time: 1 }];
    const [note] = attachmentsToSend([
      {
        dataUrl: "",
        mime: "video/mp4",
        filename: "my clip (1).mp4",
        video: { duration: 2, frames, path: clip },
      },
    ]).notes;
    expect(note).toBe(
      `[Video "my clip (1).mp4" (0:02, file "${clip}"): attached image 1 is a still frame from it, taken at 1.0s. Its audio is not included. Read the file for other moments, more frames or the audio.]`,
    );
    expect(splitVideoNotes(`Look\n\n${note}`)).toEqual({
      text: "Look",
      videos: [{ name: "my clip (1).mp4", length: "0:02", path: clip, first: 0, last: 0 }],
    });
  });
});
