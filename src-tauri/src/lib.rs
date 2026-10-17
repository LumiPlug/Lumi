// SPDX-License-Identifier: MPL-2.0

use std::io::{Read, Write};
use std::net::TcpStream;
#[cfg(debug_assertions)]
mod dev_ui;
mod mcp_settings;
mod run_windows;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
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
    endpoint: String,
    auth_header: &'static str,
    session_token: String,
    core_state: String,
    stdio_command: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPortSettings {
    default_port: u16,
    configured_port: u16,
    active_port: u16,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarReadyHandshake {
    kind: String,
    protocol_version: u16,
    core_version: String,
    port: u16,
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
    configured_port: u16,
    session_token: String,
    user_data_dir: PathBuf,
    child: Option<CommandChild>,
    generation: u64,
    shutting_down: bool,
    stdout_buffer: String,
}

pub struct CoreSupervisor {
    app: AppHandle,
    state: Mutex<SupervisorState>,
    host_nonce: String,
    host_token: String,
    window_open_lock: Mutex<()>,
    main_hidden_at: Mutex<Option<Instant>>,
}

impl CoreSupervisor {
    fn new(app: AppHandle, user_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&user_data_dir)
            .map_err(|_| "user_data_dir_unavailable".to_string())?;
        let port = mcp_settings::load_port(&user_data_dir).unwrap_or_else(|error| {
            eprintln!("[lumiplug] MCP settings: {error}; using default port");
            mcp_settings::DEFAULT_MCP_PORT
        });
        let session_token = mcp_settings::load_or_create_token(&user_data_dir)?;
        Ok(Self {
            app,
            host_nonce: Uuid::new_v4().to_string(),
            host_token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            window_open_lock: Mutex::new(()),
            main_hidden_at: Mutex::new(None),
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
                configured_port: port,
                session_token,
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
            endpoint: format!("http://{}:{}/mcp", LOOPBACK_HOST, state.port),
            auth_header: SESSION_TOKEN_HEADER,
            session_token: state.session_token.clone(),
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

    fn port_settings(&self) -> McpPortSettings {
        let state = self.state.lock().expect("core supervisor mutex poisoned");
        McpPortSettings {
            default_port: mcp_settings::DEFAULT_MCP_PORT,
            configured_port: state.configured_port,
            active_port: state.port,
        }
    }
    fn save_port_settings(&self, port: u16) -> Result<McpPortSettings, String> {
        mcp_settings::validate_port(port)?;
        let mut state = self.state.lock().expect("core supervisor mutex poisoned");
        if port != state.port || state.status.state != "ready" {
            mcp_settings::check_available(port)?;
        }
        mcp_settings::save_port(&state.user_data_dir, port)?;
        state.configured_port = port;
        Ok(McpPortSettings {
            default_port: mcp_settings::DEFAULT_MCP_PORT,
            configured_port: port,
            active_port: state.port,
        })
    }

    fn refresh_mcp_token(&self) -> Result<McpConnectionInfo, String> {
        if self.status().state != "ready" {
            return Err("core_not_ready".into());
        }
        let (previous, dir) = {
            let state = self.state.lock().expect("core supervisor mutex poisoned");
            (state.session_token.clone(), state.user_data_dir.clone())
        };
        let token = match self.call_core("POST", "/app/mcp/token", Some(json!({}))) {
            Ok(value) => value
                .get("sessionToken")
                .and_then(Value::as_str)
                .ok_or("core_invalid_response")?
                .to_string(),
            Err(error) => {
                let persisted = mcp_settings::load_or_create_token(&dir)?;
                if persisted == previous {
                    return Err(error);
                }
                persisted
            }
        };
        self.state
            .lock()
            .expect("core supervisor mutex poisoned")
            .session_token = token;
        Ok(self.mcp_connection_info())
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

        if let Err(error) = mcp_settings::check_available(port) {
            let mut state = self.state.lock().expect("core supervisor mutex poisoned");
            if state.generation == generation {
                state.status.state = "error".into();
                state.status.last_error = Some(error.clone());
            }
            return Err(error);
        }
        let args = vec![
            "--host".to_string(),
            LOOPBACK_HOST.to_string(),
            "--port".to_string(),
            port.to_string(),
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
            .env("LUMIPLUG_HOST_TOKEN", &self.host_token)
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
                if let Ok(error) = serde_json::from_str::<Value>(line.trim()) {
                    if error.get("code").and_then(Value::as_str) == Some("mcp_port_in_use") {
                        let mut state = self.state.lock().expect("core supervisor mutex poisoned");
                        if state.generation == generation {
                            state.status.state = "error".into();
                            state.status.last_error = Some("mcp_port_in_use".into());
                        }
                    }
                }
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

    fn authorize(&self, nonce: &str) -> Result<(), String> {
        if nonce != self.host_nonce {
            return Err("host_authentication_failed".to_string());
        }
        Ok(())
    }

    fn call_core(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        if !matches!(
            path,
            "/app/capabilities"
                | "/app/tools"
                | "/app/mcp/check"
                | "/app/mcp/token"
                | "/app/workbench"
                | "/app/workbench/publish"
                | "/app/workbench/apply-template"
                | "/app/workbench/restore"
                | "/app/workbench/versions"
                | "/app/workbench/export"
                | "/app/workbench/rpc"
                | "/app/skills"
                | "/app/skills/scan"
                | "/app/skills/import"
                | "/app/skills/archive"
                | "/app/skills/project"
                | "/app/skills/directory"
                | "/app/skills/file"
                | "/app/knowledge"
                | "/app/usage"
        ) && !path.starts_with("/app/capabilities/")
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
            "{} {} HTTP/1.1\r\nHost: {}:{}\r\nOrigin: tauri://localhost\r\n{}: {}\r\nx-lumiplug-host-token: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            method,
            path,
            LOOPBACK_HOST,
            port,
            SESSION_TOKEN_HEADER,
            token,
            self.host_token,
            body_text.len(),
            body_text,
        );
        let mut stream = TcpStream::connect((LOOPBACK_HOST, port))
            .map_err(|_| "core_connection_failed".to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(if path == "/app/usage" {
                180
            } else if path.starts_with("/app/skills")
                || path == "/app/tools"
                || path == "/app/knowledge"
            {
                30
            } else {
                2
            })))
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
        let code = value.pointer("/error/code").and_then(Value::as_str);
        if let Some(code) = code.filter(|code| {
            code.len() <= 80
                && code
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        }) {
            return Err(code.to_string());
        }
        return Err("core_request_failed".to_string());
    }
    value
        .get("data")
        .cloned()
        .ok_or_else(|| "core_invalid_response".to_string())
}

#[tauri::command]
async fn choose_tool_directory(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<Option<String>, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" && !run_windows::is_run_window(window.label()) {
        return Err("tool_directory_not_allowed".to_string());
    }
    Ok(rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("选择工具工作目录")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned()))
}

#[tauri::command]
fn get_core_status(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<UiCoreStatus, String> {
    supervisor.authorize(&host_nonce)?;
    Ok(supervisor.status())
}

#[tauri::command]
fn get_mcp_connection_info(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<McpConnectionInfo, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("mcp_configuration_not_allowed".to_string());
    }
    Ok(supervisor.mcp_connection_info())
}

#[tauri::command]
fn get_mcp_port_settings(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<McpPortSettings, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("mcp_configuration_not_allowed".into());
    }
    Ok(supervisor.port_settings())
}
#[tauri::command]
fn set_mcp_port(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    port: u16,
) -> Result<McpPortSettings, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("mcp_configuration_not_allowed".into());
    }
    supervisor.save_port_settings(port)
}

