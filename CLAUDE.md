# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Whisperer is a Tauri v2 desktop application that provides a voice-controlled interface for Claude Code. Users can record voice prompts via hotkeys, which are transcribed using a Whisper API endpoint, then sent to Claude Code either through embedded terminal sessions (PTY mode) or directly via the Claude Agent SDK (SDK mode). The app supports multimodal prompts (text + images), session persistence and usage tracking.

## Development Commands

```bash
# Full development - builds sidecar then runs Tauri dev
npm run tauri:dev

# Build production app (includes sidecar)
npm run tauri:build

# Type checking
npm run check

# Frontend only (without Tauri)
npm run dev

# Sidecar only
npm run sidecar:install  # Install sidecar dependencies
npm run sidecar:build    # Build the TypeScript sidecar
```

## Architecture

### Frontend (SvelteKit + Svelte 5)

**Routes:**

- `src/routes/+page.svelte` - Main application view with session list, terminal/SDK view, and transcript
- `src/routes/overlay/+page.svelte` - Floating overlay window for recording status
- `src/routes/settings/+page.svelte` - Settings modal with tabs (General, System, Audio, Whisper, Git, Hotkeys, Overlay, Repositories)
- `src/routes/usage/+page.svelte` - Usage statistics dashboard with session/token/cost analytics

**Stores (`src/lib/stores/`):**

- `settings.ts` - App configuration (terminal mode, whisper endpoint, hotkeys, repos, theme)
- `sessions.ts` - PTY terminal session management and Tauri event listeners
- `sdkSessions.ts` - Claude SDK session management with message streaming, session persistence, progressive usage tracking, and image support
- `recording.ts` - Audio recording state machine using MediaRecorder API
- `overlay.ts` - Floating overlay window visibility and positioning
- `usageStats.ts` - Persistent usage statistics tracking (sessions, tokens, costs, tools, repos, daily stats, streaks)

**Components (`src/lib/components/`):**

- `Terminal.svelte` - xterm.js terminal with WebGL rendering for PTY sessions
- `SdkView.svelte` - SDK session UI showing messages, tool calls, and streaming responses
- `ModelSelector.svelte` - Button group for selecting Claude model (Opus/Sonnet/Haiku) with model-specific colors
- `SessionList.svelte` - Unified list of PTY and SDK sessions with status indicators and unread markers
- `SessionHeader.svelte` - Active session metadata display
- `Transcript.svelte` - Last recording transcript display
- `StatusBadge.svelte` - Status indicator badge
- `Overlay.svelte` - Overlay window content
- `Start.svelte` - Welcome screen with microphone selection and Whisper connection status
- `UsagePreview.svelte` - Compact usage stats preview for main view

**SDK Components (`src/lib/components/sdk/`):**

- `SdkMessage.svelte` - Renders individual SDK messages (user prompts, text responses, tool calls, errors, subagent events)
- `SdkLoadingIndicator.svelte` - Animated loading indicator with status text
- `SdkPromptInput.svelte` - Multi-line textarea with image paste/drop support, recording button, and auto-resize
- `SdkUsageBar.svelte` - Token usage display with input/output/cache stats, cost, and context usage bar

**Utilities (`src/lib/utils/`):**

- `markdown.ts` - Markdown processing with syntax highlighting (marked + highlight.js)
- `image.ts` - Image compression and processing for Claude API (5MB limit, auto-resize, format conversion)
- `sound.ts` - Completion sound playback
- `modelColors.ts` - Model-specific color utilities (Opus=purple, Sonnet=amber, Haiku=emerald)

### Backend (Rust/Tauri)

**Core Modules (`src-tauri/src/`):**

- `lib.rs` - Tauri app initialization, plugin registration, state management
- `config.rs` - Configuration types (TerminalMode, Theme) and persistence
- `terminal.rs` - PTY management via `portable-pty`, spawns `claude` CLI
- `sidecar.rs` - SidecarManager for Node.js process IPC with Claude Agent SDK
- `whisper.rs` - HTTP client for Whisper transcription API
- `git.rs` - GitManager for repository operations (branch/worktree creation)

**Commands (`src-tauri/src/commands/`):**

- `settings_cmds.rs` - Config load/save, repo management
- `terminal_cmds.rs` - PTY session CRUD, terminal I/O, resize
- `audio_cmds.rs` - Audio transcription, Whisper connection testing
- `sdk_cmds.rs` - SDK session management, prompt sending, model updates

