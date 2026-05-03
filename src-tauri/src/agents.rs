//! Custom agent type management.
//!
//! BloxBot supports custom agent types defined as YAML files in
//! `~/BloxBot/agents/`. Each file defines one agent with its system prompt,
//! tool permissions, model overrides, and metadata. Built-in agents (plan,
//! studio, build) are always present and cannot be overridden by custom ones.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

/// Reserved agent IDs that cannot be overridden by custom agents.
/// These are always available as built-in agents.
pub const BUILTIN_AGENT_IDS: &[&str] = &["plan", "studio", "build"];

/// A custom agent definition loaded from a YAML file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentDefinition {
    /// Unique identifier slug (e.g., "code-reviewer"). Must not collide with built-in IDs.
    pub id: String,

    /// Human-readable display name (e.g., "Code Reviewer").
    pub name: String,

    /// Short description of what this agent does.
    pub description: String,

    /// Semantic version string (e.g., "1.0.0").
    #[serde(default = "default_version")]
    pub version: String,

    /// Author name or handle.
    #[serde(default)]
    pub author: String,

    /// The core system prompt that instructs the agent's behavior.
    pub system_prompt: String,

    /// Tool permission configuration.
    #[serde(default)]
    pub tools: ToolPermissions,

    /// Optional model overrides for this agent.
    #[serde(default)]
    pub model: ModelOverrides,

    /// Optional display metadata.
    #[serde(default)]
    pub metadata: AgentMetadata,
}

/// Tool permission configuration for an agent.
///
/// Security model: default-deny. If `allow` is set, only the listed tools
/// are available. If `allow` is empty/missing, no tools are available
/// (the agent must explicitly request access). The `deny` list is for
/// convenience — it blocks specific tools even if they appear in `allow`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct ToolPermissions {
    /// Whitelist of tool names this agent may use. Empty means no tools.
    /// When set, only these tools are available. When None/missing, defaults to empty.
    #[serde(default)]
    pub allow: Vec<String>,

    /// Blacklist of tool names this agent may NOT use, even if in `allow`.
    #[serde(default)]
    pub deny: Vec<String>,
}

/// Optional model configuration overrides for an agent.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct ModelOverrides {
    /// Override the default model (e.g., "opencode-go/kimi-k2.6").
    #[serde(default)]
    pub model_name: Option<String>,

    /// Override the sampling temperature.
    #[serde(default)]
    pub temperature: Option<f32>,

    /// Override the maximum number of output tokens.
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

/// Optional display metadata for an agent.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct AgentMetadata {
    /// Emoji or icon identifier for the agent.
    #[serde(default)]
    pub icon: Option<String>,

    /// Hex color code for the agent's theme.
    #[serde(default)]
    pub color: Option<String>,

    /// Tags for categorization and filtering.
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

// ── Seed agents ──────────────────────────────────────────────────────────
//
// Default agent definitions that are auto-seeded into ~/BloxBot/agents/
// on first launch. These are always recreated if missing, giving users a
// starting set of custom agents beyond the built-in plan/studio/build.

