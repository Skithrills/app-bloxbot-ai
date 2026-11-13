/**
 * Videos in the composer. Chat models take pictures, not video, so a video is sent as still frames
 * taken across its length, with a line of text saying which images they are and when they were
 * taken. Its sound isn't sent.
 */

export const MAX_COMPOSER_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_COMPOSER_VIDEOS = 2;
export const MAX_VIDEO_FRAMES = 16;
const MIN_VIDEO_FRAMES = 4;
/** Large enough to read a game's interface in a frame, and a fraction of a 1080p frame's size. */
const FRAME_EDGE = 1024;
const FRAME_QUALITY = 0.8;
const STEP_TIMEOUT_MS = 15_000;
/** Windows leaves the type of some recordings empty, so the name has to say what they are. */
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|ogv)$/i;

export interface VideoFrame {
  dataUrl: string;
  /** Seconds from the start of the video. */
  time: number;
}

export interface ComposerVideo {
  /** Seconds. */
  duration: number;
  frames: VideoFrame[];
  /** Where the file is on disk, when known. The model can read more of it, and the chat play it. */
  path?: string;
}

/** The address the chat plays a video on disk from. */
export function localVideoUrl(path: string): string {
  return `bloxbot-video://local/${encodeURIComponent(path)}`;
}

interface SendableAttachment {
  dataUrl: string;
  mime: string;
  filename: string;
  video?: ComposerVideo;
}

export function isVideoFile(file: Pick<File, "type" | "name">): boolean {
  return file.type.startsWith("video/") || (!file.type && VIDEO_EXTENSIONS.test(file.name));
}

export function isComposerVideo(value: unknown): value is ComposerVideo {
  if (typeof value !== "object" || value === null) return false;
  const { duration, frames } = value as Record<string, unknown>;
  return (
    typeof duration === "number" &&
    Array.isArray(frames) &&
    frames.length > 0 &&
    frames.every(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        typeof frame.dataUrl === "string" &&
        typeof frame.time === "number",
    )
  );
}

/** One frame a second from the middle of equal stretches, within the limits on how many. */
export function videoFrameTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const count = Math.min(MAX_VIDEO_FRAMES, Math.max(MIN_VIDEO_FRAMES, Math.round(duration)));
  return Array.from({ length: count }, (_, index) => ((index + 0.5) * duration) / count);
}

export function formatVideoLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Short clips are sampled more than once a second, so their times need a decimal. */
function formatFrameTime(seconds: number, duration: number): string {
  return duration < 60 ? `${seconds.toFixed(1)}s` : formatVideoLength(seconds);
}

function waitFor(video: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      video.removeEventListener(event, succeed);
      video.removeEventListener("error", fail);
      if (error) reject(error);
      else resolve();
    };
    const succeed = () => finish();
    const fail = () => finish(new Error(video.error?.message || "The video couldn't be decoded."));
    const timer = window.setTimeout(
      () => finish(new Error("The video took too long to read.")),
      STEP_TIMEOUT_MS,
    );
    video.addEventListener(event, succeed);
    video.addEventListener("error", fail);
  });
}

/** Decodes the video here in the app and takes stills from it. Nothing is uploaded to do this. */
export async function readVideoFrames(file: File): Promise<ComposerVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = waitFor(video, "loadeddata");
    video.src = url;
    await loaded;
    let { duration } = video;
    if (!Number.isFinite(duration)) {
      // Some recordings don't say how long they are until they are played to the end.
      const atEnd = waitFor(video, "seeked");
      video.currentTime = Number.MAX_SAFE_INTEGER;
      await atEnd;
      duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
    }
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) throw new Error("The video has no picture.");
    const scale = Math.min(1, FRAME_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The video's frames couldn't be drawn.");

    const frames: VideoFrame[] = [];
    for (const time of videoFrameTimes(duration)) {
      const seeked = waitFor(video, "seeked");
      video.currentTime = time;
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ dataUrl: canvas.toDataURL("image/jpeg", FRAME_QUALITY), time });
    }
    return { duration, frames };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** The frame that stands for the video where only one picture fits. */
export function videoPoster(video: ComposerVideo): string {
  return video.frames[Math.floor(video.frames.length / 2)].dataUrl;
}

const NOTE_PATTERN =
  /\[Video "([^"\n]*)" \((\d+:\d{2})(?:, file "([^"\n]*)")?\): attached images? (\d+)(?:–(\d+))? (?:are still frames|is a still frame) from it, taken at [^\]\n]*?\. Its audio is not included\.(?: Read the file for other moments, more frames or the audio\.)?\]/g;

function videoNote(name: string, video: ComposerVideo, first: number): string {
  const last = first + video.frames.length - 1;
  const images =
    last > first
      ? `attached images ${first}–${last} are still frames`
      : `attached image ${first} is a still frame`;
  const times = video.frames.map(({ time }) => formatFrameTime(time, video.duration)).join(", ");
  // The name is quoted inside brackets, so it can't hold what would end either early.
  const label = name.replace(/["\]\n]/g, "'");
  // With the file's place on disk, a model with a shell can take its own frames from it.
  const file = video.path && !/["\n]/.test(video.path) ? video.path : undefined;
  return `[Video "${label}" (${formatVideoLength(video.duration)}${file ? `, file "${file}"` : ""}): ${images} from it, taken at ${times}. Its audio is not included.${file ? " Read the file for other moments, more frames or the audio." : ""}]`;
}

/**
 * What goes to the model for a draft's attachments: every image, with each video replaced by its
 * frames, and one note per video to send as text.
 */
export function attachmentsToSend(attachments: readonly SendableAttachment[]): {
  images: Array<{ mime: string; url: string; filename: string }>;
  notes: string[];
} {
  const images: Array<{ mime: string; url: string; filename: string }> = [];
  const notes: string[] = [];
  for (const attachment of attachments) {
    const { video } = attachment;
    if (!video) {
      images.push({
        mime: attachment.mime,
        url: attachment.dataUrl,
        filename: attachment.filename,
      });
      continue;
    }
    notes.push(videoNote(attachment.filename, video, images.length + 1));
    const digits = String(video.frames.length).length;
    for (const [index, frame] of video.frames.entries()) {
      images.push({
        mime: "image/jpeg",
        url: frame.dataUrl,
        filename: `${attachment.filename} frame ${String(index + 1).padStart(digits, "0")}.jpg`,
      });
    }
  }
  return { images, notes };
}

export interface SentVideo {
  name: string;
  /** As written in the note, like "0:08". */
  length: string;
  /** Where the file was on disk when it was sent, if the note says. */
  path?: string;
  /** Which of the message's images are its frames, counted from zero, last one included. */
  first: number;
  last: number;
}

/** The notes in a sent message's text, as they were written, to send its videos' frames again. */
export function videoNotesIn(text: string): string[] {
  return text.match(NOTE_PATTERN) ?? [];
}

/** Takes the notes {@link attachmentsToSend} wrote back out of a sent message's text. */
export function splitVideoNotes(text: string): { text: string; videos: SentVideo[] } {
  const videos: SentVideo[] = [];
  const rest = text.replace(
    NOTE_PATTERN,
    (_note, name: string, length: string, path: string | undefined, from, to) => {
      const first = Number(from) - 1;
      videos.push({
        name,
        length,
        ...(path && { path }),
        first,
        last: to ? Number(to) - 1 : first,
      });
      return "";
    },
  );
  return videos.length > 0 ? { text: rest.trim(), videos } : { text, videos };
}
