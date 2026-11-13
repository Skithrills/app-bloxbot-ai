import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export const STUDIO_ICON_SCHEME = "bloxbot-icon";

const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const TILE_SIZE = 16;
const ICON_MAX_BYTES = 256 * 1024;
const MAX_CACHED_ICONS = 768;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PLACEHOLDER_ICON = "Placeholder";
const DEFAULT_ICON = {
  type: "image/svg+xml",
  bytes: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.25" transform="rotate(45 8 8)" fill="none" stroke="#8b949e" stroke-width="1.25"/></svg>',
  ),
} as const;

type Theme = "light" | "dark";

interface Icon {
  type: "image/png" | "image/svg+xml";
  bytes: Buffer;
}

interface IconFile {
  root: string;
  path: string;
  type: Icon["type"];
  rank: number;
}

type IconIndex = Map<string, IconFile[]>;

interface StudioLocations {
  platform: NodeJS.Platform;
  home: string;
  localAppData?: string;
  xdgDataHome?: string;
  winePrefix?: string;
}

interface StudioIconOptions extends StudioLocations {
  userData: string;
  loadSpriteSheet: (png: Buffer) => SpriteSheet | null;
}

interface SpriteSheet {
  width: number;
  height: number;
  crop: (rect: { x: number; y: number; width: number; height: number }) => Buffer;
}

interface LegacyIcons {
  index: Map<string, number>;
  sheet: SpriteSheet;
  digest: string;
}

interface IconSources {
  modern: Record<Theme, IconIndex>;
  custom: Record<Theme, IconIndex>;
  legacy: LegacyIcons | null;
}

async function listDirectory(path: string) {
  return readdir(path, { withFileTypes: true }).catch(() => []);
}

function containsPath(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

async function containedPath(root: string, path: string): Promise<string | null> {
  const resolved = await realpath(path).catch(() => null);
  return resolved && containsPath(root, resolved) ? resolved : null;
}

async function readBoundedFile(root: string, path: string, limit: number): Promise<Buffer | null> {
  const resolved = await containedPath(root, path);
  if (!resolved) return null;

  const file = await open(resolved, "r").catch(() => null);
  if (!file) return null;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > limit) return null;

    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return offset === info.size ? buffer.subarray(0, offset) : null;
  } catch {
    return null;
  } finally {
    await file.close().catch(() => {});
  }
}

async function versionsUnder(path: string): Promise<string[]> {
  return (await listDirectory(path))
    .filter((entry) => entry.isDirectory() && /^version-[\w-]+$/i.test(entry.name))
    .map((entry) => join(path, entry.name));
}

async function studiosUnderWine(prefix: string): Promise<string[]> {
  const users = join(prefix, "drive_c", "users");
  const candidates = await Promise.all(
    (await listDirectory(users))
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const local = join(users, name, "AppData", "Local");
        return [
          join(local, "Roblox Studio"),
          ...(await versionsUnder(join(local, "Roblox", "Versions"))),
        ];
      }),
  );
  return candidates.flat();
}

