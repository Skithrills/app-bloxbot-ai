import {
  type FormInfo,
  type IntegrationInfo,
  type IntegrationMethod,
  type ModelInfo,
  OpenCode,
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageInfo,
  type SessionStructuredError,
  type PermissionRequest as V2PermissionRequest,
} from "@opencode/client";
import {
  canPredictDraft,
  composerNextMessagePrompt,
  composerPredictionPrompt,
  composerPredictionSuffix,
  isComposerPredictionModel,
  isZeroCost,
} from "../composerPredictions";
import { isKnownFreeModelKey } from "../freeModels";
import { freeLimitEndsAt, isFreeUsageLimit } from "../modelError";

import {
  OPENAI_API_PROVIDER,
  OPENAI_OAUTH_PROVIDER,
  toAppProviderID,
  toEngineProviderID,
} from "../openAiProfiles";
import { lastCompaction, summarizeSessionContext } from "../sessionContext";
import { withDelegationRouting } from "../subagentProfiles";
import { EventTranslator } from "./events";
import {
  historyToMessages,
  INBOX_DELIVERY_KEY,
  pendingUserMessage,
  todosFromHistory,
  toFormAnswer,
  toModelError,
  toolName,
  toQuestionRequest,
  toSession,
} from "./messages";
import type {
  AssistantMessage,
  Command,
  Event,
  InboxDelivery,
  McpStatus,
  Model,
  PermissionRequest,
  PermissionRuleset,
  Provider,
  ProviderAuthMethod,
  ProviderListResponse,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionGoal,
  SessionStatus,
  Todo,
} from "./types";

export interface RequestOptions {
  throwOnError?: boolean;
  signal?: AbortSignal;
}

/** The SDK-style result. `data` is only missing after a failure without `throwOnError`. */
export type Result<T> = { data: T; error?: unknown };

type FilePromptPart = { type: "file"; mime: string; url: string; filename?: string };
type TextPromptPart = { type: "text"; text: string };

export interface PromptInput {
  sessionID: string;
  model?: { providerID: string; modelID: string };
  requirePaidModel?: boolean;
  variant?: string;
  system?: string;
  parts: ReadonlyArray<TextPromptPart | FilePromptPart | { type: string; [key: string]: unknown }>;
  format?: { type: "json_schema"; schema: unknown; retryCount?: number };
}

export interface PromptResult {
  info: AssistantMessage & { structured?: unknown };
  parts: [];
}

type TurnModel = Pick<PromptInput, "sessionID" | "model" | "variant" | "requirePaidModel">;

const INSTRUCTIONS_KEY = "bloxbot.prompt";
const PREDICTION_SESSION = "bloxbotComposerPrediction";
const OAUTH_POLL_MS = 1000;
const PAGE_SIZE = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle<T>(
  options: RequestOptions | undefined,
  run: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return { data: await run() };
  } catch (error) {
    if (options?.throwOnError) throw error;
    return { data: undefined as T, error };
  }
}

function toRuleset(rules: PermissionRuleset) {
  return rules.map((rule) => ({
    action:
      rule.permission === "bash"
        ? "shell"
        : rule.permission === "task"
          ? "subagent"
          : rule.permission,
    resource: rule.pattern,
    effect: rule.action,
  }));
}

function toPermissionRequest(request: V2PermissionRequest): PermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: toolName(request.action),
    patterns: [...request.resources],
    metadata: request.metadata ?? {},
    always: [...(request.save ?? [])],
  };
}

function toAuthMethods(methods: ReadonlyArray<IntegrationMethod>): ProviderAuthMethod[] {
  return connectable(methods).map((method): ProviderAuthMethod => {
    if (method.type === "key") return { type: "api", label: method.label ?? "API key" };
    if (method.type === "external") return { type: "external", label: method.label };
    return {
      type: "oauth",
      label: method.label,
      prompts: (method.form ?? [])
        .filter((field) => !("hidden" in field && field.hidden))
        .map((field) => {
          const when = "when" in field ? field.when?.[0] : undefined;
          const base = {
            key: field.key,
            message: field.title ?? field.key,
            ...(when && typeof when.value === "string"
              ? { when: { key: when.key, op: when.op, value: when.value } }
              : {}),
          };
          return "options" in field && field.options?.length
            ? {
                ...base,
                type: "select" as const,
                options: field.options.map((option) => ({
                  label: option.label,
                  value: option.value,
                  hint: option.description,
                })),
              }
            : {
                ...base,
                type: "text" as const,
                placeholder: "placeholder" in field ? field.placeholder : undefined,
              };
        }),
    };
  });
}

type ConnectableMethod = Extract<IntegrationMethod, { type: "key" | "oauth" | "external" }>;

