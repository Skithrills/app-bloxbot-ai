import { Bot, MousePointerClick, Shield } from "lucide-react";
import { memo } from "react";
import type { ApprovalMode } from "@/lib/config";
import { usePreferences } from "@/providers/PreferencesProvider";

interface ApprovalModeSwitcherProps {
  onAutoApproveRequested?: () => void;
}

const MODES: Array<{
  id: ApprovalMode;
  label: string;
  Icon: typeof Shield;
  title: string;
}> = [
  {
    id: "auto-approve",
    label: "Auto",
    Icon: Shield,
    title: "Auto-Approve — all permissions auto-approved (warning on enable)",
  },
  {
    id: "autopilot",
    label: "Pilot",
    Icon: Bot,
    title: "Autopilot — fully autonomous, no interruptions",
  },
  {
    id: "default",
    label: "Manual",
    Icon: MousePointerClick,
    title: "Manual — approve each permission request",
  },
];

const ApprovalModeSwitcher = memo(function ApprovalModeSwitcher({
  onAutoApproveRequested,
}: ApprovalModeSwitcherProps) {
  const { approvalMode, setApprovalMode } = usePreferences();

  function handleClick(mode: ApprovalMode) {
    if (mode === "auto-approve" && onAutoApproveRequested) {
      onAutoApproveRequested();
      return;
    }
    setApprovalMode(mode);
  }

  return (
    <div
      className="flex items-center rounded-md border bg-muted/50 p-0.5"
      role="radiogroup"
      aria-label="Approval mode"
    >
      {MODES.map(({ id, label, Icon, title }) => {
        const isActive = approvalMode === id;
        const isAutoApprove = id === "auto-approve";
        const isAutopilot = id === "autopilot";

        return (
          <button
            key={id}
            onClick={() => handleClick(id)}
            title={title}
            aria-pressed={isActive}
            className={`flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] font-medium transition-colors ${
              isActive
                ? isAutoApprove
                  ? "bg-amber-100 text-amber-800 shadow-sm"
                  : isAutopilot
                    ? "bg-purple-100 text-purple-800 shadow-sm"
                    : "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <Icon
              size={11}
              className={
                isActive && isAutoApprove
                  ? "text-amber-600"
                  : isActive && isAutopilot
                    ? "text-purple-600"
                    : ""
              }
            />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
});

export default ApprovalModeSwitcher;
