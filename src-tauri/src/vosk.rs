use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoskConnectionTestResult {
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VoskResponse {
    Partial { partial: String },
    Final { text: String },
}

#[derive(Debug, Serialize)]
struct VoskConfigMessage {
    config: VoskConfigInner,
}

#[derive(Debug, Serialize)]
struct VoskConfigInner {
    sample_rate: u32,
}

#[derive(Debug, Serialize)]
struct VoskEofMessage {
    eof: u8,
}

pub struct VoskClient {
    endpoint: String,
    sample_rate: u32,
}

impl VoskClient {
    pub fn new(endpoint: String, sample_rate: u32) -> Self {
        Self {
            endpoint,
            sample_rate,
        }
    }

    pub async fn test_connection(&self) -> VoskConnectionTestResult {
        match connect_async(&self.endpoint).await {
            Ok((mut ws, _)) => {
                // Send config message
                let config_msg = VoskConfigMessage {
                    config: VoskConfigInner {
                        sample_rate: self.sample_rate,
                    },
                };
                let config_json = serde_json::to_string(&config_msg).unwrap();

                if let Err(e) = ws.send(Message::Text(config_json.into())).await {
                    return VoskConnectionTestResult {
                        connected: false,
                        error: Some(format!("Failed to send config: {}", e)),
                    };
                }

                // Send EOF to close cleanly
                let eof_msg = serde_json::to_string(&VoskEofMessage { eof: 1 }).unwrap();
                let _ = ws.send(Message::Text(eof_msg.into())).await;
                let _ = ws.close(None).await;

                VoskConnectionTestResult {
                    connected: true,
                    error: None,
                }
            }
            Err(e) => VoskConnectionTestResult {
                connected: false,
                error: Some(format!("Connection failed: {}", e)),
            },
        }
    }
}

pub struct VoskSession {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    configured: bool,
    sample_rate: u32,
}

impl VoskSession {
    pub async fn new(endpoint: &str, sample_rate: u32) -> Result<Self, String> {
        let (socket, _) = connect_async(endpoint)
            .await
            .map_err(|e| format!("Failed to connect to Vosk server: {}", e))?;

        Ok(Self {
            socket,
            configured: false,
            sample_rate,
        })
    }

    async fn ensure_configured(&mut self) -> Result<(), String> {
        if !self.configured {
            let config_msg = VoskConfigMessage {
                config: VoskConfigInner {
                    sample_rate: self.sample_rate,
                },
            };
            let config_json = serde_json::to_string(&config_msg)
                .map_err(|e| format!("Failed to serialize config: {}", e))?;

            self.socket
                .send(Message::Text(config_json.into()))
                .await
                .map_err(|e| format!("Failed to send config: {}", e))?;

            self.configured = true;
        }
        Ok(())
    }

    /// Send audio samples (PCM i16) to Vosk
    pub async fn send_audio(&mut self, samples: &[i16]) -> Result<(), String> {
        self.ensure_configured().await?;

        // Convert i16 samples to bytes (little-endian)
        let bytes: Vec<u8> = samples
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();

        self.socket
            .send(Message::Binary(bytes.into()))
            .await
            .map_err(|e| format!("Failed to send audio: {}", e))
    }

    /// Receive the next result from Vosk (partial or final)
    pub async fn recv(&mut self) -> Result<Option<VoskResponse>, String> {
        match self.socket.next().await {
            Some(Ok(Message::Text(text))) => {
                let response: VoskResponse = serde_json::from_str(&text)
                    .map_err(|e| format!("Failed to parse Vosk response: {}", e))?;
                Ok(Some(response))
            }
            Some(Ok(Message::Close(_))) => Ok(None),
            Some(Ok(_)) => Ok(None), // Ignore other message types
            Some(Err(e)) => Err(format!("WebSocket error: {}", e)),
            None => Ok(None),
        }
    }

    /// Try to receive without blocking (returns immediately if no message)
    pub async fn try_recv(&mut self) -> Result<Option<VoskResponse>, String> {
        use tokio::time::{timeout, Duration};

        match timeout(Duration::from_millis(10), self.socket.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let response: VoskResponse = serde_json::from_str(&text)
                    .map_err(|e| format!("Failed to parse Vosk response: {}", e))?;
                Ok(Some(response))
            }
            Ok(Some(Ok(Message::Close(_)))) => Ok(None),
            Ok(Some(Ok(_))) => Ok(None),
            Ok(Some(Err(e))) => Err(format!("WebSocket error: {}", e)),
            Ok(None) => Ok(None),
            Err(_) => Ok(None), // Timeout - no message available
        }
    }

    /// Signal end of stream and get final result
    pub async fn finalize(&mut self) -> Result<String, String> {
        let eof_msg = serde_json::to_string(&VoskEofMessage { eof: 1 })
            .map_err(|e| format!("Failed to serialize EOF: {}", e))?;

        self.socket
            .send(Message::Text(eof_msg.into()))
            .await
            .map_err(|e| format!("Failed to send EOF: {}", e))?;

        // Wait for final result
        loop {
            match self.recv().await? {
                Some(VoskResponse::Final { text }) => {
                    let _ = self.socket.close(None).await;
                    return Ok(text);
                }
                Some(VoskResponse::Partial { .. }) => continue,
                None => {
                    let _ = self.socket.close(None).await;
                    return Ok(String::new());
                }
            }
        }
    }

    /// Close the session
    pub async fn close(&mut self) -> Result<(), String> {
        self.socket
            .close(None)
            .await
            .map_err(|e| format!("Failed to close WebSocket: {}", e))
    }
}

/// Manages active Vosk streaming sessions
pub struct VoskManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<VoskSession>>>>>,
}

impl VoskManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn create_session(
        &self,
        session_id: String,
        endpoint: &str,
        sample_rate: u32,
    ) -> Result<(), String> {
        let session = VoskSession::new(endpoint, sample_rate).await?;
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session_id, Arc::new(Mutex::new(session)));
        Ok(())
    }

    pub async fn get_session(
        &self,
        session_id: &str,
    ) -> Option<Arc<Mutex<VoskSession>>> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).cloned()
    }

    pub async fn remove_session(&self, session_id: &str) -> Option<Arc<Mutex<VoskSession>>> {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(session_id)
    }

    pub async fn close_session(&self, session_id: &str) -> Result<String, String> {
        if let Some(session) = self.remove_session(session_id).await {
            let mut session = session.lock().await;
            session.finalize().await
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }
}

impl Default for VoskManager {
    fn default() -> Self {
        Self::new()
    }
}
