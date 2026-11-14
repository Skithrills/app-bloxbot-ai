import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useTheme } from "@/components/theme-provider";

/* ── Custom toast icons ──────────────────────────────────────────── */

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.866 2.5a1 1 0 0 0-1.732 0L1.34 13a1 1 0 0 0 .866 1.5h11.588a1 1 0 0 0 .866-1.5L8.866 2.5Z"
        fill="color-mix(in oklab, var(--destructive) 12%, transparent)"
        stroke="var(--destructive)"
        strokeWidth="1.2"
      />
      <path d="M8 6v3" stroke="var(--destructive)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.25" r="0.75" fill="var(--destructive)" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="8"
        cy="8"
        r="6.4"
        fill="color-mix(in oklab, var(--success) 12%, transparent)"
        stroke="var(--success)"
        strokeWidth="1.2"
      />
      <path
        d="M5.5 8.2 7.1 9.8 10.5 6.4"
        stroke="var(--success)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="8"
        cy="8"
        r="6.4"
        fill="color-mix(in oklab, var(--info) 12%, transparent)"
        stroke="var(--info)"
        strokeWidth="1.2"
      />
      <path d="M8 7v3.5" stroke="var(--info)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="5.25" r="0.75" fill="var(--info)" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8.866 2.5a1 1 0 0 0-1.732 0L1.34 13a1 1 0 0 0 .866 1.5h11.588a1 1 0 0 0 .866-1.5L8.866 2.5Z"
        fill="color-mix(in oklab, var(--warning) 15%, transparent)"
        stroke="var(--warning)"
        strokeWidth="1.2"
      />
      <path d="M8 6v3" stroke="var(--warning)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.25" r="0.75" fill="var(--warning)" />
    </svg>
  );
}

/* ── Toaster component ───────────────────────────────────────────── */

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="bottom-right"
      closeButton
      gap={8}
      icons={{
        error: <ErrorIcon />,
        success: <SuccessIcon />,
        info: <InfoIcon />,
        warning: <WarningIcon />,
      }}
      toastOptions={{
        style: {
          pointerEvents: "auto",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // Ensure the toaster container doesn't block the title bar
          pointerEvents: "none",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