/// Built-in seed agent definitions.
fn seed_agents() -> Vec<AgentDefinition> {
    vec![
        AgentDefinition {
            id: "commander".to_string(),
            name: "Commander".to_string(),
            description: "Orchestrates complex multi-step workflows by planning, delegating to specialized agents, and coordinating results.".to_string(),
            version: "1.0.0".to_string(),
            author: "BloxBot".to_string(),
            system_prompt: "You are the Commander agent — a strategic orchestrator for complex development workflows.\n\nYour role:\n- Break large tasks into clear, ordered subtasks\n- Delegate subtasks to the most appropriate agent (plan, studio, build, etc.)\n- Coordinate results between subtasks\n- Catch errors early and adjust the plan\n- Summarize what was done and what remains\n\nAlways state your plan before executing. Use explicit step numbers. When a subtask fails, analyze the error and either retry with adjustments or report the blocker clearly.\n\nYou have access to all tools. Use them wisely — prefer delegating to specialized agents when available, but execute directly when no delegation is possible.".to_string(),
            tools: ToolPermissions {
                allow: vec![],
                deny: vec![],
            },
            model: ModelOverrides::default(),
            metadata: AgentMetadata {
                icon: Some("🎖️".to_string()),
                color: Some("#4A90D9".to_string()),
                tags: vec!["orchestration".to_string(), "workflow".to_string(), "multi-step".to_string()],
            },
        },
        AgentDefinition {
            id: "brainstormer".to_string(),
            name: "Brainstormer".to_string(),
            description: "Explores design alternatives, generates creative ideas, and helps evaluate trade-offs before committing to an approach.".to_string(),
            version: "1.0.0".to_string(),
            author: "BloxBot".to_string(),
            system_prompt: "You are the Brainstormer agent — a creative design explorer.\n\nYour role:\n- Generate 2-3 alternative approaches for any design question\n- Analyze trade-offs (effort, risk, dependencies) for each option\n- Lead with YOUR recommended approach and explain WHY\n- State assumptions explicitly and proceed\n- Keep ideas practical — no gold-plating\n\nFormat:\n## Approach A: [Name]\n- **Why:** ...\n- **Trade-offs:** ...\n- **Effort:** ...\n\nAfter presenting options, make a clear recommendation. Don't ask \"what do you think?\" — state \"I'm leaning toward X because Y.\"\n\nYou have read-only access to tools. Use them to gather context, but do not make changes.".to_string(),
            tools: ToolPermissions {
                allow: vec![],
                deny: vec![],
            },
            model: ModelOverrides {
                model_name: None,
                temperature: Some(0.8),
                max_tokens: None,
            },
            metadata: AgentMetadata {
                icon: Some("💡".to_string()),
                color: Some("#F5A623".to_string()),
                tags: vec!["design".to_string(), "exploration".to_string(), "creativity".to_string()],
            },
        },
    ]
}

/// Seeds default agent YAML files into the agents directory if they don't
/// already exist. Called once during app startup.
pub fn seed_default_agents() -> Result<(), String> {
    let dir = agents_dir()?;
    for agent in seed_agents() {
        let path = dir.join(format!("{}.yaml", agent.id));
        if path.exists() {
            continue; // Don't overwrite user modifications
        }
        let yaml = serde_yaml::to_string(&agent)
            .map_err(|e| format!("Failed to serialize seed agent '{}': {e}", agent.id))?;
        std::fs::write(&path, &yaml)
            .map_err(|e| format!("Failed to write seed agent '{}': {e}", agent.id))?;
        log::info!("Seeded default agent '{}' to {}", agent.id, path.display());
    }
    Ok(())
}

/// Returns the path to the custom agents directory (`~/BloxBot/agents/`),
/// creating it if it does not exist.
pub fn agents_dir() -> Result<PathBuf, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let dir = home.join("BloxBot").join("agents");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create agents directory: {e}"))?;
    }
    Ok(dir)
}

/// Validates an agent definition. Returns a list of warnings (non-fatal) and
/// errors (fatal). An agent with errors should not be loaded.
pub fn validate_agent(agent: &AgentDefinition) -> (Vec<String>, Vec<String>) {
    let mut warnings = Vec::new();
    let mut errors = Vec::new();

    // Check ID format
    if agent.id.is_empty() {
        errors.push("Agent ID cannot be empty".to_string());
    } else if !agent.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        errors.push(format!(
            "Agent ID '{}' must be lowercase alphanumeric with hyphens only",
            agent.id
        ));
    }

    // Check for reserved ID collision
    if BUILTIN_AGENT_IDS.contains(&agent.id.as_str()) {
        errors.push(format!(
            "Agent ID '{}' is reserved for built-in agents and cannot be used",
            agent.id
        ));
    }

    // Check required fields
    if agent.name.is_empty() {
        errors.push("Agent name cannot be empty".to_string());
    }
    if agent.description.is_empty() {
        warnings.push("Agent description is empty".to_string());
    }
    if agent.system_prompt.is_empty() {
        errors.push("Agent system_prompt cannot be empty".to_string());
    }

    // Check tool permissions consistency
    let allow_set: HashSet<_> = agent.tools.allow.iter().collect();
    let _deny_set: HashSet<_> = agent.tools.deny.iter().collect();
    for denied in &agent.tools.deny {
        if allow_set.contains(denied) {
            warnings.push(format!(
                "Tool '{}' appears in both allow and deny lists; deny takes precedence",
                denied
            ));
        }
    }

    // Check for duplicate tool names within allow/deny
    let mut seen_allow = HashSet::new();
    for tool in &agent.tools.allow {
        if !seen_allow.insert(tool) {
            warnings.push(format!("Duplicate tool '{}' in allow list", tool));
        }
    }
    let mut seen_deny = HashSet::new();
    for tool in &agent.tools.deny {
        if !seen_deny.insert(tool) {
            warnings.push(format!("Duplicate tool '{}' in deny list", tool));
        }
    }

    (warnings, errors)
}

