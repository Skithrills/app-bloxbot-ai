import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createStudioIconResolver,
  studioIconProtocolHandler,
} from "../../electron/studioIconResolver";

const svg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${color}"/></svg>`;

let root: string;
let localAppData: string;
let userData: string;

async function write(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function install(version: string, mtime: number, executable = "RobloxStudioBeta.exe") {
  const folder = join(localAppData, "Roblox", "Versions", `version-${version}`);
  const binary = join(folder, executable);
  await write(binary, executable);
  await utimes(binary, mtime, mtime);
  return folder;
}

const stockIcon = (installFolder: string, theme: string, className: string) =>
  join(
    installFolder,
    "content",
    "studio_svg_textures",
    "Shared",
    "InsertableObjects",
    theme,
    "Standard",
    `${className}.svg`,
  );

const stockPlaceholder = (installFolder: string, theme: string) =>
  join(
    installFolder,
    "content",
    "studio_svg_textures",
    "Shared",
    "Placeholder",
    theme,
    "Standard",
    "Placeholder.svg",
  );

function handler(platform: NodeJS.Platform = "win32") {
  return studioIconProtocolHandler(
    createStudioIconResolver({
      platform,
      home: root,
      userData,
      localAppData,
      loadSpriteSheet() {
        throw new Error("These installs have no legacy sprite sheet");
      },
    }),
  );
}

const iconRequest = (theme: string, className: string) =>
  new Request(`bloxbot-icon://studio/${theme}/${className}`);

describe("Studio class icon protocol", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bloxbot-studio-icons-"));
    localAppData = join(root, "local");
    userData = join(root, "userdata");
    await mkdir(userData);
  });

  afterEach(async () => {
    if (dirname(root) !== tmpdir()) throw new Error("Unexpected Studio icon test folder");
    await rm(root, { recursive: true, force: true });
  });

  it("picks the newest actual Studio and uses the requested theme and class name", async () => {
    const old = await install("old", 100);
    const latest = await install("latest", 200);
    const player = await install("player", 300, "RobloxPlayerBeta.exe");
    await write(stockIcon(old, "Dark", "Part"), svg("red"));
    await write(stockIcon(player, "Dark", "Part"), svg("red"));
    await write(stockIcon(latest, "Dark", "Part"), svg("navy"));
    await write(stockIcon(latest, "Dark", "MeshPart"), svg("green"));
    await write(stockIcon(latest, "Light", "Part"), svg("blue"));
    const resolve = handler();

    expect(await (await resolve(iconRequest("dark", "Part"))).text()).toBe(svg("navy"));
    expect(await (await resolve(iconRequest("light", "Part"))).text()).toBe(svg("blue"));
    expect(await (await resolve(iconRequest("dark", "MeshPart"))).text()).toBe(svg("green"));
  });

  it("uses the installed themed placeholder for unknown and placeholder classes", async () => {
    const studio = await install("studio", 100);
    await write(stockIcon(studio, "Dark", "Class"), svg("black"));
    await write(stockIcon(studio, "Dark", "Instance"), svg("purple"));
    await write(stockPlaceholder(studio, "Dark"), svg("gray"));
    await write(stockPlaceholder(studio, "Light"), svg("silver"));
    await write(join(userData, "icons", "Placeholder.svg"), svg("green"));
    const resolve = handler();

    expect(await (await resolve(iconRequest("dark", "UnknownClass"))).text()).toBe(svg("gray"));
    expect(await (await resolve(iconRequest("light", "UnknownClass"))).text()).toBe(svg("silver"));
    expect(await (await resolve(iconRequest("dark", "Placeholder"))).text()).toBe(svg("gray"));
    expect(await (await resolve(iconRequest("dark", "Instance"))).text()).toBe(svg("purple"));
  });

  it("uses the available Studio placeholder theme when the requested theme is missing", async () => {
    const studio = await install("studio", 100);
    await write(stockPlaceholder(studio, "Light"), svg("silver"));

    const icon = await handler()(iconRequest("dark", "UnknownClass"));
    expect(await icon.text()).toBe(svg("silver"));
  });

  it("finds the resource bundle in a user-local macOS install", async () => {
    const contents = join(root, "Applications", "RobloxStudio.app", "Contents");
    await write(join(contents, "MacOS", "RobloxStudio"), "Studio");
    await write(stockIcon(join(contents, "Resources"), "Dark", "Workspace"), svg("navy"));

    const response = await handler("darwin")(iconRequest("dark", "Workspace"));
    expect(await response.text()).toBe(svg("navy"));
  });

  it.each([
    [
      "Vinegar Flatpak",
      [".var", "app", "org.vinegarhq.Vinegar", "data", "vinegar", "versions", "version-example"],
    ],
    ["native Vinegar", [".local", "share", "vinegar", "versions", "version-example"]],
    [
      "Wine",
      [
        ".wine",
        "drive_c",
        "users",
        "roblox",
        "AppData",
        "Local",
        "Roblox",
        "Versions",
        "version-example",
      ],
    ],
  ])("finds Studio installed through %s on Linux", async (_kind, path) => {
    const installFolder = join(root, ...path);
    await write(join(installFolder, "RobloxStudioBeta.exe"), "Studio");
    await write(stockIcon(installFolder, "Dark", "Workspace"), svg("navy"));

    const response = await handler("linux")(iconRequest("dark", "Workspace"));
    expect(await response.text()).toBe(svg("navy"));
  });

  it("lets a dropped-in pack override installed icons and falls back per class", async () => {
    const studio = await install("studio", 100);
    await write(stockIcon(studio, "Dark", "Part"), svg("red"));
    await write(stockIcon(studio, "Dark", "Workspace"), svg("navy"));
    await write(
      join(userData, "icons", "Pack", "RobloxCustom", "standard", "Part.svg"),
      svg("green"),
    );
    await write(join(userData, "icons", "Workspace.svg"), "<html>not an icon</html>");
    const resolve = handler();

    const icon = await resolve(iconRequest("dark", "Part"));
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(icon.headers.get("content-security-policy")).toContain("sandbox");
    expect(await icon.text()).toBe(svg("green"));
    expect(await (await resolve(iconRequest("dark", "Workspace"))).text()).toBe(svg("navy"));
  });

  it("blocks paths and linked pack directories outside the configured root", async () => {
    const outside = join(root, "outside");
    await write(join(outside, "Workspace.svg"), svg("red"));
    await mkdir(join(userData, "icons"));
    await symlink(outside, join(userData, "icons", "Dark"), "junction");
    const resolve = handler();

    const fallback = await resolve(iconRequest("dark", "Workspace"));
    expect(fallback.headers.get("content-type")).toBe("image/svg+xml");
    expect(await fallback.text()).toContain("#8b949e");
    expect((await resolve(iconRequest("dark", "%2e%2e%2fWorkspace"))).status).toBe(404);
    expect((await resolve(iconRequest("dark", "Workspace?path=outside"))).status).toBe(404);
    expect((await resolve(new Request("bloxbot-icon://elsewhere/dark/Workspace"))).status).toBe(
      404,
    );
  });
});
