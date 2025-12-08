use crate::config::AppConfig;
use crate::vosk::{VoskClient, VoskConnectionTestResult, VoskManager, VoskResponse};
use parking_lot::Mutex as ParkingLotMutex;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub type ConfigState = ParkingLotMutex<AppConfig>;

#[tauri::command]
pub async fn test_vosk_connection(
    config: State<'_, ConfigState>,
) -> Result<VoskConnectionTestResult, String> {
    let cfg = config.lock().clone();

    if !cfg.vosk.enabled {
        return Ok(VoskConnectionTestResult {
            connected: false,
            error: Some("Vosk is not enabled".to_string()),
        });
    }

    let client = VoskClient::new(cfg.vosk.endpoint.clone(), cfg.vosk.sample_rate);
    Ok(client.test_connection().await)
}

#[tauri::command]
pub async fn start_vosk_session(
    app: AppHandle,
    config: State<'_, ConfigState>,
    vosk_manager: State<'_, Arc<VoskManager>>,
    session_id: String,
) -> Result<(), String> {
    let cfg = config.lock().clone();

    if !cfg.vosk.enabled {
        return Err("Vosk is not enabled".to_string());
    }

    // Close any existing session with this ID first to prevent duplicate polling tasks
    // This also ensures the old polling task will exit on next iteration
    if let Some(old_session) = vosk_manager.remove_session(&session_id).await {
        // Try to close the old session gracefully
        if let Ok(mut session) = old_session.try_lock() {
            let _ = session.close().await;
        }
    }

    vosk_manager
        .create_session(session_id.clone(), &cfg.vosk.endpoint, cfg.vosk.sample_rate)
        .await?;

    // Clone the Arc<VoskManager> for the spawned task
    // Note: State<'_, Arc<VoskManager>> derefs to Arc<VoskManager>, so we clone the Arc
    let manager = Arc::clone(&*vosk_manager);
    let session_id_clone = session_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        // Add a small initial delay to ensure session is fully registered
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        let mut consecutive_errors = 0;
        const MAX_CONSECUTIVE_ERRORS: u32 = 5;

        loop {
            // Check if session still exists - this is the primary exit condition
            let session = match manager.get_session(&session_id_clone).await {
                Some(s) => s,
                None => {
                    // Session was removed, exit cleanly
                    break;
                }
            };

            let result = {
                // Use try_lock to avoid blocking if session is being closed
                match session.try_lock() {
                    Ok(mut session_guard) => session_guard.try_recv().await,
                    Err(_) => {
                        // Session is locked (probably being closed), wait and retry
                        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                        continue;
                    }
                }
            };

            match result {
                Ok(Some(VoskResponse::Partial { partial })) => {
                    consecutive_errors = 0;
                    let _ = app_clone.emit(
                        &format!("vosk-partial-{}", session_id_clone),
                        serde_json::json!({ "partial": partial }),
                    );
                }
                Ok(Some(VoskResponse::Final { text })) => {
                    consecutive_errors = 0;
                    let _ = app_clone.emit(
                        &format!("vosk-final-{}", session_id_clone),
                        serde_json::json!({ "text": text }),
                    );
                }
                Ok(None) => {
                    // No message available, continue polling with backoff
                    consecutive_errors = 0;
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                }
                Err(e) => {
                    consecutive_errors += 1;
                    let _ = app_clone.emit(
                        &format!("vosk-error-{}", session_id_clone),
                        serde_json::json!({ "error": e }),
                    );

                    // Exit after too many consecutive errors to prevent infinite error loops
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        break;
                    }

                    // Small delay before retrying on error
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn send_vosk_audio(
    vosk_manager: State<'_, Arc<VoskManager>>,
    session_id: String,
    samples: Vec<i16>,
) -> Result<(), String> {
    let session = vosk_manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Vosk session {} not found", session_id))?;

    let mut session_guard = session.lock().await;
    session_guard.send_audio(&samples).await
}

#[tauri::command]
pub async fn stop_vosk_session(
    app: AppHandle,
    vosk_manager: State<'_, Arc<VoskManager>>,
    session_id: String,
) -> Result<String, String> {
    let final_text = vosk_manager.close_session(&session_id).await?;

    // Emit final result
    let _ = app.emit(
        &format!("vosk-final-{}", session_id),
        serde_json::json!({ "text": final_text }),
    );

    Ok(final_text)
}
