import { CircleQuestionMark, Zap } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { MENU_TRIGGER, MenuChevron, MenuContent, MenuItem, MenuLabel } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EFFORT_LEVELS, effortLabel } from "@/lib/effort";
import type { EffortControl } from "@/types/desktop";
import "./EffortPicker.css";

type EffortStop = { id: string | null; label: string };
type EffortDrag = { pointerId: number; offset: number };
type EffortCommit = { previous: string | null; next: string | null };
type FastControl = { enabled: boolean; onToggle: () => void };
type DisplayEffort = { text: string; stop: number; peak: boolean };

const PIXEL_ROWS = 4;
const PIXEL_COLUMNS = 26;

/** A repeatable 0–1 scatter, so the mosaic is the same picture every time it flows in. */
function pixelNoise(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

// The accent mosaic shown at the top stop: solid beside the thumb, thinning out and fading
// to the left, with each pixel switching on a little after the one nearer the thumb.
const EFFORT_PIXELS = Array.from({ length: PIXEL_ROWS * PIXEL_COLUMNS }, (_, index) => {
  const fromThumb = Math.floor(index / PIXEL_ROWS);
  const reach = 1 - fromThumb / PIXEL_COLUMNS;
  const [scatter, jitter, shade] = [0, 1, 2].map((offset) => pixelNoise(index * 3 + offset));
  // Solid for the nearer half, then dithered away: fewer and fewer pixels survive.
  if (scatter >= (reach - 0.1) * 2.2) return null;
  return {
    key: index,
    shade: shade < 0.14 ? "light" : shade > 0.7 ? "deep" : undefined,
    style: {
      "--x": PIXEL_COLUMNS - fromThumb,
      "--y": (index % PIXEL_ROWS) + 1,
      "--o": (Math.min(1, 0.2 + reach) * (0.72 + 0.28 * jitter)).toFixed(2),
      "--d": `${Math.round(fromThumb * 20 + jitter * 110)}ms`,
    } as CSSProperties,
  };
}).filter((pixel) => pixel !== null);

/** The slider's Fast mode toggle: an icon beside the help button, filled in the accent when on. */
function FastModeButton({ enabled, onToggle }: FastControl) {
  return (
    <button
      type="button"
      aria-label="Fast mode"
      aria-pressed={enabled}
      title="Fast mode · higher usage may apply"
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-brand-text"
      onClick={onToggle}
    >
      <Zap size={15} fill={enabled ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}

/** The dropdown's Fast mode toggle: a labelled row with a pill switch. */
function FastModeSwitch({ enabled, onToggle }: FastControl) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      title="Higher usage may apply"
      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onToggle}
    >
      <Zap
        size={14}
        fill={enabled ? "currentColor" : "none"}
        className={`shrink-0 ${enabled ? "text-brand-text" : "text-muted-foreground"}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">Fast mode</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          enabled ? "bg-brand" : "bg-foreground/20"
        }`}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-background transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function pointerStop(clientX: number, { left, width }: DOMRect, offset: number, lastStop: number) {
  const progress = Math.min(1, Math.max(0, (clientX - left - offset) / width));
  return Math.round(progress * lastStop);
}

function AnimatedEffortLabel({ text, stop, peak }: DisplayEffort) {
  const [labels, setLabels] = useState<{
    current: DisplayEffort;
    outgoing?: DisplayEffort;
  }>({ current: { text, stop, peak } });
  const { current, outgoing } = labels;
  if (current.text !== text || current.stop !== stop || current.peak !== peak) {
    setLabels({
      current: { text, stop, peak },
      outgoing: current.text !== text ? current : undefined,
    });
  }

  return (
    <span
      className="effort-label"
      data-direction={outgoing ? (current.stop > outgoing.stop ? "up" : "down") : undefined}
    >
      {outgoing && (
        <span
          key={outgoing.text}
          className={`effort-label-outgoing ${outgoing.peak ? "effort-peak-label" : "text-foreground"}`}
          aria-hidden="true"
          onAnimationEnd={() =>
            setLabels((previous) => (previous === labels ? { current } : previous))
          }
        >
          {outgoing.text}
        </span>
      )}
      <span
        key={current.text}
        className={`effort-label-current ${current.peak ? "effort-peak-label" : "text-foreground"}`}
      >
        {current.text}
      </span>
    </span>
  );
}

function EffortSlider({
  stops,
  value,
  onChange,
  fast,
  children,
}: {
  stops: readonly EffortStop[];
  value: string | null;
  onChange: (variant: string | null) => void;
  fast?: FastControl;
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const travel = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<EffortDrag | null>(null);
  const [dragStop, setDragStop] = useState<number | null>(null);
  const [commit, setCommit] = useState<EffortCommit | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const helpId = useId();
  const lastStop = stops.length - 1;
  const pending = commit?.previous === value ? commit : null;
  if (commit && !pending) setCommit(null);
  const selected = stops.findIndex((stop) => stop.id === (pending ? pending.next : value));
  const preview = dragStop ?? selected;
  const progress = Math.max(0, preview) / lastStop;
  const highest = preview === lastStop;
  const previewStop = stops[preview];
  const label = previewStop?.label ?? effortLabel(value);

  function commitStop(index: number) {
    const next = stops[index]?.id;
    if (next === undefined || next === (pending ? pending.next : value)) return;
    setCommit(next === value ? null : { previous: value, next });
    onChange(next);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (drag.current || !travel.current || !thumb.current) return;

    const track = travel.current.getBoundingClientRect();
    if (track.width <= 0) return;
    const bounds = thumb.current.getBoundingClientRect();
    const { clientX, currentTarget, pointerId } = event;
    const onThumb = clientX >= bounds.left && clientX <= bounds.right;
    // Anchor to the selected stop when the moving thumb is grabbed mid-snap.
    const offset = onThumb ? clientX - (track.left + progress * track.width) : 0;
    currentTarget.setPointerCapture(pointerId);
    input.current?.focus({ preventScroll: true });
    drag.current = { pointerId, offset };
    setDragStop(pointerStop(clientX, track, offset, lastStop));
  }

  function stopAtPointer(clientX: number, active: EffortDrag) {
    const track = travel.current?.getBoundingClientRect();
    return track && track.width > 0
      ? pointerStop(clientX, track, active.offset, lastStop)
      : dragStop;
  }

  function clearDrag() {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    setDragStop(null);
    const control = surface.current;
    if (control?.hasPointerCapture(active.pointerId))
      control.releasePointerCapture(active.pointerId);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") {
      const next = stopAtPointer(event.clientX, active);
      if (next !== null) commitStop(next);
    }
    clearDrag();
  }

  return (
    <PopoverContent
      side="top"
      align="start"
      aria-label="Reasoning effort"
      className="w-66 max-w-[calc(100vw-16px)] rounded-xl px-3 py-2 shadow-xl motion-reduce:animate-none"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        input.current?.focus({ preventScroll: true });
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 break-words text-lg font-medium text-muted-foreground">
          Effort <AnimatedEffortLabel text={label} stop={preview} peak={highest} />
        </div>
        {fast && <FastModeButton {...fast} />}
        <button
          type="button"
          aria-label="About reasoning effort"
          aria-expanded={showHelp}
          aria-controls={helpId}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShowHelp((show) => !show)}
        >
          <CircleQuestionMark size={16} aria-hidden />
        </button>
      </div>
      <p id={helpId} className={showHelp ? "mt-1 text-xs text-muted-foreground" : "sr-only"}>
        Higher effort gives the model more time to reason. Release the slider to select a level.
        Auto uses the model’s default.
      </p>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>Faster</span>
        <span>Smarter</span>
      </div>
      <div
        ref={surface}
        className="effort-slider"
        data-dragging={dragStop !== null || undefined}
        data-highest={highest || undefined}
        data-fast={Boolean(highest && fast?.enabled) || undefined}
        style={{ "--effort-progress": progress } as CSSProperties}
        onPointerDown={startDrag}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active?.pointerId === event.pointerId) {
            setDragStop(stopAtPointer(event.clientX, active));
          }
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="effort-slider-track" aria-hidden="true">
          <div className="effort-slider-fill">
            <div className="effort-slider-pixels">
              {EFFORT_PIXELS.map((pixel) => (
                <span
                  key={pixel.key}
                  className="effort-slider-pixel"
                  data-shade={pixel.shade}
                  style={pixel.style}
                />
              ))}
            </div>
          </div>
          <div className="effort-slider-travel" ref={travel}>
            {stops.slice(1, -1).map((stop, index) => (
              <span
                key={stop.id}
                className="effort-slider-tick"
                style={{ left: `${((index + 1) / lastStop) * 100}%` }}
              />
            ))}
            <div className="effort-slider-thumb-position">
              <div className="effort-slider-thumb" ref={thumb} />
            </div>
          </div>
        </div>
        <input
          ref={input}
          type="range"
          min={0}
          max={lastStop}
          value={Math.max(0, preview)}
          aria-label="Reasoning effort"
          aria-valuetext={preview < 0 ? `${label} selected. Adjust to set effort.` : label}
          aria-describedby={helpId}
          className="effort-slider-input"
          onBlur={clearDrag}
          onKeyDown={(event) => {
            if (event.key === "Escape") clearDrag();
          }}
          onChange={(event) => {
            clearDrag();
            commitStop(event.currentTarget.valueAsNumber);
          }}
        />
      </div>
      {children}
    </PopoverContent>
  );
}

