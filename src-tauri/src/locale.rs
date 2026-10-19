// SPDX-License-Identifier: MPL-2.0
use super::CoreSupervisor;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum Locale {
    #[default]
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}
pub struct UiLocale {
    value: Mutex<Locale>,
    directory: PathBuf,
}
impl UiLocale {
    pub fn load(directory: PathBuf) -> Self {
        let value = std::fs::read(directory.join("ui-language.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            value: Mutex::new(value),
            directory,
        }
    }
    fn get(&self) -> Locale {
        *self.value.lock().unwrap_or_else(|error| error.into_inner())
    }
    fn save(&self, locale: Locale) -> Result<(), String> {
        let mut value = self.value.lock().map_err(|_| "locale_save_failed")?;
        persist(&self.directory, locale)?;
        *value = locale;
        Ok(())
    }
}
fn persist(directory: &Path, value: Locale) -> Result<(), String> {
    let temporary = directory.join(format!("ui-language-{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec(&value)?)?;
        file.sync_all()?;
        std::fs::rename(&temporary, directory.join("ui-language.json"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result.map_err(|_| "locale_save_failed".into())
}
pub fn current(app: &AppHandle) -> Locale {
    app.try_state::<UiLocale>()
        .map(|state| state.get())
        .unwrap_or_default()
}
pub fn text<'a>(app: &AppHandle, chinese: &'a str, english: &'a str) -> &'a str {
    if current(app) == Locale::English {
        english
    } else {
        chinese
    }
}
#[tauri::command]
pub fn get_ui_locale(
    window: WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    preference: State<'_, UiLocale>,
    host_nonce: String,
) -> Result<Locale, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" && !super::run_windows::is_run_window(window.label()) {
        return Err("locale_not_allowed".into());
    }
    Ok(preference.get())
}
#[tauri::command]
pub fn set_ui_locale(
    app: AppHandle,
    window: WebviewWindow,
    supervisor: State<'_, Arc<CoreSupervisor>>,
    preference: State<'_, UiLocale>,
    host_nonce: String,
    locale: Locale,
) -> Result<Locale, String> {
    supervisor.authorize(&host_nonce)?;
    if window.label() != "main" {
        return Err("locale_not_allowed".into());
    }
    preference.save(locale)?;
    super::desktop_menu::refresh(&app);
    // A successful disk write is the commit point. New/recreated windows preload it
    // even if an existing WebView is temporarily unable to receive an event.
    if let Err(error) = app.emit("lumi-locale-changed", locale) {
        eprintln!("[lumiplug] locale broadcast failed: {error}");
    }
    // Run-window titles contain user names; change only the app-owned suffix.
    for (label, window) in app.webview_windows() {
        if super::run_windows::is_run_window(&label) {
            if let Ok(title) = window.title() {
                if let Some(name) = title
                    .strip_suffix(" · 运行")
                    .or_else(|| title.strip_suffix(" · Run"))
                {
                    let _ = window.set_title(&format!("{name} · {}", text(&app, "运行", "Run")));
                }
            }
        }
    }
    Ok(locale)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_both_languages_and_rejects_other_values() {
        let dir = std::env::temp_dir().join(format!("lumi-locale-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(UiLocale::load(dir.clone()).get(), Locale::Chinese);
        let state = UiLocale::load(dir.clone());
        for value in [Locale::English, Locale::Chinese] {
            state.save(value).unwrap();
            assert_eq!(UiLocale::load(dir.clone()).get(), value);
        }
        assert!(serde_json::from_str::<Locale>("\"fr\"").is_err());
        std::fs::write(dir.join("ui-language.json"), b"corrupt").unwrap();
        assert_eq!(UiLocale::load(dir.clone()).get(), Locale::Chinese);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_save_preserves_current_preference() {
        let dir = std::env::temp_dir().join(format!("lumi-locale-{}", Uuid::new_v4()));
        let state = UiLocale::load(dir);
        assert!(state.save(Locale::English).is_err());
        assert_eq!(state.get(), Locale::Chinese);
    }
}
