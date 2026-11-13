import { ChevronLeft, ChevronRight, Copy, Download, Minus, Paperclip, Plus, X } from "lucide-react";
import { ContextMenu, Dialog, HoverCard } from "radix-ui";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";
import { type AddComposerImage, imageForComposer } from "@/lib/toolImages";
import type { ToolImageExport } from "@/types/desktop";

export interface LightboxImage {
  id: string;
  src: string;
  name: string;
  label?: string;
  captureId?: string;
  capture?: { timestamp: number; arguments: Record<string, unknown> };
}

interface Gallery {
  images: readonly LightboxImage[];
  index: number;
  trigger: HTMLButtonElement;
}

const OpenGallery = createContext<((gallery: Gallery) => void) | null>(null);
const AddImageToComposer = createContext<AddComposerImage | undefined>(undefined);

const buttonClass =
  "inline-flex min-h-8 shrink-0 items-center justify-center rounded-md border px-2 text-sm hover:bg-muted disabled:opacity-40";
const zoomLevels = [1, 1.25, 1.5, 2, 3, 4];

async function toPng(image: HTMLImageElement): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't encode the image");
  context.drawImage(image, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Couldn't encode the image"));
    }, "image/png");
  });
  return new Uint8Array(await png.arrayBuffer());
}

async function exportImage(
  image: HTMLImageElement,
  filename: string,
  action: ToolImageExport["action"],
) {
  try {
    if (!image.naturalWidth) await image.decode();
    const png = await toPng(image);
    const saved = await desktop.exportToolImage({ action, png, filename });
    if (saved) notify.success(action === "copy" ? "Image copied" : "PNG saved");
  } catch {
    notify.error(action === "copy" ? "Couldn't copy the image" : "Couldn't save the PNG");
  }
}

const imageMenuItem =
  "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