#[tauri::command]
fn refresh_mcp_token(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<McpConnectionInfo, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("mcp_configuration_not_allowed".into());
    }
    supervisor.refresh_mcp_token()
}

#[tauri::command]
fn check_mcp_connection(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core("GET", "/app/mcp/check", None)
}

#[tauri::command]
fn get_workbench(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core("GET", "/app/workbench", None)
}

#[tauri::command]
fn apply_workbench_template(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    expected_version: u64,
    template: String,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core(
        "POST",
        "/app/workbench/apply-template",
        Some(json!({"expectedVersion": expected_version, "template": template})),
    )
}

#[tauri::command]
fn publish_workbench(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    expected_version: u64,
    bundle: Value,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core(
        "POST",
        "/app/workbench/publish",
        Some(json!({"expectedVersion": expected_version, "bundle": bundle})),
    )
}

#[tauri::command]
fn restore_workbench_version(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    expected_version: u64,
    version: u64,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core(
        "POST",
        "/app/workbench/restore",
        Some(json!({"expectedVersion": expected_version, "version": version})),
    )
}

#[tauri::command]
fn list_workbench_versions(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core("GET", "/app/workbench/versions", None)
}

#[tauri::command]
fn export_workbench_project(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    directory: String,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core(
        "POST",
        "/app/workbench/export",
        Some(json!({"directory": directory})),
    )
}

