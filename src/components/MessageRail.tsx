import { Star } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { loadMessageFavorites, saveMessageFavorites } from "@/lib/messageFavorites";
import "./MessageRail.css";

export interface RailEntry {
  id: string;
  label: string;
  preview: string;
  reply?: string;
  index: number;
}

interface MessageRailProps {
  entries: readonly RailEntry[];
  sessionId: string;
  activeIndex?: number;
  visibleRange?: { startIndex: number; endIndex: number } | null;
  onJump: (index: number) => void;
  renderAudio?: (viewport: RefObject<HTMLDivElement>) => ReactNode;
}

export const MESSAGE_RAIL_ROW_HEIGHT = 18;
const VISIBLE_ROWS = 23;
const OVERSCAN = 4;
/** How many rows either side of the hovered one lengthen with it. */
const HILL_REACH = 4;

function MessageRailContent({
  entries,
  sessionId,
  activeIndex,
  visibleRange,
  onJump,
  renderAudio,
}: MessageRailProps) {
  const [favorites, setFavorites] = useState(() => loadMessageFavorites(sessionId));
  const [focusedId, setFocusedId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const [firstRow, setFirstRow] = useState(0);
  const rail = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>();
  const pendingFocus = useRef<number>();
  const opened = useRef(false);
  const previewDescriptionId = useId();
  const previewPosition = entries.findIndex((entry) => entry.id === previewId);
  const activePosition = entries.findIndex((entry) => entry.index === activeIndex);
  const start = Math.max(0, Math.min(firstRow, entries.length - VISIBLE_ROWS) - OVERSCAN);
  const end = Math.min(entries.length, firstRow + VISIBLE_ROWS + OVERSCAN);
  const visibleEntries = entries.slice(start, end);
  const preview =
    previewPosition >= start && previewPosition < end ? entries[previewPosition] : undefined;
  const tabStop =
    visibleEntries.find((entry) => entry.id === focusedId) ??
    visibleEntries.find((entry) => entry.index === activeIndex) ??
    entries[firstRow] ??
    visibleEntries[0];

  const cancelClose = useCallback(() => window.clearTimeout(closeTimer.current), []);
  useEffect(() => cancelClose, [cancelClose]);

  function openPreview(id: string) {
    cancelClose();
    setPreviewId(id);
  }

  function closeAfterPointerLeaves() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (!rail.current?.querySelector(":focus-visible")) setPreviewId(undefined);
    }, 150);
  }

  useLayoutEffect(() => {
    const scroller = viewport.current;
    if (!entries.length || !scroller || opened.current) return;
    opened.current = true;
    scroller.scrollTop = scroller.scrollHeight;
    setFirstRow(Math.floor(scroller.scrollTop / MESSAGE_RAIL_ROW_HEIGHT));
  }, [entries.length]);

  useLayoutEffect(() => {
    const scroller = viewport.current;
    const surface = rail.current;
    if (!scroller?.clientHeight || !surface || activePosition < 0) return;
    if (surface.matches(":hover") || surface.contains(document.activeElement)) return;
    const top = activePosition * MESSAGE_RAIL_ROW_HEIGHT;
    const bottom = top + MESSAGE_RAIL_ROW_HEIGHT;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    }
    setFirstRow(Math.floor(scroller.scrollTop / MESSAGE_RAIL_ROW_HEIGHT));
  }, [activePosition]);

  useLayoutEffect(() => {
    const surface = rail.current;
    const scroller = viewport.current;
    const anchor = markers.current?.children.item(previewPosition - start);
    const panel = card.current;
    if (!surface || !scroller || !anchor || !panel) return;

    const positionPreview = () => {
      const row = anchor.getBoundingClientRect();
      const visible = scroller.getBoundingClientRect();
      if (visible.height > 0 && (row.bottom <= visible.top || row.top >= visible.bottom)) {
        setPreviewId(undefined);
        return;
      }

      const bounds = surface.getBoundingClientRect();
      const height = panel.offsetHeight;
      const center = (row.top + row.bottom) / 2 - bounds.top;
      panel.style.top = `${Math.max(0, Math.min(center - height / 2, bounds.height - height))}px`;
    };

    const dismissPreview = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel.contains(document.activeElement) && anchor instanceof HTMLButtonElement) {
        anchor.focus({ preventScroll: true });
      }
      setPreviewId(undefined);
    };

    positionPreview();
    scroller.addEventListener("scroll", positionPreview);
    document.addEventListener("keydown", dismissPreview);
    const observer = typeof ResizeObserver !== "undefined" && new ResizeObserver(positionPreview);
    if (observer) {
      observer.observe(surface);
      observer.observe(scroller);
      observer.observe(panel);
    }
    return () => {
      scroller.removeEventListener("scroll", positionPreview);
      document.removeEventListener("keydown", dismissPreview);
      if (observer) observer.disconnect();
    };
  }, [previewPosition, start]);

  useLayoutEffect(() => {
    const position = pendingFocus.current;
    if (position === undefined) return;
    const marker = markers.current?.children.item(position - start);
    if (!(marker instanceof HTMLButtonElement)) return;
    pendingFocus.current = undefined;
    marker.focus();
  }, [start]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    let next: number;
    switch (event.key) {
      case "ArrowUp":
        next = Math.max(0, position - 1);
        break;
      case "ArrowDown":
        next = Math.min(entries.length - 1, position + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = entries.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const marker = markers.current?.children.item(next - start);
    if (marker instanceof HTMLButtonElement) {
      marker.focus();
    } else if (viewport.current) {
      pendingFocus.current = next;
      viewport.current.scrollTop = next * MESSAGE_RAIL_ROW_HEIGHT;
      setFirstRow(Math.floor(viewport.current.scrollTop / MESSAGE_RAIL_ROW_HEIGHT));
    }
  }

  function toggleFavorite(id: string) {
    const next = new Set(favorites);
    if (!next.delete(id)) next.add(id);
    setFavorites(next);
    saveMessageFavorites(sessionId, next);
  }

  if (!entries.length && !renderAudio) return null;

  return (
    <nav
      ref={rail}
      aria-label="Message navigation"
      aria-hidden={entries.length === 0 || undefined}
      className="message-rail"
      style={
        {
          "--message-rail-row-height": `${MESSAGE_RAIL_ROW_HEIGHT}px`,
          "--message-rail-height": `${Math.min(VISIBLE_ROWS, renderAudio ? VISIBLE_ROWS : entries.length) * MESSAGE_RAIL_ROW_HEIGHT}px`,
        } as CSSProperties
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPreviewId(undefined);
      }}
    >
      {renderAudio && (
        <div aria-hidden="true" className="message-rail-audio">
          {renderAudio(viewport)}
        </div>
      )}
      <div
        ref={viewport}
        className="message-rail-viewport"
        data-empty={!entries.length || undefined}
        onScroll={(event) =>
          setFirstRow(Math.floor(event.currentTarget.scrollTop / MESSAGE_RAIL_ROW_HEIGHT))
        }
      >
        <div
          ref={markers}
          style={{
            paddingBlockStart: start * MESSAGE_RAIL_ROW_HEIGHT,
            paddingBlockEnd: (entries.length - end) * MESSAGE_RAIL_ROW_HEIGHT,
          }}
        >
          {visibleEntries.map((entry, offset) => {
            const favorite = favorites.has(entry.id);
            const showingPreview = entry.id === previewId;
            const position = start + offset;
            const nextIndex = entries[position + 1]?.index ?? Infinity;
            const inTranscript =
              visibleRange &&
              entry.index <= visibleRange.endIndex &&
              nextIndex > visibleRange.startIndex;
            const distance = Math.abs(previewPosition - position);
            return (
              <button
                key={entry.id}
                type="button"
                className="message-rail-marker"
                data-favorite={favorite || undefined}
                data-preview={showingPreview || undefined}
                data-visible={inTranscript || undefined}
                data-bump={previewPosition >= 0 && distance <= HILL_REACH ? distance : undefined}
                aria-label={`Message ${position + 1} from ${entry.label}${favorite ? ", favorited" : ""}`}
                aria-current={entry.index === activeIndex ? "location" : undefined}
                aria-describedby={showingPreview ? previewDescriptionId : undefined}
                tabIndex={entry === tabStop ? 0 : -1}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") openPreview(entry.id);
                }}
                onPointerLeave={closeAfterPointerLeaves}
                onFocus={() => {
                  setFocusedId(entry.id);
                  openPreview(entry.id);
                }}
                onKeyDown={(event) => moveFocus(event, position)}
                onClick={() => {
                  openPreview(entry.id);
                  onJump(entry.index);
                }}
              >
                <span className="message-rail-tick" aria-hidden="true">
                  <span className="message-rail-stroke" />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {preview && (
        <div
          ref={card}
          className="message-rail-preview"
          onPointerEnter={cancelClose}
          onPointerLeave={closeAfterPointerLeaves}
        >
          <button
            type="button"
            className="message-rail-preview-jump"
            aria-label={`Jump to message ${previewPosition + 1}`}
            aria-describedby={previewDescriptionId}
            onClick={() => onJump(preview.index)}
          >
            <span id={previewDescriptionId}>
              <span className="message-rail-preview-title">
                <MarkdownPreview text={preview.preview} />
              </span>
              {preview.reply && (
                <span className="message-rail-preview-text">
                  <MarkdownPreview text={preview.reply} />
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            className="message-rail-favorite"
            aria-label="Favorite message"
            aria-pressed={favorites.has(preview.id)}
            title={favorites.has(preview.id) ? "Remove favorite" : "Add favorite"}
            onClick={() => toggleFavorite(preview.id)}
          >
            <Star aria-hidden="true" size={15} />
          </button>
        </div>
      )}
    </nav>
  );
}

export const MessageRail = memo(function MessageRail(props: MessageRailProps) {
  return <MessageRailContent key={props.sessionId} {...props} />;
});