### Sidecar (Node.js/TypeScript)

Located in `src-tauri/sidecar/`:

- `src/index.ts` - Node.js process using `@anthropic-ai/claude-agent-sdk`
- Communicates with Rust via JSON lines over stdin/stdout
- Handles session creation, query execution, tool calls, and streaming responses
- Supports multimodal prompts (text + images via base64 content blocks)
- Session restoration with conversation history context injection
- Progressive usage tracking during streaming (input/output/cache tokens)
- Subagent lifecycle events via SDK hooks (SubagentStart/SubagentStop)
- Query interruption via `iterator.interrupt()` for proper cleanup

## Terminal Modes

The app supports three terminal modes (configured in settings):

1. **Interactive** - Opens Claude CLI in interactive mode without a pre-specified prompt
2. **Prompt** - Spawns Claude CLI with the transcribed prompt (`claude -p "<prompt>"`)
3. **SDK** - Uses Claude Agent SDK directly via the sidecar process (no CLI)

## Key Data Flow

### PTY Mode (Interactive/Prompt)

1. User presses hotkey → `recording.startRecording()` captures audio via WebRTC
2. Stop recording → audio sent to backend via `transcribe_audio` command
3. Backend posts to Whisper API → returns transcription
4. User confirms → `create_terminal_session` spawns `claude` CLI in PTY
5. PTY output streamed via `terminal-output-${sessionId}` event → rendered in xterm.js

### SDK Mode

1. User presses hotkey → `recording.startRecording()` captures audio
2. Stop recording → auto-sends if app not focused
3. `sdkSessions.createSession(cwd, model)` creates SDK session
4. Sidecar process spawned if needed, session registered
5. `sdkSessions.sendPrompt(id, prompt, images?)` sends prompt to sidecar (supports multimodal)
6. Sidecar runs query with Claude Agent SDK
7. Events emitted:
   - `sdk-text-${id}` - Text content from assistant
   - `sdk-tool-start-${id}` / `sdk-tool-result-${id}` - Tool call lifecycle
   - `sdk-progressive-usage-${id}` - Live token counts during streaming
   - `sdk-usage-${id}` - Final usage stats (tokens, cost, duration)
   - `sdk-subagent-start-${id}` / `sdk-subagent-stop-${id}` - Subagent lifecycle
   - `sdk-done-${id}` / `sdk-error-${id}` - Query completion
8. Frontend updates store → SdkView renders streaming responses, tool calls, and usage stats
9. Session state persisted → can be restored after app restart with conversation history

## Windows Configuration

Defined in `tauri.conf.json`:

- `main` - Primary application window (1200x800, decorated)
- `overlay` - Floating recording indicator (400x120, transparent, always-on-top, initially hidden)

## Configuration

App config stored in system config directory (`claude-whisperer/config.json`):

- `terminal_mode` - Interactive | Prompt | Sdk
- `theme` - Midnight | Slate | Snow | Sand
- `whisper` - Transcription endpoint, model, language
- `hotkeys` - Global shortcuts (toggle recording, send prompt, switch repo, transcribe to input)
- `repos` - List of git repositories with paths and optional default models
- `audio` - Recording device, hotkey toggle, sound settings
- `git` - Branch/worktree creation settings
- `overlay` - Position and visibility settings
- `system` - Tray behavior, autostart settings

## Key Technologies

**Frontend:** SvelteKit 2.9, Svelte 5, TypeScript 5.6, xterm.js 5.5, TailwindCSS 4.1, Vite 6, marked + highlight.js
**Backend:** Rust, Tauri v2, portable-pty, reqwest, parking_lot, serde
**Sidecar:** Node.js, TypeScript, @anthropic-ai/claude-agent-sdk

## SDK Session Features

- **Session Persistence:** SDK sessions are persisted and can be restored after app restart
- **Conversation History:** Restored sessions inject previous conversation as context for continuity
- **Multimodal Prompts:** Paste or drag-drop images (auto-compressed to 5MB limit for Claude API)
- **Progressive Usage:** Live token counts update during streaming before final usage event
- **Subagent Tracking:** Visual indicators when Claude spawns subagents (Task tool)
- **Per-Session Models:** Each session tracks its own model selection independently
- **Duration Tracking:** Timer-based work duration that survives session restore
- **Unread Markers:** Sessions marked as unread when completed while not viewing
