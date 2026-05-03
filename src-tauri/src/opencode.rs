//! OpenCode server management.
//!
//! Starts the OpenCode server as a child process on app launch, waits
//! for it to be ready, then injects the port into the webview so the
//! frontend can connect directly via the OpenCode SDK.
//!
//! If the sidecar can't start, the app exits.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

// ── MCP Tool Response Cache ─────────────────────────────────────────────

const MCP_CACHE_TTL_SECS: u64 = 30;

/// Read-only MCP tools that are safe to cache.
const CACHEABLE_TOOLS: &[&str] = &[
    "script_read",
    "search_game_tree",
    "get_instance_children",
    "get_instance_properties",
    "script_search",
    "script_grep",
    "inspect_instance",
];

struct McpCacheEntry {
    result: serde_json::Value,
    inserted_at: std::time::Instant,
}

struct McpCache {
    map: HashMap<String, McpCacheEntry>,
}

impl McpCache {
    fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    fn get(&self, tool: &str, args: &serde_json::Value) -> Option<serde_json::Value> {
        let key = format!("{}:{}", tool, args.to_string());
        let entry = self.map.get(&key)?;
        let elapsed = entry.inserted_at.elapsed().as_secs();
        if elapsed > MCP_CACHE_TTL_SECS {
            return None;
        }
        log::debug!("[mcp_cache] HIT for {}", tool);
        Some(entry.result.clone())
    }

    fn insert(&mut self, tool: &str, args: &serde_json::Value, result: serde_json::Value) {
        let key = format!("{}:{}", tool, args.to_string());
        self.map.insert(
            key,
            McpCacheEntry {
                result,
                inserted_at: std::time::Instant::now(),
            },
        );
        // Prune stale entries every so often (simple: if map > 200 entries, clear all)
        if self.map.len() > 200 {
            self.map.retain(|_, e| e.inserted_at.elapsed().as_secs() <= MCP_CACHE_TTL_SECS);
        }
    }
}

static MCP_CACHE: std::sync::LazyLock<std::sync::Mutex<McpCache>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(McpCache::new()));

fn is_cacheable_tool(tool: &str) -> bool {
    CACHEABLE_TOOLS.contains(&tool)
}

/// BloxBot's reserved port range within the IANA dynamic/private range
/// (49152-65535). The block is 10 ports; the app binds to the first
/// available port in the block.
const OC_PORT_START: u16 = 59200;
const PORT_RANGE: u16 = 10;

/// All servers bind to IPv4 loopback.
pub const LOOPBACK: &str = "127.0.0.1";


// ── State ───────────────────────────────────────────────────────────────

/// A single log line from the OpenCode sidecar, forwarded to the frontend.
#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

pub struct OpenCodeState {
    pub port: u16,
    pub workspace: String,
    pub(crate) child: Option<CommandChild>,
    pub log_lines: Vec<LogEntry>,
    /// Set to true by `stop_all()` before killing the sidecar.
    /// Prevents `handle_process_exit` from logging an error
    /// or calling `app.exit()` during intentional shutdown.
    pub(crate) shutting_down: bool,
}

impl Default for OpenCodeState {
    fn default() -> Self {
        Self {
            port: 0,
            workspace: String::new(),
            child: None,
            log_lines: Vec::with_capacity(2000),
            shutting_down: false,
        }
    }
}

pub type SharedOpenCodeState = Arc<Mutex<OpenCodeState>>;

// ── Helpers ─────────────────────────────────────────────────────────────

/// Find the first available TCP port starting from `start`.
async fn find_available_port(start: u16) -> u16 {
    for port in start..start.saturating_add(PORT_RANGE) {
        if tokio::net::TcpListener::bind((LOOPBACK, port))
            .await
            .is_ok()
        {
            return port;
        }
        log::debug!("Port {port} unavailable, skipping");
    }
    log::error!(
        "All ports {start}-{} are unavailable!",
        start.saturating_add(PORT_RANGE - 1)
    );
    start
}

/// Strip the Windows extended-length path prefix (`\\?\`).
#[cfg(windows)]
fn strip_win_prefix(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

// ── Auth replication ────────────────────────────────────────────────────

/// Resolve the global OpenCode auth file path, matching OpenCode's own
/// `xdg-basedir` logic (respects `XDG_DATA_HOME`, otherwise falls back to
/// `~/.local/share/opencode/auth.json`).
fn global_auth_path() -> Option<std::path::PathBuf> {
    if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
        return Some(std::path::PathBuf::from(xdg_data).join("opencode").join("auth.json"));
    }
    dirs::home_dir().map(|h| h.join(".local").join("share").join("opencode").join("auth.json"))
}

/// Copy the user's global OpenCode auth into the isolated sidecar
/// environment so that provider credentials (e.g. `opencode-go`) are
/// available to subagent sessions created via `ctx.client.session.create()`.
fn copy_global_auth_to_isolated(xdg_data: &std::path::Path) -> Result<(), String> {
    let global_auth = match global_auth_path() {
        Some(p) => p,
        None => return Ok(()),
    };
    if !global_auth.exists() {
        log::info!("No global auth found at {}", global_auth.display());
        return Ok(());
    }
    let isolated_auth = xdg_data.join("opencode").join("auth.json");
    if let Some(parent) = isolated_auth.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create auth dir: {e}"))?;
    }
    std::fs::copy(&global_auth, &isolated_auth)
        .map_err(|e| format!("Failed to copy auth: {e}"))?;
    log::info!(
        "Copied global auth from {} to {}",
        global_auth.display(),
        isolated_auth.display()
    );
    Ok(())
}

// ── Studio MCP binary resolution ────────────────────────────────────────

