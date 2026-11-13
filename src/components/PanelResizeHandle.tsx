import { useRef } from "react";

export function clampPanelWidth(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, width));
}

export default function PanelResizeHandle({
  label,
  controls,
  edge,
  width,
  min,
  max,
  onResize,
}: {
  label: string;
  controls: string;
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const direction = edge === "left" ? -1 : 1;
  const minimum = Math.min(min, max);
  const resize = (next: number) => onResize(clampPanelWidth(next, minimum, max));

  return (
    <hr
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className={`absolute inset-y-0 z-10 m-0 h-full w-1.5 cursor-col-resize touch-none select-none border-0 hover:bg-primary/30 focus-visible:bg-primary/50 focus-visible:outline-none active:bg-primary/50 ${
        edge === "left" ? "left-0" : "-right-1"
      }`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const handle = event.currentTarget;
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          width: handle.parentElement?.offsetWidth || width,
        };
        handle.setPointerCapture?.(event.pointerId);
        handle.focus({ preventScroll: true });
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start && start.id === event.pointerId) {
          resize(start.width + direction * (event.clientX - start.x));
        }
      }}
      onPointerUp={(event) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
      }}
      onPointerCancel={(event) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.id === event.pointerId) drag.current = null;
      }}
      onKeyDown={(event) => {
        let next: number;
        switch (event.key) {
          case "ArrowLeft":
            next = width - direction * 16;
            break;
          case "ArrowRight":
            next = width + direction * 16;
            break;
          case "Home":
            next = minimum;
            break;
          case "End":
            next = max;
            break;
          default:
            return;
        }
        event.preventDefault();
        resize(next);
      }}
    />
  );
}