async function findStudioResources(options: StudioLocations): Promise<string[]> {
  const { platform, home } = options;
  let candidates: { resources: string; executable: string }[];
  if (platform === "darwin") {
    candidates = ["/Applications", join(home, "Applications")].map((applications) => {
      const contents = join(applications, "RobloxStudio.app", "Contents");
      return {
        resources: join(contents, "Resources"),
        executable: join(contents, "MacOS", "RobloxStudio"),
      };
    });
  } else {
    let installs: string[] = [];
    if (platform === "win32") {
      const local = options.localAppData || join(home, "AppData", "Local");
      installs = [
        join(local, "Roblox Studio"),
        ...(await versionsUnder(join(local, "Roblox", "Versions"))),
      ];
    } else if (platform === "linux") {
      const vinegarRoots = [
        join(home, ".var", "app", "org.vinegarhq.Vinegar", "data", "vinegar"),
        join(options.xdgDataHome || join(home, ".local", "share"), "vinegar"),
      ];
      const prefixes = [
        ...vinegarRoots.map((root) => join(root, "prefixes", "studio")),
        options.winePrefix || join(home, ".wine"),
      ];
      installs = (
        await Promise.all([
          ...vinegarRoots.map((root) => versionsUnder(join(root, "versions"))),
          ...prefixes.map(studiosUnderWine),
        ])
      ).flat();
    }
    candidates = installs.map((resources) => ({
      resources,
      executable: join(resources, "RobloxStudioBeta.exe"),
    }));
  }

  const installed = await Promise.all(
    candidates.map(async ({ resources, executable }) => {
      const [root, info] = await Promise.all([
        realpath(resources).catch(() => null),
        stat(executable).catch(() => null),
      ]);
      return root && info?.isFile() ? { root, modified: info.mtimeMs } : null;
    }),
  );
  return [
    ...new Set(
      installed
        .filter((install) => install !== null)
        .sort((left, right) => right.modified - left.modified)
        .map(({ root }) => root),
    ),
  ];
}

async function addDirectory(index: IconIndex, root: string, parts: string[]): Promise<void> {
  const directory = await containedPath(root, join(root, ...parts));
  if (!directory) return;
  const files = new Map<string, IconFile[]>();
  for (const entry of await listDirectory(directory)) {
    if (!entry.isFile()) continue;
    const match = /^([A-Za-z][A-Za-z0-9_]{0,127})(?:@([23])x)?\.(png|svg)$/i.exec(entry.name);
    if (!match) continue;
    const [, name, scale, extension] = match;
    const type = extension.toLowerCase() === "png" ? "image/png" : "image/svg+xml";
    const rank = type === "image/svg+xml" ? 0 : scale === "2" ? 1 : scale === "3" ? 2 : 3;
    const icon: IconFile = { root, path: join(directory, entry.name), type, rank };
    const variants = files.get(name) ?? [];
    variants.push(icon);
    files.set(name, variants);
  }
  for (const [name, variants] of files) {
    variants.sort((left, right) => left.rank - right.rank);
    index.set(name, [...(index.get(name) ?? []), ...variants]);
  }
}

async function indexDirectories(root: string, directories: string[][]): Promise<IconIndex> {
  const index: IconIndex = new Map();
  for (const directory of directories) await addDirectory(index, root, directory);
  return index;
}

function indexCustomIcons(
  root: string,
  theme: "Light" | "Dark",
  packs: string[],
): Promise<IconIndex> {
  // Accept flat packs and Roblox's documented RobloxCustom/standard and scaled folders.
  const packRoots = [[], ...packs.flatMap((pack) => [[pack], [pack, "RobloxCustom"]])];
  const directories = packRoots.flatMap((pack) =>
    [[...pack, theme], [...pack, theme.toLowerCase()], pack].flatMap((variant) => [
      variant,
      [...variant, "standard"],
      [...variant, "scaled200"],
      [...variant, "scaled150"],
    ]),
  );
  return indexDirectories(root, directories);
}

function indexModernIcons(root: string, theme: "Light" | "Dark"): Promise<IconIndex> {
  const shared = ["content", "studio_svg_textures", "Shared"];
  const standard = [...shared, "InsertableObjects"];
  const textures = ["content", "textures"];
  return indexDirectories(root, [
    [...shared, PLACEHOLDER_ICON, theme, "Standard"],
    [...standard, theme, "Standard"],
    [...standard, "Standard"],
    ...["ClassIcons", "ExplorerIcons", "ClassImages"].flatMap((folder) => [
      [...textures, folder, theme],
      [...textures, folder, theme.toLowerCase()],
      [...textures, folder],
    ]),
  ]);
}