#[tauri::command]
fn workbench_rpc(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    version: u64,
    method: String,
    args: Value,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    supervisor.call_core(
        "POST",
        "/app/workbench/rpc",
        Some(json!({"version": version, "method": method, "args": args})),
    )
}

#[tauri::command]
fn copy_text(
    app: AppHandle,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    text: String,
) -> Result<(), String> {
    supervisor.authorize(&host_nonce)?;
    if text.len() > 1024 * 1024 {
        return Err("clipboard_text_too_large".to_string());
    }
    app.clipboard()
        .write_text(text)
        .map_err(|_| "clipboard_write_failed".to_string())
}

#[tauri::command]
async fn tools_request(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    let core = Arc::clone(supervisor.inner());
    tauri::async_runtime::spawn_blocking(move || {
        core.call_core(
            "POST",
            "/app/tools",
            Some(serde_json::json!({"action": action, "payload": payload})),
        )
    })
    .await
    .map_err(|_| "tools_request_failed".to_string())?
}

#[tauri::command]
async fn skills_request(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    let (method, route) = match action.as_str() {
        "list" => ("GET", "/app/skills"),
        "scan" => ("POST", "/app/skills/scan"),
        "import" => ("POST", "/app/skills/import"),
        "archive" => ("POST", "/app/skills/archive"),
        "project" => ("POST", "/app/skills/project"),
        "directory" => ("POST", "/app/skills/directory"),
        "file" => ("POST", "/app/skills/file"),
        _ => return Err("invalid_skills_action".to_string()),
    };
    let core = Arc::clone(supervisor.inner());
    tauri::async_runtime::spawn_blocking(move || core.call_core(method, route, payload))
        .await
        .map_err(|_| "skills_request_failed".to_string())?
}

#[tauri::command]
async fn usage_request(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("usage_host_required".to_string());
    }
    let core = Arc::clone(supervisor.inner());
    tauri::async_runtime::spawn_blocking(move || {
        core.call_core(
            "POST",
            "/app/usage",
            Some(json!({"action": action, "payload": payload})),
        )
    })
    .await
    .map_err(|_| "usage_request_failed".to_string())?
}

#[tauri::command]
async fn knowledge_request(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("knowledge_host_required".to_string());
    }
    let core = Arc::clone(supervisor.inner());
    tauri::async_runtime::spawn_blocking(move || {
        core.call_core(
            "POST",
            "/app/knowledge",
            Some(json!({"action": action, "payload": payload})),
        )
    })
    .await
    .map_err(|_| "knowledge_request_failed".to_string())?
}