fn studio_mcp_command() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        vec!["/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP".to_string()]
    }
    #[cfg(target_os = "windows")]
    {
        let local_app = dirs::data_local_dir()
            .map(|p| p.join("Roblox").join("mcp.bat"))
            .unwrap_or_else(|| {
                std::path::PathBuf::from(r"C:\Users\Default\AppData\Local\Roblox\mcp.bat")
            });
        vec![
            "cmd.exe".to_string(),
            "/c".to_string(),
            local_app.to_string_lossy().to_string(),
        ]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec!["studio-mcp".to_string()]
    }
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct ContextFileConfig {
    pub name: String,
    pub enabled: bool,
    pub priority: String, // "critical", "normal", "background"
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct ContextSettings {
    pub max_tokens: usize,
    pub files: Vec<ContextFileConfig>,
    pub auto_codebase: bool,
}

impl Default for ContextSettings {
    fn default() -> Self {
        Self {
            max_tokens: 2000,
            files: Vec::new(),
            auto_codebase: false,
        }
    }
}

/// Approximate token count: characters / 4.
fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// Scan the workspace for markdown context files and concatenate them.
/// Reads `.settings.json` from the context directory to filter, sort,
/// and truncate files according to priority and token budget.
/// Returns empty string if no context directory exists.
fn load_context_files(workspace: &std::path::Path) -> Result<String, std::io::Error> {
    let context_dir = workspace.join(".bloxbot").join("context");
    if !context_dir.exists() {
        return Ok(String::new());
    }

    // Read settings if present
    let settings_path = context_dir.join(".settings.json");
    let settings: ContextSettings = if settings_path.exists() {
        let text = std::fs::read_to_string(&settings_path)?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        ContextSettings::default()
    };

    // Collect all .md files
    let mut entries = std::fs::read_dir(&context_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "md")
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    entries.sort_by_key(|e| e.file_name());

    // Build file configs for any files not yet in settings
    let mut file_map: std::collections::HashMap<String, ContextFileConfig> = settings
        .files
        .into_iter()
        .map(|f| (f.name.clone(), f))
        .collect();

    let mut files_with_content: Vec<(ContextFileConfig, String, usize)> = Vec::new();

    for entry in &entries {
        let path = entry.path();
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let config = file_map.remove(&name).unwrap_or(ContextFileConfig {
            name: name.clone(),
            enabled: true,
            priority: "normal".to_string(),
        });

        if !config.enabled {
            continue;
        }

        let text = std::fs::read_to_string(&path)?;
        let tokens = estimate_tokens(&text);
        files_with_content.push((config, text, tokens));
    }

    // Sort by priority: critical (0) > normal (1) > background (2)
    files_with_content.sort_by(|a, b| {
        let priority_rank = |p: &str| match p {
            "critical" => 0,
            "normal" => 1,
            "background" => 2,
            _ => 1,
        };
        priority_rank(&a.0.priority).cmp(&priority_rank(&b.0.priority))
    });

    // Build output within token budget
    let mut parts = Vec::new();
    let mut total_tokens = 0;
    let max_tokens = if settings_path.exists() {
        settings.max_tokens
    } else {
        usize::MAX // No budget when settings don't exist (backward compat)
    };

    for (config, text, tokens) in files_with_content {
        let is_critical = config.priority == "critical";

        if !is_critical && total_tokens + tokens > max_tokens {
            log::info!(
                "Skipping context file '{}' ({} tokens) — would exceed budget of {}",
                config.name,
                tokens,
                max_tokens
            );
            continue;
        }

        total_tokens += tokens;
        parts.push(format!("### {}\n\n{}", config.name, text));
    }

    if !parts.is_empty() {
        log::info!(
            "Injected {} context files ({} est. tokens) into studio agent prompt",
            parts.len(),
            total_tokens
        );
    }

    Ok(parts.join("\n\n---\n\n"))
}

/// Information about a single context file for the frontend.
#[derive(serde::Serialize)]
pub struct ContextFileInfo {
    pub name: String,
    pub tokens: usize,
    pub enabled: bool,
    pub priority: String,
}

/// List all markdown context files with their current settings and token estimates.
#[tauri::command]
pub async fn list_context_files() -> Result<Vec<ContextFileInfo>, String> {
    let workspace = crate::paths::workspace_dir().map_err(|e| e.to_string())?;
    let context_dir = workspace.join(".bloxbot").join("context");

    if !context_dir.exists() {
        return Ok(Vec::new());
    }

    // Read settings if present
    let settings_path = context_dir.join(".settings.json");
    let settings: ContextSettings = if settings_path.exists() {
        let text = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        ContextSettings::default()
    };

    let file_map: std::collections::HashMap<String, ContextFileConfig> = settings
        .files
        .into_iter()
        .map(|f| (f.name.clone(), f))
        .collect();

    let mut infos = Vec::new();

    let entries = std::fs::read_dir(&context_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "md")
                .unwrap_or(false)
        });

    for entry in entries {
        let path = entry.path();
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let config = file_map.get(&name);
        let enabled = config.map(|c| c.enabled).unwrap_or(true);
        let priority = config
            .map(|c| c.priority.clone())
            .unwrap_or_else(|| "normal".to_string());

        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let tokens = estimate_tokens(&text);

        infos.push(ContextFileInfo {
            name,
            tokens,
            enabled,
            priority,
        });
    }

    infos.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(infos)
}

/// Write context settings to `.settings.json` in the context directory.
#[tauri::command]
pub async fn write_context_settings(
    max_tokens: usize,
    files: Vec<ContextFileConfig>,
    auto_codebase: bool,
) -> Result<(), String> {
    let workspace = crate::paths::workspace_dir().map_err(|e| e.to_string())?;
    let context_dir = workspace.join(".bloxbot").join("context");

    if !context_dir.exists() {
        std::fs::create_dir_all(&context_dir).map_err(|e| e.to_string())?;
    }

    let settings = ContextSettings {
        max_tokens,
        files,
        auto_codebase,
    };
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let path = context_dir.join(".settings.json");
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    log::info!("Wrote context settings to {}", path.display());
    Ok(())
}

