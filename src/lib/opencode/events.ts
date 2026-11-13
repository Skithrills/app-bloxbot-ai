import type { OpenCodeEvent } from "@opencode/client";
import type { MessageWithParts } from "./messages";
import {
  assistantInfo,
  pendingUserMessage,
  providerFinished,
  textPartId,
  todosFromToolMetadata,
  toModelError,
  toolName,
  toolResult,
  toQuestionRequest,
  toToolPart,
} from "./messages";
import type {
  AssistantMessage,
  Event,
  EventGoalChanged,
  InboxDelivery,
  Part,
  Session,
  ToolPart,
  UserMessage,
} from "./types";

type Translated = Event;
type InboxChange = "pending" | "delivered" | "cancelled";
type InboxChanges = Map<string, InboxChange>;

const inboxDeliveryKey = (sessionID: string) => `bloxbot.inbox-delivery.v1:${sessionID}`;

const abortedError = {
  name: "MessageAbortedError",
  data: { message: "The response was stopped before it finished." },
} as Extract<Event, { type: "session.error" }>["properties"]["error"];

/**
 * Rebuilds the message-and-part event stream the app consumes from OpenCode 2's events, which
 * describe a turn in smaller steps and leave out anything a client can work out for itself. It holds
 * only what a later event needs: the sessions, the open assistant messages and their tool calls.
 */
export class EventTranslator {
  private readonly sessions = new Map<string, Session>();
  private readonly assistants = new Map<string, AssistantMessage>();
  private readonly tools = new Map<string, ToolPart>();
  private readonly lastUser = new Map<string, UserMessage>();
  private readonly inbox = new Map<string, ReturnType<typeof pendingUserMessage>>();
  private readonly inboxDeliveryOverrides = new Map<string, Map<string, InboxDelivery>>();
  private readonly inboxObservers = new Map<string, Set<InboxChanges>>();
  private readonly unreadSteers = new Map<
    string,
    Map<string, { created: number; fromSnapshot: boolean }>
  >();
  private readonly stepSteers = new Map<string, ReadonlySet<string>>();
  private readonly confirmedSteers = new Map<string, Set<string>>();

  rememberSession(session: Session): void {
    this.sessions.set(session.id, session);
  }

  forgetSession(sessionID: string): void {
    this.sessions.delete(sessionID);
    this.lastUser.delete(sessionID);
    this.unreadSteers.delete(sessionID);
    this.confirmedSteers.delete(sessionID);
    this.inboxDeliveryOverrides.delete(sessionID);
    this.saveInboxDeliveries(sessionID);
    this.inboxObservers.delete(sessionID);
    for (const [id, item] of this.inbox) {
      if (item.info.sessionID === sessionID) this.inbox.delete(id);
    }
    for (const [id, item] of this.assistants) {
      if (item.sessionID !== sessionID) continue;
      this.assistants.delete(id);
      this.stepSteers.delete(id);
    }
  }