#[tauri::command]
async fn export_knowledge(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    kb_id: String,
    file_name: String,
) -> Result<Option<String>, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("knowledge_host_required".into());
    }
    let core = Arc::clone(supervisor.inner());
    let bundle = tauri::async_runtime::spawn_blocking(move || {
        core.call_core(
            "POST",
            "/app/knowledge",
            Some(json!({"action": "export", "payload": {"kbId": kb_id}})),
        )
    })
    .await
    .map_err(|_| "knowledge_export_failed")??;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("导出知识库")
        .set_file_name(&file_name)
        .add_filter("Lumi 知识库", &["json"])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let bytes = serde_json::to_vec_pretty(&bundle).map_err(|_| "knowledge_export_failed")?;
    file.write(&bytes)
        .await
        .map_err(|_| "knowledge_export_failed")?;
    Ok(Some(file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
async fn export_usage_csv(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    payload: Option<Value>,
) -> Result<Option<String>, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("usage_host_required".into());
    }
    let core = Arc::clone(supervisor.inner());
    let export = tauri::async_runtime::spawn_blocking(move || {
        core.call_core(
            "POST",
            "/app/usage",
            Some(json!({"action": "export", "payload": payload})),
        )
    })
    .await
    .map_err(|_| "usage_export_failed")??;
    let csv = export
        .get("csv")
        .and_then(Value::as_str)
        .ok_or("usage_export_failed")?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("导出 AI 用量")
        .set_file_name("lumi-ai-usage.csv")
        .add_filter("CSV 表格", &["csv"])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    file.write(csv.as_bytes())
        .await
        .map_err(|_| "usage_export_failed")?;
    Ok(Some(file.path().to_string_lossy().into_owned()))
}

#[tauri::command]
#[allow(deprecated)]
fn open_skill_source(
    app: AppHandle,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    url: String,
) -> Result<(), String> {
    supervisor.authorize(&host_nonce)?;
    let allowed = [
        "https://github.com/openai/skills/tree/main/skills/.curated/openai-docs",
        "https://github.com/openai/skills/tree/main/skills/.curated/pdf",
        "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
        "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
    ];
    if !allowed.contains(&url.as_str()) {
        return Err("invalid_skill_source".to_string());
    }
    app.shell()
        .open(url, None)
        .map_err(|_| "open_skill_source_failed".to_string())
}

#[tauri::command]
#[allow(deprecated)]
fn open_skill_link(
    app: AppHandle,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    url: String,
) -> Result<(), String> {
    supervisor.authorize(&host_nonce)?;
    let parsed = tauri::Url::parse(&url).map_err(|_| "invalid_skill_link".to_string())?;
    if url.len() > 4096
        || !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("invalid_skill_link".to_string());
    }
    app.shell()
        .open(parsed.to_string(), None)
        .map_err(|_| "open_skill_link_failed".to_string())
}

