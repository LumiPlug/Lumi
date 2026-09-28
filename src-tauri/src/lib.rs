// SPDX-License-Identifier: MPL-2.0

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

const CORE_PROTOCOL_VERSION: u16 = 1;
const LOOPBACK_HOST: &str = "127.0.0.1";
const SESSION_TOKEN_HEADER: &str = "x-lumiplug-session-token";
const CORE_SIDECAR_NAME: &str = "lumi-core";
const MAX_RESTARTS: u8 = 3;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiCoreStatus {
    state: String,
    protocol_version: u16,
    core_version: Option<String>,
    user_data_path_available: bool,
    restart_count: u8,
    last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionInfo {
    transport: &'static str,
    endpoint: String,
    auth_header: &'static str,
    session_token: String,
    gateway_available: bool,
    core_state: String,
    stdio_command: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarReadyHandshake {
    kind: String,
    protocol_version: u16,
    core_version: String,
    port: u16,
    #[allow(dead_code)]
    pid: u32,
    #[serde(default)]
    mcp_available: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySummary {
    pub id: String,
    pub name: String,
    pub namespace: String,
    pub description: String,
    pub version: u32,
    pub runner_type: String,
    pub status: String,
    pub enabled: bool,
    pub tool_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

struct SupervisorState {
    status: UiCoreStatus,
    port: u16,
    session_token: String,
    mcp_available: bool,
    user_data_dir: PathBuf,
    child: Option<CommandChild>,
    generation: u64,
    shutting_down: bool,
    stdout_buffer: String,
}

pub struct CoreSupervisor {
    app: AppHandle,
    state: Mutex<SupervisorState>,
}

impl CoreSupervisor {
    fn new(app: AppHandle, user_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&user_data_dir)
            .map_err(|_| "user_data_dir_unavailable".to_string())?;
        let port = allocate_loopback_port()?;
        Ok(Self {
            app,
            state: Mutex::new(SupervisorState {
                status: UiCoreStatus {
                    state: "disconnected".to_string(),
                    protocol_version: CORE_PROTOCOL_VERSION,
                    core_version: None,
                    user_data_path_available: user_data_dir.exists(),
                    restart_count: 0,
                    last_error: None,
                },
                port,
                session_token: Uuid::new_v4().simple().to_string(),
                mcp_available: false,
                user_data_dir,
                child: None,
                generation: 0,
                shutting_down: false,
                stdout_buffer: String::new(),
            }),
        })
    }

    fn status(&self) -> UiCoreStatus {
        self.state
            .lock()
            .expect("core supervisor mutex poisoned")
            .status
            .clone()
    }

    fn mcp_connection_info(&self) -> McpConnectionInfo {
        let state = self.state.lock().expect("core supervisor mutex poisoned");
        McpConnectionInfo {
            transport: "streamable-http",
            endpoint: format!("http://{}:{}/mcp", LOOPBACK_HOST, state.port),
            auth_header: SESSION_TOKEN_HEADER,
            session_token: state.session_token.clone(),
            gateway_available: state.mcp_available,
            core_state: state.status.state.clone(),
            stdio_command: self
                .app
                .shell()
                .sidecar("mcp-stdio-proxy")
                .ok()
                .and_then(|command| {
                    let command: std::process::Command = command.into();
                    let program = PathBuf::from(command.get_program());
                    program
                        .is_file()
                        .then(|| program.to_string_lossy().into_owned())
                }),
        }
    }

    fn start_sidecar(self: &Arc<Self>) -> Result<(), String> {
        let (port, token, user_data_dir, generation) = {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.shutting_down {
                return Err("core_supervisor_stopped".to_string());
            }
            state.generation += 1;
            state.status.state = "starting".to_string();
            state.status.last_error = None;
            (
                state.port,
                state.session_token.clone(),
                state.user_data_dir.clone(),
                state.generation,
            )
        };

        let args = vec![
            "--host".to_string(),
            LOOPBACK_HOST.to_string(),
            "--port".to_string(),
            port.to_string(),
            "--parent-pid".to_string(),
            std::process::id().to_string(),
            "--session-token".to_string(),
            token,
            "--user-data-dir".to_string(),
            user_data_dir.to_string_lossy().into_owned(),
        ];
        let sidecar = self
            .app
            .shell()
            .sidecar(CORE_SIDECAR_NAME)
            .map_err(|_| "sidecar_not_configured".to_string())?;
        let (mut receiver, child) = sidecar
            .args(args)
            .spawn()
            .map_err(|_| "sidecar_spawn_failed".to_string())?;

        let mut child_to_store = Some(child);
        let keep_child = {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.generation == generation && !state.shutting_down {
                state.child = child_to_store.take();
                true
            } else {
                false
            }
        };
        if !keep_child {
            if let Some(child) = child_to_store {
                let _ = child.kill();
            }
            return Ok(());
        }

        let supervisor = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            while let Some(event) = receiver.recv().await {
                supervisor.handle_event(generation, event);
            }
        });
        Ok(())
    }

    fn handle_event(self: &Arc<Self>, generation: u64, event: CommandEvent) {
        match event {
            CommandEvent::Stdout(bytes) => self.handle_stdout(generation, &bytes),
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                eprintln!("[lumiplug-core] {}", line.trim_end());
            }
            CommandEvent::Error(_) => {
                let mut state = self.state.lock().expect("core supervisor mutex poisoned");
                if state.generation == generation {
                    state.status.state = "error".to_string();
                    state.status.last_error = Some("sidecar_process_error".to_string());
                }
            }
            CommandEvent::Terminated(_) => self.handle_terminated(generation),
            _ => {}
        }
    }

    fn handle_stdout(&self, generation: u64, bytes: &[u8]) {
        let mut ready: Option<SidecarReadyHandshake> = None;
        {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.generation != generation {
                return;
            }
            state
                .stdout_buffer
                .push_str(&String::from_utf8_lossy(bytes));
            if state.stdout_buffer.len() > 16 * 1024 {
                let keep_from = state.stdout_buffer.len() - 16 * 1024;
                state.stdout_buffer = state.stdout_buffer.split_off(keep_from);
            }
            while let Some(newline) = state.stdout_buffer.find('\n') {
                let line = state.stdout_buffer[..newline].trim().to_string();
                state.stdout_buffer.drain(..=newline);
                if let Ok(handshake) = serde_json::from_str::<SidecarReadyHandshake>(&line) {
                    ready = Some(handshake);
                    break;
                }
            }
        }

        if let Some(handshake) = ready {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.generation != generation {
                return;
            }
            if handshake.kind != "sidecar.ready"
                || handshake.protocol_version != CORE_PROTOCOL_VERSION
                || handshake.port != state.port
            {
                state.status.state = "error".to_string();
                state.status.last_error = Some("sidecar_handshake_invalid".to_string());
                return;
            }
            state.status.state = "ready".to_string();
            state.status.core_version = Some(handshake.core_version);
            state.mcp_available = handshake.mcp_available;
            state.status.user_data_path_available = state.user_data_dir.exists();
            state.status.last_error = None;
        }
    }

    fn handle_terminated(self: &Arc<Self>, generation: u64) {
        let should_restart = {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.generation != generation {
                return;
            }
            state.child = None;
            if state.shutting_down {
                state.status.state = "stopped".to_string();
                false
            } else if state.status.state == "starting" || state.status.state == "ready" {
                if state.status.restart_count < MAX_RESTARTS {
                    state.status.restart_count += 1;
                    state.status.state = "restarting".to_string();
                    true
                } else {
                    state.status.state = "error".to_string();
                    state.status.last_error = Some("sidecar_restart_limit_reached".to_string());
                    false
                }
            } else {
                false
            }
        };

        if should_restart {
            let supervisor = Arc::clone(self);
            let attempt = self.status().restart_count;
            thread::spawn(move || {
                let backoff_ms = 100_u64.saturating_mul(2_u64.saturating_pow(attempt as u32));
                thread::sleep(Duration::from_millis(backoff_ms));
                let _ = supervisor.start_sidecar();
            });
        }
    }

    fn restart(self: &Arc<Self>) -> Result<UiCoreStatus, String> {
        let child = {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            state.generation += 1;
            state.shutting_down = false;
            state.status.state = "restarting".to_string();
            state.status.restart_count = 0;
            state.status.last_error = None;
            state.child.take()
        };
        if let Some(child) = child {
            let _ = child.kill();
        }
        self.start_sidecar()?;
        Ok(self.status())
    }

    fn shutdown(&self) {
        let child = {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            state.generation += 1;
            state.shutting_down = true;
            state.status.state = "stopped".to_string();
            state.child.take()
        };
        if let Some(child) = child {
            let _ = child.kill();
        }
    }

    fn call_core(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        if !matches!(path, "/app/status" | "/app/capabilities" | "/app/mcp/check")
            && !path.starts_with("/app/capabilities/")
        {
            return Err("core_path_not_allowed".to_string());
        }
        let (port, token) = {
            let state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.status.state != "ready" {
                return Err("core_not_ready".to_string());
            }
            (state.port, state.session_token.clone())
        };
        let body_text = body.map(|value| value.to_string()).unwrap_or_default();
        let request = format!(
            "{} {} HTTP/1.1\r\nHost: {}:{}\r\nOrigin: tauri://localhost\r\n{}: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            method,
            path,
            LOOPBACK_HOST,
            port,
            SESSION_TOKEN_HEADER,
            token,
            body_text.len(),
            body_text,
        );
        let mut stream = TcpStream::connect((LOOPBACK_HOST, port))
            .map_err(|_| "core_connection_failed".to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| "core_connection_failed".to_string())?;
        stream
            .write_all(request.as_bytes())
            .map_err(|_| "core_connection_failed".to_string())?;
        let mut bytes = Vec::new();
        stream
            .read_to_end(&mut bytes)
            .map_err(|_| "core_connection_failed".to_string())?;
        parse_http_json(&bytes)
    }
}

