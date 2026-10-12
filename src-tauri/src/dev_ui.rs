// SPDX-License-Identifier: MPL-2.0
// This module is compiled only with debug_assertions; release never registers its command.
use super::CoreSupervisor;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    enabled: bool,
    action: String,
    capability_id: String,
}
pub struct DevelopmentUiState {
    preset: Option<Preset>,
    claimed: AtomicBool,
    records: AtomicUsize,
}
impl DevelopmentUiState {
    pub fn from_args(args: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut action = None;
        let mut target = None;
        for arg in args {
            if let Some(value) = arg.strip_prefix("--lumi-dev-ui-action=") {
                if action.replace(value.to_string()).is_some() {
                    return Err("duplicate_development_ui_option".into());
                }
            } else if let Some(value) = arg.strip_prefix("--lumi-dev-ui-target=") {
                if target.replace(value.to_string()).is_some() {
                    return Err("duplicate_development_ui_option".into());
                }
            } else if arg.starts_with("--lumi-dev-ui-") {
                return Err("unknown_development_ui_option".into());
            }
        }
        let preset = match (action, target) {
            (None, None) => None,
            (Some(action), Some(target)) if action == "terminal.start" => Some(Preset {
                enabled: true,
                action,
                capability_id: Uuid::parse_str(&target)
                    .map_err(|_| "invalid_development_ui_target")?
                    .to_string(),
            }),
            _ => return Err("invalid_development_ui_action".into()),
        };
        Ok(Self {
            preset,
            claimed: AtomicBool::new(false),
            records: AtomicUsize::new(0),
        })
    }
    pub fn initialization_script(&self) -> Result<String, String> {
        let value = serde_json::to_string(&self.preset)
            .map_err(|_| "development_ui_initialization_failed")?;
        Ok(format!("if (window.top === window && ['http://127.0.0.1:1420','http://localhost:1420'].includes(location.origin)) {{ Object.defineProperty(window, '__LUMI_DEV_UI_PRESET__', {{value: Object.freeze({value}), writable: false, configurable: false}}); }}"))
    }
    fn authorize_event(&self, window: &str, event: &AuditEvent) -> Result<(), String> {
        let preset = self.preset.as_ref().ok_or("development_ui_disabled")?;
        if window != "main"
            || event.action != "terminal.start"
            || event.capability_id != preset.capability_id
        {
            return Err("development_ui_scope_rejected".into());
        }
        if event
            .task_id
            .as_ref()
            .is_some_and(|id| Uuid::parse_str(id).is_err())
        {
            return Err("invalid_development_ui_task".into());
        }
        if let Some(status) = &event.status {
            if ![
                "running",
                "stopping",
                "completed",
                "failed",
                "timed_out",
                "interrupted",
                "cancelled",
            ]
            .contains(&status.as_str())
            {
                return Err("invalid_development_ui_status".into());
            }
        }
        if event.phase == Phase::Dispatch {
            self.claimed
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map_err(|_| "development_ui_already_used")?;
        } else if !self.claimed.load(Ordering::Acquire) {
            return Err("development_ui_not_claimed".into());
        }
        if self.records.fetch_add(1, Ordering::Relaxed) >= 64 {
            return Err("development_ui_audit_limit".into());
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Dispatch,
    Clicked,
    NotReady,
    Observation,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditEvent {
    action: String,
    capability_id: String,
    phase: Phase,
    task_id: Option<String>,
    status: Option<String>,
    exit_code: Option<i32>,
    stdout_length: Option<usize>,
    stderr_length: Option<usize>,
}
#[tauri::command]
pub(super) fn lumi_dev_ui_record(
    window: WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    state: State<'_, DevelopmentUiState>,
    host_nonce: String,
    event: AuditEvent,
) -> Result<(), String> {
    supervisor.authorize(&host_nonce)?;
    state.authorize_event(window.label(), &event)?;
    eprintln!(
        "[lumi-development-ui] {}",
        serde_json::json!({"source":"development-ui", "event":event})
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "2ab20dbb-eda9-438b-9722-e10fa12ad907";
    fn event(phase: Phase) -> AuditEvent {
        AuditEvent {
            action: "terminal.start".into(),
            capability_id: ID.into(),
            phase,
            task_id: None,
            status: None,
            exit_code: None,
            stdout_length: None,
            stderr_length: None,
        }
    }
    fn enabled() -> DevelopmentUiState {
        DevelopmentUiState::from_args([
            "--lumi-dev-ui-action=terminal.start".into(),
            format!("--lumi-dev-ui-target={ID}"),
        ])
        .unwrap()
    }
    #[test]
    fn disabled_by_default() {
        let state = DevelopmentUiState::from_args([]).unwrap();
        assert!(state.preset.is_none());
        assert!(state
            .authorize_event("main", &event(Phase::Dispatch))
            .is_err());
    }
    #[test]
    fn rejects_unknown_actions_and_incomplete_or_duplicate_options() {
        for args in [
            vec![
                "--lumi-dev-ui-action=eval".into(),
                format!("--lumi-dev-ui-target={ID}"),
            ],
            vec!["--lumi-dev-ui-action=terminal.start".into()],
            vec![format!("--lumi-dev-ui-target={ID}")],
            vec![
                "--lumi-dev-ui-action=terminal.start".into(),
                "--lumi-dev-ui-action=terminal.start".into(),
                format!("--lumi-dev-ui-target={ID}"),
            ],
        ] {
            assert!(DevelopmentUiState::from_args(args).is_err());
        }
    }
    #[test]
    fn scopes_and_claims_only_once() {
        let state = enabled();
        assert!(state
            .authorize_event("run-tool-other", &event(Phase::Dispatch))
            .is_err());
        let mut wrong = event(Phase::Dispatch);
        wrong.capability_id = Uuid::new_v4().to_string();
        assert!(state.authorize_event("main", &wrong).is_err());
        assert!(state
            .authorize_event("main", &event(Phase::Dispatch))
            .is_ok());
        assert!(state
            .authorize_event("main", &event(Phase::Dispatch))
            .is_err());
        assert!(state
            .authorize_event("main", &event(Phase::Clicked))
            .is_ok());
    }
    #[test]
    fn rejects_unregistered_event_fields() {
        assert!(serde_json::from_str::<AuditEvent>(&format!(r#"{{"action":"terminal.start","capabilityId":"{ID}","phase":"dispatch","selector":"body"}}"#)).is_err());
    }
}
