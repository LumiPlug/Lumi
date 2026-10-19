// SPDX-License-Identifier: MPL-2.0
//! Native menu delivery is retained until a main-window listener acknowledges it.
use super::{show_main_window, CoreSupervisor};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, Wry};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopAction {
    Open,
    Usage,
    Skills,
    Knowledge,
    CoreStatus,
    CoreStart,
    CoreStop,
    Settings,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRequest {
    id: String,
    action: DesktopAction,
    core_generation: u64,
}

pub struct DesktopMenu {
    pending: Mutex<VecDeque<DesktopRequest>>,
    quitting: AtomicBool,
    status: MenuItem<Wry>,
    start: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    labels: Vec<(MenuItem<Wry>, &'static str, &'static str)>,
}

fn label(app: &AppHandle, state: &str) -> &'static str {
    match state {
        "ready" => super::locale::text(app, "已连接", "Connected"),
        "starting" => super::locale::text(app, "启动中", "Starting"),
        "restarting" => super::locale::text(app, "重启中", "Restarting"),
        "stopping" => super::locale::text(app, "停止中", "Stopping"),
        "stopped" => super::locale::text(app, "已停止", "Stopped"),
        "error" => super::locale::text(app, "连接异常", "Connection error"),
        _ => super::locale::text(app, "未连接", "Disconnected"),
    }
}

pub fn refresh(app: &AppHandle) {
    let app = app.clone();
    let dispatch = app.clone();
    if let Err(error) = dispatch.run_on_main_thread(move || {
        if let (Some(menu), Some(core)) = (
            app.try_state::<DesktopMenu>(),
            app.try_state::<Arc<CoreSupervisor>>(),
        ) {
            let status = core.status();
            let result = (|| -> tauri::Result<()> {
                menu.status.set_text(format!(
                    "Core{}{}",
                    super::locale::text(&app, "：", ": "),
                    label(&app, &status.state)
                ))?;
                for (item, chinese, english) in &menu.labels {
                    item.set_text(super::locale::text(&app, chinese, english))?;
                }
                menu.start.set_enabled(status.can_start)?;
                menu.stop.set_enabled(status.can_stop)?;
                Ok(())
            })();
            if let Err(error) = result {
                eprintln!("[lumiplug] tray status update failed: {error}");
            }
        }
    }) {
        eprintln!("[lumiplug] tray dispatch failed: {error}");
    }
}

pub fn quitting(app: &AppHandle) -> bool {
    app.try_state::<DesktopMenu>()
        .is_some_and(|menu| menu.quitting.load(Ordering::Acquire))
}

pub fn handle_menu(app: &AppHandle, event: MenuEvent) {
    if event.id.as_ref() == "lumi-quit" {
        if let Some(menu) = app.try_state::<DesktopMenu>() {
            menu.quitting.store(true, Ordering::Release);
        }
        app.exit(0);
        return;
    }
    let action = match event.id.as_ref() {
        "lumi-open" => DesktopAction::Open,
        "lumi-usage" => DesktopAction::Usage,
        "lumi-skills" => DesktopAction::Skills,
        "lumi-knowledge" => DesktopAction::Knowledge,
        "lumi-core-status" => DesktopAction::CoreStatus,
        "lumi-core-start" => DesktopAction::CoreStart,
        "lumi-core-stop" => DesktopAction::CoreStop,
        "lumi-settings" => DesktopAction::Settings,
        _ => return,
    };
    if quitting(app) {
        return;
    }
    let core = app.state::<Arc<CoreSupervisor>>();
    let status = core.status();
    if (action == DesktopAction::CoreStart && !status.can_start)
        || (action == DesktopAction::CoreStop && !status.can_stop)
    {
        refresh(app);
        return;
    }
    let generation = core
        .state
        .lock()
        .expect("core supervisor mutex poisoned")
        .generation;
    let menu = app.state::<DesktopMenu>();
    let request = DesktopRequest {
        id: Uuid::new_v4().to_string(),
        action,
        core_generation: generation,
    };
    let mut pending = menu.pending.lock().expect("desktop queue mutex poisoned");
    // Eight fixed actions bound the queue; duplicate clicks never accumulate.
    if !pending.iter().any(|item| item.action == action) {
        pending.push_back(request.clone());
    }
    drop(pending);
    if let Err(error) = show_main_window(app) {
        menu.pending
            .lock()
            .expect("desktop queue mutex poisoned")
            .retain(|item| item.id != request.id);
        eprintln!("[lumiplug] desktop menu open failed: {error}");
        return;
    }
    let _ = app.emit_to("main", "lumi-desktop-action", ());
}

