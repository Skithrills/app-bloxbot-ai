import { ArrowUpRight, Bot } from "lucide-react";
import { useMemo } from "react";
import { useSessions } from "@/hooks/useSessions";
import {
  type SubagentStatus,
  useSubagentMetrics,
  useSubagentModelLabel,
  useSubagentStatus,
} from "@/hooks/useSubagentSession";
import { effortLabel } from "@/lib/effort";
import { formatModelCost } from "@/lib/modelCost";
import type { Session, ToolPart } from "@/lib/opencode/types";
import { subagentsForSession } from "@/lib/sessionVisibility";
import { subagentProfileName } from "@/lib/subagentProfiles";
import { useActiveSession } from "@/providers/ActiveSessionProvider";

const statusStyles: Record<SubagentStatus, string> = {
  Waiting: "bg-accent text-accent-foreground",
  Running: "bg-primary/10 text-primary",
  Completed: "bg-muted text-foreground",
  Error: "bg-destructive/10 text-destructive",
  Stopped: "bg-muted text-muted-foreground",
};

const subagentColors = [
  "text-violet-700 dark:text-violet-400",
  "text-teal-700 dark:text-teal-400",
  "text-rose-700 dark:text-rose-400",
  "text-amber-700 dark:text-amber-400",
  "text-sky-700 dark:text-sky-400",
  "text-emerald-700 dark:text-emerald-400",
  "text-fuchsia-700 dark:text-fuchsia-400",
  "text-orange-700 dark:text-orange-400",
];

export function SubagentIcon({
  session,
  threadAgents,
}: {
  session?: Session;
  threadAgents: readonly Session[];
}) {
  let color = "text-muted-foreground";
  if (session) {
    // Use creation order so a status update or a newly spawned agent keeps existing colors stable.
    const older = threadAgents.filter(
      (agent) =>
        agent.time.created < session.time.created ||
        (agent.time.created === session.time.created && agent.id < session.id),
    ).length;
    color = subagentColors[older % subagentColors.length];
  }
  return <Bot aria-hidden="true" className={`shrink-0 ${color}`} size={16} />;
}

export function SubagentStatusBadge({ status }: { status: SubagentStatus }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}

function textField(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function SubagentToolCard({
  part,
  onOpen,
}: {
  part: ToolPart;
  onOpen?: (sessionID: string) => void;
}) {
  const state = part.state;
  const metadata = "metadata" in state ? state.metadata : undefined;
  const childId =
    textField(metadata?.sessionID) ??
    textField(metadata?.sessionId) ??
    textField(state.input.sessionID);
  const { data: sessions } = useSessions();
  const { activeSessionId } = useActiveSession();
  const threadAgents = useMemo(
    () => (activeSessionId && sessions ? subagentsForSession(sessions, activeSessionId) : []),
    [activeSessionId, sessions],
  );
  const child = threadAgents.find((session) => session.id === childId);
  const currentStatus = useSubagentStatus(child);
  const metrics = useSubagentMetrics(child);
  const model = useSubagentModelLabel(metrics.model) ?? textField(state.input.model);
  const effort = metrics.model ? effortLabel(metrics.model.variant ?? null) : undefined;
  const role = child?.agent ?? textField(state.input.agent) ?? textField(state.input.subagent_type);
  const description = textField(state.input.description) ?? child?.title;
  const fallbackStatus = {
    pending: "Waiting",
    running: "Running",
    completed: metadata?.status === "running" ? "Running" : "Completed",
    error: "Error",
  } as const;
  const status = currentStatus ?? fallbackStatus[state.status];

  return (
    <div className="my-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SubagentIcon session={child} threadAgents={threadAgents} />
        <span className="min-w-0 truncate text-sm font-medium">
          {role ? subagentProfileName(role) : "Subagent"}
        </span>
        <SubagentStatusBadge status={status} />
      </div>
      {description && <p className="mt-1 break-words text-xs text-foreground">{description}</p>}
      {model && (
        <p className="mt-1 break-words text-xs text-muted-foreground">
          {model}
          {effort && ` · ${effort} effort`}
        </p>
      )}
      {child && (
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {metrics.tokens.toLocaleString()} tokens · {metrics.steps}{" "}
          {metrics.steps === 1 ? "step" : "steps"}
          {metrics.cost !== undefined && (
            <span title="Reported subagent session cost in US dollars">
              {` · ${formatModelCost(metrics.cost)}`}
            </span>
          )}
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-1 break-words text-xs text-destructive">{state.error}</p>
      )}
      {state.status === "completed" && state.output && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Task result</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{state.output.slice(0, 3000)}</p>
        </details>
      )}
      {child && onOpen && (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => onOpen(child.id)}
        >
          Open Subagent Chat <ArrowUpRight aria-hidden="true" size={13} />
        </button>
      )}
    </div>
  );
}