fn allocate_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind((LOOPBACK_HOST, 0))
        .map_err(|_| "loopback_port_unavailable".to_string())?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|_| "loopback_port_unavailable".to_string())
}

fn parse_http_json(bytes: &[u8]) -> Result<Value, String> {
    let separator = b"\r\n\r\n";
    let header_end = bytes
        .windows(separator.len())
        .position(|window| window == separator)
        .ok_or_else(|| "core_invalid_response".to_string())?;
    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "core_invalid_response".to_string())?;
    let value: Value = serde_json::from_slice(&bytes[header_end + separator.len()..])
        .map_err(|_| "core_invalid_response".to_string())?;
    if status >= 400 {
        return Err("core_request_failed".to_string());
    }
    Ok(value.get("data").cloned().unwrap_or(value))
}

#[tauri::command]
fn get_core_status(supervisor: State<'_, Arc<CoreSupervisor>>) -> UiCoreStatus {
    supervisor.status()
}

#[tauri::command]
fn get_mcp_connection_info(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
) -> Result<McpConnectionInfo, String> {
    if window.label() != "main" {
        return Err("mcp_configuration_not_allowed".to_string());
    }
    Ok(supervisor.mcp_connection_info())
}

#[tauri::command]
fn check_mcp_connection(supervisor: State<'_, Arc<CoreSupervisor>>) -> Result<Value, String> {
    supervisor.call_core("GET", "/app/mcp/check", None)
}

