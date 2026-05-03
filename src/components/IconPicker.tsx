import * as LucideIcons from "lucide-react";
import { useMemo, useRef, useState } from "react";

type LucideIcon = typeof LucideIcons.Bot;
// Cast through unknown since lucide-react exports non-component symbols too
const ICON_MODULE = LucideIcons as unknown as Record<string, LucideIcon | undefined>;

interface IconPickerProps {
  value: string | undefined;
  onChange: (icon: string | undefined) => void;
}

/**
 * Searchable Lucide icon picker.
 * Shows a text input with the selected icon preview, and a popover grid
 * of matching icons. Type to filter by icon name.
 */
function IconPicker({ value, onChange }: IconPickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Derive the icon names from the LucideIcons namespace
  const iconNames = useMemo(() => {
    return Object.keys(LucideIcons).filter(
      (key): key is keyof typeof LucideIcons =>
        typeof (LucideIcons as Record<string, unknown>)[key] === "function" &&
        key[0] === key[0]?.toUpperCase() &&
        key !== "default" &&
        key !== "createLucideIcon" &&
        key !== "IconNode" &&
        !key.startsWith("_"),
    );
  }, []);

  // Filter icons by search query
  const filtered = useMemo(() => {
    if (!search.trim()) return iconNames.slice(0, 80);
    const q = search.toLowerCase().replace(/[-_]/g, "");
    return iconNames.filter((name) => name.toLowerCase().includes(q)).slice(0, 120);
  }, [iconNames, search]);

  const SelectedIcon = value ? ICON_MODULE[value] : undefined;

  return (
    <div className="relative" ref={ref}>
      {/* Input + preview */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setShowPicker(!showPicker);
            if (!showPicker) setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent"
          title="Pick an icon"
        >
          {SelectedIcon ? (
            <SelectedIcon size={14} />
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground/50"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={value ?? ""}
          onChange={(e) => {
            onChange(e.target.value || undefined);
          }}
          placeholder="e.g. Code, Bot, Settings"
          className="h-8 flex-1 rounded border bg-background px-2 font-mono text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {value && (
          <button
            onClick={() => {
              onChange(undefined);
              setSearch("");
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            title="Clear icon"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Picker popover */}
      {showPicker && (
        <div className="absolute left-0 z-50 mt-1 w-80 rounded-lg border bg-popover shadow-lg">
          <div className="border-b p-1.5">
            <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-muted-foreground/50"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search icons..."
                className="h-7 flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none"
                autoFocus
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="grid max-h-64 grid-cols-8 gap-px overflow-y-auto p-2">
            {filtered.map((name) => {
              const Icon = ICON_MODULE[name];
              if (!Icon) return null;
              const isSelected = value === name;
              return (
                <button
                  key={name}
                  onClick={() => {
                    onChange(name);
                    setShowPicker(false);
                    setSearch("");
                  }}
                  className={`flex aspect-square items-center justify-center rounded-md text-xs transition-colors ${
                    isSelected
                      ? "bg-accent text-foreground ring-1 ring-ring"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                  title={name}
                >
                  <Icon size={14} />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-8 py-4 text-center text-xs text-muted-foreground">
                No icons matching &quot;{search}&quot;
              </div>
            )}
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {showPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowPicker(false);
            setSearch("");
          }}
        />
      )}
    </div>
  );
}

export default IconPicker;
