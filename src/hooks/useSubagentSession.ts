import { useTranscript } from "@/hooks/useMessages";
import { useActivePermission } from "@/hooks/usePermissions";
import { useAllModels } from "@/hooks/useProviders";
import { useActiveQuestion } from "@/hooks/useQuestions";
import { useSessionStatus } from "@/hooks/useSessionStatuses";
import { modelLabel } from "@/lib/modelChoice";
import { toAppProviderID } from "@/lib/openAiProfiles";
import type { Session, SessionStatus } from "@/lib/opencode/types";
import type { MessagesCache } from "@/lib/sseDispatch";

export type SubagentStatus = "Waiting" | "Running" | "Completed" | "Error" | "Stopped";

export function subagentStatus(
  session: Session,
  status: SessionStatus | undefined,
): SubagentStatus {
  if (status?.type === "retry") return "Waiting";
  if (status?.type === "busy") return "Running";
  if (session.outcome === "succeeded") return "Completed";
  if (session.outcome === "failed") return "Error";
  if (session.outcome === "interrupted") return "Stopped";
  return status?.type !== "idle" && (session.time.busy ?? 0) > (session.time.idle ?? 0)
    ? "Running"
    : "Waiting";
}

export function useSubagentStatus(session: Session | undefined): SubagentStatus | undefined {
  const id = session?.id ?? null;
  const status = useSessionStatus(id);
  const question = useActiveQuestion(id);
  const permission = useActivePermission(id);
  if (!session) return undefined;
  return question || permission ? "Waiting" : subagentStatus(session, status);
}

function selectMetrics(cache: MessagesCache) {
  let steps = 0;
  let tokens = 0;
  let cost = 0;
  let latestReply = "";
  let model: Session["model"];
  for (const id of cache.messageIds) {
    const message = cache.messagesById[id];
    if (message?.info.role !== "assistant") continue;
    steps += 1;
    if (message.info.modelID && message.info.providerID) {
      model = {
        id: message.info.modelID,
        providerID: message.info.providerID,
        variant: message.info.variant,
      };
    }
    const usage = message.info.tokens;
    tokens +=
      usage.total ??
      usage.input + usage.output + usage.reasoning + usage.cache.read + usage.cache.write;
    if (Number.isFinite(message.info.cost) && message.info.cost > 0) cost += message.info.cost;
    if (!message.info.error && message.info.time.completed) {
      const reply = message.parts
        .flatMap((part) => (part.type === "text" && !part.ignored ? [part.text] : []))
        .join("\n\n")
        .trim();
      if (reply) latestReply = reply;
    }
  }
  return { steps, tokens, cost, latestReply, model };
}

export function useSubagentMetrics(session: Session | undefined) {
  const metrics = useTranscript(session?.id ?? null, selectMetrics, { includePending: true });
  const tokens = session?.tokens;
  const cost = session?.cost ?? metrics?.cost ?? 0;
  return {
    steps: metrics?.steps ?? 0,
    tokens: tokens
      ? tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
      : (metrics?.tokens ?? 0),
    cost: Number.isFinite(cost) && cost > 0 ? cost : undefined,
    latestReply: metrics?.latestReply ?? "",
    model: session?.model ?? metrics?.model,
  };
}

export function useSubagentModelLabel(model: Session["model"]): string | undefined {
  const models = useAllModels();
  if (!model) return undefined;
  const providerID = toAppProviderID(model.providerID);
  const info = models.find((option) => option.id === model.id && option.providerId === providerID);
  return info ? modelLabel(info) : `${providerID}/${model.id}`;
}