/** The ways to connect that BloxBot can offer, in the order the index in the UI refers to. */
function connectable(methods: ReadonlyArray<IntegrationMethod>): ConnectableMethod[] {
  return methods.filter(
    (method): method is ConnectableMethod =>
      method.type === "key" || method.type === "oauth" || method.type === "external",
  );
}

function toModel(model: ModelInfo): Model {
  const cost = model.cost[0];
  const media = (list: ReadonlyArray<string>) => ({
    text: list.includes("text"),
    audio: list.includes("audio"),
    image: list.includes("image"),
    video: list.includes("video"),
    pdf: list.includes("pdf"),
  });
  const { capabilities } = model;
  return {
    id: model.id,
    providerID: toAppProviderID(model.providerID),
    api: { id: model.modelID, url: "", npm: model.package ?? "" },
    name: model.name,
    family: model.family,
    capabilities: {
      temperature: capabilities.temperature ?? false,
      reasoning: "reasoning" in capabilities && Boolean(capabilities.reasoning),
      attachment: capabilities.input.length > 1,
      toolcall: capabilities.tools,
      input: media(capabilities.input),
      output: media(capabilities.output),
      interleaved: false,
    },
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cache: { read: cost?.cache.read ?? 0, write: cost?.cache.write ?? 0 },
    },
    limit: model.limit,
    status: model.status,
    serviceTier: typeof model.body?.service_tier === "string" ? model.body.service_tier : undefined,
    options: {},
    headers: {},
    releasedAt: model.time?.released,
    variants:
      model.variants.length > 0
        ? Object.fromEntries(
            model.variants.map((variant) => [variant.id, (variant.settings ?? {}) as object]),
          )
        : undefined,
  } as Model;
}

function providerSource(integration: IntegrationInfo): Provider["source"] {
  if (integration.connections.some((connection) => connection.type === "credential")) return "api";
  if (integration.connections.some((connection) => connection.type === "env")) return "env";
  return "custom";
}

/** An external login, like Claude Code's, that failed OpenCode's last check of it. */
function externalLoginProblem(integration: IntegrationInfo) {
  for (const connection of integration.connections) {
    if (connection.type === "credential" && connection.method === "external" && connection.status) {
      return connection.status;
    }
  }
  return undefined;
}

function toAppIntegration(integration: IntegrationInfo): IntegrationInfo {
  const id = toAppProviderID(integration.id);
  if (id !== OPENAI_OAUTH_PROVIDER) return integration;
  return {
    ...integration,
    id,
    name: "ChatGPT Subscription",
    methods: integration.methods.filter((method) => method.type === "oauth"),
    connections: integration.connections.filter(
      (connection) => connection.type === "credential" && connection.method === "oauth",
    ),
  };
}

function profileCanRun(integration: IntegrationInfo) {
  if (integration.id === OPENAI_API_PROVIDER) {
    return integration.connections.some(
      (connection) =>
        connection.type === "env" ||
        (connection.type === "credential" && connection.method === "key"),
    );
  }
  if (toAppProviderID(integration.id) === OPENAI_OAUTH_PROVIDER) {
    const active = integration.connections[0];
    return active?.type === "credential" && active.method === "oauth";
  }
  return true;
}

function toProviderList(
  integrations: ReadonlyArray<IntegrationInfo>,
  models: ReadonlyArray<ModelInfo>,
  defaultModel: ModelInfo | null,
): ProviderListResponse {
  const byProvider = new Map<string, Record<string, Model>>();
  for (const model of models) {
    if (!model.enabled || (model.type && model.type !== "chat")) continue;
    const providerID = toAppProviderID(model.providerID);
    const provider = byProvider.get(providerID) ?? {};
    provider[model.id] = toModel(model);
    byProvider.set(providerID, provider);
  }
  const all = integrations.map((native): Provider => {
    const integration = toAppIntegration(native);
    return {
      id: integration.id,
      name: integration.id === "opencode" ? "OpenCode Zen" : integration.name,
      source: providerSource(integration),
      env:
        integration.id === OPENAI_API_PROVIDER
          ? ["OPENAI_API_KEY"]
          : integration.methods.flatMap((method) =>
              method.type === "env" ? [...method.names] : [],
            ),
      options: {},
      models: profileCanRun(native) ? (byProvider.get(integration.id) ?? {}) : {},
    };
  });
  const connected = all
    .filter((provider) => Object.keys(provider.models).length > 0)
    // A signed-out Claude Code still lists its models.
    .filter(
      (provider) =>
        !integrations.some(
          (item) => toAppProviderID(item.id) === provider.id && externalLoginProblem(item),
        ),
    )
    .map((provider) => provider.id);
  const defaultProvider = defaultModel && toAppProviderID(defaultModel.providerID);
  return {
    all,
    default:
      defaultModel && defaultProvider && connected.includes(defaultProvider)
        ? { [defaultProvider]: defaultModel.id }
        : {},
    connected,
  };
}