/// Scans the agents directory for `.yaml` and `.yml` files and loads all
/// valid custom agent definitions. Invalid files are logged and skipped.
/// Agents with IDs that collide with built-in agents are also skipped.
pub fn load_custom_agents() -> Result<Vec<AgentDefinition>, String> {
    let dir = agents_dir()?;
    let mut agents = Vec::new();
    let mut seen_ids = HashSet::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read agents directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        if ext != "yaml" && ext != "yml" {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to read agent file {}: {e}", path.display());
                continue;
            }
        };

        let agent: AgentDefinition = match serde_yaml::from_str(&content) {
            Ok(a) => a,
            Err(e) => {
                log::warn!(
                    "Failed to parse agent file {}: {e}",
                    path.display()
                );
                continue;
            }
        };

        let (warnings, errors) = validate_agent(&agent);
        for w in &warnings {
            log::warn!("Agent '{}': {}", agent.id, w);
        }
        for e in &errors {
            log::error!("Agent '{}': {}", agent.id, e);
        }
        if !errors.is_empty() {
            log::error!(
                "Skipping agent '{}' from {} due to validation errors",
                agent.id,
                path.display()
            );
            continue;
        }

        if seen_ids.contains(&agent.id) {
            log::warn!(
                "Duplicate agent ID '{}' in {} — skipping",
                agent.id,
                path.display()
            );
            continue;
        }

        seen_ids.insert(agent.id.clone());
        log::info!("Loaded custom agent '{}' from {}", agent.id, path.display());
        agents.push(agent);
    }

    log::info!("Loaded {} custom agent(s)", agents.len());
    Ok(agents)
}

/// Converts a custom AgentDefinition into the JSON format expected by
/// OpenCode's `agent` config section.
pub fn agent_to_opencode_json(agent: &AgentDefinition) -> serde_json::Value {
    let mut obj = serde_json::Map::new();

    obj.insert(
        "description".to_string(),
        serde_json::Value::String(agent.description.clone()),
    );

    obj.insert(
        "prompt".to_string(),
        serde_json::Value::String(agent.system_prompt.clone()),
    );

    // Model name goes as a top-level "model" string property (OpenCode expects a string, not an object)
    if let Some(ref name) = agent.model.model_name {
        obj.insert("model".to_string(), serde_json::Value::String(name.clone()));
    }

    // Temperature and max_tokens are top-level agent config properties in OpenCode
    if let Some(temp) = agent.model.temperature {
        obj.insert("temperature".to_string(), serde_json::json!(temp));
    }
    if let Some(tokens) = agent.model.max_tokens {
        obj.insert("max_tokens".to_string(), serde_json::json!(tokens));
    }

    // Tool permissions: OpenCode expects booleans, not arrays.
    // Non-empty allow/deny lists map to true; empty/missing lists are omitted.
    if !agent.tools.allow.is_empty() || !agent.tools.deny.is_empty() {
        let mut tools = serde_json::Map::new();
        tools.insert(
            "allow".to_string(),
            serde_json::Value::Bool(!agent.tools.allow.is_empty()),
        );
        tools.insert(
            "deny".to_string(),
            serde_json::Value::Bool(!agent.tools.deny.is_empty()),
        );
        obj.insert("tools".to_string(), serde_json::Value::Object(tools));
    }

    // Store metadata for the frontend
    let mut meta = serde_json::Map::new();
    if let Some(ref icon) = agent.metadata.icon {
        meta.insert("icon".to_string(), serde_json::Value::String(icon.clone()));
    }
    if let Some(ref color) = agent.metadata.color {
        meta.insert("color".to_string(), serde_json::Value::String(color.clone()));
    }
    if !agent.metadata.tags.is_empty() {
        meta.insert(
            "tags".to_string(),
            serde_json::Value::Array(
                agent
                    .metadata
                    .tags
                    .iter()
                    .map(|t| serde_json::Value::String(t.clone()))
                    .collect(),
            ),
        );
    }
    meta.insert("version".to_string(), serde_json::Value::String(agent.version.clone()));
    meta.insert("author".to_string(), serde_json::Value::String(agent.author.clone()));
    meta.insert("custom".to_string(), serde_json::Value::Bool(true));
    obj.insert("_metadata".to_string(), serde_json::Value::Object(meta));

    serde_json::Value::Object(obj)
}

