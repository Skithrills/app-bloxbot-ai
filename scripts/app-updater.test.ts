import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { checkForAppUpdate, installAppUpdate } from "../electron/appUpdater.ts";

const updateInfo = {
  version: "0.15.2",
  releaseNotes: "Release notes",
  releaseDate: "2026-11-13T00:00:00.000Z",
  files: [],
  path: "BloxBot-Setup-0.15.2.exe",
  sha512: "",
};

const unexpectedRequest = async () => assert.fail("The GitHub API should not be needed");
const updaterFailure = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};

test("only returns updates the updater marks available", async () => {
  const check = (isUpdateAvailable: boolean) => async () => ({ isUpdateAvailable, updateInfo });
  assert.deepEqual(await checkForAppUpdate(check(false), unexpectedRequest), {
    status: "up-to-date",
    version: "0.15.2",
  });
  assert.deepEqual(await checkForAppUpdate(check(true), unexpectedRequest), {
    status: "available",
    update: { version: "0.15.2", body: "Release notes" },
  });
  assert.deepEqual(await checkForAppUpdate(async () => null, unexpectedRequest), {
    status: "unsupported",
  });
});

test("explains how to recover when the installed updater configuration is missing", async () => {
  await assert.rejects(
    checkForAppUpdate(updaterFailure("ENOENT"), unexpectedRequest),
    /missing its update configuration.*Skithrills\/app-bloxbot-ai/,
  );
});

test("distinguishes a fork without stable releases from an invalid feed", async () => {
  const check = updaterFailure("ERR_UPDATER_INVALID_RELEASE_FEED");
  assert.deepEqual(
    await checkForAppUpdate(check, async (url) => {
      assert.equal(url, "https://api.github.com/repos/Skithrills/app-bloxbot-ai/releases/latest");
      return { status: 404 };
    }),
    { status: "no-releases" },
  );
  for (const status of [200, 403]) {
    await assert.rejects(
      checkForAppUpdate(check, async () => ({ status })),
      /Could not check the BloxBot fork/,
    );
  }
});

test("downloads before launching the installer and asks it to relaunch", async () => {
  const events = new EventEmitter();
  const calls: string[] = [];
  const install = installAppUpdate(
    Object.assign(events, {
      async downloadUpdate() {
        calls.push("download");
        await Promise.resolve();
        calls.push("downloaded");
        return [];
      },
      quitAndInstall(isSilent?: boolean, relaunch?: boolean) {
        assert.equal(isSilent, false);
        assert.equal(relaunch, true);
        calls.push("install");
      },
    }),
  );
  assert.deepEqual(calls, ["download"]);
  await install;
  assert.deepEqual(calls, ["download", "downloaded", "install"]);
  assert.equal(events.listenerCount("error"), 0);
});

test("surfaces a compact download or installer launch failure", async () => {
  const events = new EventEmitter();
  const updater = Object.assign(events, {
    async downloadUpdate() {
      throw new Error("download details");
    },
    quitAndInstall() {
      assert.fail("Do not install a failed download");
    },
  });
  await assert.rejects(installAppUpdate(updater), /Could not download the BloxBot update/);
  await assert.rejects(
    installAppUpdate(Object.assign(updater, {
      downloadUpdate: async () => [],
      quitAndInstall: () => events.emit("error", new Error("launch details")),
    })),
    /Could not start the BloxBot installer/,
  );
  assert.equal(events.listenerCount("error"), 0);
});

test("reports absent metadata on a published release", async () => {
  await assert.rejects(
    checkForAppUpdate(updaterFailure("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"), unexpectedRequest),
    /latest BloxBot release is missing the update metadata/,
  );
});
