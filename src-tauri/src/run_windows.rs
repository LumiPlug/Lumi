// SPDX-License-Identifier: MPL-2.0
use super::CoreSupervisor;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWindowRequest {
    capability_id: String,
    title: String,
    task_id: Option<String>,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
}
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

pub(super) fn is_run_window(label: &str) -> bool {
    ["run-tool-", "run-task-"].iter().any(|prefix| {
        label
            .strip_prefix(prefix)
            .is_some_and(|id| Uuid::parse_str(id).is_ok())
    })
}
fn window_target(capability_id: &str, task_id: Option<&str>) -> Result<(String, String), String> {
    let capability =
        Uuid::parse_str(capability_id).map_err(|_| "invalid_run_window".to_string())?;
    if let Some(id) = task_id {
        let task = Uuid::parse_str(id).map_err(|_| "invalid_run_window".to_string())?;
        Ok((
            format!("run-task-{task}"),
            format!("index.html?runTool={capability}&task={task}"),
        ))
    } else {
        Ok((
            format!("run-tool-{capability}"),
            format!("index.html?runTool={capability}"),
        ))
    }
}
pub(super) fn initialization_script(supervisor: &CoreSupervisor) -> Result<String, String> {
    let nonce = serde_json::to_string(&supervisor.host_nonce)
        .map_err(|_| "host_initialization_failed".to_string())?;
    let locale = serde_json::to_string(&super::locale::current(&supervisor.app))
        .map_err(|_| "host_initialization_failed".to_string())?;
    Ok(format!("if (window.top === window && ((location.protocol === 'tauri:' && location.hostname === 'localhost') || ['http://tauri.localhost','https://tauri.localhost','http://127.0.0.1:1420','http://localhost:1420'].includes(location.origin))) {{ Object.defineProperty(window, '__LUMI_LOCALE__', {{ value: {locale}, writable: false, configurable: false }}); Object.defineProperty(window, '__LUMI_HOST_NONCE__', {{ value: {nonce}, writable: false, configurable: false }}); }}"))
}
#[tauri::command]
pub async fn open_tool_run_window(
    app: AppHandle,
    window: WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    request: RunWindowRequest,
) -> Result<(), String> {
    let RunWindowRequest {
        capability_id,
        title,
        task_id,
        width,
        height,
        min_width,
        min_height,
    } = request;
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" || title.is_empty() || title.len() > 256 {
        return Err("run_window_not_allowed".into());
    }
    let (label, url) = window_target(&capability_id, task_id.as_deref())?;
    if [width, height, min_width, min_height]
        .iter()
        .any(|size| !size.is_finite() || *size <= 0.0 || *size > 10000.0)
    {
        return Err("invalid_run_window".into());
    }
    let _opening = supervisor
        .window_open_lock
        .lock()
        .map_err(|_| "run_window_failed".to_string())?;
    if let Some(existing) = app.get_webview_window(&label) {
        existing
            .show()
            .map_err(|_| "run_window_failed".to_string())?;
        existing
            .unminimize()
            .map_err(|_| "run_window_failed".to_string())?;
        return existing
            .set_focus()
            .map_err(|_| "run_window_failed".to_string());
    }
    let builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()));
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    builder
        .title(format!(
            "{title} · {}",
            super::locale::text(&app, "运行", "Run")
        ))
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .center()
        .resizable(true)
        .initialization_script(initialization_script(&supervisor)?)
        .build()
        .map_err(|_| "run_window_failed".to_string())?;
    Ok(())
}
#[tauri::command]
pub fn close_tool_run_window(
    app: AppHandle,
    window: WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    host_nonce: String,
    mode: String,
) -> Result<(), String> {
    supervisor.authorize(&host_nonce)?;
    if !is_run_window(window.label()) {
        return Err("run_window_not_allowed".into());
    }
    let message = match mode.as_str() {
        "idle" => None,
        "background" => Some(super::locale::text(
            &app,
            "任务已保留在后台运行，可从运行记录查看。",
            "Task continues in the background. View it in run history.",
        )),
        "ended" => Some(super::locale::text(
            &app,
            "任务已结束，运行窗口已关闭。",
            "Task ended and the run window was closed.",
        )),
        _ => return Err("invalid_run_window".into()),
    };
    if let Some(message) = message {
        let _ = app.emit_to("main", "tool-run-window-feedback", message);
    }
    window.destroy().map_err(|_| "run_window_failed".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    const CAP: &str = "f06cb86e-b41c-418e-9034-c92325d76732";
    const TASK: &str = "1e10f383-17d5-4254-9ab1-9fcc445baf76";
    #[test]
    fn restricts_labels_and_routes_to_valid_ids() {
        let (label, route) = window_target(CAP, None).unwrap();
        assert!(is_run_window(&label));
        assert_eq!(route, format!("index.html?runTool={CAP}"));
        let (label, route) = window_target(CAP, Some(TASK)).unwrap();
        assert!(is_run_window(&label));
        assert_eq!(route, format!("index.html?runTool={CAP}&task={TASK}"));
        for invalid in [
            "main",
            "run-tool-",
            "run-tool-../../main",
            "run-task-invalid",
        ] {
            assert!(!is_run_window(invalid));
        }
        assert!(window_target("../../main", None).is_err());
        assert!(window_target(CAP, Some("?token=secret")).is_err());
    }
}
