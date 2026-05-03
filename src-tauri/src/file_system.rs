use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use dirs;
use tauri_plugin_store::StoreExt;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
    pub file_type: String, // "ModuleScript", "ServerScript", "LocalScript", "Folder", "Other"
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct FileSystemState {
    pub open_folders: HashMap<String, PathBuf>,
}

impl Default for FileSystemState {
    fn default() -> Self {
        Self {
            open_folders: HashMap::new(),
        }
    }
}

// Determine Roblox script type from file extension
// Convention: .legacy = ServerScript, .local = LocalScript, otherwise = ModuleScript
fn get_file_type(file_name: &str) -> String {
    if file_name.ends_with(".luau") || file_name.ends_with(".lua") {
        let name_lower = file_name.to_lowercase();
        
        // Check file suffix first (most reliable indicator)
        if name_lower.ends_with(".legacy.luau") 
            || name_lower.ends_with(".legacy.lua")
            || name_lower.ends_with(".server.luau")
            || name_lower.ends_with(".server.lua") {
            return "ServerScript".to_string();
        }
        
        if name_lower.ends_with(".local.luau") 
            || name_lower.ends_with(".local.lua")
            || name_lower.ends_with(".client.luau")
            || name_lower.ends_with(".client.lua") {
            return "LocalScript".to_string();
        }
        
        // Fallback: check filename patterns
        if name_lower.contains("module") || name_lower.contains("util") || name_lower.starts_with("init.") {
            return "ModuleScript".to_string();
        }
        
        // Default for .lua/.luau files is ModuleScript
        return "ModuleScript".to_string();
    } else if file_name.ends_with(".json") {
        "JSON".to_string()
    } else if file_name.ends_with(".toml") || file_name.ends_with(".yaml") || file_name.ends_with(".yml") {
        "Config".to_string()
    } else {
        "Other".to_string()
    }
}

