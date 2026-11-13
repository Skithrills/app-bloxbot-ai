import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { expect, it } from "vitest";
import { createOpencodeClient } from "@/lib/opencode/client";
import { PASSWORD, shellCall, startScriptedProvider, startServer } from "@/test/support/liveServer";
import { createOpenCodeConfig } from "../../electron/opencodeConfig";

const bin = process.env.OPENCODE_LIVE_BIN;

it.skipIf(!bin)(
  "creates, lists, moves and reopens project chats in their own directories",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bloxbot-projects-"));
    const { provider, url, requests } = await startScriptedProvider([
      shellCall("echo project-probe"),
      { content: "A scripted reply." },
    ]);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const configPath = join(home, "config", "opencode");
      await mkdir(configPath, { recursive: true });
      await writeFile(
        join(configPath, "opencode.json"),
        JSON.stringify({
          ...createOpenCodeConfig({ url }),
          providers: { opencode: { settings: { baseURL: url } } },
          permissions: [{ action: "shell", resource: "*", effect: "ask" }],
          mcp: {},
        }),
      );
      server = await startServer(bin as string, home);
      const { workspace, baseUrl } = server;
      const headers = {
        Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
      };
      const api = OpenCode.make({ baseUrl, headers });
      const client = createOpencodeClient({
        baseUrl,
        directory: workspace,
        headers,
      });
      const options = { throwOnError: true };
      const gameA = join(home, "Game A");
      const gameB = join(home, "Game B");
      await Promise.all([mkdir(gameA), mkdir(gameB)]);
      await writeFile(
        join(gameA, "opencode.json"),
        JSON.stringify({
          providers: { opencode: { settings: { baseURL: "http://127.0.0.1:1/unreachable" } } },
          permissions: [{ action: "shell", resource: "*", effect: "deny" }],
        }),
      );
      const { data: session } = await client.session.create(
        { directory: gameA, title: "Game chat" },
        options,
      );
      const { data: defaultSession } = await client.session.create({}, options);
      expect(session.directory).toBe(gameA);
      expect(defaultSession.directory).toBe(workspace);
      const { data: firstList } = await client.experimental.session.list({}, options);
      expect(firstList.map(({ id }) => id)).toEqual(
        expect.arrayContaining([session.id, defaultSession.id]),
      );
      await client.session.promptAsync(
        {
          sessionID: session.id,
          model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" },
          parts: [{ type: "text", text: "History follows the chat." }],
        },
        options,
      );
      await expect
        .poll(async () => {
          const { data } = await client.permission.list({ sessionID: session.id }, options);
          return data.some((item) => item.sessionID === session.id);
        })
        .toBe(true);
      const { data: basePermissions } = await client.permission.list({}, options);
      expect(basePermissions.some((item) => item.sessionID === session.id)).toBe(false);
      const { data: projectPermissions } = await client.permission.list(
        { sessionID: session.id },
        options,
      );
      const approval = projectPermissions.find((item) => item.sessionID === session.id);
      if (!approval) throw new Error("The project chat's approval was not listed.");
      await client.permission.reply(
        { sessionID: session.id, requestID: approval.id, reply: "once" },
        options,
      );
      await api.experimental.session.wait({ sessionID: session.id });
      expect(requests()).toBe(2);
      const form = await api.session.form.create({
        sessionID: session.id,
        title: "Project question",
        fields: [{ key: "color", type: "string", options: [{ value: "blue", label: "Blue" }] }],
      });
      const { data: projectQuestions } = await client.question.list(
        { sessionID: session.id },
        options,
      );
      expect(projectQuestions.map(({ id }) => id)).toContain(form.id);
      const reopenedClient = createOpencodeClient({ baseUrl, directory: workspace, headers });
      await reopenedClient.question.reply(
        {
          requestID: form.id,
          sessionID: session.id,
          answers: [["Blue"]],
        },
        options,
      );
      expect((await client.session.fork({ sessionID: session.id }, options)).data.directory).toBe(
        gameA,
      );

      const { data: moved } = await client.session.move(
        { sessionID: session.id, directory: gameB },
        options,
      );
      expect(moved).toMatchObject({ id: session.id, directory: gameB, title: "Game chat" });
      const { data: reopened } = await client.experimental.session.list({}, options);
      expect(reopened.find(({ id }) => id === session.id)?.directory).toBe(gameB);
      const { data: history } = await client.session.messages({ sessionID: session.id }, options);
      expect(JSON.stringify(history)).toContain("History follows the chat.");
      const { data: restored } = await client.session.move({ sessionID: session.id }, options);
      expect(restored.directory).toBe(workspace);
    } finally {
      const child = server?.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      provider.close();
      await rm(home, { recursive: true, force: true });
    }
  },
  45_000,
);
