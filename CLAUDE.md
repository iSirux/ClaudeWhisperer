# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Whisperer is a Tauri v2 desktop application that provides a voice-controlled interface for Claude Code. Users can record voice prompts via hotkeys, which are transcribed using a Whisper API endpoint, then sent to Claude Code either through embedded terminal sessions (PTY mode) or directly via the Claude Agent SDK (SDK mode).

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

**Stores (`src/lib/stores/`):**
- `settings.ts` - App configuration (terminal mode, whisper endpoint, hotkeys, repos, theme)
- `sessions.ts` - PTY terminal session management and Tauri event listeners
- `sdkSessions.ts` - Claude SDK session management with message streaming
- `recording.ts` - Audio recording state machine using MediaRecorder API
- `overlay.ts` - Floating overlay window visibility and positioning

**Components (`src/lib/components/`):**
- `Terminal.svelte` - xterm.js terminal with WebGL rendering for PTY sessions
- `SdkView.svelte` - SDK session UI showing messages, tool calls, and streaming responses
- `ModelSelector.svelte` - Button group for selecting Claude model (Opus/Sonnet/Haiku 4.5)
- `SessionList.svelte` - Unified list of PTY and SDK sessions with status indicators
- `SessionHeader.svelte` - Active session metadata display
- `Transcript.svelte` - Last recording transcript display
- `StatusBadge.svelte` - Status indicator badge
- `Overlay.svelte` - Overlay window content

**Utilities (`src/lib/utils/`):**
- `markdown.ts` - Markdown processing utilities

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
5. `sdkSessions.sendPrompt(id, prompt)` sends prompt to sidecar
6. Sidecar runs query with Claude Agent SDK
7. Events emitted: `sdk-text-${id}`, `sdk-tool-start-${id}`, `sdk-tool-result-${id}`, `sdk-done-${id}`
8. Frontend updates store → SdkView renders streaming responses and tool calls

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

**Frontend:** SvelteKit 2.9, Svelte 5, TypeScript 5.6, xterm.js 5.5, TailwindCSS 4.1, Vite 6
**Backend:** Rust, Tauri v2, portable-pty, reqwest, parking_lot, serde
**Sidecar:** Node.js, TypeScript, @anthropic-ai/claude-agent-sdk
