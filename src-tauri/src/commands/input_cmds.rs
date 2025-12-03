use enigo::{Enigo, Keyboard, Settings, Key, Direction};
use std::thread;
use std::time::Duration;
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Simulates pasting text into the currently focused application.
/// This command:
/// 1. Copies the given text to the clipboard
/// 2. Waits briefly for clipboard to be ready
/// 3. Simulates Ctrl+V (or Cmd+V on macOS) to paste
#[tauri::command]
pub async fn paste_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    // Copy text to clipboard using Tauri plugin
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;

    // Simulate paste keystroke in a blocking task
    tauri::async_runtime::spawn_blocking(move || {
        // Brief delay to ensure clipboard is ready
        thread::sleep(Duration::from_millis(100));

        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("Failed to create Enigo instance: {}", e))?;

        // Simulate Ctrl+V (Windows/Linux) or Cmd+V (macOS)
        #[cfg(target_os = "macos")]
        {
            enigo.key(Key::Meta, Direction::Press)
                .map_err(|e| format!("Failed to press Meta: {}", e))?;
            enigo.key(Key::Unicode('v'), Direction::Click)
                .map_err(|e| format!("Failed to press V: {}", e))?;
            enigo.key(Key::Meta, Direction::Release)
                .map_err(|e| format!("Failed to release Meta: {}", e))?;
        }

        #[cfg(not(target_os = "macos"))]
        {
            enigo.key(Key::Control, Direction::Press)
                .map_err(|e| format!("Failed to press Ctrl: {}", e))?;
            enigo.key(Key::Unicode('v'), Direction::Click)
                .map_err(|e| format!("Failed to press V: {}", e))?;
            enigo.key(Key::Control, Direction::Release)
                .map_err(|e| format!("Failed to release Ctrl: {}", e))?;
        }

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(())
}
