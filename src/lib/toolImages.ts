export type ToolImageMime = "image/png" | "image/jpeg" | "image/webp";

export const COMPOSER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_COMPOSER_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_COMPOSER_IMAGES = 5;

export interface ComposerImage {
  dataUrl: string;
  mime: string;
  filename: string;
}

export type AddComposerImage = (image: ComposerImage) => boolean;

export function imageForComposer(dataUrl: string, filename: string): ComposerImage | undefined {
  const header = /^data:(image\/(?:png|jpeg|gif|webp));base64,/i.exec(dataUrl.slice(0, 32));
  if (!header) return undefined;
  const length = dataUrl.length - header[0].length;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  if (length === 0 || Math.floor((length * 3) / 4) - padding > MAX_COMPOSER_IMAGE_BYTES) {
    return undefined;
  }
  return { dataUrl, mime: header[1].toLowerCase(), filename };
}

export function isCaptureId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function toolImageMime(value: string): ToolImageMime | undefined {
  const mime = value.split(";", 1)[0]?.trim().toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") return mime;
}

export function imageDataUrlMime(url: string): ToolImageMime | undefined {
  // Image bytes can be large. Only inspect the data URL header here.
  const header = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(url.slice(0, 32));
  return header?.[1] ? toolImageMime(header[1]) : undefined;
}
