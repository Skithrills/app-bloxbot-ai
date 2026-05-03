import * as LucideIcons from "lucide-react";
import { Bot, ClipboardList, Gamepad2, Hammer, Lightbulb, Medal } from "lucide-react";

type LucideIcon = typeof LucideIcons.Bot;

const AGENT_ICON_MAP: Record<string, LucideIcon> = {
  plan: ClipboardList,
  studio: Gamepad2,
  build: Hammer,
  commander: Medal,
  brainstormer: Lightbulb,
};

interface AgentIconProps {
  agentId: string;
  className?: string;
  size?: number;
  /** Optional custom icon name (Lucide icon name like "Code", "Wrench") */
  iconName?: string;
}

function AgentIcon({ agentId, className, size = 16, iconName }: AgentIconProps) {
  // Try custom icon name first (for custom agents)
  if (iconName) {
    const CustomIcon = (LucideIcons as unknown as Record<string, LucideIcon>)[iconName];
    if (CustomIcon) return <CustomIcon size={size} className={className} />;
  }

  // Fall back to agent ID mapping
  const Icon = AGENT_ICON_MAP[agentId] ?? Bot;
  return <Icon size={size} className={className} />;
}

export default AgentIcon;
export type { AgentIconProps };
export { AGENT_ICON_MAP };
