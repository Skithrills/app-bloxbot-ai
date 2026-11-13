import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { fetchMessages, mergeMessagesSnapshot } from "@/hooks/useMessages";
import type { OpencodeClient } from "@/lib/opencode/client";
import type { UserMessage } from "@/lib/opencode/types";
import { qk } from "@/lib/queryKeys";
import type { MessagesCache } from "@/lib/sseDispatch";
import type { MessageWithParts } from "@/types";

function message(id: string, text: string): MessageWithParts {
  return {
    info: { id, sessionID: "s1", role: "assistant" },
    parts: [{ id: `${id}-part`, sessionID: "s1", messageID: id, type: "text", text }],
  } as MessageWithParts;
}

describe("message snapshot reconciliation", () => {
  it("includes pending native inbox items when first loading a chat", async () => {
    const pending = {
      ...message("m1", "After this turn"),
      info: { ...message("m1", "").info, role: "user" },
    };
    const messages = vi.fn().mockResolvedValue({ data: [pending] });
    const client = { session: { messages } } as unknown as OpencodeClient;

    await expect(fetchMessages(client, new QueryClient(), "s1")).resolves.toEqual({
      messageIds: ["m1"],
      messagesById: { m1: pending },
    });
    expect(messages).toHaveBeenCalledExactlyOnceWith(
      { sessionID: "s1", includePending: true },
      { throwOnError: true },
    );
  });

  it("preserves messages updated by SSE while an HTTP snapshot is loading", () => {
    const before: MessagesCache = {
      messageIds: ["m1"],
      messagesById: { m1: message("m1", "before") },
    };
    const fetched: MessagesCache = {
      messageIds: ["m1"],
      messagesById: { m1: message("m1", "stale fetch") },
    };
    const after: MessagesCache = {
      messageIds: ["m1", "m2"],
      messagesById: {
        m1: message("m1", "streamed update"),
        m2: message("m2", "streamed addition"),
      },
    };

    const merged = mergeMessagesSnapshot(before, fetched, after);

    expect(merged.messageIds).toEqual(["m1", "m2"]);
    expect(merged.messagesById.m1).toBe(after.messagesById.m1);
    expect(merged.messagesById.m2).toBe(after.messagesById.m2);
  });

  it("does not resurrect a message removed by SSE during the fetch", () => {
    const retained = message("m2", "retained");
    const before: MessagesCache = {
      messageIds: ["m1", "m2"],
      messagesById: { m1: message("m1", "before"), m2: retained },
    };
    const fetched: MessagesCache = {
      messageIds: ["m1", "m2"],
      messagesById: { m1: message("m1", "stale fetch"), m2: message("m2", "fresh fetch") },
    };
    const after: MessagesCache = {
      messageIds: ["m2"],
      messagesById: { m2: retained },
    };

    const merged = mergeMessagesSnapshot(before, fetched, after);

    expect(merged.messageIds).toEqual(["m2"]);
    expect(merged.messagesById.m1).toBeUndefined();
  });

  it("keeps delivery order when pending inbox items are admitted during a history fetch", () => {
    function queued(id: string, state: "pending" | "delivered"): MessageWithParts {
      const info: UserMessage = {
        id,
        sessionID: "s1",
        time: { created: 1 },
        role: "user",
        agent: "studio",
        model: { providerID: "opencode", modelID: "fixture" },
        inbox: { delivery: "queue", state },
      };
      return { ...message(id, id), info };
    }
    const before = {
      messageIds: ["first", "second"],
      messagesById: { first: queued("first", "pending"), second: queued("second", "pending") },
    };
    const after = {
      messageIds: ["second", "reply", "first"],
      messagesById: {
        first: queued("first", "delivered"),
        second: queued("second", "delivered"),
        reply: message("reply", "A turn ran between deliveries"),
      },
    };
    expect(mergeMessagesSnapshot(before, before, after)).toEqual(after);
  });

  it("does not resurrect a message added and removed while the snapshot loads", () => {
    const transient = message("m1", "transient");
    const fetched: MessagesCache = {
      messageIds: ["m1"],
      messagesById: { m1: message("m1", "stale fetch") },
    };
    const after: MessagesCache = { messageIds: [], messagesById: {} };

    const merged = mergeMessagesSnapshot(undefined, fetched, after, new Set([transient.info.id]));

    expect(merged.messageIds).toEqual([]);
    expect(merged.messagesById.m1).toBeUndefined();
  });

  it("records an add-then-remove cache event while the HTTP request is pending", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const request = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const client = {
      session: { messages: vi.fn().mockReturnValue(request) },
    } as unknown as OpencodeClient;
    const queryClient = new QueryClient();
    queryClient.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: [],
      messagesById: {},
    });

    const resultPromise = fetchMessages(client, queryClient, "s1");
    const transient = message("m1", "streamed");
    queryClient.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: ["m1"],
      messagesById: { m1: transient },
    });
    queryClient.setQueryData<MessagesCache>(qk.messages("s1"), {
      messageIds: [],
      messagesById: {},
    });
    resolveRequest?.({ data: [{ info: transient.info, parts: transient.parts }] });

    await expect(resultPromise).resolves.toEqual({ messageIds: [], messagesById: {} });
  });
});
