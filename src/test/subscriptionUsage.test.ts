import { describe, expect, it, vi } from "vitest";
import { claudeProtocol, codexProtocol } from "../../electron/services/SubscriptionUsage";
import { claudeWindows, codexWindows } from "../../electron/services/subscriptionWindows";

describe("subscription windows", () => {
  it("takes Codex limits from the multi-bucket view, preserving duration, reset and zero usage", () => {
    expect(
      codexWindows({
        rateLimits: { primary: { usedPercent: 99 } },
        rateLimitsByLimitId: {
          codex: {
            primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1794416400 },
            secondary: { usedPercent: 47, windowDurationMins: 10080, resetsAt: null },
          },
          code_review: {
            limitName: "Code review",
            primary: { usedPercent: 12.5, windowDurationMins: 15 },
            secondary: { usedPercent: "20" },
          },
        },
        rateLimitResetCredits: { availableCount: 10 },
      }),
    ).toEqual([
      { id: "codex/primary", label: "5-hour window", usedPercent: 0, resetsAt: 1794416400000 },
      { id: "codex/secondary", label: "Weekly", usedPercent: 47, resetsAt: null },
      {
        id: "code_review/primary",
        label: "Code review · 15-minute window",
        usedPercent: 12.5,
        resetsAt: null,
      },
    ]);
    expect(
      codexWindows({
        rateLimitsByLimitId: {},
        rateLimits: { primary: null, secondary: { usedPercent: 2, resetsAt: 0 } },
      }),
    ).toEqual([
      { id: "codex/secondary", label: "Secondary window", usedPercent: 2, resetsAt: null },
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
});

describe("read-only CLI probes", () => {
  it("gates Codex rate limits on external OAuth auth and does not provide a refresh token", () => {
    const protocol = codexProtocol("0.15.1", {
      accessToken: "fixture-access",
      chatgptAccountId: "fixture-workspace",
    });
    const send = vi.fn();
    protocol.start(send);
    protocol.read({ id: 1, result: {} }, send);
    protocol.read({ id: 2, result: { type: "chatgptAuthTokens" } }, send);
    expect(send.mock.calls.map(([message]) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/login/start",
      "account/rateLimits/read",
    ]);
    expect(send).toHaveBeenNthCalledWith(3, {
      id: 2,
      method: "account/login/start",
      params: {
        type: "chatgptAuthTokens",
        accessToken: "fixture-access",
        chatgptAccountId: "fixture-workspace",
      },
    });
    expect(protocol.read({ method: "account/chatgptAuthTokens/refresh", id: 5 }, send)).toEqual({
      status: "unavailable",
    });
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("reads the installed Codex CLI account without supplying credentials or forcing refresh", () => {
    const protocol = codexProtocol("0.15.1");
    const send = vi.fn();
    protocol.start(send);
    protocol.read({ id: 1, result: {} }, send);
    expect(send).toHaveBeenLastCalledWith({
      method: "account/read",
      id: 2,
      params: { refreshToken: false },
    });
    expect(protocol.read({ id: 2, result: { account: null } }, send)).toEqual({
      status: "disconnected",
    });
    expect(protocol.read({ id: 2, result: { account: { type: "apiKey" } } }, send)).toEqual({
      status: "unsupported",
    });
    expect(send).toHaveBeenCalledTimes(3);
    protocol.read({ id: 2, result: { account: { type: "chatgpt" } } }, send);
    expect(send).toHaveBeenLastCalledWith({ method: "account/rateLimits/read", id: 3 });
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
