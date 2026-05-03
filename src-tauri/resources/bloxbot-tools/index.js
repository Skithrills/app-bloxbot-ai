#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

// ── Config ─────────────────────────────────────────────
const CACHE_DIR = path.join(os.homedir(), ".bloxbot-tools");
const BIN_DIR = path.join(CACHE_DIR, "bin");

// ── Binary metadata ────────────────────────────────────
const BINARIES = {
  selene: {
    repo: "Kampfkarren/selene",
    version: "0.27.1",
    assetMap: {
      win32: "selene-{version}-windows-x86_64.zip",
      darwin: "selene-{version}-macos-x86_64.zip",
      linux: "selene-{version}-linux-x86_64.zip",
    },
    exeName: { win32: "selene.exe", darwin: "selene", linux: "selene" },
  },
  stylua: {
    repo: "JohnnyMorganz/StyLua",
    version: "2.0.2",
    assetMap: {
      win32: "stylua-windows-x86_64.zip",
      darwin: "stylua-macos-x86_64.zip",
      linux: "stylua-linux-x86_64.zip",
    },
    exeName: { win32: "stylua.exe", darwin: "stylua", linux: "stylua" },
  },
};

// ── Utilities ──────────────────────────────────────────
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function httpsGet(url, binary = false) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: binary ? {} : { "User-Agent": "BloxBot-Tools/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpsGet(res.headers.location, binary));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function downloadAndExtract(name, meta) {
  const platform = process.platform;
  if (!meta.assetMap[platform]) throw new Error(`Unsupported platform: ${platform}`);

  const assetName = meta.assetMap[platform].replace("{version}", meta.version);
  const url = `https://github.com/${meta.repo}/releases/download/v${meta.version}/${assetName}`;
  const dest = path.join(BIN_DIR, name);

  if (fs.existsSync(dest)) return dest;

  ensureDir(BIN_DIR);
  console.error(`[BloxBot Tools] Downloading ${name} from GitHub...`);
  const data = await httpsGet(url, true);
  const archivePath = path.join(BIN_DIR, assetName);
  fs.writeFileSync(archivePath, data);

  // Extract
  if (assetName.endsWith(".zip")) {
    if (platform === "win32") {
      const ps = spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${BIN_DIR}' -Force`,
        ],
        { stdio: "inherit" }
      );
      await new Promise((resolve, reject) => {
        ps.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Expand-Archive failed"))));
      });
    } else {
      const tar = spawn("unzip", ["-o", archivePath, "-d", BIN_DIR], { stdio: "inherit" });
      await new Promise((resolve, reject) => {
        tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error("unzip failed"))));
      });
    }
  } else if (assetName.endsWith(".tar.gz")) {
    const tar = spawn("tar", ["-xzf", archivePath, "-C", BIN_DIR], { stdio: "inherit" });
    await new Promise((resolve, reject) => {
      tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error("tar failed"))));
    });
  }

  // Rename extracted binary to a normalized name if needed
  const expectedExe = meta.exeName[platform];
  const extractedPath = path.join(BIN_DIR, expectedExe);
  if (!fs.existsSync(extractedPath)) {
    // try to find it in the zip root
    const files = fs.readdirSync(BIN_DIR);
    const match = files.find((f) => f.startsWith(name) || f === expectedExe);
    if (match && match !== expectedExe) {
      fs.renameSync(path.join(BIN_DIR, match), extractedPath);
    }
  }
  // Make executable on Unix
  if (platform !== "win32" && fs.existsSync(extractedPath)) {
    fs.chmodSync(extractedPath, 0o755);
  }

  fs.unlinkSync(archivePath);
  return dest;
}

async function ensureBinary(name) {
  const meta = BINARIES[name];
  if (!meta) throw new Error(`Unknown binary: ${name}`);
  const platform = process.platform;
  const exeName = meta.exeName[platform];
  const exePath = path.join(BIN_DIR, exeName);
  if (fs.existsSync(exePath)) return exePath;
  await downloadAndExtract(name, meta);
  if (!fs.existsSync(exePath)) throw new Error(`Failed to install ${name}`);
  return exePath;
}

// ── MCP Helpers ────────────────────────────────────────
function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function readRequest(buf) {
  // Simple Content-Length parser
  let offset = 0;
  while (offset < buf.length) {
    const headerEnd = buf.indexOf("\r\n\r\n", offset);
    if (headerEnd === -1) return { used: offset, msg: null };
    const header = buf.slice(offset, headerEnd).toString("utf8");
    const match = header.match(/Content-Length: (\d+)/i);
    if (!match) return { used: offset, msg: null };
    const len = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) return { used: offset, msg: null };
    const body = buf.slice(bodyStart, bodyStart + len).toString("utf8");
    offset = bodyStart + len;
    try {
      const msg = JSON.parse(body);
      return { used: offset, msg };
    } catch {
      return { used: offset, msg: null };
    }
  }
  return { used: offset, msg: null };
}

