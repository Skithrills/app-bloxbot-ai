import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { Readable } from "node:stream";

/** Plays a video from the user's disk in the chat: bloxbot-video://local/<encoded path>. */
export const LOCAL_VIDEO_SCHEME = "bloxbot-video";

const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
};

/** The file a player's address names, or null for anything that isn't a video on this disk. */
export function localVideoPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${LOCAL_VIDEO_SCHEME}:` || parsed.hostname !== "local") return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    return null;
  }
  return isAbsolute(path) && extname(path).toLowerCase() in VIDEO_TYPES ? path : null;
}

/** What a save dialog offers for a copy of the video: its own name, and its own kind of file. */
export function videoSaveOptions(path: string) {
  const extension = extname(path).slice(1).toLowerCase();
  return {
    defaultPath: basename(path),
    filters: [{ name: `${extension.toUpperCase()} video`, extensions: [extension] }],
  };
}

/**
 * Serves the file a piece at a time. A player asks for ranges of bytes to start quickly and to
 * seek, so each answer covers only the range it was asked for.
 */
export async function serveLocalVideo(request: Request): Promise<Response> {
  const path = localVideoPath(request.url);
  if (!path) return new Response(null, { status: 404 });
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return new Response(null, { status: 404 });
    size = info.size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const headers = {
    "Content-Type": VIDEO_TYPES[extname(path).toLowerCase()],
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    // Lets the player copy the frame it is showing. Only the app's own pages can ask here.
    "Access-Control-Allow-Origin": "*",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (!range || (!range[1] && !range[2])) {
    const body = size > 0 ? createReadStream(path) : null;
    return new Response(body && (Readable.toWeb(body) as ReadableStream), {
      status: 200,
      headers: { ...headers, "Content-Length": String(size) },
    });
  }
  // "-500" is the last 500 bytes, and "500-" is everything from byte 500 on.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${size}` },
    });
  }
  return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}
