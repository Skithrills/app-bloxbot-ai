import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  claudeProtocol,
  codexProtocol,
  fetchChatGptUsage,
} from "../../electron/services/SubscriptionUsage";
import {
  chatGptWindows,
  claudeWindows,
  codexWindows,
} from "../../electron/services/subscriptionWindows";
import { SubscriptionProviderSchema } from "../types/subscriptionUsage";

describe("subscription windows", () => {
  it("uses the reported duration, including a weekly-only primary window", () => {
    expect(
      chatGptWindows({
        rate_limit: {
          primary_window: { used_percent: 84, limit_window_seconds: 604800, reset_at: 1794416400 },
          secondary_window: null,
        },
        additional_rate_limits: [
          {
            limit_name: "Code review",
            metered_feature: "code_review",
            rate_limit: {
              primary_window: { used_percent: 0, limit_window_seconds: 900, reset_at: 0 },
              secondary_window: { used_percent: "20" },
            },
          },
        ],
      }),
    ).toEqual([
      { id: "codex/primary", label: "Weekly", usedPercent: 84, resetsAt: 1794416400000 },
      {
        id: "code_review/primary",
        label: "Code review · 15-minute window",
        usedPercent: 0,
        resetsAt: null,
      },
    ]);
  });

  it("uses Claude's subscription windows while ignoring paid usage and invalid meters", () => {
    const resetsAt = "2026-11-17T08:00:00Z";
    expect(
      claudeWindows({
        rate_limits: {
          five_hour: { utilization: 0, resets_at: "invalid" },
          seven_day: { utilization: 24.5, resets_at: resetsAt },
          model_scoped: [
            { display_name: "Opus", utilization: 31, resets_at: null },
            { display_name: "Sonnet", utilization: -2, resets_at: null },
          ],
          extra_usage: { is_enabled: true, utilization: 90 },
          spend: { enabled: true, percent: 10 },
        },
      }),
    ).toEqual([
      { id: "five_hour", label: "5-hour window", usedPercent: 0, resetsAt: null },
      { id: "seven_day", label: "Weekly", usedPercent: 24.5, resetsAt: Date.parse(resetsAt) },
      { id: "model/Opus", label: "Weekly · Opus", usedPercent: 31, resetsAt: null },
    ]);
  });

  it("reads Codex CLI usage from current and legacy replies", () => {
    const rateLimits = {
      primary: { usedPercent: 84, windowDurationMins: 10_080, resetsAt: 1794416400 },
      secondary: null,
    };
    const weekly = {
      id: "codex/primary",
      label: "Weekly",
      usedPercent: 84,
      resetsAt: 1794416400000,
    };
    expect(codexWindows({ rateLimits })).toEqual([weekly]);
    expect(
      codexWindows({
        rateLimitsByLimitId: {
          codex: rateLimits,
          review: {
            limitName: "Code review",
            primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 0 },
            secondary: { usedPercent: -1 },
          },
        },
      }),
    ).toEqual([
      weekly,
      {
        id: "review/primary",
        label: "Code review · 5-hour window",
        usedPercent: 0,
        resetsAt: null,
      },
    ]);
  });
});

describe("ChatGPT usage request", () => {
  const credential = () => ({
    methodID: "chatgpt-browser",
    access: "fixture-access",
    expires: Date.now() + 60_000,
    metadata: { accountID: "fixture-workspace" },
  });

  it("does not probe an account endpoint with the token-sharing sign-in", async () => {
    const fetchUsage = vi.fn<typeof fetch>();
    await expect(
      fetchChatGptUsage({ ...credential(), methodID: "chatgpt-token-sharing" }, fetchUsage),
    ).resolves.toEqual({ status: "usage_not_shared" });
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it("sends the active access token only to ChatGPT and returns just the windows", async () => {
    const fetchUsage = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        rate_limit: { primary_window: { used_percent: 84, limit_window_seconds: 604800 } },
        account_id: "fixture-private",
      }),
    );
    await expect(fetchChatGptUsage(credential(), fetchUsage)).resolves.toEqual({
      status: "available",
      checkedAt: expect.any(Number),
      windows: [{ id: "codex/primary", label: "Weekly", usedPercent: 84, resetsAt: null }],
    });
    expect(fetchUsage).toHaveBeenCalledOnce();
    expect(fetchUsage).toHaveBeenCalledWith("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer fixture-access",
        "ChatGPT-Account-Id": "fixture-workspace",
      },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("distinguishes a revoked login, a forbidden quota read, and a temporary error", async () => {
    const fetchUsage = vi.fn<typeof fetch>();
    for (const [code, status] of [
      [401, "session_expired"],
      [403, "usage_not_shared"],
      [429, "unavailable"],
    ] as const) {
      fetchUsage.mockResolvedValueOnce(new Response(null, { status: code }));
      await expect(fetchChatGptUsage(credential(), fetchUsage)).resolves.toEqual({ status });
    }
  });
});

describe("read-only CLI probe", () => {
  it("reads usage for the installed CLI's ChatGPT account with no login request", () => {
    expect(Schema.decodeUnknownSync(SubscriptionProviderSchema)("codex-cli")).toBe("codex-cli");
    const protocol = codexProtocol("1.2.3");
    const send = vi.fn();
    protocol.start(send);
    protocol.read({ id: 1, result: {} }, send);
    protocol.read(
      { id: 2, result: { account: { type: "chatgpt", email: "fixture@example.com" } } },
      send,
    );
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      {
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "bloxbot", title: "BloxBot", version: "1.2.3" } },
      },
      { method: "initialized", params: {} },
      { method: "account/read", id: 2, params: { refreshToken: false } },
      { method: "account/rateLimits/read", id: 3 },
    ]);
    expect(
      protocol.read(
        {
          id: 3,
          result: { rateLimits: { primary: { usedPercent: 84, windowDurationMins: 10_080 } } },
        },
        send,
      ),
    ).toEqual({
      status: "available",
      checkedAt: expect.any(Number),
      windows: [{ id: "codex/primary", label: "Weekly", usedPercent: 84, resetsAt: null }],
    });
  });

  it("skips the quota request when Codex CLI has no subscription account", () => {
    const protocol = codexProtocol("1.2.3");
    const send = vi.fn();
    expect(protocol.read({ id: 2, result: { account: null } }, send)).toEqual({
      status: "disconnected",
    });
    expect(protocol.read({ id: 2, result: { account: { type: "apiKey" } } }, send)).toEqual({
      status: "unsupported",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends Claude only control requests and handles a non-subscription response", () => {
    const send = vi.fn();
    claudeProtocol.start(send);
    claudeProtocol.read(
      {
        type: "control_response",
        response: { request_id: "init", subtype: "success" },
      },
      send,
    );
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: "control_request", request_id: "init", request: { subtype: "initialize" } },
      {
        type: "control_request",
        request_id: "usage",
        request: { subtype: "get_usage", skip_behaviors: true },
      },
    ]);
    expect(
      claudeProtocol.read(
        {
          type: "control_response",
          response: {
            request_id: "usage",
            subtype: "success",
            response: { rate_limits_available: false, rate_limits: null },
          },
        },
        send,
      ),
    ).toEqual({ status: "unsupported" });
  });
});