/// Generate or update `codebase.md` from a Verde explorer snapshot.
/// Expects `snapshot` to be the JSON payload from a `explorer_snapshot` message.
/// Writes a compact structural outline to `.bloxbot/context/codebase.md`.
#[tauri::command]
pub async fn generate_codebase_context(snapshot: serde_json::Value) -> Result<(), String> {
    let workspace = crate::paths::workspace_dir().map_err(|e| e.to_string())?;
    let context_dir = workspace.join(".bloxbot").join("context");
    if !context_dir.exists() {
        std::fs::create_dir_all(&context_dir).map_err(|e| e.to_string())?;
    }

    let payload = snapshot
        .get("payload")
        .or(Some(&snapshot))
        .ok_or("Missing snapshot payload")?;
    let nodes = payload
        .get("nodes")
        .and_then(|n| n.as_object())
        .ok_or("Missing nodes object")?;
    let root_ids = payload
        .get("rootIds")
        .and_then(|r| r.as_array())
        .ok_or("Missing rootIds")?;

    fn build_outline(
        nodes: &serde_json::Map<String, serde_json::Value>,
        id: &str,
        depth: usize,
        out: &mut Vec<String>,
    ) {
        let node = match nodes.get(id) {
            Some(n) => n,
            None => return,
        };
        let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        let class = node
            .get("className")
            .and_then(|v| v.as_str())
            .unwrap_or("Instance");
        let indent = "  ".repeat(depth);
        let is_script = class == "Script" || class == "LocalScript" || class == "ModuleScript";
        let marker = if is_script { " 📜" } else { "" };
        out.push(format!("{}{} (`{}`){}", indent, name, class, marker));

        if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
            for child_id in children {
                if let Some(cid) = child_id.as_str() {
                    build_outline(nodes, cid, depth + 1, out);
                }
            }
        }
    }

    let mut lines = vec![
        "# Codebase Overview".to_string(),
        String::new(),
        "This file is auto-generated from the live Roblox Studio explorer.".to_string(),
        "It gives the AI a structural map of the project without requiring tool calls.".to_string(),
        String::new(),
    ];

    for root in root_ids {
        if let Some(rid) = root.as_str() {
            build_outline(nodes, rid, 0, &mut lines);
        }
    }

    let content = lines.join("\n");
    let path = context_dir.join("codebase.md");
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;

    let tokens = estimate_tokens(&content);
    log::info!(
        "Wrote codebase.md ({} nodes, ~{} tokens) to {}",
        nodes.len(),
        tokens,
        path.display()
    );
    Ok(())
}

/// Generate a lightweight structural outline of Luau code.
/// Extracts functions, local declarations, and module returns.
fn generate_script_outline(code: &str, path: &str) -> String {
    let mut outlines = Vec::new();
    let script_name = path.split('.').last().unwrap_or("script");

    outlines.push(format!("# {script_name}"));
    outlines.push(String::new());

    for (line_num, line) in code.lines().enumerate() {
        let trimmed = line.trim();
        let line_no = line_num + 1;

        if trimmed.starts_with("local function ") {
            if let Some(name) = trimmed.strip_prefix("local function ") {
                let name = name.split('(').next().unwrap_or(name).trim();
                outlines.push(format!("- `local function {name}` (line {line_no})"));
            }
        } else if trimmed.starts_with("function ") {
            if let Some(name) = trimmed.strip_prefix("function ") {
                let name = name.split('(').next().unwrap_or(name).trim();
                outlines.push(format!("- `function {name}` (line {line_no})"));
            }
        } else if trimmed.starts_with("local ") && !trimmed.starts_with("local function") {
            // Extract variable names from local declarations
            if let Some(decl) = trimmed.strip_prefix("local ") {
                let names = decl.split('=').next().unwrap_or(decl).trim();
                if !names.is_empty() && !names.starts_with("--") {
                    outlines.push(format!("- `local {names}` (line {line_no})"));
                }
            }
        } else if trimmed.starts_with("return ") {
            let ret = trimmed.strip_prefix("return ").unwrap_or(trimmed).trim();
            if ret.len() < 80 {
                outlines.push(format!("- `return {ret}` (line {line_no})"));
            } else {
                outlines.push(format!("- `return ...` (line {line_no})"));
            }
        }
    }

    if outlines.len() <= 2 {
        outlines.push("*No significant declarations found*".to_string());
    }

    outlines.join("\n")
}

/// Update auto-generated context for an open script.
/// Writes an outline to `.bloxbot/context/.auto/<name>.md`.
#[tauri::command]
pub async fn update_auto_context(path: String, code: String) -> Result<(), String> {
    let workspace = crate::paths::workspace_dir().map_err(|e| e.to_string())?;
    let auto_dir = workspace.join(".bloxbot").join("context").join(".auto");

    if !auto_dir.exists() {
        std::fs::create_dir_all(&auto_dir).map_err(|e| e.to_string())?;
    }

    let script_name = path.split('.').last().unwrap_or("script");
    let outline = generate_script_outline(&code, &path);
    let file_path = auto_dir.join(format!("{script_name}.md"));

    std::fs::write(&file_path, outline).map_err(|e| e.to_string())?;
    log::debug!("Wrote auto-context for {path} to {}", file_path.display());
    Ok(())
}

/// Clear all auto-generated context files.
#[tauri::command]
pub async fn clear_auto_context() -> Result<(), String> {
    let workspace = crate::paths::workspace_dir().map_err(|e| e.to_string())?;
    let auto_dir = workspace.join(".bloxbot").join("context").join(".auto");

    if auto_dir.exists() {
        std::fs::remove_dir_all(&auto_dir).map_err(|e| e.to_string())?;
        log::info!("Cleared auto-generated context directory");
    }

    Ok(())
}