// ── Tauri Commands ─────────────────────────────────────────────────────

/// Returns all custom agent definitions loaded from the agents directory.
#[tauri::command]
pub async fn list_custom_agents() -> Result<Vec<AgentDefinition>, String> {
    load_custom_agents()
}

/// Saves a new custom agent definition to the agents directory.
/// Validates the agent first and returns an error message if invalid.
#[tauri::command]
pub async fn save_custom_agent(agent: AgentDefinition) -> Result<String, String> {
    let (warnings, errors) = validate_agent(&agent);
    if !errors.is_empty() {
        return Err(format!(
            "Invalid agent: {}",
            errors.join("; ")
        ));
    }
    for w in &warnings {
        log::warn!("Agent '{}': {}", agent.id, w);
    }

    let dir = agents_dir()?;
    let file_path = dir.join(format!("{}.yaml", agent.id));
    let yaml_content = serde_yaml::to_string(&agent)
        .map_err(|e| format!("Failed to serialize agent: {e}"))?;
    std::fs::write(&file_path, &yaml_content)
        .map_err(|e| format!("Failed to write agent file: {e}"))?;

    log::info!("Saved custom agent '{}' to {}", agent.id, file_path.display());
    Ok(file_path.to_string_lossy().to_string())
}

/// Deletes a custom agent definition by ID.
/// Cannot delete built-in agents.
#[tauri::command]
pub async fn delete_custom_agent(id: String) -> Result<(), String> {
    if BUILTIN_AGENT_IDS.contains(&id.as_str()) {
        return Err(format!(
            "Cannot delete built-in agent '{}'",
            id
        ));
    }

    let dir = agents_dir()?;
    let yaml_path = dir.join(format!("{}.yaml", id));
    let yml_path = dir.join(format!("{}.yml", id));

    let deleted = if yaml_path.exists() {
        std::fs::remove_file(&yaml_path)
            .map_err(|e| format!("Failed to delete agent file: {e}"))?;
        true
    } else if yml_path.exists() {
        std::fs::remove_file(&yml_path)
            .map_err(|e| format!("Failed to delete agent file: {e}"))?;
        true
    } else {
        false
    };

    if deleted {
        log::info!("Deleted custom agent '{}'", id);
    } else {
        log::warn!("Agent '{}' not found in agents directory", id);
    }

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_agent_rejects_empty_id() {
        let agent = AgentDefinition {
            id: "".to_string(),
            name: "Test".to_string(),
            description: "Test agent".to_string(),
            version: "1.0.0".to_string(),
            author: "test".to_string(),
            system_prompt: "You are a test agent.".to_string(),
            tools: ToolPermissions::default(),
            model: ModelOverrides::default(),
            metadata: AgentMetadata::default(),
        };
        let (_, errors) = validate_agent(&agent);
        assert!(errors.iter().any(|e| e.contains("ID cannot be empty")));
    }

    #[test]
    fn validate_agent_rejects_reserved_ids() {
        for &id in BUILTIN_AGENT_IDS {
            let agent = AgentDefinition {
                id: id.to_string(),
                name: "Override".to_string(),
                description: "Trying to override".to_string(),
                version: "1.0.0".to_string(),
                author: "test".to_string(),
                system_prompt: "You are a test.".to_string(),
                tools: ToolPermissions::default(),
                model: ModelOverrides::default(),
                metadata: AgentMetadata::default(),
            };
            let (_, errors) = validate_agent(&agent);
            assert!(errors.iter().any(|e| e.contains("reserved")));
        }
    }

    #[test]
    fn validate_agent_rejects_uppercase_id() {
        let agent = AgentDefinition {
            id: "MyAgent".to_string(),
            name: "Test".to_string(),
            description: "Test".to_string(),
            version: "1.0.0".to_string(),
            author: "test".to_string(),
            system_prompt: "You are a test.".to_string(),
            tools: ToolPermissions::default(),
            model: ModelOverrides::default(),
            metadata: AgentMetadata::default(),
        };
        let (_, errors) = validate_agent(&agent);
        assert!(errors.iter().any(|e| e.contains("lowercase")));
    }

    #[test]
    fn validate_agent_accepts_valid_agent() {
        let agent = AgentDefinition {
            id: "code-reviewer".to_string(),
            name: "Code Reviewer".to_string(),
            description: "Reviews code for bugs".to_string(),
            version: "1.0.0".to_string(),
            author: "community".to_string(),
            system_prompt: "You are a code reviewer.".to_string(),
            tools: ToolPermissions {
                allow: vec!["script_read".to_string(), "script_grep".to_string()],
                deny: vec![],
            },
            model: ModelOverrides::default(),
            metadata: AgentMetadata::default(),
        };
        let (_, errors) = validate_agent(&agent);
        assert!(errors.is_empty());
    }

    #[test]
    fn validate_agent_warns_on_deny_overlap() {
        let agent = AgentDefinition {
            id: "test-agent".to_string(),
            name: "Test".to_string(),
            description: "Test".to_string(),
            version: "1.0.0".to_string(),
            author: "test".to_string(),
            system_prompt: "You are a test.".to_string(),
            tools: ToolPermissions {
                allow: vec!["script_read".to_string()],
                deny: vec!["script_read".to_string()],
            },
            model: ModelOverrides::default(),
            metadata: AgentMetadata::default(),
        };
        let (warnings, _) = validate_agent(&agent);
        assert!(warnings.iter().any(|w| w.contains("both allow and deny")));
    }

    #[test]
    fn agent_to_opencode_json_produces_valid_structure() {
        let agent = AgentDefinition {
            id: "code-reviewer".to_string(),
            name: "Code Reviewer".to_string(),
            description: "Reviews code".to_string(),
            version: "1.2.0".to_string(),
            author: "bloxbot-community".to_string(),
            system_prompt: "You review code.".to_string(),
            tools: ToolPermissions {
                allow: vec!["script_read".to_string()],
                deny: vec![],
            },
            model: ModelOverrides {
                model_name: Some("opencode-go/kimi-k2.6".to_string()),
                temperature: Some(0.3),
                max_tokens: None,
            },
            metadata: AgentMetadata {
                icon: Some("🔍".to_string()),
                color: Some("#4A90D9".to_string()),
                tags: vec!["code-quality".to_string()],
            },
        };
        let json = agent_to_opencode_json(&agent);
        assert_eq!(json["description"], "Reviews code");
        assert_eq!(json["prompt"], "You review code.");
        assert_eq!(json["model"], "opencode-go/kimi-k2.6");
        // Use approximate comparison for floating-point temperature
        let temp = json["temperature"].as_f64().unwrap();
        assert!((temp - 0.3).abs() < 0.01, "temperature should be ~0.3, got {temp}");
        assert_eq!(json["tools"]["allow"], true);
        assert_eq!(json["_metadata"]["custom"], true);
        assert_eq!(json["_metadata"]["icon"], "🔍");
        assert_eq!(json["_metadata"]["version"], "1.2.0");
    }

    #[test]
    fn default_version_is_1_0_0() {
        assert_eq!(default_version(), "1.0.0");
    }
}