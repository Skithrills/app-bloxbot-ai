use futures_util::{SinkExt, StreamExt};
use sha1::{Digest, Sha1};
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use base64::Engine;

pub type Tx = mpsc::UnboundedSender<Message>;
pub type PeerMap = Arc<Mutex<HashMap<std::net::SocketAddr, Tx>>>;

/// Information about a connected peer, serialised for the frontend.
#[derive(Clone, serde::Serialize)]
pub struct PeerInfo {
    pub addr: String,
    pub label: String,
    pub is_active: bool,
}

/// Payload emitted with `verde-peer-connected` / `verde-peer-disconnected`.
#[derive(Clone, serde::Serialize)]
pub struct PeerEventPayload {
    pub peer_count: usize,
    pub addr: String,
    pub label: String,
    pub is_active: bool,
}

pub struct VerdeState {
    pub peers: PeerMap,
    /// The peer that currently receives `verde_tx` messages.
    pub active_peer: Arc<Mutex<Option<std::net::SocketAddr>>>,
    /// Human-readable labels for each connected peer (e.g. "Studio 1").
    pub peer_labels: Arc<Mutex<HashMap<std::net::SocketAddr, String>>>,
    /// Monotonically increasing counter for labelling peers.
    pub peer_counter: Arc<Mutex<u32>>,
}

pub async fn start_verde_server(app_handle: AppHandle, state: Arc<VerdeState>) {
    let addr = "127.0.0.1:9000";
    let try_socket = TcpListener::bind(&addr).await;
    let listener = match try_socket {
        Ok(l) => l,
        Err(e) => {
            log::error!("[verde_server] failed to bind {}: {}", addr, e);
            return;
        }
    };
    log::info!("[verde_server] listening on {}", addr);

    while let Ok((stream, addr)) = listener.accept().await {
        tokio::spawn(handle_connection(
            app_handle.clone(),
            Arc::clone(&state),
            stream,
            addr,
        ));
    }
}

/// Perform a lenient WebSocket handshake that works with Roblox's HttpService client.
/// Reads the HTTP upgrade request, extracts the Sec-WebSocket-Key, and replies
/// with the correct Sec-WebSocket-Accept hash.
async fn perform_handshake(stream: TcpStream) -> Result<WebSocketStream<TcpStream>, String> {
    let mut stream = stream;
    let mut buf = [0u8; 4096];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("failed to read handshake: {}", e))?;

    if n == 0 {
        return Err("client closed connection during handshake".to_string());
    }

    let request = String::from_utf8_lossy(&buf[..n]);
    log::debug!("[verde_server] handshake request:\n{}", request);

    // Extract Sec-WebSocket-Key
    let key = request
        .lines()
        .find(|line| line.to_lowercase().starts_with("sec-websocket-key:"))
        .and_then(|line| line.split(':').nth(1))
        .map(|s| s.trim())
        .ok_or_else(|| "missing Sec-WebSocket-Key".to_string())?;

    // Generate Sec-WebSocket-Accept
    let magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = Sha1::new();
    hasher.update(key.as_bytes());
    hasher.update(magic.as_bytes());
    let hash = hasher.finalize();
    let accept = base64::engine::general_purpose::STANDARD.encode(hash);

    // Send response
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\
         \r\n",
        accept
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|e| format!("failed to send handshake response: {}", e))?;

    // At this point the connection is upgraded to WebSocket
    Ok(WebSocketStream::from_raw_socket(
        stream,
        tokio_tungstenite::tungstenite::protocol::Role::Server,
        None,
    )
    .await)
}