/// Call an MCP tool directly by spawning the Studio MCP server process.
/// This bypasses OpenCode entirely for reliable direct tool execution.
#[tauri::command]
pub async fn call_mcp_tool(tool: String, arguments: serde_json::Value) -> Result<serde_json::Value, String> {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};

    // ── Cache lookup ────────────────────────────────────────────────────
    if is_cacheable_tool(&tool) {
        if let Ok(cache) = MCP_CACHE.lock() {
            if let Some(cached) = cache.get(&tool, &arguments) {
                return Ok(cached);
            }
        }
    }

    let cmd = studio_mcp_command();
    if cmd.is_empty() {
        return Err("Studio MCP command not configured".to_string());
    }

    let mut child = Command::new(&cmd[0])
        .args(&cmd[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server: {e}"))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    // Send initialize request
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "bloxbot-editor", "version": "0.5.2" }
        }
    });

    let mut stdin = stdin;
    let payload = serde_json::to_string(&init_req).map_err(|e| e.to_string())?;
    let msg = format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload);
    stdin.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;

    // Read initialize response
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let len: usize = line
        .trim()
        .strip_prefix("Content-Length: ")
        .and_then(|n| n.parse().ok())
        .ok_or("Invalid Content-Length header")?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;

    // Send tools/call request
    let call_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": tool,
            "arguments": arguments
        }
    });

    let payload = serde_json::to_string(&call_req).map_err(|e| e.to_string())?;
    let msg = format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload);
    stdin.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;

    // Read response
    line.clear();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let len: usize = line
        .trim()
        .strip_prefix("Content-Length: ")
        .and_then(|n| n.parse().ok())
        .ok_or("Invalid Content-Length header")?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;

    // Cleanup
    let _ = child.kill();

    let response: serde_json::Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if let Some(error) = response.get("error") {
        return Err(format!("MCP error: {}", error));
    }

    let result = response.get("result").cloned().unwrap_or(serde_json::Value::Null);

    // ── Cache store ─────────────────────────────────────────────────────
    if is_cacheable_tool(&tool) {
        if let Ok(mut cache) = MCP_CACHE.lock() {
            cache.insert(&tool, &arguments, result.clone());
        }
    }

    Ok(result)
}

// ── Startup cleanup ─────────────────────────────────────────────────────

