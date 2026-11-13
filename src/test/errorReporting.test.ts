import { describe, expect, it } from "vitest";
import {
  ERROR_MESSAGE_MAX_LENGTH,
  REDACTED,
  scrubErrorMessage,
  scrubErrorText,
} from "@/lib/errorReporting";

describe("scrubErrorText", () => {
  it("replaces home directories on macOS, Linux and Windows", () => {
    expect(scrubErrorText("ENOENT: open '/Users/oscar/BloxBot/opencode.json'")).toBe(
      "ENOENT: open '~/BloxBot/opencode.json'",
    );
    expect(scrubErrorText("at /home/jane/app/index.js:1:2")).toBe("at ~/app/index.js:1:2");
    expect(scrubErrorText("EPERM C:\\Users\\Jane Doe\\AppData\\Local\\x")).toBe(
      "EPERM ~\\AppData\\Local\\x",
    );
    expect(scrubErrorText("path C:\\Users\\jdoe\\BloxBot")).toBe("path ~\\BloxBot");
    expect(scrubErrorText('{"path":"C:\\\\Users\\\\jdoe\\\\BloxBot"}')).toBe(
      '{"path":"~\\\\BloxBot"}',
    );
    expect(scrubErrorText("EPERM C:/Users/Jane Doe/AppData/x")).toBe("EPERM ~/AppData/x");
    expect(scrubErrorText("profile at C:\\Users\\Jane Doe")).toBe("profile at ~");
    expect(scrubErrorText("profile at C:/Users/Jane Doe")).toBe("profile at ~");
    expect(scrubErrorText("file:///Users/oscar/app.asar/index.js")).toBe(
      "file://~/app.asar/index.js",
    );
  });

  it("masks the username wherever else it appears", () => {
    expect(scrubErrorText("/Users/oscar/x failed for oscar@laptop")).toBe(
      "~/x failed for <user>@laptop",
    );
    expect(scrubErrorText("login oscar rejected", { username: "oscar" })).toBe(
      "login <user> rejected",
    );
  });

  it("replaces a known home directory", () => {
    expect(scrubErrorText("/opt/homes/os/BloxBot missing", { home: "/opt/homes/os" })).toBe(
      "~/BloxBot missing",
    );
  });

  it("masks email addresses", () => {
    expect(scrubErrorText("Your plan for jane.doe+ai@example.co.uk can't use this model")).toBe(
      "Your plan for <email> can't use this model",
    );
    expect(scrubErrorText("account jane@bücher.de has no access")).toBe(
      "account <email> has no access",
    );
    expect(scrubErrorText("anthropic/claude-sonnet-4@latest")).toBe(
      "anthropic/claude-sonnet-4@latest",
    );
  });

  it("redacts numeric credential values but keeps token counts", () => {
    expect(scrubErrorText("api_key=12345678 rejected")).toBe("api_key=[redacted] rejected");
    expect(scrubErrorText('{"password": "4242"}')).toBe('{"password": "[redacted]"}');
    expect(scrubErrorText("input_tokens: 812, max_tokens: 4096")).toBe(
      "input_tokens: 812, max_tokens: 4096",
    );
  });

  it("leaves URL paths and ordinary text alone", () => {
    expect(scrubErrorText("max_tokens: 4096 exceeds the limit")).toBe(
      "max_tokens: 4096 exceeds the limit",
    );
    const text =
      "GET https://example.com/home/users/123 returned 404 for anthropic/claude-sonnet-4";
    expect(scrubErrorText(text)).toBe(text);
    expect(scrubErrorText("Cannot read properties of undefined (reading 'map')")).toBe(
      "Cannot read properties of undefined (reading 'map')",
    );
  });

  it("masks API keys and tokens", () => {
    const cases = [
      "sk-proj-abcdefghijklmnop1234567890",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      "sk-or-v1-0123456789abcdef0123456789abcdef",
      "AIzaSyA1234567890abcdefghijklmnopqrstu",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "gsk_abcdefghijklmnopqrstuv0123",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a",
    ];
    for (const secret of cases) {
      const scrubbed = scrubErrorText(`request failed with ${secret} in it`);
      expect(scrubbed).not.toContain(secret);
      expect(scrubbed).toContain(REDACTED);
    }
  });

  it("masks authorization headers and key-value credentials", () => {
    expect(scrubErrorText("Authorization: Bearer abc.def-ghi_jkl")).not.toContain("abc.def");
    expect(scrubErrorText("Basic b3BlbmNvZGU6c2VjcmV0cGFzcw==")).toBe(`Basic ${REDACTED}`);
    expect(scrubErrorText("url?api_key=hunter2&x=1")).toBe(`url?api_key=${REDACTED}&x=1`);
    expect(scrubErrorText('{"password": "hunter2"}')).toBe(`{"password": "${REDACTED}"}`);
  });

  it("keeps long paths that are not secrets", () => {
    const path = "~/node_modules/.pnpm/lexical@0.48.0/node_modules/lexical/dist/module.js";
    expect(scrubErrorText(path)).toBe(path);
  });
});

describe("scrubErrorMessage", () => {
  it("truncates after scrubbing", () => {
    const message = scrubErrorMessage(`/Users/oscar/${"x".repeat(2000)}`);
    expect(message).toHaveLength(ERROR_MESSAGE_MAX_LENGTH);
    expect(message.startsWith("~/x")).toBe(true);
    expect(message.endsWith("…")).toBe(true);
  });
});