#[tauri::command]
fn list_capabilities(
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<Vec<CapabilitySummary>, String> {
    supervisor.authorize(&host_nonce)?;
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
    host_nonce: String,
) -> Result<CapabilitySummary, String> {
    supervisor.authorize(&host_nonce)?;
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

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let supervisor = app.state::<Arc<CoreSupervisor>>();
    let _opening = supervisor
        .window_open_lock
        .lock()
        .map_err(|_| "main_window_failed")?;
    *supervisor
        .main_hidden_at
        .lock()
        .map_err(|_| "main_window_failed")? = None;
    let window = if let Some(window) = app.get_webview_window("main") {
        window
    } else {
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .ok_or("main_window_missing")?;
        tauri::WebviewWindowBuilder::from_config(app, config)
            .map_err(|_| "main_window_failed")?
            .initialization_script(run_windows::initialization_script(&supervisor)?)
            .build()
            .map_err(|_| "main_window_failed")?
    };
    window.show().map_err(|_| "main_window_failed")?;
    window.unminimize().map_err(|_| "main_window_failed")?;
    window.set_focus().map_err(|_| "main_window_failed")?;
    let _ = window.emit_to(window.label(), "lumi-window-activity", true);
    Ok(())
}

#[tauri::command]
fn get_window_activity(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<bool, String> {
    supervisor.authorize(&host_nonce)?;
    Ok(window.is_visible().map_err(|_| "window_unavailable")?
        && !window.is_minimized().map_err(|_| "window_unavailable")?)
}

fn idle_main_can_release(label: &str, visible: bool, hidden_for: Option<Duration>) -> bool {
    label == "main"
        && !visible
        && hidden_for.is_some_and(|elapsed| elapsed >= Duration::from_secs(300))
}

#[tauri::command]
fn release_idle_main_window(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
) -> Result<bool, String> {
    supervisor.authorize(&host_nonce)?;
    let _opening = supervisor
        .window_open_lock
        .lock()
        .map_err(|_| "main_window_failed")?;
    let mut hidden_at = supervisor
        .main_hidden_at
        .lock()
        .map_err(|_| "main_window_failed")?;
    if !idle_main_can_release(
        window.label(),
        window.is_visible().map_err(|_| "window_unavailable")?,
        hidden_at.map(|instant| instant.elapsed()),
    ) {
        return Ok(false);
    }
    window.destroy().map_err(|_| "main_window_failed")?;
    *hidden_at = None;
    Ok(true)
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
            let init = run_windows::initialization_script(&supervisor)?;
            #[cfg(debug_assertions)]
            let init = {
                let development = dev_ui::DevelopmentUiState::from_args(std::env::args().skip(1))?;
                let init = format!("{init}\n{}", development.initialization_script()?);
                app.manage(development);
                init
            };
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("main_window_missing")?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .initialization_script(init)
                .build()?;
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
                        if let Err(error) = show_main_window(app) {
                            eprintln!("[lumiplug] main window unavailable: {error}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler({
            let regular: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                get_core_status,
                get_window_activity,
                release_idle_main_window,
                run_windows::open_tool_run_window,
                run_windows::close_tool_run_window,
                choose_tool_directory,
                get_mcp_connection_info,
                get_mcp_port_settings,
                set_mcp_port,
                refresh_mcp_token,
                check_mcp_connection,
                get_workbench,
                apply_workbench_template,
                publish_workbench,
                restore_workbench_version,
                list_workbench_versions,
                export_workbench_project,
                workbench_rpc,
                copy_text,
                skills_request,
                knowledge_request,
                usage_request,
                export_usage_csv,
                export_knowledge,
                open_skill_source,
                open_skill_link,
                tools_request,
                list_capabilities,
                create_capability_draft
            ];
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                #[cfg(debug_assertions)]
                if invoke.message.command() == "lumi_dev_ui_record" {
                    let development: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool =
                        tauri::generate_handler![dev_ui::lumi_dev_ui_record];
                    return development(invoke);
                }
                regular(invoke)
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Focused(_) | WindowEvent::Resized(_)) {
                let visible =
                    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
                let _ = window.emit_to(window.label(), "lumi-window-activity", visible);
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    if window.hide().is_ok() {
                        let supervisor = window.app_handle().state::<Arc<CoreSupervisor>>();
                        *supervisor
                            .main_hidden_at
                            .lock()
                            .expect("main hidden mutex poisoned") = Some(Instant::now());
                        let _ = window.emit_to(window.label(), "lumi-window-activity", false);
                    }
                } else if run_windows::is_run_window(window.label()) {
                    api.prevent_close();
                    let _ = window.app_handle().emit_to(
                        window.label(),
                        "run-window-close-requested",
                        (),
                    );
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Lumi");
    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if matches!(event, tauri::RunEvent::Reopen { .. }) {
            if let Err(error) = show_main_window(app_handle) {
                eprintln!("[lumiplug] main window unavailable: {error}");
            }
        }
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
        {
            api.prevent_exit();
        }
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(supervisor) = app_handle.try_state::<Arc<CoreSupervisor>>() {
                supervisor.shutdown();
            }
        }
    });
}

#[cfg(test)]
mod resource_tests {
    use super::*;
    #[test]
    fn only_releases_a_main_window_after_continuous_hiding() {
        let idle = Some(Duration::from_secs(300));
        assert!(idle_main_can_release("main", false, idle));
        assert!(!idle_main_can_release("main", true, idle));
        assert!(!idle_main_can_release("main", false, None));
        assert!(!idle_main_can_release(
            "main",
            false,
            Some(Duration::from_secs(299))
        ));
        assert!(!idle_main_can_release("run-task-example", false, idle));
    }
}