/// Kill any stale processes listening on our reserved port range.
pub fn cleanup_stale_processes() {
    let start = OC_PORT_START;
    let end = OC_PORT_START + PORT_RANGE;
    log::info!("Checking for stale processes on ports {start}-{}", end - 1);

    #[cfg(unix)]
    {
        let mut killed = 0u32;
        for port in start..end {
            let output = std::process::Command::new("lsof")
                .args(["-ti", &format!("tcp:{port}")])
                .output();

            if let Ok(out) = output {
                let pids = String::from_utf8_lossy(&out.stdout);
                for pid_str in pids.split_whitespace() {
                    if let Ok(pid) = pid_str.trim().parse::<u32>() {
                        log::info!("Killing stale process PID {pid} on port {port}");
                        let _ = std::process::Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                        killed += 1;
                    }
                }
            }
        }
        if killed > 0 {
            log::info!("Killed {killed} stale process(es)");
        } else {
            log::info!("No stale processes found");
        }
    }

    #[cfg(windows)]
    {
        let output = std::process::Command::new("netstat")
            .args(["-ano", "-p", "TCP"])
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for port in start..end {
                let needle = format!("{}:{}", LOOPBACK, port);
                for line in text.lines() {
                    if line.contains(&needle) && line.contains("LISTENING") {
                        if let Some(pid_str) = line.split_whitespace().last() {
                            if let Ok(pid) = pid_str.parse::<u32>() {
                                if pid > 0 {
                                    log::info!("Killing stale process PID {pid} on port {port}");
                                    let _ = std::process::Command::new("taskkill")
                                        .args(["/F", "/PID", &pid.to_string()])
                                        .output();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Tauri command ───────────────────────────────────────────────────────

/// Returns the OpenCode server port and workspace directory.
/// Called by the frontend to create the SDK client.
/// Returns the OpenCode server port and workspace directory.
#[tauri::command]
pub async fn get_opencode_info(
    state: tauri::State<'_, SharedOpenCodeState>,
) -> Result<(u16, String), String> {
    let s = state.lock().await;
    Ok((s.port, s.workspace.clone()))
}

/// Returns all buffered sidecar log lines, newest last.
#[tauri::command]
pub async fn get_opencode_logs(
    state: tauri::State<'_, SharedOpenCodeState>,
) -> Result<Vec<LogEntry>, String> {
    let s = state.lock().await;
    Ok(s.log_lines.clone())
}

/// Base system prompt for the studio agent. Context files are appended at runtime.
const STUDIO_PROMPT_BASE: &str = concat!(
    "You are BloxBot, an expert Roblox game developer working directly inside Roblox Studio via the official built-in MCP server. ",
    "You build games by using MCP tools to read, write, and execute code in the live Studio session — never by showing code snippets for the user to paste.\n\n",

    "## Workflow\n",
    "1. **Explore first.** Use `search_game_tree` (depth 5-10), `inspect_instance`, `script_search`, and `script_read` to understand the project before changing anything. Never guess at paths or names.\n",
    "2. **Edit with tools.** Use `multi_edit` for script changes and `execute_luau` for instance creation, property changes, and batch operations. Never tell the user to paste code.\n",
    "3. **Verify after.** Re-read scripts with `script_read` and confirm DataModel changes with `inspect_instance` or `search_game_tree`.\n",
    "4. **Debug with playtests.** Instrument code → `start_stop_play(\"start\")` → simulate input or ask the user to act → `console_output()` + `execute_luau` to probe live state → `start_stop_play(\"stop\")` → fix → repeat.\n\n",

    "## Project Awareness\n",
    "At the start of a session, scan the codebase to learn its architecture. Use `search_game_tree` with high depth, then read key scripts. Identify:\n",
    "- **Frameworks**: Knit, AeroGameFramework, Rojo, Nevermore, Fusion, Roact/React-lua, Rodux, ProfileService, DataStore2, etc. All new code must follow existing patterns.\n",
    "- **Folder conventions**: How are scripts organized? Place new code where it belongs.\n",
    "- **Module patterns**: Return table, OOP metatables, functional? Match the style.\n",
    "- **Communication patterns**: Direct RemoteEvents, or wrapped (Knit, BridgeNet2, Red)? Use the same approach.\n",
    "- **Naming conventions**: PascalCase, camelCase, prefix systems? Be consistent.\n\n",
    "Carry this context throughout the session. Do not introduce new frameworks or architectural styles unless the user explicitly asks.\n\n",

    "## Tool Guide\n",
    "Use ONLY the tools listed below. Tool names follow the MCP server naming convention — not the BloxBot plugin naming. Do not invent `studio_*` tool names.\n\n",

    "### Scripts\n",
    "- `script_read(path)` — Read script via dot-notation. Supports `start_line`/`end_line` for ranges.\n",
    "- `multi_edit(path, edits[])` — Atomic sequential edits via exact string matching. Can create new scripts.\n",
    "- `script_search(query)` — Fuzzy search script names (max 10 results).\n",
    "- `script_grep(pattern)` — Search all script contents for a string pattern (max 50 matches).\n\n",

    "### Data Model\n",
    "- `search_game_tree(path?, instance_type?, keyword?, depth?)` — Explore hierarchy as flat JSON. Default depth 3, max 10.\n",
    "- `inspect_instance(path)` — All readable properties, attributes, children/descendants counts.\n\n",

    "### Code Execution\n",
    "`execute_luau(code)` — Run Luau in Studio: create instances, set properties, batch ops, probe live state.\n\n",

    "### Playtesting & Debugging\n",
    "- `start_stop_play(\"start\")` / `start_stop_play(\"stop\")` — Start/stop playtesting.\n",
    "- `console_output()` — Retrieve console logs.\n",
    "**Always stop playtesting before making structural edits.**\n\n",

    "### Input Simulation\n",
    "- `character_navigation(target)` — Move player to position or instance path.\n",
    "- `keyboard_input(action, key)` — Key presses, holds, text input.\n",
    "- `mouse_input(action, position?)` — Clicks, movement, scrolling.\n\n",

    "### Session Management\n",
    "- `list_roblox_studios()` — List connected Studio instances.\n",
    "- `set_active_studio(studio_id)` — Target a specific instance.\n\n",

    "### BloxBot Tools (auxiliary MCP)\n",
    "- `web_search(query, max_results?)` — Search the web. Returns 3 results by default (max 5).\n",
    "- `lint_script(code, file_path?)` — Lint Luau with selene (Roblox std).\n",
    "- `format_script(code)` — Format Luau with StyLua.\n",
    "- `script_outline(code, path?)` — Get structural outline of large scripts (functions, locals, returns with line ranges). Use before editing to understand script structure.\n\n",

    "## Roblox Architecture\n\n",

    "**DataModel**: game → Services → Instances. Key services:\n",
    "- `Workspace` — 3D world. BaseParts, Models, Terrain, Camera. Replicated.\n",
    "- `ServerScriptService` — Server Scripts. Never accessible from client.\n",
    "- `ServerStorage` — Server-only assets and data. Not replicated.\n",
    "- `ReplicatedStorage` — Shared modules, RemoteEvents, RemoteFunctions, assets.\n",
    "- `StarterPlayerScripts` / `StarterCharacterScripts` — LocalScripts cloned per player.\n",
    "- `StarterGui` — ScreenGuis/LocalScripts cloned to PlayerGui.\n",
    "- `Players`, `Lighting`, `SoundService` — as named.\n",
    "- Access all services via `:GetService()`.\n\n",

    "**Client-server model**: Server is authoritative. Clients see a replicated subset. Communicate via RemoteEvents (fire-and-forget) and RemoteFunctions (request-response). ",
    "**Never trust the client.** Validate all inputs server-side.\n\n",

    "**Script types**: `Script` (server), `LocalScript` (client), `ModuleScript` (shared via `require()`). Place them in the correct service.\n\n",

    "## Luau Style\n",
    "- Idiomatic Luau: type annotations, string interpolation, `if-then-else` expressions.\n",
    "- Descriptive names: `player` not `p`, `character` not `char`, `humanoid` not `hum`.\n",
    "- PascalCase for services/instances/properties/methods. camelCase for locals.\n",
    "- `:GetService()` for services. `:WaitForChild()` on client for instances that may not have replicated.\n",
    "- `task.spawn`, `task.defer`, `task.delay`, `task.wait` — never legacy `spawn`/`wait`/`delay`.\n",
    "- Clean up: disconnect connections, destroy clones, cancel threads.\n\n",

    "## Safety\n",
    "- Never overwrite large scripts unless necessary. Prefer targeted `multi_edit`.\n",
    "- Never invent paths, remotes, or instances without verifying they exist.\n",
    "- Never claim a fix works until verified with `script_read`, `inspect_instance`, or playtesting.\n",
    "- If a change is risky or destructive, say so and proceed carefully.\n\n",

    "## Communication\n",
    "Be concise and practical. State what you did, not how to do it — the tools already did it. ",
    "Explain *why* when it's non-obvious. When console errors appear, immediately read the relevant script to diagnose. ",
    "If a request is outside what the tools can do (publishing, Team Create, marketplace), say so clearly.\n\n",

    "## MCP Connection Issues\n",
    "If any MCP tool call fails or times out, tell the user:\n",
    "\"Roblox Studio must be open and configured. See https://create.roblox.com/docs/studio/mcp\"\n",
    "Do not retry repeatedly. Ask the user to verify Studio is running with MCP enabled."
);

// ── Core lifecycle ──────────────────────────────────────────────────────

/// Start the OpenCode server. Called automatically on app launch.
pub async fn start_opencode_server(
    state: SharedOpenCodeState,
    app: AppHandle,
) -> Result<u16, String> {
    // Guard: don't double-start
    {
        let current = state.lock().await;
        if current.child.is_some() {
            return Ok(current.port);
        }
    }

    let nodejs_bin_dir = crate::paths::bundled_nodejs_bin_dir()?;
    log::info!("Node.js bin: {}", nodejs_bin_dir.display());

    let port = do_start(&state, &app, &nodejs_bin_dir).await?;

    // Store workspace in state so the frontend can retrieve it via command
    let workspace = crate::paths::workspace_dir()?;
    {
        let mut s = state.lock().await;
        s.workspace = workspace.to_string_lossy().to_string();
    }

    Ok(port)
}

/// Inner startup logic.
async fn do_start(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    nodejs_bin_dir: &std::path::Path,
) -> Result<u16, String> {
    cleanup_stale_processes();
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    let port = find_available_port(OC_PORT_START).await;
    log::info!("OpenCode port: {port}");

    {
        let mut s = state.lock().await;
        s.port = port;
    }

    let studio_mcp_cmd = studio_mcp_command();
    log::info!("Studio MCP command: {:?}", studio_mcp_cmd);

    let nodejs_exe = nodejs_bin_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
    #[cfg(unix)]
    let nodejs_bin = nodejs_exe.to_string_lossy().to_string();
    #[cfg(windows)]
    let nodejs_bin = strip_win_prefix(&nodejs_exe);

    let bloxbot_tools_dir = crate::paths::bloxbot_tools_dir()?;
    #[cfg(unix)]
    let bloxbot_tools_dir_str = bloxbot_tools_dir.to_string_lossy().to_string();
    #[cfg(windows)]
    let bloxbot_tools_dir_str = strip_win_prefix(&bloxbot_tools_dir);
    let bloxbot_tools_cmd = vec![
        nodejs_bin.clone(),
        format!("{}/index.js", bloxbot_tools_dir_str),
    ];
    log::info!("BloxBot Tools MCP command: {:?}", bloxbot_tools_cmd);

    let workspace = crate::paths::workspace_dir()?;

    // ── Load custom agents and merge with built-ins ───────────────────
    let mut agent_map = serde_json::Map::new();

    // Built-in agent: build
    agent_map.insert(
        "build".to_string(),
        serde_json::json!({
            "description": "Executes tools based on the conversation"
        }),
    );

    // Built-in agent: studio
    let context_content = load_context_files(&workspace).unwrap_or_default();
    let studio_prompt = if context_content.is_empty() {
        STUDIO_PROMPT_BASE.to_string()
    } else {
        log::info!(
            "Injected {} bytes of project context into studio agent prompt",
            context_content.len()
        );
        format!("{STUDIO_PROMPT_BASE}\n\n## Project Context\n\n{context_content}")
    };
    agent_map.insert(
        "studio".to_string(),
        serde_json::json!({
            "mode": "primary",
            "description": "Roblox Studio development assistant",
            "prompt": studio_prompt
        }),
    );

    // Merge custom agents from ~/BloxBot/agents/
    match crate::agents::load_custom_agents() {
        Ok(custom_agents) => {
            for agent in &custom_agents {
                let json = crate::agents::agent_to_opencode_json(agent);
                agent_map.insert(agent.id.clone(), json);
            }
            if !custom_agents.is_empty() {
                log::info!(
                    "Merged {} custom agent(s) into OpenCode config",
                    custom_agents.len()
                );
            }
        }
        Err(e) => {
            log::warn!("Failed to load custom agents, continuing with built-ins only: {e}");
        }
    }

    let mcp_config = serde_json::json!({
        "model": "opencode-go/kimi-k2.6",
        "plugin": [],
        "mcp": {
            "roblox-studio": {
                "type": "local",
                "command": studio_mcp_cmd,
                "enabled": true
            },
            "bloxbot-tools": {
                "type": "local",
                "command": bloxbot_tools_cmd,
                "enabled": true
            }
        },
        "default_agent": "studio",
        "agent": agent_map
    });
    let config_content = serde_json::to_string_pretty(&mcp_config)
        .map_err(|e| format!("Failed to serialize OpenCode config: {e}"))?;

    log::debug!("Config: {config_content}");

    // Create isolated XDG directories under ~/BloxBot/.opencode/
    let opencode_home = workspace.join(".opencode");
    let xdg_data = opencode_home.join("data");
    let xdg_config = opencode_home.join("config");
    let xdg_cache = opencode_home.join("cache");
    let xdg_state = opencode_home.join("state");

    for dir in [&xdg_data, &xdg_config, &xdg_cache, &xdg_state] {
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create directory {}: {e}", dir.display()))?;
        }
    }

    // Create context directory for project-level system instructions
    let context_dir = workspace.join(".bloxbot").join("context");
    if !context_dir.exists() {
        std::fs::create_dir_all(&context_dir)
            .map_err(|e| format!("Failed to create context directory: {e}"))?;
        log::info!("Created context directory: {}", context_dir.display());
    }

    copy_global_auth_to_isolated(&xdg_data)?;

    let config_dir = xdg_config.join("opencode");
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    let config_file = config_dir.join("opencode.json");
    std::fs::write(&config_file, &config_content)
        .map_err(|e| format!("Failed to write OpenCode config: {e}"))?;
    log::info!("Wrote OpenCode config to {}", config_file.display());

    let opencode_path = crate::paths::bundled_opencode_path()?;
    log::info!("Spawning OpenCode from: {}", opencode_path.display());
    log::info!(
        "Current exe: {:?}",
        std::env::current_exe()
    );

    let sidecar_dir = crate::paths::sidecar_dir()?;

    #[cfg(unix)]
    let sidecar_path_str = sidecar_dir.to_string_lossy().to_string();
    #[cfg(windows)]
    let sidecar_path_str = strip_win_prefix(&sidecar_dir);

    #[cfg(unix)]
    let minimal_path = format!(
        "{}:{}:/usr/bin:/bin:/usr/sbin:/sbin",
        nodejs_bin, sidecar_path_str
    );
    #[cfg(windows)]
    let minimal_path = format!(
        "{};{};C:\\Windows\\System32;C:\\Windows",
        nodejs_bin, sidecar_path_str
    );

    log::info!("Working directory: {}", workspace.display());
    log::info!("OpenCode args: serve --port {port} --hostname {LOOPBACK} --print-logs --log-level DEBUG");
    log::info!("Isolated environment: {}", opencode_home.display());
    log::info!(
        "Spawn env: XDG_DATA_HOME={}, XDG_CONFIG_HOME={}, XDG_CACHE_HOME={}, XDG_STATE_HOME={}",
        xdg_data.display(),
        xdg_config.display(),
        xdg_cache.display(),
        xdg_state.display()
    );
    log::debug!("PATH: {}", minimal_path);

    let (rx, child) = app
        .shell()
        .command(&opencode_path)
        .args([
            "serve",
            "--port",
            &port.to_string(),
            "--hostname",
            LOOPBACK,
            "--print-logs",
            "--log-level",
            "DEBUG",
        ])
        .current_dir(&workspace)
        .env("XDG_DATA_HOME", &xdg_data)
        .env("XDG_CONFIG_HOME", &xdg_config)
        .env("XDG_CACHE_HOME", &xdg_cache)
        .env("XDG_STATE_HOME", &xdg_state)
        .env("PATH", &minimal_path)
        .spawn()
        .map_err(|e| {
            let msg = format!("Failed to start OpenCode server: {e}");
            log::error!("{msg}");
            msg
        })?;

    {
        let mut s = state.lock().await;
        s.child = Some(child);
    }

    // Spawn event handler for stdout, stderr, and process exit.
    spawn_event_handler(rx, Arc::clone(state), app.clone());

    // Wait for the HTTP server to be ready.
    // Use /global/health instead of /session — the health endpoint responds
    // immediately while /session triggers full bootstrapping (Bun plugin
    // installation, project init, LSP setup) that can hang on slow networks
    // or when antivirus intercepts downloads. The frontend handles the
    // "still bootstrapping" state via its own polling.
    let health_url = format!("http://{LOOPBACK}:{port}/global/health");
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Check if the process already exited.
        {
            let s = state.lock().await;
            if s.child.is_none() {
                let err = "OpenCode process exited before becoming ready".to_string();
                log::error!("{err}");
                return Err(err);
            }
        }

        match http_client.get(&health_url).send().await {
            Ok(resp) => {
                // Any HTTP response means the server is running and responding.
                // A non-success status (e.g., 401 Unauthorized) just means
                // the endpoint requires auth, but the server is definitely up.
                // The frontend handles authentication separately.
                log::info!("Server responding on port {port} (status {})", resp.status());
                return Ok(port);
            }
            Err(_) => {
                log::trace!("Server not ready yet, retrying...");
            }
        }
    }
}

/// Spawn an event handler task for stdout/stderr/exit.
fn spawn_event_handler(
    rx: tauri::async_runtime::Receiver<CommandEvent>,
    state: SharedOpenCodeState,
    app: AppHandle,
) {
    let app_for_buffer = app.clone();
    let state_for_buffer = state.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::error!("Failed to build tokio runtime for event handler: {e}");
                return;
            }
        };

        rt.block_on(async move {
            process_events(rx, state_for_buffer, app_for_buffer).await;
        });
    });
}

/// Sidecar stderr lines matching these are high-frequency noise.
const NOISY_PATTERNS: &[&str] = &[
    "path=/mcp request",
    "path=/global/health request",
    "service=server method=",
    "service=server status=",
    "service=bus type=",
    "service=tool.registry",
    "service=permission",
];

fn parse_sidecar_level(line: &str) -> log::Level {
    let trimmed = line.trim_start();
    if trimmed.starts_with("ERROR") {
        log::Level::Error
    } else if trimmed.starts_with("WARN") {
        log::Level::Warn
    } else if trimmed.starts_with("DEBUG") {
        log::Level::Debug
    } else if trimmed.starts_with("INFO") {
        log::Level::Info
    } else {
        log::Level::Warn
    }
}

fn is_noisy_sidecar_line(line: &str) -> bool {
    NOISY_PATTERNS.iter().any(|p| line.contains(p))
}

async fn emit_log(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    level: &str,
    source: &str,
    message: &str,
) {
    // Simple HH:MM:SS timestamp from system time (no chrono dep)
    let timestamp = {
        use std::time::SystemTime;
        if let Ok(dur) = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
            let secs = dur.as_secs();
            let h = (secs / 3600) % 24;
            let m = (secs / 60) % 60;
            let s = secs % 60;
            format!("{:02}:{:02}:{:02}", h, m, s)
        } else {
            String::from("--:--:--")
        }
    };
    let entry = LogEntry {
        timestamp,
        level: level.to_string(),
        source: source.to_string(),
        message: message.to_string(),
    };

    // Push to shared buffer (bounded)
    {
        let mut s = state.lock().await;
        let len = s.log_lines.len();
        if len >= 5000 {
            s.log_lines.drain(0..(len - 4999));
        }
        s.log_lines.push(entry.clone());
    }

    // Emit to frontend for real-time display
    let _ = app.emit("opencode-log", &entry);
}

async fn process_events(
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    state: SharedOpenCodeState,
    app: AppHandle,
) {
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim_end();
                if is_noisy_sidecar_line(trimmed) {
                    log::trace!(target: "opencode::stdout", "{trimmed}");
                    emit_log(&state, &app, "DEBUG", "stdout", trimmed).await;
                } else {
                    log::info!(target: "opencode::stdout", "{trimmed}");
                    emit_log(&state, &app, "INFO", "stdout", trimmed).await;
                }
            }
            CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line);
                let trimmed = text.trim_end();
                if trimmed.is_empty() {
                    continue;
                }
                if is_noisy_sidecar_line(trimmed) {
                    log::trace!(target: "opencode::stderr", "{trimmed}");
                    emit_log(&state, &app, "DEBUG", "stderr", trimmed).await;
                } else {
                    let level = parse_sidecar_level(trimmed);
                    let level_str = match level {
                        log::Level::Error => "ERROR",
                        log::Level::Warn => "WARN",
                        log::Level::Info => "INFO",
                        log::Level::Debug => "DEBUG",
                        log::Level::Trace => "DEBUG",
                    };
                    match level {
                        log::Level::Error => {
                            log::error!(target: "opencode::stderr", "{trimmed}")
                        }
                        log::Level::Warn => log::warn!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Info => log::info!(target: "opencode::stderr", "{trimmed}"),
                        log::Level::Debug => {
                            log::debug!(target: "opencode::stderr", "{trimmed}")
                        }
                        _ => log::debug!(target: "opencode::stderr", "{trimmed}"),
                    }
                    emit_log(&state, &app, level_str, "stderr", trimmed).await;
                }
            }
            CommandEvent::Terminated(payload) => {
                handle_process_exit(&state, &app, &payload).await;
                return;
            }
            _ => {}
        }
    }
}