function parseLegacyIndexes(xml: string, tileCount: number): Map<string, number> {
  const classes = new Map<string, number>();
  // Read only the class's direct Properties block. Nested member names are not ClassNames.
  const items =
    /<Item\b[^>]*\bclass=["']ReflectionMetadataClass["'][^>]*>\s*<Properties>([\s\S]*?)<\/Properties>/g;
  for (const [, properties] of xml.matchAll(items)) {
    const name = /<string\s+name=["']Name["']>\s*([A-Za-z][A-Za-z0-9_]*)\s*<\/string>/.exec(
      properties,
    )?.[1];
    const value = /<(string|int)\s+name=["']ExplorerImageIndex["']>\s*(\d+)\s*<\/\1>/.exec(
      properties,
    )?.[2];
    const index = Number(value);
    if (name && CLASS_NAME.test(name) && Number.isSafeInteger(index) && index < tileCount) {
      classes.set(name, index);
    }
  }
  return classes;
}

async function loadLegacyIcons(
  root: string,
  loadSpriteSheet: StudioIconOptions["loadSpriteSheet"],
): Promise<LegacyIcons | null> {
  const textures = await containedPath(root, join(root, "content", "textures"));
  if (!textures) return null;
  const entry = (await listDirectory(textures)).find(
    (file) => file.isFile() && file.name.toLowerCase() === "classimages.png",
  );
  if (!entry) return null;
  const [png, metadata] = await Promise.all([
    readBoundedFile(root, join(textures, entry.name), 2 * 1024 * 1024),
    readBoundedFile(root, join(root, "ReflectionMetadata.xml"), 4 * 1024 * 1024),
  ]);
  if (!png || !metadata || !validPng(png, 8192, 8192, 1024 * 1024)) return null;
  const sheet = loadSpriteSheet(png);
  if (!sheet || sheet.width % TILE_SIZE !== 0 || sheet.height % TILE_SIZE !== 0) return null;
  const index = parseLegacyIndexes(
    metadata.toString("utf8"),
    (sheet.width * sheet.height) / TILE_SIZE ** 2,
  );
  if (!index.size) return null;
  return { index, sheet, digest: createHash("sha256").update(png).digest("hex") };
}

async function loadIconSources(
  options: StudioIconOptions,
  userData: string | null,
): Promise<IconSources> {
  const pack = userData ? await containedPath(userData, join(userData, "icons")) : null;
  const packNames = pack
    ? (await listDirectory(pack))
        .filter(
          (entry) =>
            entry.isDirectory() && !/^(?:light|dark|standard|scaled\d+)$/i.test(entry.name),
        )
        .map(({ name }) => name)
        .sort()
    : [];
  const [customLight, customDark, studio] = await Promise.all([
    pack ? indexCustomIcons(pack, "Light", packNames) : new Map<string, IconFile[]>(),
    pack ? indexCustomIcons(pack, "Dark", packNames) : new Map<string, IconFile[]>(),
    findStudioResources(options),
  ]);
  const custom = { light: customLight, dark: customDark };
  for (const root of studio) {
    const [light, dark, legacy] = await Promise.all([
      indexModernIcons(root, "Light"),
      indexModernIcons(root, "Dark"),
      loadLegacyIcons(root, options.loadSpriteSheet),
    ]);
    if (light.size || dark.size || legacy) return { custom, modern: { light, dark }, legacy };
  }
  return { custom, modern: { light: new Map(), dark: new Map() }, legacy: null };
}

function validPng(bytes: Buffer, maxWidth: number, maxHeight: number, maxPixels: number): boolean {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return (
    width > 0 &&
    height > 0 &&
    width <= maxWidth &&
    height <= maxHeight &&
    width * height <= maxPixels
  );
}

async function loadIconFile({ root, path, type }: IconFile): Promise<Icon | null> {
  const bytes = await readBoundedFile(root, path, ICON_MAX_BYTES);
  if (!bytes) return null;
  if (type === "image/png" && !validPng(bytes, 512, 512, 512 * 512)) return null;
  if (
    type === "image/svg+xml" &&
    !/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(bytes.toString("utf8"))
  )
    return null;
  return { bytes, type };
}

async function legacyCacheDirectory(userData: string): Promise<string | null> {
  const cache = join(userData, "studio-icon-cache-v1");
  await mkdir(cache, { recursive: true });
  return containedPath(userData, cache);
}

async function cropLegacyIcon(
  legacy: LegacyIcons,
  index: number,
  cache: string | null,
): Promise<Icon | null> {
  const file = cache ? join(cache, `${legacy.digest}-${index}.png`) : null;
  const cached = file && cache ? await readBoundedFile(cache, file, ICON_MAX_BYTES) : null;
  if (cached && validPng(cached, TILE_SIZE, TILE_SIZE, TILE_SIZE ** 2)) {
    return { type: "image/png", bytes: cached };
  }

  const columns = legacy.sheet.width / TILE_SIZE;
  const bytes = legacy.sheet.crop({
    x: (index % columns) * TILE_SIZE,
    y: Math.floor(index / columns) * TILE_SIZE,
    width: TILE_SIZE,
    height: TILE_SIZE,
  });
  if (!validPng(bytes, TILE_SIZE, TILE_SIZE, TILE_SIZE ** 2)) return null;
  if (file) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, file);
    } catch {
      await unlink(temporary).catch(() => {});
    }
  }
  return { type: "image/png", bytes };
}