// ── Tools ──────────────────────────────────────────────
async function handleToolCall(name, args) {
  switch (name) {
    case "web_search": {
      const query = args.query;
      if (!query) throw new Error("Missing query");
      const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const html = await httpsGet(ddgUrl);
      // Extract links with text
      const links = [];
      const linkRe = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        const text = m[2].replace(/<[^>]+>/g, "").trim();
        if (href.startsWith("http") && text && text.length > 10 && !href.includes("duckduckgo")) {
          links.push({ url: href, title: text });
        }
      }
      const top = links.slice(0, Math.min(args.max_results || 3, 5));
      if (top.length === 0) return { content: [{ type: "text", text: "No results found." }] };
      // Summarize top results via Jina AI
      const summaries = await Promise.all(
        top.map(async (l) => {
          try {
            const jinaUrl = `https://r.jina.ai/http://` + l.url.replace(/^https?:\/\//, "");
            const summary = await httpsGet(jinaUrl);
            return `## ${l.title}\n${summary.slice(0, 600)}\n`;
          } catch (e) {
            return `## ${l.title}\n(Unable to fetch summary)\n`;
          }
        })
      );
      return {
        content: [
          {
            type: "text",
            text: `Search results for "${query}":\n\n${summaries.join("\n---\n")}`,
          },
        ],
      };
    }

    case "lint_script": {
      const code = args.code;
      const filePath = args.file_path || "script.lua";
      if (!code) throw new Error("Missing code");
      const selenePath = await ensureBinary("selene");

      // Write a temporary selene.toml for Roblox std
      const seleneToml = path.join(CACHE_DIR, "selene.toml");
      if (!fs.existsSync(seleneToml)) {
        fs.writeFileSync(
          seleneToml,
          `[std]\nname = "roblox"\n`,
          "utf8"
        );
      }

      const tmpFile = path.join(os.tmpdir(), `selene-${Date.now()}.lua`);
      fs.writeFileSync(tmpFile, code, "utf8");

      const { stdout, stderr } = await runCommand(selenePath, [tmpFile], { cwd: CACHE_DIR });
      fs.unlinkSync(tmpFile);
      const output = stdout || stderr || "";
      if (!output.trim()) {
        return { content: [{ type: "text", text: "✅ No issues found." }] };
      }
      return { content: [{ type: "text", text: output }] };
    }

    case "format_script": {
      const code = args.code;
      if (!code) throw new Error("Missing code");
      const styluaPath = await ensureBinary("stylua");
      const tmpFile = path.join(os.tmpdir(), `stylua-${Date.now()}.lua`);
      fs.writeFileSync(tmpFile, code, "utf8");

      try {
        await runCommand(styluaPath, ["--check", tmpFile], { cwd: CACHE_DIR });
        fs.unlinkSync(tmpFile);
        return { content: [{ type: "text", text: "✅ Code is already formatted." }] };
      } catch (e) {
        // Not formatted, run formatter
        await runCommand(styluaPath, [tmpFile], { cwd: CACHE_DIR });
        const formatted = fs.readFileSync(tmpFile, "utf8");
        fs.unlinkSync(tmpFile);
        return { content: [{ type: "text", text: formatted }] };
      }
    }

    case "script_outline": {
      const code = args.code;
      const filePath = args.path || "unknown";
      if (!code) throw new Error("Missing code");
      const outline = generateOutline(code, filePath);
      return { content: [{ type: "text", text: outline }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...options, shell: false });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `Exit code ${code}`));
    });
  });
}

// ── Script Outline Generator ───────────────────────────
function generateOutline(code, filePath) {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 30) {
    return `// ${filePath} (${lines.length} lines) — script is small, full content:\n${code}`;
  }

  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('--')) continue;

    if (/^(?:local\s+)?function\s+/.test(t)) {
      entries.push({ line: i + 1, text: t });
    } else if (/^local\s+\w+\s*=/.test(t)) {
      entries.push({ line: i + 1, text: t });
    } else if (/^return\s/.test(t)) {
      entries.push({ line: i + 1, text: t });
    } else if (/^\w+\.\w+\s*=/.test(t)) {
      entries.push({ line: i + 1, text: t });
    }
  }

  if (entries.length === 0) {
    return `// ${filePath} (${lines.length} lines) — no significant structure found`;
  }

  const outline = [];
  for (let i = 0; i < entries.length; i++) {
    const curr = entries[i];
    const next = entries[i + 1];
    const endLine = next ? next.line - 1 : lines.length;
    const lineCount = endLine - curr.line + 1;
    const preview = curr.text.slice(0, 60);
    const dots = curr.text.length > 60 ? '...' : '';
    outline.push(`${curr.line}-${endLine}: ${preview}${dots} (${lineCount} lines)`);
  }

  const header = `// ${filePath} (${lines.length} lines)`;
  return header + '\n' + outline.join('\n');
}

// ── Main loop ──────────────────────────────────────────
let buffer = Buffer.alloc(0);
let initialized = false;

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const { used, msg } = readRequest(buffer);
    if (!msg) break;
    buffer = buffer.slice(used);
    handleMessage(msg);
  }
});

async function handleMessage(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "bloxbot-tools", version: "1.0.0" },
      },
    });
    initialized = true;
    return;
  }

  if (msg.method === "initialized") {
    // notification, no response needed
    return;
  }

  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "web_search",
            description: "Search the web for current Roblox API docs, best practices, or Luau topics.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query" },
              },
              required: ["query"],
            },
          },
          {
            name: "lint_script",
            description: "Lint Luau code with selene (Roblox std). Returns warnings and errors.",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string", description: "Luau source code" },
                file_path: { type: "string", description: "Optional original file path" },
              },
              required: ["code"],
            },
          },
          {
            name: "format_script",
            description: "Format Luau code with StyLua. Returns formatted code.",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string", description: "Luau source code" },
              },
              required: ["code"],
            },
          },
          {
            name: "script_outline",
            description: "Get a structural outline of a Luau script (functions, locals, returns) with line ranges. Use before editing to understand large scripts.",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string", description: "Luau source code" },
                path: { type: "string", description: "File path for display" },
              },
              required: ["code"],
            },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === "tools/call") {
    if (!initialized) {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32001, message: "Not initialized" } });
      return;
    }
    try {
      const result = await handleToolCall(msg.params.name, msg.params.arguments || {});
      send({ jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: e.message || String(e) },
      });
    }
    return;
  }

  // Fallback
  if (msg.id !== undefined) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
}

console.error("[BloxBot Tools] MCP server started on stdio.");
