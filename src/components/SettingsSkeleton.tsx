const NAV_WIDTHS = ["w-20", "w-24", "w-16", "w-24", "w-28", "w-24", "w-28", "w-12", "w-16"];
const ROW_WIDTHS = ["w-1/3", "w-1/2", "w-1/4", "w-2/5", "w-1/3"];

/**
 * Stands in for Settings while its code loads. It keeps the same sidebar and pane, so the
 * real screen replaces it without anything moving. It lives outside Settings.tsx because
 * that file is the part still loading.
 */
export default function SettingsSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1 bg-sidebar" aria-busy="true">
      <span className="sr-only">Loading settings</span>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @xl:flex-row">
        <div className="flex shrink-0 flex-col @xl:w-56">
          <div className="flex h-11 shrink-0 items-center gap-1 px-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Back to chat"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h3 className="text-sm font-medium">Settings</h3>
          </div>
          <div className="flex shrink-0 gap-1 overflow-hidden px-2 pb-2 @xl:flex-col @xl:gap-0.5 @xl:pt-1">
            {NAV_WIDTHS.map((width, index) => (
              <div key={`${index}-${width}`} className="flex h-8 shrink-0 items-center gap-2 px-2">
                <div className="skeleton size-3.5 shrink-0 rounded" />
                <div className={`skeleton h-3 rounded ${width}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-t-xl border-x border-t bg-background">
          <div className="mx-auto w-full max-w-2xl px-4 py-6 @xl:px-6 @xl:py-8">
            <div className="skeleton h-5 w-32 rounded" />
            <div className="skeleton mt-3 h-3 w-64 max-w-full rounded" />
            <div className="mt-6 space-y-2">
              {ROW_WIDTHS.map((width, index) => (
                <div
                  key={`${index}-${width}`}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-3"
                >
                  <div className="skeleton size-7 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className={`skeleton h-3 rounded ${width}`} />
                    <div className="skeleton h-2.5 w-2/5 rounded" />
                  </div>
                  <div className="skeleton h-7 w-16 shrink-0 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
