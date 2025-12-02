# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Whisperer is a Tauri v2 desktop application that provides a voice-controlled interface for Claude Code. Users can record voice prompts via hotkeys, which are transcribed using a Whisper API endpoint, then sent to Claude Code running in embedded terminal sessions.

## Development Commands

```bash
# Development - runs both frontend and Tauri
npm run tauri dev
# or
pnpm tauri dev

# Build production app
npm run tauri build

# Type checking
npm run check

# Frontend only (without Tauri)
npm run dev
```

## Architecture

### Frontend (SvelteKit + Svelte 5)

- `src/routes/+page.svelte` - Main application view with session list, terminal, and transcript
- `src/routes/overlay/+page.svelte` - Floating overlay window for recording status
- `src/routes/settings/+page.svelte` - Settings modal
- `src/lib/stores/` - Svelte stores for state management:
  - `settings.ts` - App configuration (whisper endpoint, hotkeys, repos, etc.)
  - `sessions.ts` - Terminal session management and Tauri event listeners
  - `recording.ts` - Audio recording state machine using MediaRecorder API
- `src/lib/components/Terminal.svelte` - xterm.js terminal with WebGL rendering

### Backend (Rust/Tauri)

- `src-tauri/src/lib.rs` - Tauri app initialization and plugin registration
- `src-tauri/src/terminal.rs` - PTY management via `portable-pty`, spawns `claude` CLI with prompts
- `src-tauri/src/whisper.rs` - HTTP client for Whisper transcription API
- `src-tauri/src/config.rs` - Configuration types and persistence (JSON in config dir)
- `src-tauri/src/commands/` - Tauri command handlers exposed to frontend

### Key Data Flow

1. User presses hotkey → `recording.startRecording()` captures audio via WebRTC
2. Stop recording → audio sent to backend via `transcribe_audio` command
3. Backend posts to Whisper API endpoint → returns transcript
4. User confirms → `create_terminal_session` spawns `claude --dangerously-skip-permissions -p "<prompt>"` in PTY
5. PTY output streamed to frontend via Tauri events → rendered in xterm.js

### Windows Configuration

The app has two windows defined in `tauri.conf.json`:

- `main` - Primary application window (1200x800, decorated)
- `overlay` - Floating recording indicator (400x120, transparent, always-on-top, initially hidden)

## Configuration

App config stored in system config directory (`claude-whisperer/config.json`). Key sections:

- `whisper` - Transcription endpoint, model, language
- `hotkeys` - Global shortcuts (toggle recording, send prompt, switch repo)
- `repos` - List of git repositories to work with
- `audio` - Recording device, open mic mode, voice commands