#[tauri::command]
pub async fn file_system_open_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<FileSystemState>>>,
    folder_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&folder_path);
    
    if !path.exists() || !path.is_dir() {
        return Err(format!("Path does not exist or is not a directory: {}", folder_path));
    }
    
    let mut state = state.lock().await;
    let folder_id = path.display().to_string();
    state.open_folders.insert(folder_id.clone(), path.clone());
    
    // Save to store
    if let Ok(store) = app.store("bloxbot-store.json") {
        let folders: Vec<String> = state
            .open_folders
            .values()
            .map(|p| p.display().to_string())
            .collect();
        // Convert to serde_json::Value and set
        match serde_json::to_value(folders) {
            Ok(json_value) => {
                store.set("open_folders", json_value);
            }
            Err(e) => {
                return Err(format!("Failed to serialize folders: {}", e));
            }
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn file_system_read_dir(
    folder_path: String,
    relative_path: Option<String>,
) -> Result<Vec<FileNode>, String> {
    let base_path = PathBuf::from(&folder_path);
    let target_path = if let Some(rel) = relative_path {
        base_path.join(rel)
    } else {
        base_path.clone()
    };
    
    if !target_path.exists() {
        return Err(format!("Path does not exist: {}", target_path.display()));
    }
    
    let mut entries = Vec::new();
    
    let dir_entries = fs::read_dir(&target_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;
    
    for entry in dir_entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = path
            .file_name()
            .ok_or_else(|| "Invalid file name".to_string())?
            .to_string_lossy()
            .to_string();
        
        // Skip hidden files and common non-script files
        if name.starts_with('.') {
            continue;
        }
        
        let is_dir = path.is_dir();
        let file_type = if is_dir {
            "Folder".to_string()
        } else {
            get_file_type(&name)
        };
        
        // Only include relevant files (scripts, configs, etc.)
        if !is_dir && file_type == "Other" {
            continue;
        }
        
        let node = FileNode {
            name: name.clone(),
            path: path.display().to_string(),
            is_dir,
            children: if is_dir {
                Some(Vec::new()) // Lazy load children
            } else {
                None
            },
            file_type,
        };
        
        entries.push(node);
    }
    
    // Sort: directories first, then files alphabetically
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    
    Ok(entries)
}

#[tauri::command]
pub async fn file_system_read_file(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() || !path.is_file() {
        return Err(format!("File does not exist: {}", file_path));
    }
    
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn file_system_write_file(file_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    
    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub async fn file_system_get_open_folders(
    state: tauri::State<'_, Arc<Mutex<FileSystemState>>>,
) -> Result<Vec<String>, String> {
    let state = state.lock().await;
    let folders: Vec<String> = state
        .open_folders
        .values()
        .map(|p| p.display().to_string())
        .collect();
    Ok(folders)
}

pub fn load_open_folders(state: &Arc<Mutex<FileSystemState>>, folders: Vec<String>) {
    let mut state = tokio::runtime::Handle::current().block_on(state.lock());
    for folder in folders {
        let path = PathBuf::from(&folder);
        if path.exists() && path.is_dir() {
            state.open_folders.insert(folder.clone(), path);
        }
    }
}

#[tauri::command]
pub async fn file_system_open_folder_dialog(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::FilePath;
    
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    app.dialog()
        .file()
        .set_title("Select Project Folder")
        .pick_folder(move |folder_path: Option<FilePath>| {
            let _ = tx.send(folder_path);
        });
    
    match rx.await {
        Ok(Some(path)) => {
            // FilePath can be converted to PathBuf
            let path_buf = PathBuf::from(path.to_string());
            let path_str = path_buf.display().to_string();
            Ok(Some(path_str))
        }
        Ok(None) => Ok(None),
        Err(_) => Err("Dialog cancelled or failed".to_string()),
    }
}

/// Find a file by name across all open folders, optionally filtered by a specific folder
#[tauri::command]
pub async fn file_system_find_and_read(
    state: tauri::State<'_, Arc<Mutex<FileSystemState>>>,
    file_name: String,
    folder_path: Option<String>,
) -> Result<Option<(String, String)>, String> {
    let state = state.lock().await;
    
    // Strip @[] wrapper if present
    let search_name = file_name.trim_start_matches('@').trim_start_matches('[').trim_end_matches(']').trim();
    
    // Determine which folders to search
    let folders_to_search: Vec<PathBuf> = if let Some(folder) = folder_path {
        vec![PathBuf::from(folder)]
    } else {
        state.open_folders.values().cloned().collect()
    };
    
    for folder in folders_to_search {
        if !folder.exists() {
            continue;
        }
        
        // Recursively search the folder
        if let Some(result) = search_file_in_dir(&folder, search_name) {
            // Read the file
            match fs::read_to_string(&result) {
                Ok(content) => {
                    return Ok(Some((result.to_string_lossy().to_string(), content)));
                }
                Err(e) => {
                    return Err(format!("Failed to read file: {}", e));
                }
            }
        }
    }
    
    Ok(None)
}

fn search_file_in_dir(dir: &Path, file_name: &str) -> Option<PathBuf> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return None,
    };
    
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        
        let path = entry.path();
        
        if path.is_dir() {
            if let Some(found) = search_file_in_dir(&path, file_name) {
                return Some(found);
            }
        } else if path.file_name().map(|n| n.to_string_lossy()) == Some(file_name.into()) {
            return Some(path);
        }
    }
    
    None
}

// ── Skill Support ─────────────────────────────────────────────

/// Search for skills in common locations
fn find_skill_locations() -> Vec<PathBuf> {
    let mut locations = Vec::new();
    
    // Current directory .agents/skills/
    if let Ok(current) = std::env::current_dir() {
        let agents_skills = current.join(".agents").join("skills");
        if agents_skills.exists() {
            locations.push(agents_skills);
        }
    }
    
    // Home directory .agents/skills/
    if let Some(home) = dirs::home_dir() {
        let agents_skills = home.join(".agents").join("skills");
        if agents_skills.exists() {
            locations.push(agents_skills);
        }
    }
    
    // OpenCode skills directory
    if let Some(config_dir) = dirs::config_dir() {
        let opencode_skills = config_dir.join("opencode").join("skills");
        if opencode_skills.exists() {
            locations.push(opencode_skills);
        }
    }
    
    // App resources skills folder
    if let Ok(current) = std::env::current_dir() {
        let app_skills = current.join("src-tauri").join("resources").join("skills");
        if app_skills.exists() {
            locations.push(app_skills);
        }
    }
    
    locations
}

/// Find a skill by name (searches for skill_name/SKILL.md or skill_name.md)
fn find_skill(skill_name: &str) -> Option<(PathBuf, String)> {
    let locations = find_skill_locations();
    
    for location in &locations {
        // Try skill_name/SKILL.md
        let skill_dir = location.join(skill_name);
        let skill_md = skill_dir.join("SKILL.md");
        if skill_md.exists() {
            if let Ok(content) = fs::read_to_string(&skill_md) {
                return Some((skill_md, content));
            }
        }
        
        // Try skill_name.md
        let skill_file = location.join(format!("{}.md", skill_name));
        if skill_file.exists() {
            if let Ok(content) = fs::read_to_string(&skill_file) {
                return Some((skill_file, content));
            }
        }
    }
    
    None
}

#[tauri::command]
pub async fn file_system_find_skill(
    skill_name: String,
) -> Result<Option<(String, String)>, String> {
    // Strip @skill: wrapper if present
    let search_name = skill_name
        .trim_start_matches('@')
        .trim_start_matches("skill:")
        .trim();
    
    match find_skill(search_name) {
        Some((path, content)) => {
            Ok(Some((path.display().to_string(), content)))
        }
        None => Ok(None),
    }
}
