import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult, ImageContent } from "@modelcontextprotocol/sdk/types.js";

import { imageDataUrlMime, toolImageMime, type ToolImageMime } from "../../src/lib/toolImages";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const FILE_MIMES: Readonly<Partial<Record<string, ToolImageMime>>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function matchesImage(bytes: Buffer, mime: ToolImageMime): boolean {
  switch (mime) {
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp":
      return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  }
}

function base64Image(data: string, mime: ToolImageMime): ImageContent | undefined {
  if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return;
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_IMAGE_BYTES || !matchesImage(bytes, mime)) return;
  return { type: "image", mimeType: mime, data };
}

function dataUrlImage(url: string): ImageContent | undefined {
  const mime = imageDataUrlMime(url);
  if (mime) return base64Image(url.slice(url.indexOf(",") + 1), mime);
}

function isWithin(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix !== "" && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

async function pathImage(
  reference: string,
  roots: readonly string[],
  expectedMime?: ToolImageMime,
): Promise<ImageContent | undefined> {
  if (reference.length > 4096 || /[\r\n\0]/.test(reference)) return;
  try {
    let path = reference;
    if (/^file:/i.test(reference)) {
      const url = new URL(reference);
      if (url.hostname || url.search || url.hash) return;
      path = fileURLToPath(url);
    }
    if (!isAbsolute(path) || /^[\\/]{2}/.test(path)) return;
    const mime = FILE_MIMES[extname(path).toLowerCase()];
    if (!mime || (expectedMime && expectedMime !== mime)) return;
    const canonicalRoots = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
    if (![...roots, ...canonicalRoots].some((root) => isWithin(root, path))) return;
    const canonical = await realpath(path);
    if (!canonicalRoots.some((root) => isWithin(root, canonical))) return;

    const file = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_IMAGE_BYTES) return;
      const bytes = Buffer.alloc(stats.size);
      for (let offset = 0; offset < bytes.length; ) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) return;
        offset += bytesRead;
      }
      if (matchesImage(bytes, mime)) {
        return { type: "image", mimeType: mime, data: bytes.toString("base64") };
      }
    } finally {
      await file.close();
    }
  } catch {
    // A missing or inaccessible producer file still leaves the tool's original result intact.
    return;
  }
}

async function resultImage(
  value: Record<string, unknown>,
  roots: readonly string[],
  capture: boolean,
): Promise<ImageContent | undefined> {
  const declared = value.mimeType;
  const mime = typeof declared === "string" ? toolImageMime(declared) : undefined;
  if (typeof declared === "string" && !mime) return;
  if (value.type === "image" && mime && typeof value.data === "string") {
    return base64Image(value.data, mime);
  }
  if (!mime && !capture) return;
  const reference = value.uri ?? value.url ?? value.path ?? value.filePath ?? value.screenshotPath;
  if (typeof reference !== "string") return;
  const inline = dataUrlImage(reference);
  if (inline && (!mime || inline.mimeType === mime)) return inline;
  return pathImage(reference, roots, mime);
}

/** Imports producer-owned images into OpenCode's canonical session content. */
export async function normalizeStudioToolImages(
  tool: string,
  result: CallToolResult,
  roots: readonly string[] = [tmpdir()],
): Promise<CallToolResult> {
  if (result.isError) return result;
  const capture = tool === "screen_capture";
  const content: CallToolResult["content"] = [];
  for (const block of result.content) {
    if (block.type === "text") {
      const value = block.text.trim();
      const inline = dataUrlImage(value);
      if (inline) {
        content.push(inline);
        continue;
      }
      content.push(block);
      if (capture) {
        const image = await pathImage(value, roots);
        if (image) content.push(image);
      }
    } else if (block.type === "resource_link") {
      const image = await resultImage(block, roots, capture);
      content.push(image ?? block);
    } else if (block.type === "image") {
      const image = dataUrlImage(block.data);
      content.push(
        image && image.mimeType === toolImageMime(block.mimeType) ? { ...block, data: image.data } : block,
      );
    } else {
      content.push(block);
    }
  }
  if (result.structuredContent && !content.some((block) => block.type === "image")) {
    const image = await resultImage(result.structuredContent, roots, capture);
    if (image) content.push(image);
  }
  return { ...result, content };
}
