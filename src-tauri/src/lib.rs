mod agents;
mod file_system;
mod logging;
mod opencode;
mod paths;
mod verde_server;

use file_system::FileSystemState;
use opencode::SharedOpenCodeState;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    let opencode_state: SharedOpenCodeState =
        Arc::new(Mutex::new(opencode::OpenCodeState::default()));

    let verde_peers: verde_server::PeerMap = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let verde_state = Arc::new(verde_server::VerdeState {
        peers: verde_peers.clone(),
        active_peer: Arc::new(Mutex::new(None)),
        peer_labels: Arc::new(Mutex::new(std::collections::HashMap::new())),
        peer_counter: Arc::new(Mutex::new(0)),
    });

        let verde_state_for_server = Arc::clone(&verde_state);

        let file_system_state: Arc<Mutex<FileSystemState>> =
            Arc::new(Mutex::new(FileSystemState::default()));

        tauri::Builder::default()
            .plugin(tauri_plugin_opener::init())
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_store::Builder::default().build())
            .plugin(tauri_plugin_dialog::init())
            .manage(opencode_state)
            .manage(verde_state)
            .manage(file_system_state)
            .invoke_handler(tauri::generate_handler![
                opencode::get_opencode_info,
                opencode::get_opencode_logs,
                opencode::call_mcp_tool,
                opencode::list_context_files,
                opencode::write_context_settings,
                opencode::update_auto_context,
                opencode::clear_auto_context,
                opencode::generate_codebase_context,
                agents::list_custom_agents,
                agents::save_custom_agent,
                agents::delete_custom_agent,
                verde_server::verde_tx,
                verde_server::verde_get_peers,
                verde_server::verde_set_active_peer,
                paths::get_workspace_dir,
                paths::set_workspace_dir,
                file_system::file_system_open_folder,
                file_system::file_system_read_dir,
                file_system::file_system_read_file,
                file_system::file_system_write_file,
                file_system::file_system_get_open_folders,
                file_system::file_system_open_folder_dialog,
                file_system::file_system_find_and_read,
                file_system::file_system_find_skill
            ])
        .setup(|app| {
            // ── Application menu ──────────────────────────────────
            let app_submenu = SubmenuBuilder::new(app, "BloxBot")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .item(&PredefinedMenuItem::maximize(app, None)?)
                .separator()
                .close_window()
                .build()?;

            let debug_toggle = MenuItemBuilder::with_id("debug_opencode_ui", "OpenCode Web UI")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;

            let debug_submenu = SubmenuBuilder::new(app, "Debug")
                .item(&debug_toggle)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .item(&debug_submenu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                if event.id() == debug_toggle.id() {
                    let state = app_handle.state::<SharedOpenCodeState>().inner().clone();
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let port = {
                            let s = state.lock().await;
                            s.port
                        };
                        if port > 0 {
                            let url = format!("http://{}:{}", opencode::LOOPBACK, port);
                            let _ = handle.opener().open_url(&url, None::<&str>);
                        }
                    });
                }
            });

            // ── Updater plugin ────────────────────────────────────
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // ── Seed default agents on first launch ──────────────
            if let Err(e) = agents::seed_default_agents() {
                log::warn!("Failed to seed default agents: {e}");
            }

            // ── Load custom workspace directory from store ───────
            if let Ok(store) = app.store("bloxbot-store.json") {
                if let Some(config_value) = store.get("config") {
                    if let serde_json::Value::Object(config) = config_value {
                        if let Some(serde_json::Value::String(dir)) = config.get("workspaceDir") {
                            let path = std::path::PathBuf::from(dir);
                            if path.exists() && path.is_dir() {
                                paths::set_workspace_dir_override(Some(path));
                                log::info!("Loaded custom workspace directory from store: {dir}");
                            } else {
                                log::warn!("Stored workspaceDir does not exist, using default: {dir}");
                            }
                        }
                    }
                }

                // Load open folders for file system explorer
                if let Some(serde_json::Value::Array(folders)) = store.get("open_folders") {
                    let folder_paths: Vec<String> = folders
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect();
                    if !folder_paths.is_empty() {
                        let file_system_state = app.state::<Arc<Mutex<FileSystemState>>>().inner().clone();
                        file_system::load_open_folders(&file_system_state, folder_paths.clone());
                        log::info!("Loaded {} open folders from store", folder_paths.len());
                    }
                }
            }

            // ── Start OpenCode, then show window ─────────────────
            // The window stays hidden until OpenCode is alive.
            // If it can't start after retries, exit — there's nothing to show.
            let state = app.state::<SharedOpenCodeState>().inner().clone();
            let handle = app.handle().clone();
            log::info!("BloxBot starting up");
            tauri::async_runtime::spawn(async move {
                match opencode::start_opencode_server(state, handle.clone()).await {
                    Ok(port) => {
                        log::info!("OpenCode ready on port {port}, showing window");
                        if let Some(win) = handle.get_webview_window("main") {
                            let _ = win.show();
                        }
                    }
                    Err(e) => {
                        log::error!("OpenCode failed to start: {e} — exiting");
                        handle.exit(1);
                    }
                }
            });

            // ── Start Verde WebSocket server ──────────────────────
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                verde_server::start_verde_server(handle, verde_state_for_server).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window
                    .app_handle()
                    .state::<SharedOpenCodeState>()
                    .inner()
                    .clone();
                let handle = window.app_handle().clone();
                tauri::async_runtime::block_on(async {
                    opencode::stop_all(&state, &handle).await;
                });
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building BloxBot")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle
                    .state::<SharedOpenCodeState>()
                    .inner()
                    .clone();
                let handle = app_handle.clone();
                tauri::async_runtime::block_on(async {
                    opencode::stop_all(&state, &handle).await;
                });
                app_handle.exit(0);
            }
        });
}