fn authorize_main(
    window: &WebviewWindow,
    core: &CoreSupervisor,
    nonce: &str,
) -> Result<(), String> {
    core.authorize(nonce)?;
    if window.label() != "main" {
        return Err("desktop_action_not_allowed".into());
    }
    Ok(())
}

#[tauri::command]
pub fn pending_desktop_action(
    window: WebviewWindow,
    core: State<'_, Arc<CoreSupervisor>>,
    menu: State<'_, DesktopMenu>,
    host_nonce: String,
) -> Result<Option<DesktopRequest>, String> {
    authorize_main(&window, &core, &host_nonce)?;
    Ok(menu
        .pending
        .lock()
        .map_err(|_| "desktop_queue_failed")?
        .front()
        .cloned())
}

#[tauri::command]
pub fn acknowledge_desktop_action(
    window: WebviewWindow,
    core: State<'_, Arc<CoreSupervisor>>,
    menu: State<'_, DesktopMenu>,
    host_nonce: String,
    id: String,
) -> Result<(), String> {
    authorize_main(&window, &core, &host_nonce)?;
    let mut pending = menu.pending.lock().map_err(|_| "desktop_queue_failed")?;
    if pending.front().is_some_and(|item| item.id == id) {
        pending.pop_front();
    }
    Ok(())
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let item = |id, text| MenuItem::with_id(app, id, text, true, None::<&str>);
    let open = item("lumi-open", "打开 Lumi")?;
    let usage = item("lumi-usage", "AI 用量")?;
    let skills = item("lumi-skills", "Skills")?;
    let knowledge = item("lumi-knowledge", "项目知识")?;
    let status = item("lumi-core-status", "Core：启动中")?;
    let start = item("lumi-core-start", "启动 Core")?;
    let stop = item("lumi-core-stop", "停止 Core…")?;
    let settings = item("lumi-settings", "设置")?;
    let quit = item("lumi-quit", "退出 Lumi")?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &usage,
            &skills,
            &knowledge,
            &PredefinedMenuItem::separator(app)?,
            &status,
            &start,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &quit,
        ],
    )?;
    #[allow(unused_mut)]
    let mut labels = vec![
        (open, "打开 Lumi", "Open Lumi"),
        (usage, "AI 用量", "AI Usage"),
        (skills, "Skills", "Skills"),
        (knowledge, "项目知识", "Project knowledge"),
        (start.clone(), "启动 Core", "Start Core"),
        (stop.clone(), "停止 Core…", "Stop Core…"),
        (settings, "设置", "Settings"),
        (quit, "退出 Lumi", "Quit Lumi"),
    ];
    TrayIconBuilder::with_id("lumi-tray")
        .icon(Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?)
        .icon_as_template(false)
        .tooltip("Lumi")
        .menu(&menu)
        .build(app)?;
    #[cfg(target_os = "macos")]
    {
        // Keep Tauri's standard Edit/Window actions, replacing only the default Quit.
        // A custom Cmd+Q shares the explicit quit flag with the tray item.
        let application_menu = Menu::default(app)?;
        if let Some(submenu) = application_menu
            .items()?
            .first()
            .and_then(|item| item.as_submenu())
        {
            let count = submenu.items()?.len();
            if count > 0 {
                submenu.remove_at(count - 1)?;
            }
            let quit_item =
                MenuItem::with_id(app, "lumi-quit", "退出 Lumi", true, Some("CmdOrCtrl+Q"))?;
            submenu.append(&quit_item)?;
            labels.push((quit_item, "退出 Lumi", "Quit Lumi"));
        }
        app.set_menu(application_menu)?;
    }
    app.manage(DesktopMenu {
        pending: Mutex::new(VecDeque::new()),
        quitting: AtomicBool::new(false),
        status,
        start,
        stop,
        labels,
    });
    refresh(app);
    Ok(())
}
