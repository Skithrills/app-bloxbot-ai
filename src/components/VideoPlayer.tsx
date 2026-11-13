import {
  Copy,
  Download,
  Film,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ContextMenu } from "radix-ui";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";

const SPEEDS = [1, 1.5, 2, 0.5];
const SEEK_SECONDS = 5;
const VOLUME_STEP = 0.1;
const SOUND_KEY = "bloxbot-video-sound";

const CONTROL =
  "inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring";
const MENU_ITEM =
  "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";

interface Sound {
  volume: number;
  muted: boolean;
}

/** Videos start silent until someone turns the sound on. After that, their choice is kept. */
export function readVideoSound(): Sound {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SOUND_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const { volume, muted } = saved as Record<string, unknown>;
      if (typeof volume === "number" && volume >= 0 && volume <= 1 && typeof muted === "boolean") {
        return { volume, muted };
      }
    }
  } catch {
    // Without storage, every video starts from the default.
  }
  return { volume: 1, muted: true };
}

function saveVideoSound(sound: Sound) {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(sound));
  } catch {
    // The choice still holds for this video.
  }
}

function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A bar with a filled part and a handle, over a range input that does the work. */
function Meter({
  label,
  valueText,
  value,
  max,
  under = 0,
  className,
  onChange,
}: {
  label: string;
  valueText: string;
  value: number;
  max: number;
  /** A fainter fill under the main one, for how much of a video has loaded. */
  under?: number;
  className: string;
  onChange: (value: number) => void;
}) {
  const percent = (part: number) => (max > 0 ? Math.min(100, Math.max(0, (part / max) * 100)) : 0);
  return (
    <div className={`relative flex h-7 items-center ${className}`}>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-foreground/15">
        <div
          className="absolute inset-y-0 left-0 bg-foreground/20"
          style={{ width: `${percent(under)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-brand"
          style={{ width: `${percent(value)}%` }}
        />
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand shadow ring-2 ring-card"
        style={{ left: `${percent(value)}%` }}
      />
      <input
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={max || 0}
        step="any"
        value={Math.min(value, max || 0)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-3 -translate-y-1/2 rounded-full ring-2 ring-ring peer-focus-visible:block"
      />
    </div>
  );
}

/** The frame a video is showing, as a PNG. */
async function currentFrame(video: HTMLVideoElement): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) throw new Error("No frame to copy");
  context.drawImage(video, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No frame to copy"))),
      "image/png",
    );
  });
  return new Uint8Array(await png.arrayBuffer());
}

/**
 * BloxBot's own video player, in place of the browser's: the picture, and under it one row of
 * controls in the app's look. Click the picture or press Space to play, the left and right arrow
 * keys to move five seconds, up and down for volume, M to mute and F for full screen. Right-click
 * the picture to copy or save the frame it shows, or save the video.
 */
export function VideoPlayer({
  src,
  name,
  poster,
  autoPlay = false,
  compact = false,
  videoClassName = "max-h-[62vh]",
  trailing,
  onError,
}: {
  src: string;
  name: string;
  poster?: string;
  autoPlay?: boolean;
  /** Fits a message bubble, leaving out speed and full screen. */
  compact?: boolean;
  /** Limits how tall the picture gets. */
  videoClassName?: string;
  /** More controls for the end of the row. */
  trailing?: ReactNode;
  onError?: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [sound, setSound] = useState(readVideoSound);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  // A video served by the app can be saved as a file. One read from memory has no file to save.
  const onDisk = src.startsWith("bloxbot-video:");

  // Before the first frame, so a video set to play at once doesn't start at full volume.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the sound it starts with
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = sound.volume;
    video.muted = sound.muted;
  }, []);

  // The video reports its time a few times a second, which makes the bar jump. While it plays,
  // read the time every frame instead.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function follow() {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    // A file that has since moved can't start. The error handler says so; nothing to add here.
    if (video.paused) video.play()?.catch(() => undefined);
    else video.pause();
  }
  function seek(to: number) {
    const video = videoRef.current;
    if (!video) return;
    const end = Number.isFinite(video.duration) ? video.duration : duration;
    video.currentTime = Math.min(Math.max(0, to), end || 0);
    setTime(video.currentTime);
  }
  /** Changes the sound here and for every video after this one. */
  function changeSound(next: Sound) {
    const video = videoRef.current;
    if (video) {
      video.volume = next.volume;
      video.muted = next.muted;
    }
    setSound(next);
    saveVideoSound(next);
  }
  function toggleMute() {
    // Unmuting at no volume would change nothing, so it comes back at a level that can be heard.
    changeSound(
      sound.muted ? { volume: sound.volume || 0.5, muted: false } : { ...sound, muted: true },
    );
  }
  function setVolume(volume: number) {
    const level = Math.min(1, Math.max(0, volume));
    changeSound({ volume: level, muted: level === 0 });
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void frameRef.current?.requestFullscreen?.().catch(() => undefined);
  }
  function nextSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    if (videoRef.current) videoRef.current.playbackRate = next;
    setSpeed(next);
  }
  async function exportFrame(action: "copy" | "save") {
    const video = videoRef.current;
    if (!video) return;
    try {
      const png = await currentFrame(video);
      const filename = `${name.replace(/\.[^.]+$/, "")} at ${clock(video.currentTime).replace(":", "m")}s`;
      const done = await desktop.exportToolImage({ action, png, filename });
      if (done) notify.success(action === "copy" ? "Frame copied" : "Frame saved");
    } catch {
      notify.error(action === "copy" ? "Couldn't copy the frame" : "Couldn't save the frame");
    }
  }
  async function saveVideo() {
    try {
      if (await desktop.saveVideo(src)) notify.success("Video saved");
    } catch {
      notify.error("Couldn't save the video. Its file may have moved.");
    }
  }

  const heard = sound.muted ? 0 : sound.volume;
  const SoundIcon = heard === 0 ? VolumeX : heard < 0.5 ? Volume1 : Volume2;
  return (
    // The keys below work anywhere in the player.
    <div
      ref={frameRef}
      // Arrow keys move through the video here, and not on to the next attachment.
      data-image-viewport=""
      className="group/player min-w-0 overflow-hidden rounded-lg border bg-card text-card-foreground [&:fullscreen]:flex [&:fullscreen]:flex-col [&:fullscreen]:rounded-none [&:fullscreen]:border-0"
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const onButton = event.target instanceof HTMLButtonElement;
        const key = event.key.toLowerCase();
        if (key === "arrowleft" || key === "arrowright") {
          seek(
            (videoRef.current?.currentTime ?? 0) + (key === "arrowleft" ? -1 : 1) * SEEK_SECONDS,
          );
        } else if (key === "arrowup" || key === "arrowdown") {
          setVolume(heard + (key === "arrowup" ? 1 : -1) * VOLUME_STEP);
        } else if (key === "k" || (key === " " && !onButton)) toggle();
        else if (key === "m") toggleMute();
        else if (key === "f" && !compact) toggleFullscreen();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button
            type="button"
            tabIndex={-1}
            aria-label={playing ? `Pause ${name}` : `Play ${name}`}
            onClick={toggle}
            onDoubleClick={compact ? undefined : toggleFullscreen}
            // The menu copies and saves the frame on screen, so the video holds on it.
            onContextMenu={() => videoRef.current?.pause()}
            className="relative block w-full bg-black [:fullscreen_&]:min-h-0 [:fullscreen_&]:flex-1"
          >
            {/* biome-ignore lint/a11y/useMediaCaption: a recording the user attached has no captions */}
            <video
              ref={videoRef}
              src={src}
              poster={poster}
              autoPlay={autoPlay}
              // Lets the frame on screen be copied. The app's own video address allows it.
              crossOrigin={onDisk ? "anonymous" : undefined}
              playsInline
              preload="metadata"
              className={`mx-auto block w-full object-contain [:fullscreen_&]:h-full [:fullscreen_&]:max-h-none ${videoClassName}`}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onDurationChange={(event) =>
                setDuration(
                  Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0,
                )
              }
              onProgress={({ currentTarget: video }) =>
                setBuffered(
                  video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
                )
              }
              onError={onError}
            />
            {!playing && (
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg transition-transform group-hover/player:scale-105"
              >
                <Play size={18} fill="currentColor" className="translate-x-px" />
              </span>
            )}
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            collisionPadding={8}
            className="z-[120] min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            <ContextMenu.Item className={MENU_ITEM} onSelect={() => void exportFrame("copy")}>
              <Copy size={14} aria-hidden /> Copy Frame
            </ContextMenu.Item>
            <ContextMenu.Item className={MENU_ITEM} onSelect={() => void exportFrame("save")}>
              <Download size={14} aria-hidden /> Save Frame as PNG
            </ContextMenu.Item>
            {onDisk && (
              <ContextMenu.Item className={MENU_ITEM} onSelect={() => void saveVideo()}>
                <Film size={14} aria-hidden /> Save Video As…
              </ContextMenu.Item>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <div className="flex min-w-0 items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className={`${CONTROL} text-foreground`}
          onClick={toggle}
        >
          {playing ? (
            <Pause aria-hidden="true" size={14} fill="currentColor" />
          ) : (
            <Play aria-hidden="true" size={14} fill="currentColor" />
          )}
        </button>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          <span className="text-foreground">{clock(time)}</span> / {clock(duration)}
        </span>
        <Meter
          label="Seek"
          valueText={`${clock(time)} of ${clock(duration)}`}
          value={time}
          max={duration}
          under={buffered}
          className="mx-1.5 min-w-10 flex-1"
          onChange={seek}
        />
        {!compact && (
          <button
            type="button"
            aria-label={`Playback speed, ${speed}×`}
            title="Playback speed"
            className={`${CONTROL} text-xs tabular-nums`}
            onClick={nextSpeed}
          >
            {speed}×
          </button>
        )}
        {/* In a message the volume bar opens when the sound button is pointed at or focused. */}
        <div className="group/sound flex shrink-0 items-center">
          <button
            type="button"
            aria-label={sound.muted ? "Unmute" : "Mute"}
            aria-pressed={sound.muted}
            title={sound.muted ? "Unmute (M)" : "Mute (M)"}
            className={CONTROL}
            onClick={toggleMute}
          >
            <SoundIcon aria-hidden="true" size={14} />
          </button>
          <div
            className={
              compact
                ? "w-0 overflow-hidden transition-[width] duration-150 group-focus-within/sound:w-16 group-hover/sound:w-16"
                : "w-20"
            }
          >
            <Meter
              label="Volume"
              valueText={sound.muted ? "Muted" : `${Math.round(sound.volume * 100)}%`}
              value={heard}
              max={1}
              className="mx-1.5"
              onChange={setVolume}
            />
          </div>
        </div>
        {!compact && (
          <button
            type="button"
            aria-label={fullscreen ? "Leave full screen" : "Full screen"}
            title={fullscreen ? "Leave full screen (F)" : "Full screen (F)"}
            className={CONTROL}
            onClick={toggleFullscreen}
          >
            {fullscreen ? (
              <Minimize aria-hidden="true" size={14} />
            ) : (
              <Maximize aria-hidden="true" size={14} />
            )}
          </button>
        )}
        {trailing}
      </div>
    </div>
  );
}

export const VIDEO_CONTROL = CONTROL;
