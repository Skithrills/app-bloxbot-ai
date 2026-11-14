import { Check, Monitor, Moon, Sun } from "lucide-react";
import ThemeEditor from "@/components/ThemeEditor";
import { ACCENT_OPTIONS, THEME_OPTIONS, useTheme } from "@/components/theme-provider";

const modeIcons = { light: Sun, dark: Moon, system: Monitor };

export default function PersonalisationSettings() {
  const { theme, setTheme, accent, setAccent, presetAccent } = useTheme();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 @xl:px-6 @xl:py-8">
      <h4 className="text-lg font-medium text-foreground">Personalisation</h4>

      <fieldset className="mt-6">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Colour mode</legend>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ value, label }) => {
            const Icon = modeIcons[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                className="flex items-center justify-center gap-1.5 rounded-lg border bg-card px-2 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-foreground/40 aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground"
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
        {presetAccent && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {presetAccent.name} uses its own colour mode. This setting applies to Default and custom
            themes.
          </p>
        )}
      </fieldset>

      <ThemeEditor />

      <fieldset className="mt-6">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Accent colour</legend>
        {presetAccent && (
          <button
            type="button"
            aria-pressed={accent === null}
            onClick={() => setAccent(null)}
            className="mb-2 flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-foreground/40 aria-pressed:text-foreground"
          >
            <span
              className="size-3.5 rounded-full"
              style={{ backgroundColor: presetAccent.palette.brand }}
            />
            {presetAccent.name} accent
          </button>
        )}
        <div className="grid grid-cols-4 gap-2">
          {ACCENT_OPTIONS.map((option) => {
            const selected = accent === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setAccent(option.value)}
                aria-pressed={selected}
                className={`rounded-lg border px-2 py-2.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                  selected
                    ? "border-foreground/40 bg-accent font-medium text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {/* The name and the tick carry the choice, so it never rests on hue alone. */}
                <span
                  data-accent={option.value}
                  className="mx-auto grid size-7 place-items-center rounded-full bg-brand text-brand-foreground"
                >
                  {selected && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                </span>
                <span className="mt-1.5 block text-xs">{option.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {presetAccent
            ? `Changes the accent for ${presetAccent.name} on send buttons, links, focus outlines and running chats.`
            : "Sets the default accent for send buttons, links, focus outlines and running chats. Custom palettes can override it."}
        </p>
      </fieldset>

      <div className="mt-6">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Accent preview</div>
        <AccentPreview />
      </div>
    </div>
  );
}

/** A still of the places the accent shows up, so a choice can be judged without leaving Settings. */
function AccentPreview() {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3" aria-hidden="true">
      <div className="flex items-center gap-2 rounded-xl border border-brand/60 bg-background px-3 py-2 ring-2 ring-brand/25">
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Make the lobby door open when a player walks up
        </span>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-brand" />
          Chat running
        </span>
        <span className="text-brand-text underline decoration-brand/40 underline-offset-2">
          A link in a reply
        </span>
        <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-brand">
          <span className="inline-block size-3.5 translate-x-5 rounded-full bg-background" />
        </span>
      </div>
    </div>
  );
}