export function EffortPicker({
  variants,
  value,
  control = "slider",
  onChange,
  fast,
}: {
  variants: readonly string[];
  value: string | null;
  control?: EffortControl;
  onChange: (variant: string | null) => void;
  fast?: FastControl;
}) {
  const [open, setOpen] = useState(false);
  if (variants.length === 0 && !fast) return null;

  const current = value !== null && variants.includes(value) ? value : null;
  const stops: EffortStop[] = [
    { id: null, label: "Auto" },
    ...EFFORT_LEVELS.flatMap((level) =>
      variants
        .filter((id) => level.ids.includes(id.toLowerCase()))
        .map((id) => ({ id, label: level.label })),
    ),
  ];
  const activeStop = stops.find((stop) => stop.id === current);
  const otherVariants = variants.filter((id) => !stops.some((stop) => stop.id === id));
  const useSlider = control === "slider" && stops.length > 1;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={MENU_TRIGGER}>
          {fast?.enabled && (
            <Zap size={13} fill="currentColor" aria-label="Fast on" className="shrink-0" />
          )}
          {variants.length
            ? `${(useSlider && activeStop?.label) || effortLabel(current)} effort`
            : "Speed"}
          <MenuChevron />
        </button>
      </PopoverTrigger>
      {useSlider ? (
        <EffortSlider stops={stops} value={current} onChange={onChange} fast={fast}>
          {otherVariants.length > 0 && (
            <div className="mt-2 border-t pt-1">
              {!activeStop && <MenuItem onClick={() => onChange(null)}>Use model default</MenuItem>}
              {otherVariants.map((variant) => (
                <MenuItem
                  key={variant}
                  checked={current === variant}
                  onClick={() => onChange(variant)}
                >
                  {effortLabel(variant)}
                </MenuItem>
              ))}
            </div>
          )}
        </EffortSlider>
      ) : (
        <MenuContent side="top" align="start" className="w-56">
          {variants.length > 0 && (
            <MenuLabel>How long the model thinks before it answers. More is slower.</MenuLabel>
          )}
          {(variants.length ? [null, ...variants] : []).map((variant) => (
            <MenuItem
              key={variant ?? ""}
              checked={current === variant}
              onClick={() => {
                onChange(variant);
                setOpen(false);
              }}
            >
              {effortLabel(variant)}
            </MenuItem>
          ))}
          {fast && (
            <div className={variants.length > 0 ? "mt-1 border-t pt-1" : undefined}>
              <FastModeSwitch {...fast} />
            </div>
          )}
        </MenuContent>
      )}
    </Popover>
  );
}
