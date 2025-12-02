use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OutboundMessage {
    Create {
        id: String,
        cwd: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    Query {
        id: String,
        prompt: String,
    },
    Stop {
        id: String,
    },
    Close {
        id: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InboundMessage {
    Ready,
    Created {
        id: String,
    },
    Text {
        id: String,
        content: String,
    },
    ToolStart {
        id: String,
        tool: String,
        input: serde_json::Value,
    },
    ToolResult {
        id: String,
        tool: String,
        output: String,
    },
    Done {
        id: String,
    },
    Closed {
        id: String,
    },
    Error {
        id: String,
        message: String,
    },
    Debug {
        id: String,
        message: String,
    },
}

pub struct SidecarManager {
    process: Arc<Mutex<Option<Child>>>,
    stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    started: Arc<Mutex<bool>>,
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            stdin: Arc::new(Mutex::new(None)),
            started: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        // Check if already started
        {
            let started = self.started.lock();
            if *started {
                return Ok(());
            }
        }

        // Try multiple possible sidecar locations
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Failed to get exe path: {}", e))?
            .parent()
            .ok_or("Failed to get exe directory")?
            .to_path_buf();

        let cwd = std::env::current_dir()
            .map_err(|e| format!("Failed to get cwd: {}", e))?;

        // Get resource directory for bundled release
        let resource_dir = app.path().resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?;

        // Possible paths (in order of priority):
        // 1. <resource_dir>/dist/index.js (bundled release - "sidecar/dist/" becomes "dist/")
        // 2. <resource_dir>/sidecar/dist/index.js (bundled release alternate)
        // 3. <cwd>/sidecar/dist/index.js (when cwd is src-tauri during dev)
        // 4. <cwd>/src-tauri/sidecar/dist/index.js (when cwd is project root)
        // 5. <exe_dir>/sidecar/dist/index.js (fallback)
        let possible_paths = [
            resource_dir.join("dist").join("index.js"),
            resource_dir.join("sidecar").join("dist").join("index.js"),
            cwd.join("sidecar").join("dist").join("index.js"),
            cwd.join("src-tauri").join("sidecar").join("dist").join("index.js"),
            exe_dir.join("sidecar").join("dist").join("index.js"),
        ];

        let path = possible_paths
            .iter()
            .find(|p| {
                println!("[sidecar] Checking path: {:?} exists={}", p, p.exists());
                p.exists()
            })
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Sidecar not found. Tried:\n{}",
                    possible_paths
                        .iter()
                        .map(|p| format!("  - {:?}", p))
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            })?;

        // Convert to string and strip Windows extended path prefix if present
        let path_str = path.to_string_lossy().to_string();
        let path_str = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_string();

        println!("[sidecar] Using sidecar at: {}", path_str);

        // Get the sidecar base directory (contains dist/ and node_modules/)
        let sidecar_base = std::path::Path::new(&path_str)
            .parent() // dist/
            .and_then(|p| p.parent()) // sidecar/
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());

        println!("[sidecar] Sidecar base directory: {}", sidecar_base);

        let mut child = Command::new("node")
            .arg(&path_str)
            .current_dir(&sidecar_base)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to get stdout")?;
        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to get stdin")?;
        let stderr = child.stderr.take();

        *self.stdin.lock() = Some(stdin);
        *self.process.lock() = Some(child);
        *self.started.lock() = true;

        // Spawn stderr reader thread
        if let Some(stderr) = stderr {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        eprintln!("[sidecar stderr] {}", line);
                    }
                }
            });
        }

        // Spawn stdout reader thread
        let app_clone = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    match serde_json::from_str::<InboundMessage>(&line) {
                        Ok(msg) => {
                            Self::handle_message(&app_clone, msg);
                        }
                        Err(e) => {
                            eprintln!("[sidecar] Failed to parse message: {} - {}", e, line);
                        }
                    }
                }
            }
            eprintln!("[sidecar] Reader thread exited");
        });

        Ok(())
    }

    fn handle_message(app: &AppHandle, msg: InboundMessage) {
        match msg {
            InboundMessage::Ready => {
                println!("[sidecar] Ready");
            }
            InboundMessage::Created { id } => {
                println!("[sidecar] Emitting sdk-created-{}", id);
                let _ = app.emit(&format!("sdk-created-{}", id), ());
            }
            InboundMessage::Text { id, ref content } => {
                println!("[sidecar] Emitting sdk-text-{} with {} bytes", id, content.len());
                let result = app.emit(&format!("sdk-text-{}", id), content);
                if let Err(e) = result {
                    eprintln!("[sidecar] Failed to emit text event: {}", e);
                }
            }
            InboundMessage::ToolStart { id, tool, input } => {
                let _ = app.emit(
                    &format!("sdk-tool-start-{}", id),
                    serde_json::json!({ "tool": tool, "input": input }),
                );
            }
            InboundMessage::ToolResult { id, tool, output } => {
                let _ = app.emit(
                    &format!("sdk-tool-result-{}", id),
                    serde_json::json!({ "tool": tool, "output": output }),
                );
            }
            InboundMessage::Done { id } => {
                println!("[sidecar] Emitting sdk-done-{}", id);
                let result = app.emit(&format!("sdk-done-{}", id), ());
                if let Err(e) = result {
                    eprintln!("[sidecar] Failed to emit done event: {}", e);
                }
            }
            InboundMessage::Closed { id } => {
                let _ = app.emit(&format!("sdk-closed-{}", id), ());
            }
            InboundMessage::Error { id, message } => {
                let _ = app.emit(&format!("sdk-error-{}", id), &message);
            }
            InboundMessage::Debug { id, message } => {
                println!("[sidecar debug][{}] {}", id, message);
            }
        }
    }

    pub fn send(&self, msg: OutboundMessage) -> Result<(), String> {
        let mut stdin = self.stdin.lock();
        if let Some(ref mut stdin) = *stdin {
            let json =
                serde_json::to_string(&msg).map_err(|e| format!("Serialize error: {}", e))?;
            writeln!(stdin, "{}", json).map_err(|e| format!("Write error: {}", e))?;
            stdin.flush().map_err(|e| format!("Flush error: {}", e))?;
            Ok(())
        } else {
            Err("Sidecar not started".to_string())
        }
    }

    pub fn is_started(&self) -> bool {
        *self.started.lock()
    }
}