/// Handle process termination. Logs, clears state, and exits the app.
/// The app cannot function without the OpenCode sidecar.
///
/// If `shutting_down` is already set, the process was killed intentionally
/// by `stop_all()` — we suppress the error log and do not call `app.exit()`
/// (the caller of `stop_all` already handles the shutdown).
async fn handle_process_exit(
    state: &SharedOpenCodeState,
    app: &AppHandle,
    payload: &tauri_plugin_shell::process::TerminatedPayload,
) {
    let mut s = state.lock().await;
    s.child = None;

    if s.shutting_down {
        log::info!("OpenCode process stopped during intentional shutdown");
        return;
    }

    if payload.code == Some(0) {
        log::info!("OpenCode process exited cleanly");
        app.exit(0);
    } else {
        log::error!(
            "OpenCode process exited with code {:?} (signal {:?})",
            payload.code,
            payload.signal
        );
        app.exit(1);
    }
}

/// Gracefully stop the OpenCode sidecar process.
pub async fn stop_all(state: &SharedOpenCodeState, _app: &AppHandle) {
    let mut s = state.lock().await;
    s.shutting_down = true;
    if let Some(child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = 0;
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_is_port_zero() {
        let state = OpenCodeState::default();
        assert_eq!(state.port, 0);
        assert!(state.child.is_none());
    }

    #[test]
    fn port_range_within_iana_dynamic_range() {
        assert!(OC_PORT_START >= 49152);
        assert!((OC_PORT_START + PORT_RANGE) as u32 <= 65535);
    }

    #[test]
    fn loopback_is_ipv4() {
        assert_eq!(LOOPBACK, "127.0.0.1");
    }

    #[test]
    fn parse_sidecar_level_error() {
        assert_eq!(
            parse_sidecar_level("ERROR 2026-03-22T12:00:00 something broke"),
            log::Level::Error
        );
    }

    #[test]
    fn parse_sidecar_level_warn() {
        assert_eq!(
            parse_sidecar_level("WARN  2026-03-22T12:00:00 deprecated usage"),
            log::Level::Warn
        );
    }

    #[test]
    fn parse_sidecar_level_info() {
        assert_eq!(
            parse_sidecar_level("INFO  2026-03-22T12:00:00 server started"),
            log::Level::Info
        );
    }

    #[test]
    fn parse_sidecar_level_debug() {
        assert_eq!(
            parse_sidecar_level("DEBUG 2026-03-22T12:00:00 tick"),
            log::Level::Debug
        );
    }

    #[test]
    fn parse_sidecar_level_unknown_defaults_to_warn() {
        assert_eq!(
            parse_sidecar_level("some random stack trace line"),
            log::Level::Warn
        );
    }

    #[test]
    fn parse_sidecar_level_leading_whitespace() {
        assert_eq!(
            parse_sidecar_level("  ERROR trailing text"),
            log::Level::Error
        );
    }

    #[test]
    fn noisy_patterns_detected() {
        assert!(is_noisy_sidecar_line("path=/mcp request id=123"));
        assert!(is_noisy_sidecar_line("path=/global/health request"));
        assert!(is_noisy_sidecar_line("service=server method=GET"));
        assert!(is_noisy_sidecar_line("service=server status=200"));
        assert!(is_noisy_sidecar_line("service=bus type=event"));
        assert!(is_noisy_sidecar_line("service=tool.registry loading"));
        assert!(is_noisy_sidecar_line("service=permission check=true"));
    }

    #[test]
    fn non_noisy_lines_pass_through() {
        assert!(!is_noisy_sidecar_line("ERROR something important"));
        assert!(!is_noisy_sidecar_line("server listening on port 59200"));
        assert!(!is_noisy_sidecar_line(""));
    }

    #[test]
    fn studio_mcp_command_returns_non_empty_vec() {
        let cmd = studio_mcp_command();
        assert!(!cmd.is_empty());
        #[cfg(target_os = "macos")]
        assert!(cmd[0].contains("StudioMCP"));
        #[cfg(target_os = "windows")]
        assert_eq!(cmd[0], "cmd.exe");
    }

    #[tokio::test]
    async fn find_available_port_returns_port_in_range() {
        let port = find_available_port(OC_PORT_START).await;
        assert!(port >= OC_PORT_START);
        assert!(port < OC_PORT_START + PORT_RANGE);
    }
}