function ImageContextMenu({ image, children }: { image: LightboxImage; children: ReactElement }) {
  const addImage = useContext(AddImageToComposer);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const exportFromMenu = (action: ToolImageExport["action"]) => {
    const trigger = triggerRef.current;
    const photo = trigger instanceof HTMLImageElement ? trigger : trigger?.querySelector("img");
    if (photo) void exportImage(photo, image.name, action);
  };
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild ref={triggerRef}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={8}
          className="z-[120] min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <ContextMenu.Item className={imageMenuItem} onSelect={() => exportFromMenu("copy")}>
            <Copy size={14} aria-hidden /> Copy Image
          </ContextMenu.Item>
          <ContextMenu.Item className={imageMenuItem} onSelect={() => exportFromMenu("save")}>
            <Download size={14} aria-hidden /> Save Image as PNG
          </ContextMenu.Item>
          {addImage && (
            <ContextMenu.Item
              className={imageMenuItem}
              onSelect={() => {
                const attachment = imageForComposer(image.src, image.name);
                if (attachment) addImage(attachment);
                else
                  notify.error(
                    "Couldn't attach this image. Use a PNG, JPEG, GIF, or WebP under 20 MB.",
                  );
              }}
            >
              <Paperclip size={14} aria-hidden /> Add to Chat
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ImageViewer({ image }: { image: LightboxImage }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [resolution, setResolution] = useState<{ width: number; height: number }>();
  const [fit, setFit] = useState<{ width: number; height: number }>();
  const [level, setLevel] = useState(0);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const zoom = zoomLevels[level] ?? 1;
  const date = image.capture ? new Date(image.capture.timestamp) : undefined;

  function changeZoom(next: number) {
    if (level === 0 && imageRef.current) {
      const { clientWidth, clientHeight } = imageRef.current;
      setFit({ width: clientWidth, height: clientHeight });
    }
    setLevel(next);
  }

  async function exportFromLightbox(action: ToolImageExport["action"]) {
    if (!imageRef.current || exporting) return;
    setExporting(true);
    try {
      await exportImage(imageRef.current, image.name, action);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <section
        aria-label="Image preview"
        className="min-h-0 overflow-auto rounded-md bg-black/70"
        data-image-viewport
      >
        <div className="flex min-h-full min-w-full">
          <ImageContextMenu image={image}>
            <img
              ref={imageRef}
              src={image.src}
              alt={image.name}
              className={`m-auto block shrink-0 object-contain ${level === 0 ? "max-h-[62vh] max-w-full" : "max-w-none"} ${failed ? "hidden" : ""}`}
              style={
                level > 0 && fit
                  ? { width: fit.width * zoom, height: fit.height * zoom }
                  : undefined
              }
              onLoad={({ currentTarget }) =>
                setResolution({
                  width: currentTarget.naturalWidth,
                  height: currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
            />
          </ImageContextMenu>
          {failed && <p className="m-auto p-6 text-sm text-white">Image unavailable</p>}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex items-center gap-1" aria-label="Image zoom">
          <button
            aria-label="Zoom out"
            className={buttonClass}
            type="button"
            disabled={level === 0 || !resolution}
            onClick={() => changeZoom(level - 1)}
          >
            <Minus size={16} aria-hidden />
          </button>
          <button
            aria-label="Reset zoom"
            className={buttonClass}
            type="button"
            disabled={level === 0}
            onClick={() => changeZoom(0)}
          >
            {zoom * 100}%
          </button>
          <button
            aria-label="Zoom in"
            className={buttonClass}
            type="button"
            disabled={level === zoomLevels.length - 1 || !resolution}
            onClick={() => changeZoom(level + 1)}
          >
            <Plus size={16} aria-hidden />
          </button>
        </fieldset>
        {resolution && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {resolution.width} × {resolution.height} px
          </span>
        )}
        {date && !Number.isNaN(date.getTime()) && (
          <time className="text-xs text-muted-foreground" dateTime={date.toISOString()}>
            {date.toLocaleString()}
          </time>
        )}
        <div className="ml-auto flex gap-1">
          <button
            className={buttonClass}
            type="button"
            disabled={!resolution || exporting}
            onClick={() => void exportFromLightbox("copy")}
          >
            Copy Image
          </button>
          <button
            className={buttonClass}
            type="button"
            disabled={!resolution || exporting}
            onClick={() => void exportFromLightbox("save")}
          >
            Save PNG
          </button>
        </div>
      </div>
      {image.capture && (
        <details className="min-w-0 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Tool arguments</summary>
          <pre className="app-scrollbar mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2">
            {JSON.stringify(image.capture.arguments, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}

export function ImageLightboxProvider({
  children,
  onAddImage,
}: {
  children: ReactNode;
  onAddImage?: AddComposerImage;
}) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const openGallery = useCallback((next: Gallery) => {
    trigger.current = next.trigger;
    setGallery(next);
  }, []);
  const image = gallery?.images[gallery.index];
  const addToComposer: AddComposerImage = (attachment) => {
    if (!onAddImage?.(attachment)) return false;
    trigger.current = null;
    setGallery(null);
    return true;
  };

  function move(direction: -1 | 1) {
    setGallery((current) => {
      if (!current) return current;
      const length = current.images.length;
      return { ...current, index: (current.index + direction + length) % length };
    });
  }

  return (
    <OpenGallery.Provider value={openGallery}>
      <AddImageToComposer.Provider value={onAddImage ? addToComposer : undefined}>
        {children}
        <Dialog.Root
          open={!!image}
          onOpenChange={(open) => {
            if (!open) setGallery(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="animate-lightbox-backdrop fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm" />
            <Dialog.Content
              className="fixed left-1/2 top-1/2 z-[101] flex max-h-[94vh] w-[min(94vw,72rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 text-card-foreground shadow-2xl"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                trigger.current?.focus({ preventScroll: true });
              }}
              onKeyDown={(event) => {
                if (
                  !gallery ||
                  gallery.images.length < 2 ||
                  (event.target instanceof HTMLElement &&
                    event.target.closest("[data-image-viewport]"))
                )
                  return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  move(event.key === "ArrowLeft" ? -1 : 1);
                }
              }}
            >
              {image && gallery && (
                <>
                  <div className="flex items-center gap-2">
                    <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {image.name}
                    </Dialog.Title>
                    <Dialog.Description className="sr-only">
                      Image attachment preview
                    </Dialog.Description>
                    {gallery.images.length > 1 && (
                      <fieldset className="flex items-center gap-1" aria-label="Image gallery">
                        <button
                          aria-label="Previous image"
                          className={buttonClass}
                          type="button"
                          onClick={() => move(-1)}
                        >
                          <ChevronLeft size={16} aria-hidden />
                        </button>
                        <output className="px-1 text-xs tabular-nums text-muted-foreground">
                          {gallery.index + 1} / {gallery.images.length}
                        </output>
                        <button
                          aria-label="Next image"
                          className={buttonClass}
                          type="button"
                          onClick={() => move(1)}
                        >
                          <ChevronRight size={16} aria-hidden />
                        </button>
                      </fieldset>
                    )}
                    <Dialog.Close aria-label="Close image" className={buttonClass}>
                      <X size={16} aria-hidden />
                    </Dialog.Close>
                  </div>
                  <ImageViewer key={image.id} image={image} />
                </>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </AddImageToComposer.Provider>
    </OpenGallery.Provider>
  );
}

export function ActivityGallery({ images }: { images: readonly LightboxImage[] }) {
  const openGallery = useContext(OpenGallery);
  const hidden = Math.max(0, images.length - 3);
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {hidden > 0 && (
        <button
          type="button"
          aria-label={`Open gallery with ${images.length} images`}
          className="rounded px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-2"
          onClick={(event) => openGallery?.({ images, index: 0, trigger: event.currentTarget })}
        >
          +{hidden}
        </button>
      )}
      {images.slice(hidden).map((image, offset) => {
        const index = hidden + offset;
        return (
          <HoverCard.Root key={image.id} openDelay={220} closeDelay={80}>
            <ImageContextMenu image={image}>
              <HoverCard.Trigger asChild>
                <button
                  type="button"
                  aria-label={`Open ${image.label ?? image.name}, image ${index + 1} of ${images.length}`}
                  className="h-7 w-9 cursor-zoom-in overflow-hidden rounded border bg-muted hover:border-foreground/60 focus-visible:outline-2 sm:w-12"
                  onClick={(event) =>
                    openGallery?.({ images, index, trigger: event.currentTarget })
                  }
                >
                  <img
                    src={image.src}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
              </HoverCard.Trigger>
            </ImageContextMenu>
            <HoverCard.Portal>
              <HoverCard.Content
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                className="pointer-events-none z-50 w-[min(26rem,85vw)] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xl"
              >
                <img
                  src={image.src}
                  alt=""
                  className="max-h-64 w-full bg-black/80 object-contain"
                />
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="truncate font-medium">{image.label ?? image.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {index + 1} of {images.length}
                  </span>
                </div>
              </HoverCard.Content>
            </HoverCard.Portal>
          </HoverCard.Root>
        );
      })}
    </div>
  );
}

export function ReplyImage({ image, caption }: { image: LightboxImage; caption: string }) {
  const openGallery = useContext(OpenGallery);
  return (
    <ImageContextMenu image={image}>
      <button
        type="button"
        aria-label={`Open ${caption || image.label || image.name}`}
        className="my-1 block max-w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted text-left hover:border-foreground/50 focus-visible:outline-2"
        onClick={(event) =>
          openGallery?.({ images: [image], index: 0, trigger: event.currentTarget })
        }
      >
        <img
          src={image.src}
          alt={caption}
          loading="lazy"
          className="block max-h-[26rem] max-w-full object-contain"
        />
        {caption && (
          <span className="block px-3 py-1.5 text-xs text-muted-foreground">{caption}</span>
        )}
      </button>
    </ImageContextMenu>
  );
}

export function ImageThumbnails({ images }: { images: readonly LightboxImage[] }) {
  const openGallery = useContext(OpenGallery);
  return (
    <div className="flex flex-wrap gap-1.5">
      {images.map((image, index) => (
        <ImageContextMenu image={image} key={image.id}>
          <button
            type="button"
            aria-label={`Open ${image.name}`}
            className="block max-w-full cursor-zoom-in overflow-hidden rounded-md border bg-black/30 hover:border-foreground/50 focus-visible:outline-2"
            onClick={(event) => openGallery?.({ images, index, trigger: event.currentTarget })}
          >
            <img
              src={image.src}
              alt={image.name}
              loading="lazy"
              className="max-h-36 max-w-full object-contain sm:max-w-[240px]"
            />
          </button>
        </ImageContextMenu>
      ))}
    </div>
  );
}