export function createStudioIconResolver(options: StudioIconOptions) {
  let sources: Promise<IconSources> | undefined;
  let legacyCache: Promise<string | null> | undefined;
  const userData = () => realpath(options.userData).catch(() => null);
  const memory = new Map<string, Promise<Icon | null>>();

  function cached(key: string, load: () => Promise<Icon | null>): Promise<Icon | null> {
    const existing = memory.get(key);
    if (existing) return existing;

    const pending = load().catch(() => null);
    if (memory.size >= MAX_CACHED_ICONS) {
      const oldest = memory.keys().next().value;
      if (oldest) memory.delete(oldest);
    }
    memory.set(key, pending);
    return pending;
  }

  async function firstFile(index: IconIndex, className: string): Promise<Icon | null> {
    for (const file of index.get(className) ?? []) {
      const icon = await cached(file.path, () => loadIconFile(file));
      if (icon) return icon;
    }
    return null;
  }

  return async function resolveIcon(className: string, theme: Theme): Promise<Icon> {
    if (!CLASS_NAME.test(className)) return DEFAULT_ICON;
    sources ??= userData().then((root) => loadIconSources(options, root));
    const { custom, modern, legacy } = await sources;
    const otherTheme = theme === "light" ? "dark" : "light";
    const placeholder = async () =>
      (await firstFile(modern[theme], PLACEHOLDER_ICON)) ??
      (await firstFile(modern[otherTheme], PLACEHOLDER_ICON)) ??
      DEFAULT_ICON;
    if (className === PLACEHOLDER_ICON) return placeholder();

    const exact =
      (await firstFile(custom[theme], className)) ??
      (await firstFile(modern[theme], className)) ??
      (await firstFile(modern[otherTheme], className));
    if (exact) return exact;

    const index = legacy?.index.get(className);
    if (legacy && index !== undefined) {
      const cache = (legacyCache ??= userData()
        .then((root) => root && legacyCacheDirectory(root))
        .catch(() => null));
      const icon = await cached(`sprite:${index}`, async () =>
        cropLegacyIcon(legacy, index, await cache),
      );
      if (icon) return icon;
    }

    return placeholder();
  };
}

export function studioIconProtocolHandler(resolve: ReturnType<typeof createStudioIconResolver>) {
  return async (request: Request): Promise<Response> => {
    const match = /^bloxbot-icon:\/\/studio\/(light|dark)\/([A-Za-z][A-Za-z0-9_]{0,127})$/.exec(
      request.url,
    );
    if (!match || request.method !== "GET") return new Response(null, { status: 404 });

    const theme = match[1] === "light" ? "light" : "dark";
    const icon = await resolve(match[2], theme).catch(() => DEFAULT_ICON);
    return new Response(Uint8Array.from(icon.bytes), {
      headers: {
        "Content-Type": icon.type,
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  };
}