  private loadInboxDeliveries(sessionID: string): Map<string, InboxDelivery> {
    const existing = this.inboxDeliveryOverrides.get(sessionID);
    if (existing) return existing;
    const overrides = new Map<string, InboxDelivery>();
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(inboxDeliveryKey(sessionID)) ?? "null",
      );
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [id, delivery] of Object.entries(stored)) {
          if (delivery === "queue" || delivery === "steer") overrides.set(id, delivery);
        }
      }
    } catch {
      // Receipts still work in memory when renderer storage is unavailable.
    }
    this.inboxDeliveryOverrides.set(sessionID, overrides);
    return overrides;
  }

  private saveInboxDeliveries(sessionID: string): void {
    const key = inboxDeliveryKey(sessionID);
    const overrides = this.inboxDeliveryOverrides.get(sessionID);
    try {
      if (overrides?.size) {
        localStorage.setItem(key, JSON.stringify(Object.fromEntries(overrides)));
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Storage failures must not fail a confirmed OpenCode operation.
    }
  }

  inboxDeliveries(sessionID: string): ReadonlyMap<string, InboxDelivery> {
    return this.loadInboxDeliveries(sessionID);
  }

  rememberInboxDelivery(sessionID: string, inboxID: string, delivery: InboxDelivery): void {
    const overrides = this.loadInboxDeliveries(sessionID);
    if (overrides.get(inboxID) === delivery) return;
    overrides.set(inboxID, delivery);
    this.saveInboxDeliveries(sessionID);
  }

  observeInbox(sessionID: string) {
    const observers = this.inboxObservers.get(sessionID) ?? new Set<InboxChanges>();
    this.inboxObservers.set(sessionID, observers);
    const changes: InboxChanges = new Map();
    observers.add(changes);
    return {
      changes,
      isActive: () => this.inboxObservers.get(sessionID) === observers,
      stop: () => {
        observers.delete(changes);
        if (observers.size === 0 && this.inboxObservers.get(sessionID) === observers) {
          this.inboxObservers.delete(sessionID);
        }
      },
    };
  }

  rememberTranscript(
    sessionID: string,
    messages: MessageWithParts[],
    pending: ReturnType<typeof pendingUserMessage>[],
    changes: InboxChanges,
  ): MessageWithParts[] {
    const deliveredIds = new Set(messages.map(({ info }) => info.id));
    for (const [id, item] of this.inbox) {
      if (item.info.sessionID === sessionID && (!changes.has(id) || deliveredIds.has(id))) {
        this.inbox.delete(id);
      }
    }
    for (const item of pending) {
      const { info } = item;
      const change = changes.get(info.id);
      if (
        deliveredIds.has(info.id) ||
        change === "delivered" ||
        change === "cancelled" ||
        this.inbox.has(info.id)
      )
        continue;
      const changedDelivery =
        change === "pending" ? this.inboxDeliveries(sessionID).get(info.id) : undefined;
      this.inbox.set(
        info.id,
        changedDelivery
          ? { ...item, info: { ...info, inbox: { delivery: changedDelivery, state: "pending" } } }
          : item,
      );
    }
    const precedingSteers = new Set<string>();
    const confirmed = this.confirmedSteers.get(sessionID);
    for (const [index, message] of messages.entries()) {
      const { info } = message;
      if (info.role === "assistant") {
        if (!info.time.completed && !this.assistants.has(info.id)) {
          this.assistants.set(info.id, info);
          this.stepSteers.set(info.id, new Set(precedingSteers));
        }
        continue;
      }
      if (message.parts.some((part) => part.type === "compaction")) {
        precedingSteers.clear();
        continue;
      }
      if (info.time.created >= (this.lastUser.get(sessionID)?.time.created ?? 0)) {
        this.lastUser.set(sessionID, info);
      }
      if (info.inbox?.state === "read") {
        this.unreadSteers.get(sessionID)?.delete(info.id);
        confirmed?.delete(info.id);
      }
      if (info.inbox?.state === "delivered" && info.inbox.delivery === "steer") {
        if (confirmed?.has(info.id)) {
          messages[index] = {
            ...message,
            info: { ...info, inbox: { ...info.inbox, state: "read" } },
          };
          continue;
        }
        this.rememberUnreadSteer(info, true);
        precedingSteers.add(info.id);
      }
    }
    if (confirmed?.size === 0) this.confirmedSteers.delete(sessionID);
    const snapshotPendingIds = new Set(pending.map(({ info }) => info.id));
    for (const { info } of pending) {
      const current = this.inbox.get(info.id);
      if (current) messages.push(current);
    }
    for (const [id, item] of this.inbox) {
      if (item.info.sessionID === sessionID && !snapshotPendingIds.has(id)) messages.push(item);
    }
    return messages;
  }

  private inboxChanged(sessionID: string, inboxID: string, state: InboxChange): void {
    for (const changes of this.inboxObservers.get(sessionID) ?? []) changes.set(inboxID, state);
  }

  private rememberUnreadSteer(info: UserMessage, fromSnapshot = false): void {
    if (info.inbox?.delivery !== "steer") return;
    const unread = this.unreadSteers.get(info.sessionID) ?? new Map();
    if (!fromSnapshot || !unread.has(info.id))
      unread.set(info.id, { created: info.time.created, fromSnapshot });
    this.unreadSteers.set(info.sessionID, unread);
  }

  private markSteersRead(sessionID: string, assistantID: string): Translated[] {
    const steers = this.stepSteers.get(assistantID);
    const unread = this.unreadSteers.get(sessionID);
    if (!steers || !unread) return [];
    this.stepSteers.delete(assistantID);
    const events: Translated[] = [];
    const confirmed = this.confirmedSteers.get(sessionID) ?? new Set<string>();
    for (const messageID of steers) {
      if (!unread.delete(messageID)) continue;
      confirmed.add(messageID);
      events.push({ type: "message.inbox.read", properties: { sessionID, messageID } });
    }
    if (confirmed.size) this.confirmedSteers.set(sessionID, confirmed);
    if (unread.size === 0) this.unreadSteers.delete(sessionID);
    return events;
  }

  private updateSession(sessionID: string, change: (session: Session) => Session): Translated[] {
    const session = this.sessions.get(sessionID);
    if (!session) return [];
    const info = change(session);
    this.sessions.set(sessionID, info);
    return [{ type: "session.updated", properties: { sessionID, info } }];
  }

  private textPart(
    sessionID: string,
    messageID: string,
    kind: "text" | "reasoning",
    ordinal: number,
    text: string,
    time: { start: number; end?: number },
  ): Translated {
    const part = {
      id: textPartId(messageID, kind, ordinal),
      sessionID,
      messageID,
      type: kind,
      text,
      time,
    } as Part;
    return { type: "message.part.updated", properties: { sessionID, part, time: time.start } };
  }

  private toolEvent(part: ToolPart): Translated {
    // A settled call gets no more events, so its input and output aren't kept.
    if (part.state.status === "completed" || part.state.status === "error") {
      this.tools.delete(part.id);
    } else {
      this.tools.set(part.id, part);
    }
    return {
      type: "message.part.updated",
      properties: { sessionID: part.sessionID, part, time: Date.now() },
    };
  }

  private settle(
    sessionID: string,
    outcome: NonNullable<Session["outcome"]>,
    at: number,
  ): Translated[] {
    return [
      ...this.updateSession(sessionID, (session) => ({
        ...session,
        outcome,
        time: { ...session.time, updated: at, idle: at },
      })),
      { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
      { type: "session.idle", properties: { sessionID } },
    ];
  }

  translate(event: OpenCodeEvent): Translated[] {
    const created = "created" in event && typeof event.created === "number" ? event.created : 0;
    switch (event.type) {
      case "session.created": {
        const { data } = event;
        const info = {
          id: data.sessionID,
          slug: data.slug,
          projectID: data.projectID,
          directory: data.location.directory,
          parentID: data.parentID,
          title: data.title ?? "",
          agent: data.agent,
          model: data.model,
          version: data.version,
          metadata: data.metadata,
          time: { created, updated: created },
        } as Session;
        this.sessions.set(info.id, info);
        return [{ type: "session.created", properties: { sessionID: info.id, info } }];
      }
      case "session.agent.selected":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          agent: event.data.agent,
        }));
      case "session.moved":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          directory: event.data.location.directory,
          projectID: event.data.projectID,
        }));
      case "session.model.selected":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          model: event.data.model,
        }));
      case "session.usage.updated":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          cost: event.data.cost,
          tokens: event.data.tokens,
        }));
      case "session.renamed":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          title: event.data.title,
          time: { ...session.time, updated: created },
        }));
      case "session.metadata.updated":
        return this.updateSession(
          event.data.sessionID,
          (session) => ({ ...session, metadata: event.data.metadata }) as Session,
        );
      case "session.archived":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          time: { ...session.time, archived: created },
        }));
      case "session.unarchived":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          time: { ...session.time, archived: undefined },
        }));
      case "session.deleted": {
        const { sessionID } = event.data;
        const info = this.sessions.get(sessionID) ?? ({ id: sessionID } as Session);
        this.forgetSession(sessionID);
        return [{ type: "session.deleted", properties: { sessionID, info } }];
      }
      case "session.status":
        return [
          {
            type: "session.status",
            properties: event.data as Extract<Event, { type: "session.status" }>["properties"],
          },
        ];
      case "session.idle":
        return [{ type: "session.idle", properties: { sessionID: event.data.sessionID } }];
      case "session.execution.started":
        return [
          ...this.updateSession(event.data.sessionID, (session) => ({
            ...session,
            outcome: undefined,
            time: { ...session.time, updated: created, busy: created },
          })),
          {
            type: "session.status",
            properties: { sessionID: event.data.sessionID, status: { type: "busy" } },
          },
        ];
      case "session.execution.succeeded":
        return this.settle(event.data.sessionID, "succeeded", created);
      case "session.execution.failed":
        return [
          {
            type: "session.error",
            properties: {
              sessionID: event.data.sessionID,
              error: toModelError(event.data.error),
            },
          },
          ...this.settle(event.data.sessionID, "failed", created),
        ];
      case "session.execution.interrupted":
        return [
          {
            type: "session.error",
            properties: { sessionID: event.data.sessionID, error: abortedError },
          },
          ...this.settle(event.data.sessionID, "interrupted", created),
        ];
      case "session.retry.scheduled":
        return [
          {
            type: "session.status",
            properties: {
              sessionID: event.data.sessionID,
              status: {
                type: "retry",
                attempt: event.data.attempt,
                message: event.data.error.message,
                next: event.data.at,
              },
            },
          },
        ];
      case "session.inbox.enqueued": {
        const { inboxID, sessionID, item } = event.data;
        if (item.type !== "user") return [];
        this.inboxChanged(sessionID, inboxID, "pending");
        const message = pendingUserMessage(sessionID, inboxID, created, item);
        this.inbox.set(inboxID, message);
        return message.info.inbox
          ? [{ type: "message.inbox.pending", properties: { sessionID, ...message } }]
          : [];
      }
      case "session.inbox.delivery.changed": {
        const { sessionID, inboxID, delivery } = event.data;
        this.inboxChanged(sessionID, inboxID, "pending");
        this.rememberInboxDelivery(sessionID, inboxID, delivery);
        const previous = this.inbox.get(inboxID);
        if (!previous) return [];
        const info: UserMessage = { ...previous.info, inbox: { delivery, state: "pending" } };
        const message = { ...previous, info };
        this.inbox.set(inboxID, message);
        return [{ type: "message.inbox.pending", properties: { sessionID, ...message } }];
      }
      case "session.inbox.delivered": {
        const { sessionID, inboxID } = event.data;
        this.inboxChanged(sessionID, inboxID, "delivered");
        const pending = this.inbox.get(inboxID);
        if (!pending) return [];
        this.inbox.delete(inboxID);
        const info: UserMessage = { ...pending.info, time: { created } };
        if (info.inbox) info.inbox = { ...info.inbox, state: "delivered" };
        if (created >= (this.lastUser.get(sessionID)?.time.created ?? 0)) {
          this.lastUser.set(sessionID, info);
        }
        this.rememberUnreadSteer(info);
        return [
          { type: "message.updated", properties: { sessionID, info, inboxDelivered: true } },
          ...pending.parts.map(
            (part): Translated => ({
              type: "message.part.updated",
              properties: { sessionID, part, time: created },
            }),
          ),
        ];
      }
      case "session.inbox.cancelled": {
        const { sessionID, inboxID } = event.data;
        this.inboxChanged(sessionID, inboxID, "cancelled");
        this.inbox.delete(inboxID);
        // The cancel endpoint can also succeed when the item was already delivered.
        if (this.loadInboxDeliveries(sessionID).delete(inboxID))
          this.saveInboxDeliveries(sessionID);
        return [
          {
            type: "message.removed",
            properties: { sessionID, messageID: inboxID },
          },
        ];
      }
      case "session.step.started": {
        const { sessionID, assistantMessageID: id, agent, model, started } = event.data;
        const info = assistantInfo(
          sessionID,
          { id, agent, model, time: { created: started } },
          this.lastUser.get(sessionID)?.id ?? "",
        );
        // Native event order associates each steer with its step, even when timestamps tie.
        // A steer learned through a snapshot is eligible only if it precedes this step.
        if (!this.stepSteers.has(id)) {
          const steers = new Set<string>();
          for (const [steerID, steer] of this.unreadSteers.get(sessionID) ?? []) {
            if (!steer.fromSnapshot || steer.created < started) steers.add(steerID);
          }
          if (steers.size) this.stepSteers.set(id, steers);
        }
        this.assistants.set(id, info);
        return [
          { type: "message.updated", properties: { sessionID, info } },
          {
            type: "message.part.updated",
            properties: {
              sessionID,
              time: started,
              part: { id: `${id}:start`, sessionID, messageID: id, type: "step-start" },
            },
          },
        ];
      }
      case "session.step.ended":
      case "session.step.failed": {
        const { sessionID, assistantMessageID: id } = event.data;
        const previous = this.assistants.get(id);
        if (!previous) return [];
        const failed = event.type === "session.step.failed";
        const receipts =
          !failed && providerFinished(event.data.finish) ? this.markSteersRead(sessionID, id) : [];
        this.assistants.delete(id);
        this.stepSteers.delete(id);
        const info = {
          ...previous,
          time: { ...previous.time, completed: created },
          cost: event.data.cost ?? previous.cost,
          tokens: event.data.tokens ?? previous.tokens,
          finish: failed ? "error" : event.data.finish,
          error: failed ? toModelError(event.data.error) : undefined,
        } as AssistantMessage;
        const updated: Translated = { type: "message.updated", properties: { sessionID, info } };
        if (failed) return [updated];
        return [
          ...receipts,
          updated,
          {
            type: "message.part.updated",
            properties: {
              sessionID,
              time: created,
              part: {
                id: `${id}:finish`,
                sessionID,
                messageID: id,
                type: "step-finish",
                reason: event.data.finish,
                cost: info.cost,
                tokens: info.tokens,
              },
            },
          },
        ];
      }
      case "session.text.started":
      case "session.reasoning.started": {
        const { sessionID, assistantMessageID: id, ordinal } = event.data;
        const kind = event.type === "session.text.started" ? "text" : "reasoning";
        return [this.textPart(sessionID, id, kind, ordinal, "", { start: created })];
      }
      case "session.text.delta":
      case "session.reasoning.delta": {
        const { sessionID, assistantMessageID: messageID, ordinal, delta } = event.data;
        const kind = event.type === "session.text.delta" ? "text" : "reasoning";
        return [
          ...(delta ? this.markSteersRead(sessionID, messageID) : []),
          {
            type: "message.part.delta",
            properties: {
              sessionID,
              messageID,
              partID: textPartId(messageID, kind, ordinal),
              field: "text",
              delta,
            },
          },
        ];
      }
      case "session.text.ended":
      case "session.reasoning.ended": {
        const { sessionID, assistantMessageID: id, ordinal, text } = event.data;
        const kind = event.type === "session.text.ended" ? "text" : "reasoning";
        return [
          ...(text ? this.markSteersRead(sessionID, id) : []),
          this.textPart(sessionID, id, kind, ordinal, text, { start: created, end: created }),
        ];
      }
      case "session.tool.input.started": {
        const { sessionID, assistantMessageID: messageID, id, name } = event.data;
        return [
          this.toolEvent(
            toToolPart(sessionID, messageID, {
              type: "tool",
              id,
              name,
              state: { status: "streaming", input: "" },
              time: { created },
            }),
          ),
        ];
      }
      case "session.tool.called": {
        const { sessionID, assistantMessageID: messageID, id, input } = event.data;
        return [
          ...this.markSteersRead(sessionID, messageID),
          this.toolEvent(
            toToolPart(sessionID, messageID, {
              type: "tool",
              id,
              name: this.tools.get(id)?.tool ?? "",
              state: { status: "running", input, metadata: {} },
              time: { created, ran: created },
            }),
          ),
        ];
      }
      case "session.tool.progress": {
        const { id, metadata } = event.data;
        const previous = this.tools.get(id);
        if (previous?.state.status !== "running") return [];
        return [
          this.toolEvent({
            ...previous,
            state: {
              ...previous.state,
              metadata: { ...previous.state.metadata, ...metadata },
            },
          }),
        ];
      }
      case "session.tool.success": {
        const { sessionID, assistantMessageID: messageID, id, content, metadata } = event.data;
        const previous = this.tools.get(id);
        if (!previous) return [];
        this.tools.delete(id);
        const start = "time" in previous.state ? previous.state.time.start : created;
        const todos = previous.tool === "todowrite" ? todosFromToolMetadata(metadata) : null;
        const part: ToolPart = {
          ...previous,
          state: {
            status: "completed",
            input: previous.state.input,
            ...toolResult(sessionID, messageID, id, content),
            title: "",
            metadata:
              metadata ??
              ("metadata" in previous.state ? previous.state.metadata : undefined) ??
              {},
            time: { start, end: created },
          },
        };
        return [
          this.toolEvent(part),
          ...(todos
            ? [{ type: "todo.updated", properties: { sessionID, todos } } satisfies Translated]
            : []),
        ];
      }
      case "session.tool.failed": {
        const { sessionID, assistantMessageID, id, error, content, metadata } = event.data;
        const previous = this.tools.get(id);
        if (!previous) return [];
        this.tools.delete(id);
        const start = "time" in previous.state ? previous.state.time.start : created;
        const attachments =
          content && toolResult(sessionID, assistantMessageID, id, content).attachments;
        return [
          this.toolEvent({
            ...previous,
            state: {
              status: "error",
              input: previous.state.input,
              error: error.message,
              ...(attachments ? { attachments } : {}),
              metadata:
                metadata ?? ("metadata" in previous.state ? previous.state.metadata : undefined),
              time: { start, end: created },
            },
          }),
        ];
      }
      // The goal plugin's own event, which arrives on the same stream.
      case "rpc.opencode.goal.changed":
        return [{ type: "goal.changed", properties: event.data as EventGoalChanged["properties"] }];
      case "session.revert.staged": {
        const { messageID } = event.data.revert;
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          revert: { messageID },
        }));
      }
      case "session.revert.cleared":
        return this.updateSession(event.data.sessionID, (session) => ({
          ...session,
          revert: undefined,
        }));
      case "session.revert.committed":
        return [
          ...this.updateSession(event.data.sessionID, (session) => ({
            ...session,
            revert: undefined,
          })),
          { type: "session.compacted", properties: { sessionID: event.data.sessionID } },
        ];
      // The chat is read again at each stage, so it shows the compaction starting, then how it ended.
      case "session.compaction.started":
      case "session.compaction.failed":
      case "session.compaction.ended":
        return [{ type: "session.compacted", properties: { sessionID: event.data.sessionID } }];
      case "permission.asked":
        return [
          {
            type: "permission.asked",
            properties: {
              id: event.data.id,
              sessionID: event.data.sessionID,
              permission: toolName(event.data.action),
              patterns: [...event.data.resources],
              metadata: event.data.metadata ?? {},
              always: [...(event.data.save ?? [])],
            },
          },
        ];
      case "permission.replied":
        return [{ type: "permission.replied", properties: event.data }];
      case "form.created":
        return [{ type: "question.asked", properties: toQuestionRequest(event.data.form) }];
      case "form.replied":
        return [
          {
            type: "question.replied",
            properties: {
              sessionID: event.data.sessionID,
              requestID: event.data.id,
              answers: Object.values(event.data.answer).map((value) =>
                Array.isArray(value) ? value.map(String) : [String(value)],
              ),
            },
          },
        ];
      case "form.cancelled":
        return [
          {
            type: "question.rejected",
            properties: { sessionID: event.data.sessionID, requestID: event.data.id },
          },
        ];
      default:
        return [];
    }
  }
}
