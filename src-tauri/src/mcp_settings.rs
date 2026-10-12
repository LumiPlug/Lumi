// SPDX-License-Identifier: MPL-2.0
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::TcpListener;
use std::path::Path;
use uuid::Uuid;

pub const DEFAULT_MCP_PORT: u16 = 38491;
#[derive(Deserialize, Serialize)]
struct Settings {
    port: u16,
}
pub fn validate_port(port: u16) -> Result<u16, String> {
    if port < 1024 {
        Err("mcp_port_invalid".into())
    } else {
        Ok(port)
    }
}
pub fn load_port(dir: &Path) -> Result<u16, String> {
    let path = dir.join("mcp-settings.json");
    let data = match std::fs::read(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(DEFAULT_MCP_PORT),
        Err(_) => return Err("mcp_port_settings_unreadable".into()),
    };
    let settings: Settings =
        serde_json::from_slice(&data).map_err(|_| "mcp_port_settings_invalid".to_string())?;
    validate_port(settings.port)
}
pub fn save_port(dir: &Path, port: u16) -> Result<(), String> {
    validate_port(port)?;
    let temporary = dir.join(format!("mcp-settings-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(format!("{{\"port\":{port}}}\n").as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temporary, dir.join("mcp-settings.json"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result.map_err(|_: std::io::Error| "mcp_port_settings_save_failed".into())
}
pub fn check_available(port: u16) -> Result<(), String> {
    validate_port(port)?;
    TcpListener::bind(("127.0.0.1", port))
        .map(|_| ())
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                "mcp_port_in_use"
            } else {
                "mcp_port_unavailable"
            }
            .into()
        })
}

pub fn load_or_create_token(dir: &Path) -> Result<String, String> {
    match std::fs::read_to_string(dir.join("mcp-token")) {
        Ok(token) => {
            let token = token.trim();
            if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("mcp_token_settings_invalid".into());
            }
            Ok(token.to_string())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let token = new_token();
            save_token(dir, &token)?;
            Ok(token)
        }
        Err(_) => Err("mcp_token_settings_unreadable".into()),
    }
}
pub fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}
pub fn save_token(dir: &Path, token: &str) -> Result<(), String> {
    let temporary = dir.join(format!("mcp-token-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(token.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temporary, dir.join("mcp-token"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result.map_err(|_: std::io::Error| "mcp_token_settings_save_failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_port_across_loads_and_rejects_invalid_updates() {
        let dir = std::env::temp_dir().join(format!("lumi-port-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(load_port(&dir).unwrap(), DEFAULT_MCP_PORT);
        save_port(&dir, 38492).unwrap();
        assert_eq!(load_port(&dir).unwrap(), 38492);
        assert!(save_port(&dir, 0).is_err());
        assert_eq!(load_port(&dir).unwrap(), 38492);
        save_port(&dir, DEFAULT_MCP_PORT).unwrap();
        assert_eq!(load_port(&dir).unwrap(), DEFAULT_MCP_PORT);
        let first_token = load_or_create_token(&dir).unwrap();
        assert_eq!(load_or_create_token(&dir).unwrap(), first_token);
        let next = new_token();
        save_token(&dir, &next).unwrap();
        assert_ne!(next, first_token);
        assert_eq!(load_or_create_token(&dir).unwrap(), next);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(dir.join("mcp-token"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn reports_occupied_port_without_picking_another() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_eq!(check_available(port), Err("mcp_port_in_use".into()));
        drop(listener);
        assert!(check_available(port).is_ok());
        assert!(validate_port(1023).is_err());
        assert!(validate_port(1024).is_ok());
        assert!(validate_port(65535).is_ok());
    }
}
