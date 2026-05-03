import type { Theme } from "@/lib/config";
import { usePreferences } from "@/providers/PreferencesProvider";

const CYCLE: Theme[] = ["system", "light", "dark"];

const LABEL: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

function ThemeToggle() {
  const { theme, setTheme } = usePreferences();

  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];

  return (
    <button
      className="inline-flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABEL[theme]} (click for ${LABEL[next]})`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {theme === "dark" ? (
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="5" />
            <line x1="12" x2="12" y1="1" y2="3" />
            <line x1="12" x2="12" y1="21" y2="23" />
            <line x1="4.22" x2="5.64" y1="4.22" y2="5.64" />
            <line x1="18.36" x2="19.78" y1="18.36" y2="19.78" />
            <line x1="1" x2="3" y1="12" y2="12" />
            <line x1="21" x2="23" y1="12" y2="12" />
            <line x1="4.22" x2="5.64" y1="19.78" y2="18.36" />
            <line x1="18.36" x2="19.78" y1="5.64" y2="4.22" />
          </>
        )}
      </svg>
      {LABEL[theme]}
    </button>
  );
}

export default ThemeToggle;