/**
 * The OpenCode API as the app uses it, on top of OpenCode 2's client. It keeps the call shapes and
 * the data model in `types.ts`, so OpenCode's API changes stop at this file and `events.ts`.
 */
export function createOpencodeClient(options: {
  baseUrl: string;
  directory?: string;
  headers?: Record<string, string>;
}) {
  const api: OpenCodeClient = OpenCode.make({ baseUrl: options.baseUrl, headers: options.headers });
  const translator = new EventTranslator();
  const location = options.directory ? { directory: options.directory } : undefined;

  const forms = new Map<string, FormInfo>();
  const permissionSessions = new Map<string, string>();
  const oauthAttempts = new Map<string, string>();
  const sessionModels = new Map<string, string>();
  const exchanges = new Map<string, string[]>();
  let predictionInFlight = false;
  let predictionRetryAt = 0;

  const remember = (info: SessionInfo): Session => {
    const session = toSession(info);
    translator.rememberSession(session);
    return session;
  };

  const sessionLocation = async (sessionID?: string) =>
    sessionID ? (await api.session.get({ sessionID })).location : location;

  // A cursor carries its query, and OpenCode rejects one sent with the query's filters again.
  const history = async (sessionID: string): Promise<SessionMessageInfo[]> => {
    const entries: SessionMessageInfo[] = [];
    let page = await api.message.list({ sessionID, order: "asc", limit: PAGE_SIZE });
    for (;;) {
      entries.push(...page.data);
      if (page.data.length < PAGE_SIZE || !page.cursor.next) return entries;
      page = await api.message.list({ sessionID, limit: PAGE_SIZE, cursor: page.cursor.next });
    }
  };

  const listSessions = async (archived: boolean): Promise<Session[]> => {
    const sessions: Session[] = [];
    let page = await api.session.list({ archived, limit: PAGE_SIZE });
    for (;;) {
      sessions.push(
        ...page.data.filter((info) => !info.metadata?.[PREDICTION_SESSION]).map(remember),
      );
      if (page.data.length < PAGE_SIZE || !page.cursor.next) return sessions;
      page = await api.session.list({ limit: PAGE_SIZE, cursor: page.cursor.next });
    }
  };

  const readProviderCatalog = async () => {
    // Listing models loads config-defined providers. After a reload, integration.list can
    // return a nonempty catalog of built-in providers before that work finishes.
    const { data: models } = await api.model.list({ location });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data: integrations } = await api.integration.list({ location });
      if (integrations.length > 0) return { integrations, models };
      await sleep(250);
    }
    throw new Error("OpenCode's provider catalog is still loading.");
  };

  let pendingCatalog: ReturnType<typeof readProviderCatalog> | undefined;
  const providerCatalog = () => {
    pendingCatalog ??= readProviderCatalog().finally(() => {
      pendingCatalog = undefined;
    });
    return pendingCatalog;
  };

  const integration = async (providerID: string) =>
    (await api.integration.get({ integrationID: toEngineProviderID(providerID), location })).data;

  /** Applies the prompt's model and instructions, which OpenCode 2 keeps on the session. */
  const defaultModel = async () => {
    const { data } = await api.model.default({ location }).catch(() => ({ data: null }));
    if (!data) return undefined;
    const providerID = toAppProviderID(data.providerID);
    if (providerID === OPENAI_API_PROVIDER || providerID === OPENAI_OAUTH_PROVIDER) {
      if (!profileCanRun(await integration(providerID))) {
        const { integrations, models } = await providerCatalog();
        const list = toProviderList(integrations, models, null);
        const provider = list.all.find((item) => list.connected.includes(item.id));
        const fallback = provider && Object.values(provider.models)[0];
        if (!fallback) throw new Error("Connect a provider before sending a message.");
        return { providerID: fallback.providerID, modelID: fallback.id };
      }
    }
    return { providerID, modelID: data.id };
  };

  const applyTurnModel = async (input: TurnModel) => {
    const { sessionID, variant } = input;
    if (
      input.requirePaidModel &&
      (!input.model || isKnownFreeModelKey(`${input.model.providerID}/${input.model.modelID}`))
    ) {
      throw new Error("Connect a paid provider or turn off Hide free models.");
    }
    // A chat keeps its last model. With none selected, as when that model's provider was
    // disconnected, it moves to OpenCode's default instead of failing on the old one.
    const model = input.model ?? (await defaultModel());
    if (model) {
      const key = `${model.providerID}/${model.modelID}#${variant ?? ""}`;
      if (sessionModels.get(sessionID) !== key) {
        await api.session.switchModel({
          sessionID,
          model: { id: model.modelID, providerID: toEngineProviderID(model.providerID), variant },
        });
        sessionModels.set(sessionID, key);
      }
    }
  };

  const prepareTurn = async (input: PromptInput) => {
    await applyTurnModel(input);
    const { sessionID } = input;
    const system = input.system?.includes("studio_id")
      ? withDelegationRouting(input.system)
      : input.system;
    if (system) {
      await api.experimental.session.instructions.entry.put({
        sessionID,
        key: INSTRUCTIONS_KEY,
        value: system,
      });
    } else {
      await api.experimental.session.instructions.entry
        .remove({ sessionID, key: INSTRUCTIONS_KEY })
        .catch(() => undefined);
    }
  };

  const sendPrompt = async (input: PromptInput, suffix = "") => {
    await prepareTurn(input);
    const text = input.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    const files = input.parts.flatMap((part) =>
      part.type === "file"
        ? [{ uri: part.url as string, name: part.filename as string | undefined }]
        : [],
    );
    return api.session.prompt({
      sessionID: input.sessionID,
      text: `${text}${suffix}`,
      files: files.length > 0 ? files : undefined,
      resume: true,
    });
  };

  /**
   * One model reply that runs no tools and leaves the chat's history alone. Generate requests keep
   * the session's tools, which OpenCode's free tier requires. Nothing is remembered between them,
   * so a follow-up carries the earlier exchange itself.
   */
  const prompt = async (input: PromptInput): Promise<PromptResult> => {
    await prepareTurn(input);
    const { sessionID, model, format } = input;
    const info = {
      role: "assistant",
      sessionID,
      modelID: model?.modelID,
      providerID: model?.providerID,
    } as PromptResult["info"];
    const instruction = format
      ? `\n\nAnswer with only one JSON object matching this JSON schema, with no other text:\n${JSON.stringify(format.schema)}`
      : "";
    const asked = input.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    const earlier = exchanges.get(sessionID) ?? [];
    const attempts = (format?.retryCount ?? 0) + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let reply: string;
      try {
        ({ text: reply } = await api.session.generate({
          sessionID,
          prompt: [...earlier, `${asked}${instruction}`].join("\n\n"),
        }));
      } catch (error) {
        info.error = toModelError(toStructuredError(error));
        return { info, parts: [] };
      }
      if (!format) return { info, parts: [] };
      const structured = parseJsonObject(reply);
      if (structured !== undefined) {
        info.structured = structured;
        return { info, parts: [] };
      }
      earlier.push(`You were asked: ${asked}`, `You replied: ${reply}`);
      exchanges.set(sessionID, earlier);
    }
    info.error = {
      name: "StructuredOutputError",
      data: { message: "The model did not return the requested JSON.", retries: attempts },
    } as AssistantMessage["error"];
    return { info, parts: [] };
  };

  const client = {
    composer: {
      /**
       * Continues a draft. With nothing typed yet, `context` is the end of the chat and the
       * suggestion is the whole next message.
       */
      predict: async (
        { draft, modelID, context }: { draft: string; modelID: string; context?: string },
        { signal }: Pick<RequestOptions, "signal"> = {},
      ): Promise<string | null> => {
        const nextMessage = draft === "" && context ? context : null;
        if (
          predictionInFlight ||
          Date.now() < predictionRetryAt ||
          signal?.aborted ||
          (!nextMessage && !canPredictDraft(draft)) ||
          !isKnownFreeModelKey(`opencode/${modelID}`)
        ) {
          return null;
        }

        predictionInFlight = true;
        let sessionID: string | undefined;
        try {
          const { integrations, models } = await providerCatalog();
          const native = models.find(
            (item) => item.providerID === "opencode" && item.id === modelID,
          );
          const provider = toProviderList(integrations, native ? [native] : [], null).all.find(
            ({ id }) => id === "opencode",
          );
          const model = provider?.models[modelID];
          // Use the built-in anonymous Zen connection, with explicit zero pricing in the catalog.
          if (
            signal?.aborted ||
            !native?.cost.length ||
            !native.cost.every(isZeroCost) ||
            !provider ||
            !model ||
            !isComposerPredictionModel(provider, model)
          ) {
            return null;
          }

          const scratch = await api.session.create({
            title: "Composer prediction",
            model: { id: modelID, providerID: "opencode" },
            metadata: { bloxbotHidden: true, [PREDICTION_SESSION]: true },
            location,
          });
          sessionID = scratch.id;
          if (
            signal?.aborted ||
            scratch.model?.providerID !== "opencode" ||
            scratch.model.id !== modelID
          ) {
            return null;
          }
          // This endpoint supplies the tools Zen expects without running them or writing history.
          const reply = await api.session.generate(
            {
              sessionID,
              prompt: nextMessage
                ? composerNextMessagePrompt(nextMessage)
                : composerPredictionPrompt(draft),
            },
            { signal },
          );
          return signal?.aborted ? null : composerPredictionSuffix(draft, reply.text);
        } catch (error) {
          if (!signal?.aborted) {
            const failure = toModelError(toStructuredError(error));
            predictionRetryAt = isFreeUsageLimit(failure)
              ? freeLimitEndsAt(failure, Date.now())
              : Date.now() + 30_000;
          }
          return null;
        } finally {
          if (sessionID) {
            await api.session
              .remove({ sessionID }, { signal: AbortSignal.timeout(5000) })
              .catch(() => undefined);
          }
          predictionInFlight = false;
        }
      },
    },
    session: {
      create: (
        input: {
          title?: string;
          parentID?: string;
          metadata?: Record<string, string | number | boolean>;
          permission?: PermissionRuleset;
          directory?: string;
        },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () =>
          remember(
            await api.session.create({
              title: input.title,
              parentID: input.parentID,
              metadata: input.metadata,
              location: input.directory ? { directory: input.directory } : location,
              permissions: input.permission ? toRuleset(input.permission) : undefined,
            }),
          ),
        ),
      move: (input: { sessionID: string; directory?: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const directory = input.directory ?? location?.directory;
          if (!directory) throw new Error("The default workspace is unavailable.");
          await api.session.move({ sessionID: input.sessionID, directory });
          await api.experimental.session.wait({ sessionID: input.sessionID });
          return remember(await api.session.get({ sessionID: input.sessionID }));
        }),
      update: (
        input: { sessionID: string; title?: string; time?: { archived?: number } },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          await api.session.update({
            sessionID: input.sessionID,
            title: input.title,
            archived: input.time ? Boolean(input.time.archived) : undefined,
          });
          return remember(await api.session.get({ sessionID: input.sessionID }));
        }),
      delete: (input: { sessionID: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await api.session.remove({ sessionID: input.sessionID });
          translator.forgetSession(input.sessionID);
          sessionModels.delete(input.sessionID);
          exchanges.delete(input.sessionID);
          return true;
        }),
      status: (_input: object = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const active = await api.session.active();
          return Object.fromEntries(
            Object.keys(active).map((sessionID): [string, SessionStatus] => [
              sessionID,
              { type: "busy" },
            ]),
          ) as Record<string, SessionStatus>;
        }),
      context: (
        input: { sessionID: string; beforeMessageID?: string },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () =>
          summarizeSessionContext(
            await api.session.context(
              { sessionID: input.sessionID },
              { signal: requestOptions?.signal },
            ),
            input.beforeMessageID,
          ),
        ),
      messages: (
        input: { sessionID: string; includePending?: boolean },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          const { sessionID, includePending } = input;
          const observer = includePending ? translator.observeInbox(sessionID) : undefined;
          try {
            // Read the inbox first so an item delivered during the history request is returned once.
            const inbox = includePending
              ? await api.session.inbox.list({ sessionID }, { signal: requestOptions?.signal })
              : [];
            const messages = await history(sessionID);
            const transcript = historyToMessages(
              sessionID,
              messages,
              translator.inboxDeliveries(sessionID),
            );
            if (!observer) return transcript;
            const pending = inbox.flatMap((item) =>
              item.type === "user"
                ? [pendingUserMessage(sessionID, item.id, item.time.created, item)]
                : [],
            );
            return translator.rememberTranscript(sessionID, transcript, pending, observer.changes);
          } finally {
            observer?.stop();
          }
        }),
      inbox: {
        cancel: (input: { sessionID: string; inboxID: string }, requestOptions?: RequestOptions) =>
          settle(requestOptions, () =>
            api.session.inbox.cancel(input, { signal: requestOptions?.signal }),
          ),
        update: (
          input: { sessionID: string; inboxID: string; delivery: InboxDelivery },
          requestOptions?: RequestOptions,
        ) =>
          settle(requestOptions, async () => {
            const { sessionID, inboxID, delivery } = input;
            const observer = translator.observeInbox(sessionID);
            try {
              await api.session.inbox.update(input, { signal: requestOptions?.signal });
              if (observer.isActive() && observer.changes.get(inboxID) !== "cancelled") {
                translator.rememberInboxDelivery(sessionID, inboxID, delivery);
              }
            } finally {
              observer.stop();
            }
          }),
      },
      todo: (input: { sessionID: string }, requestOptions?: RequestOptions) =>
        settle(
          requestOptions,
          async (): Promise<Todo[]> => todosFromHistory(await history(input.sessionID)),
        ),
      /** Stops the turn. With `wait`, answers once it has stopped, so another can start. */
      abort: (input: { sessionID: string; wait?: boolean }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await api.session.interrupt({ sessionID: input.sessionID });
          if (input.wait) await api.experimental.session.wait({ sessionID: input.sessionID });
          return true;
        }),
      promptAsync: (input: PromptInput, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await sendPrompt(input);
        }),
      /** Sends a native inbox message while preserving the session's agent and instructions. */
      promptInbox: (
        input: {
          sessionID: string;
          text: string;
          delivery: InboxDelivery;
          files?: Array<{ uri: string; name?: string }>;
          model?: { providerID: string; modelID: string };
          studioTargetID?: string | null;
        },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          const { sessionID, text, delivery, files, model, studioTargetID } = input;
          if (studioTargetID !== undefined) {
            const entries = await api.experimental.session.instructions.entry.list({ sessionID });
            const instructions = entries.find(({ key }) => key === INSTRUCTIONS_KEY)?.value;
            const routedID =
              typeof instructions === "string"
                ? instructions.match(
                    /^Route every Roblox Studio MCP tool call for this request to studio_id ("(?:[^"\\]|\\.)*")\./,
                  )?.[1]
                : undefined;
            if (
              routedID !== (studioTargetID === null ? undefined : JSON.stringify(studioTargetID))
            ) {
              throw new Error(
                "The Studio selection changed. Send this message once the chat is idle.",
              );
            }
          }
          if (model) {
            await api.session.switchModel({
              sessionID,
              model: { id: model.modelID, providerID: model.providerID },
            });
            sessionModels.delete(sessionID);
          }
          return api.session.prompt({
            sessionID,
            text,
            delivery,
            files,
            metadata: { [INBOX_DELIVERY_KEY]: delivery },
            resume: true,
          });
        }),
      prompt: (input: PromptInput, requestOptions?: RequestOptions) =>
        settle(requestOptions, () => prompt(input)),
      /** Runs one of OpenCode's slash commands, such as /goal, instead of sending it as a prompt. */
      command: (input: PromptInput & { name: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await prepareTurn(input);
          await api.session.command({
            sessionID: input.sessionID,
            name: input.name,
            text: input.parts
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n"),
            files: input.parts.flatMap((part) =>
              part.type === "file"
                ? [{ uri: part.url as string, name: part.filename as string | undefined }]
                : [],
            ),
          });
        }),
      compact: (
        input: TurnModel & { waitForCompletion?: boolean },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          const { sessionID, waitForCompletion } = input;
          const previous = waitForCompletion
            ? lastCompaction(await api.session.context({ sessionID }))
            : undefined;
          if (waitForCompletion && (await api.session.active())[sessionID]) {
            throw new Error("Wait for the chat to finish before compacting.");
          }
          if (input.model || input.requirePaidModel) await applyTurnModel(input);
          await api.session.compact({ sessionID });
          if (!waitForCompletion) return;

          await api.experimental.session.wait({ sessionID });
          const latest = lastCompaction(await api.session.context({ sessionID }));
          if (!latest || latest.id === previous?.id || latest.status === "running") {
            throw new Error("OpenCode did not report a compaction result.");
          }
          if (latest.status === "failed") throw new Error(latest.error.message);
        }),
      fork: (input: { sessionID: string; before?: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => remember(await api.session.fork(input))),
      /** Rewinds the chat to before a message. Sending again makes it final. */
      /**
       * With `files`, the files the chat changed from that message on go back to how they were
       * too, and the answer says how many. Redo puts them forward again.
       */
      undo: (
        input: { sessionID: string; messageID: string; files?: boolean },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          await api.session.interrupt({ sessionID: input.sessionID });
          await api.experimental.session.wait({ sessionID: input.sessionID });
          const staged = await api.session.revert.stage(input);
          return { files: staged?.files?.length ?? 0 };
        }),
      redo: (input: { sessionID: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await api.session.revert.clear(input);
        }),
      /** The chat as OpenCode stores it, for saving to a file. */
      exportData: (input: { sessionID: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => ({
          info: await api.session.get({ sessionID: input.sessionID }),
          messages: await history(input.sessionID),
        })),
    },
    experimental: {
      session: {
        /** Every session. OpenCode 2 lists archived sessions on their own, so this asks twice. */
        list: (_input: { archived?: boolean } = {}, requestOptions?: RequestOptions) =>
          settle(requestOptions, async () => {
            const [active, archived] = await Promise.all([listSessions(false), listSessions(true)]);
            return [...active, ...archived];
          }),
      },
    },
    event: {
      subscribe: async (_input: object = {}, requestOptions?: RequestOptions) => {
        const iterator = api.event
          .subscribe({ signal: requestOptions?.signal })
          [Symbol.asyncIterator]();
        // The SDK starts the stream on its first read. Connect before the caller refetches
        // snapshots, so native changes during that request are buffered by the SDK.
        const first = await iterator.next();
        async function* translated(): AsyncGenerator<Event> {
          const predictionSessions = new Set<string>();
          try {
            for (let next = first; !next.done; next = await iterator.next()) {
              const event = next.value;
              if (event.type === "session.created" && event.data.metadata?.[PREDICTION_SESSION]) {
                predictionSessions.add(event.data.sessionID);
              }
              if ("sessionID" in event.data && predictionSessions.has(event.data.sessionID)) {
                if (event.type === "session.deleted")
                  predictionSessions.delete(event.data.sessionID);
                continue;
              }
              yield* translator.translate(event);
            }
          } finally {
            await iterator.return?.();
          }
        }
        return { stream: translated() };
      },
    },
    goal: {
      get: (input: { sessionID: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const { output } = await api.rpc.call({
            rpcID: "opencode.goal",
            method: "get",
            input,
            location,
          });
          return (output ?? null) as SessionGoal | null;
        }),
    },
    location: {
      /** Rereads config, commands, agents and skills without restarting. */
      reload: (requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await api.location.reload();
        }),
    },
    command: {
      list: (_input: object = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const commands = await api.command.list({ location });
          return commands.data.map(
            (command): Command => ({
              name: command.name,
              description: command.description,
              template: "",
              hints: [],
            }),
          );
        }),
    },
    mcp: {
      status: (_input: object = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const servers = await api.mcp.list({ location });
          return Object.fromEntries(
            servers.data.map((server) => [server.name, server.status as McpStatus]),
          );
        }),
      connect: (input: { name: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await api.experimental.mcp.connect({ server: input.name, location });
          return true;
        }),
    },
    instance: {
      dispose: (_input: object = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          await api.location.reload();
          return true;
        }),
    },
    provider: {
      list: (_input: object = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const [catalog, defaultModel] = await Promise.all([
            providerCatalog(),
            api.model.default({ location }).catch(() => ({ data: null })),
          ]);
          return toProviderList(catalog.integrations, catalog.models, defaultModel.data);
        }),
      auth: (_input: object = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          return Object.fromEntries(
            (await providerCatalog()).integrations
              .map(toAppIntegration)
              .map((item) => [item.id, toAuthMethods(item.methods)]),
          );
        }),
      oauth: {
        authorize: (
          input: { providerID: string; method: number; inputs?: Record<string, string> },
          requestOptions?: RequestOptions,
        ) =>
          settle(requestOptions, async () => {
            const { methods } = toAppIntegration(await integration(input.providerID));
            const method = connectable(methods)[input.method];
            if (method?.type !== "oauth") throw new Error("This sign-in method isn't available.");
            const attempt = await api.integration.oauth.connect({
              integrationID: toEngineProviderID(input.providerID),
              methodID: method.id,
              answer: input.inputs,
              location,
            });
            oauthAttempts.set(input.providerID, attempt.data.attemptID);
            return {
              url: attempt.data.url,
              method: attempt.data.mode === "code" ? ("code" as const) : ("auto" as const),
              instructions: attempt.data.instructions,
            };
          }),
        callback: (
          input: { providerID: string; method: number; code?: string },
          requestOptions?: RequestOptions,
        ) =>
          settle(requestOptions, async () => {
            const attemptID = oauthAttempts.get(input.providerID);
            if (!attemptID) throw new Error("Start the sign-in again.");
            const ids = {
              integrationID: toEngineProviderID(input.providerID),
              attemptID,
              location,
            };
            if (input.code) {
              await api.integration.oauth.complete({ ...ids, code: input.code });
              oauthAttempts.delete(input.providerID);
              return true;
            }
            for (;;) {
              const { data: status } = await api.integration.oauth.status(ids);
              if (status.status === "complete") break;
              if (status.status === "failed") throw new Error(status.message);
              if (status.status === "expired") throw new Error("The sign-in timed out.");
              await sleep(OAUTH_POLL_MS);
            }
            await api.integration.oauth.complete(ids).catch(() => undefined);
            oauthAttempts.delete(input.providerID);
            return true;
          }),
      },
    },
    auth: {
      set: (
        input: { providerID: string; auth: { type: "api"; key: string } },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          const providerID = input.providerID === "openai" ? OPENAI_API_PROVIDER : input.providerID;
          if (providerID === OPENAI_OAUTH_PROVIDER) {
            throw new Error("Use the OpenAI API Key profile to enter a key.");
          }
          await api.integration.connect.key({
            integrationID: providerID,
            key: input.auth.key,
            location,
          });
          return true;
        }),
      /** Asks OpenCode to use a login it doesn't hold, and check it. Connecting again rechecks. */
      connectExternal: (
        input: { providerID: string; methodIndex: number },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          const { methods, connections } = await integration(input.providerID);
          const method = connectable(methods)[input.methodIndex];
          if (method?.type !== "external") throw new Error("Choose a way to connect first.");
          await api.integration.connect.external({
            integrationID: input.providerID,
            methodID: method.id,
            location,
          });
          // Each connect saves a new account, so drop the ones this replaces.
          await Promise.all(
            connections.flatMap((connection) =>
              connection.type === "credential"
                ? [api.credential.remove({ credentialID: connection.id }).catch(() => undefined)]
                : [],
            ),
          );
          return true;
        }),
      /** Where OpenCode's check of an external login has got to. */
      externalStatus: (input: { providerID: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const [info, models] = await Promise.all([
            integration(input.providerID),
            api.model.list({ location }),
          ]);
          const problem = externalLoginProblem(info);
          if (problem) return { state: "problem" as const, message: problem.message };
          const ready = models.data.some(
            (model) => model.providerID === input.providerID && model.enabled,
          );
          return { state: ready ? ("ready" as const) : ("checking" as const) };
        }),
      remove: (input: { providerID: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const { id, connections } = toAppIntegration(await integration(input.providerID));
          await Promise.all(
            connections.flatMap((connection) =>
              connection.type === "credential" &&
              (id !== OPENAI_API_PROVIDER || connection.method === "key")
                ? [api.credential.remove({ credentialID: connection.id })]
                : [],
            ),
          );
          return true;
        }),
    },
    permission: {
      list: (input: { sessionID?: string } = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const requests = await api.permission.request.list({
            location: await sessionLocation(input.sessionID),
          });
          for (const request of requests.data) {
            permissionSessions.set(request.id, request.sessionID);
          }
          return requests.data.map(toPermissionRequest);
        }),
      reply: (
        input: {
          requestID: string;
          sessionID?: string;
          reply: "once" | "always" | "reject";
          message?: string;
        },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          let sessionID = input.sessionID ?? permissionSessions.get(input.requestID);
          if (!sessionID) {
            const requests = await api.permission.request.list({ location });
            sessionID = requests.data.find((request) => request.id === input.requestID)?.sessionID;
          }
          if (!sessionID) throw new Error("This approval request is no longer open.");
          await api.permission.reply({
            sessionID,
            requestID: input.requestID,
            decision: input.reply,
            message: input.message,
          });
          permissionSessions.delete(input.requestID);
          return true;
        }),
    },
    question: {
      list: (input: { sessionID?: string } = {}, requestOptions?: RequestOptions) =>
        settle(requestOptions, async (): Promise<QuestionRequest[]> => {
          const open = input.sessionID
            ? await api.session.form.list({ sessionID: input.sessionID })
            : (await api.form.list({ location })).data;
          for (const form of open) forms.set(form.id, form);
          return open.map(toQuestionRequest);
        }),
      reply: (
        input: { requestID: string; sessionID?: string; answers: QuestionAnswer[] },
        requestOptions?: RequestOptions,
      ) =>
        settle(requestOptions, async () => {
          const form = await findForm(input.requestID, input.sessionID);
          await api.session.form.reply({
            sessionID: form.sessionID,
            formID: form.id,
            answer: toFormAnswer(form, input.answers),
          });
          forms.delete(form.id);
          return true;
        }),
      reject: (input: { requestID: string; sessionID?: string }, requestOptions?: RequestOptions) =>
        settle(requestOptions, async () => {
          const form = await findForm(input.requestID, input.sessionID);
          await api.session.form.cancel({ sessionID: form.sessionID, formID: form.id });
          forms.delete(form.id);
          return true;
        }),
    },
  };

  const findForm = async (formID: string, sessionID?: string): Promise<FormInfo> => {
    const known = forms.get(formID);
    if (known) return known;
    if (sessionID) {
      return api.session.form.get({ sessionID, formID });
    }
    const open = await api.form.list({ location });
    const form = open.data.find((candidate) => candidate.id === formID);
    if (!form) throw new Error("This question is no longer open.");
    return form;
  };

  return client;
}

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

/** A failed request in the shape a failed turn reports, so callers handle both the same way. */
function toStructuredError(error: unknown): SessionStructuredError {
  const fields = error as {
    reason?: string;
    message?: string;
    status?: number;
    retryAfterMs?: number;
  };
  return {
    type: fields.reason ?? "unknown",
    message: fields.message ?? String(error),
    status: fields.status,
    retryAfterMs: fields.retryAfterMs,
  };
}

/** The JSON object in a model's reply, which some models wrap in a code fence or a sentence. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
