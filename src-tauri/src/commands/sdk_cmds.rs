use crate::sidecar::{OutboundMessage, SidecarManager};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn start_sidecar(
    app: AppHandle,
    sidecar: State<Arc<SidecarManager>>,
) -> Result<(), String> {
    sidecar.start(app)
}

#[tauri::command]
pub fn create_sdk_session(
    sidecar: State<Arc<SidecarManager>>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    if !sidecar.is_started() {
        return Err("Sidecar not started. Call start_sidecar first.".to_string());
    }
    sidecar.send(OutboundMessage::Create { id, cwd })
}

#[tauri::command]
pub fn send_sdk_prompt(
    sidecar: State<Arc<SidecarManager>>,
    id: String,
    prompt: String,
) -> Result<(), String> {
    if !sidecar.is_started() {
        return Err("Sidecar not started".to_string());
    }
    sidecar.send(OutboundMessage::Query { id, prompt })
}

#[tauri::command]
pub fn close_sdk_session(
    sidecar: State<Arc<SidecarManager>>,
    id: String,
) -> Result<(), String> {
    if !sidecar.is_started() {
        return Err("Sidecar not started".to_string());
    }
    sidecar.send(OutboundMessage::Close { id })
}