async fn handle_connection(
    app_handle: AppHandle,
    state: Arc<VerdeState>,
    raw_stream: TcpStream,
    addr: std::net::SocketAddr,
) {
    log::info!("[verde_server] incoming TCP connection from: {}", addr);

    // Perform a lenient WebSocket handshake that works with Roblox's client
    let ws_stream = match perform_handshake(raw_stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::error!("[verde_server] websocket handshake failed: {}", e);
            return;
        }
    };
    
    log::info!("[verde_server] WebSocket connection established: {}", addr);

    let (tx, mut rx) = mpsc::unbounded_channel();

    // Register peer
    state.peers.lock().await.insert(addr, tx.clone());

    // Assign a label
    let label = {
        let mut counter = state.peer_counter.lock().await;
        *counter += 1;
        let label = format!("Studio {}", *counter);
        state.peer_labels.lock().await.insert(addr, label.clone());
        label
    };

    // Auto-select as active peer
    {
        let mut active = state.active_peer.lock().await;
        *active = Some(addr);
    }

    // Emit connect event
    let peer_count = state.peers.lock().await.len();
    let _ = app_handle.emit(
        "verde-peer-connected",
        PeerEventPayload {
            peer_count,
            addr: addr.to_string(),
            label: label.clone(),
            is_active: true,
        },
    );

    log::info!(
        "[verde_server] peer registered: {} ({}) — {} peer(s) total",
        addr,
        label,
        peer_count
    );

    let (mut outgoing, mut incoming) = ws_stream.split();

    // Send ACK immediately to unlock the Luau client
    let ack_msg = Message::Text(r#"{"type":"ack"}"#.to_string().into());
    if let Err(e) = outgoing.send(ack_msg).await {
        log::error!("[verde_server] error sending ack: {}", e);
    }

    // Broadcast incoming messages to the Tauri UI
    let broadcast_incoming = tokio::spawn({
        let app_handle = app_handle.clone();
        async move {
            while let Some(msg) = incoming.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        let text_str = text.to_string();
                        let preview = if text_str.len() > 100 {
                            &text_str[..100]
                        } else {
                            &text_str
                        };
                        log::info!("[verde_server] Received Text: {}...", preview);
                        let _ = app_handle.emit("verde-rx", text_str);
                    }
                    Ok(Message::Binary(_)) => {
                        log::warn!("[verde_server] unexpected binary msg");
                    }
                    Ok(_) => {} // skip ping/pong/close
                    Err(e) => {
                        log::error!("[verde_server] Error reading message: {}", e);
                        break;
                    }
                }
            }
        }
    });

    let receive_from_others = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if outgoing.send(msg).await.is_err() {
                break;
            }
        }
    });

    let heartbeat = tokio::spawn({
        let tx = tx.clone();
        async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                let ack_msg = Message::Text(r#"{"type":"ack"}"#.into());
                if tx.send(ack_msg).is_err() {
                    break;
                }
            }
        }
    });

    tokio::select! {
        _ = broadcast_incoming => {}
        _ = receive_from_others => {}
        _ = heartbeat => {}
    }

    // ── Peer disconnected ───────────────────────────────────────────
    log::info!("[verde_server] {} disconnected", &addr);
    state.peers.lock().await.remove(&addr);
    let removed_label = state
        .peer_labels
        .lock()
        .await
        .remove(&addr)
        .unwrap_or_default();

    // If the disconnected peer was the active one, promote the next peer
    {
        let mut active = state.active_peer.lock().await;
        if *active == Some(addr) {
            let peers = state.peers.lock().await;
            if let Some((&next_addr, _)) = peers.iter().next() {
                *active = Some(next_addr);
                log::info!(
                    "[verde_server] active peer promoted to {}",
                    next_addr
                );
            } else {
                *active = None;
                log::info!("[verde_server] no peers remaining, active_peer = None");
            }
        }
    }

    let peer_count = state.peers.lock().await.len();
    let _ = app_handle.emit(
        "verde-peer-disconnected",
        PeerEventPayload {
            peer_count,
            addr: addr.to_string(),
            label: removed_label,
            is_active: false,
        },
    );
}

// ── Tauri commands ──────────────────────────────────────────────────────

/// Send a message to the **active** peer only.
#[tauri::command]
pub async fn verde_tx(
    payload: String,
    state: tauri::State<'_, Arc<VerdeState>>,
) -> Result<(), String> {
    let active_addr = {
        let active = state.active_peer.lock().await;
        match *active {
            Some(addr) => addr,
            None => {
                log::debug!(
                    "[verde_server] verde_tx called but no active peer – message dropped"
                );
                return Err("no_active_peer".to_string());
            }
        }
    };

    let peers = state.peers.lock().await;
    if let Some(tx) = peers.get(&active_addr) {
        if let Err(_disconnected) = tx.send(Message::Text(payload.into())) {
            log::warn!(
                "[verde_server] failed to send msg to active peer {}",
                active_addr
            );
            return Err("send_failed".to_string());
        }
        log::info!(
            "[verde_server] verde_tx sent to active peer {}",
            active_addr
        );
        Ok(())
    } else {
        log::warn!(
            "[verde_server] active peer {} not found in peer map",
            active_addr
        );
        Err("active_peer_not_found".to_string())
    }
}

/// Get the list of currently connected peers.
#[tauri::command]
pub async fn verde_get_peers(
    state: tauri::State<'_, Arc<VerdeState>>,
) -> Result<Vec<PeerInfo>, String> {
    let peers = state.peers.lock().await;
    let labels = state.peer_labels.lock().await;
    let active = state.active_peer.lock().await;

    let mut result = Vec::new();
    for (addr, _) in peers.iter() {
        let label = labels
            .get(addr)
            .cloned()
            .unwrap_or_else(|| addr.to_string());
        result.push(PeerInfo {
            addr: addr.to_string(),
            label,
            is_active: *active == Some(*addr),
        });
    }

    Ok(result)
}

/// Set the active peer by address string. Triggers a fresh snapshot request
/// by emitting `verde-active-peer-changed`.
#[tauri::command]
pub async fn verde_set_active_peer(
    addr: String,
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<VerdeState>>,
) -> Result<(), String> {
    let target_addr: std::net::SocketAddr = addr
        .parse()
        .map_err(|e| format!("invalid address: {}", e))?;

    let peers = state.peers.lock().await;
    if !peers.contains_key(&target_addr) {
        return Err("peer_not_found".to_string());
    }
    drop(peers);

    {
        let mut active = state.active_peer.lock().await;
        *active = Some(target_addr);
    }

    let label = state
        .peer_labels
        .lock()
        .await
        .get(&target_addr)
        .cloned()
        .unwrap_or_else(|| addr.clone());

    log::info!(
        "[verde_server] active peer switched to {} ({})",
        target_addr,
        label
    );

    let peer_count = state.peers.lock().await.len();
    let _ = app_handle.emit(
        "verde-active-peer-changed",
        PeerEventPayload {
            peer_count,
            addr,
            label,
            is_active: true,
        },
    );

    Ok(())
}
