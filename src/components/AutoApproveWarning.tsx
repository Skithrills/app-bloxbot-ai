import { AlertTriangle, FileText, Globe, Shield, Terminal } from "lucide-react";
import { memo } from "react";

interface AutoApproveWarningProps {
  onConfirm: () => void;
  onCancel: () => void;
}

const RISKS = [
  {
    icon: FileText,
    label: "File system access (read/write)",
  },
  {
    icon: Terminal,
    label: "Shell command execution",
  },
  {
    icon: Globe,
    label: "Network requests",
  },
  {
    icon: Shield,
    label: "Any future tool permissions",
  },
] as const;

const AutoApproveWarning = memo(function AutoApproveWarning({
  onConfirm,
  onCancel,
}: AutoApproveWarningProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="mx-4 w-full max-w-sm animate-fade-in-up rounded-xl border bg-card p-6 shadow-xl"
        role="alertdialog"
        aria-labelledby="auto-approve-warning-title"
        aria-describedby="auto-approve-warning-body"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle size={16} className="text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="auto-approve-warning-title" className="text-sm font-semibold text-foreground">
              Enable Auto-Approve?
            </h3>
            <p
              id="auto-approve-warning-body"
              className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              All tool permission requests will be automatically approved for this session. This
              includes:
            </p>
          </div>
        </div>

        <ul className="mt-3 space-y-1.5">
          {RISKS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Icon size={12} className="shrink-0 text-amber-500" />
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
          The agent will have unrestricted access until you switch back to Manual mode. This warning
          will appear each time you enable Auto-Approve.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Enable
          </button>
        </div>
      </div>
    </div>
  );
});

export default AutoApproveWarning;