#[tauri::command]
fn list_capabilities(
    supervisor: State<'_, Arc<CoreSupervisor>>,
) -> Result<Vec<CapabilitySummary>, String> {
    let value = supervisor.call_core("GET", "/app/capabilities", None)?;
    let capabilities = value
        .get("capabilities")
        .cloned()
        .ok_or_else(|| "core_invalid_response".to_string())?;
    serde_json::from_value(capabilities).map_err(|_| "core_invalid_response".to_string())
}

#[tauri::command]
fn create_capability_draft(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    kind: String,
    name: String,
) -> Result<CapabilitySummary, String> {
    if !matches!(kind.as_str(), "terminal" | "http" | "mcp") || name.trim().is_empty() {
        return Err("invalid_draft_request".to_string());
    }
    let value = supervisor.call_core(
        "POST",
        "/app/capabilities/drafts",
        Some(json!({ "kind": kind, "name": name })),
    )?;
    let capability = value
        .get("capability")
        .cloned()
        .ok_or_else(|| "core_invalid_response".to_string())?;
    serde_json::from_value(capability).map_err(|_| "core_invalid_response".to_string())
}

#[tauri::command]
fn restart_core(supervisor: State<'_, Arc<CoreSupervisor>>) -> Result<UiCoreStatus, String> {
    supervisor.restart()
}

#[tauri::command]
fn shutdown_core(supervisor: State<'_, Arc<CoreSupervisor>>) -> Result<(), String> {
    supervisor.shutdown();
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let user_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|_| "user_data_dir_unavailable")?;
            let supervisor = Arc::new(CoreSupervisor::new(app.handle().clone(), user_data_dir)?);
            app.manage(supervisor.clone());
            if let Err(error) = supervisor.start_sidecar() {
                eprintln!("[lumiplug] core sidecar unavailable: {}", error);
            }

            let show = MenuItem::with_id(app, "show", "Show Lumi", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .map_err(|_| "tray_icon_invalid")?;
            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(false)
                .tooltip("Lumi")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_core_status,
            get_mcp_connection_info,
            check_mcp_connection,
            list_capabilities,
            create_capability_draft,
            restart_core,
            shutdown_core
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Lumi");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(supervisor) = app_handle.try_state::<Arc<CoreSupervisor>>() {
                supervisor.shutdown();
            }
        }
    });
}
