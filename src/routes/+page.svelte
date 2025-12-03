<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import SdkView from '$lib/components/SdkView.svelte';
  import SessionList from '$lib/components/SessionList.svelte';
  import SessionHeader from '$lib/components/SessionHeader.svelte';
  import Settings from './settings/+page.svelte';
  import Start from '$lib/components/Start.svelte';
  import ModelSelector from '$lib/components/ModelSelector.svelte';
  import UsagePreview from '$lib/components/UsagePreview.svelte';
  import { sessions, activeSessionId, activeSession } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId, activeSdkSession } from '$lib/stores/sdkSessions';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { recording, isRecording } from '$lib/stores/recording';
  import { overlay } from '$lib/stores/overlay';
  import { loadSessionsFromDisk, saveSessionsToDisk, setupAutoSave, setupPeriodicAutoSave } from '$lib/stores/sessionPersistence';
  import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { get } from 'svelte/store';

  // System prompt for voice-transcribed sessions
  const VOICE_TRANSCRIPTION_SYSTEM_PROMPT =
    "The user's prompt was recorded via voice and transcribed using speech-to-text. " +
    "There may be minor transcription errors such as homophones, missing punctuation, or misheard words. " +
    "Please interpret the intent behind the request even if there are small errors in the transcription.";

  // Sidebar resize state
  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 600;
  const DEFAULT_SIDEBAR_WIDTH = 256;
  let sidebarWidth = $state(DEFAULT_SIDEBAR_WIDTH);
  let isResizing = $state(false);
  let sidebarWidthInitialized = false;

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResize(e: MouseEvent) {
    if (!isResizing) return;
    const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
    sidebarWidth = newWidth;
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Save the sidebar width to settings
    if (sidebarWidthInitialized) {
      settings.update(s => ({ ...s, sidebar_width: sidebarWidth }));
      settings.save($settings);
    }
  }

  // Flag to track if we're recording for a new session (header button)
  let isRecordingForNewSession = $state(false);

  let currentView = $state<'sessions' | 'settings' | 'start'>('start');
  let showRepoSelector = $state(false);
  let isTogglingRecording = false;
  let wasAppFocusedOnRecordStart = true;
  let transcribeHotkeyRegistered = false;
  let cycleRepoHotkeyRegistered = false;
  let cycleModelHotkeyRegistered = false;
  // Store the hotkey strings we registered with, so we can unregister them properly
  let registeredCycleRepoHotkey: string | null = null;
  let registeredCycleModelHotkey: string | null = null;
  let settingsInitialTab = $state('general');
  let cleanupAutoSave: (() => void) | null = null;
  let cleanupPeriodicSave: (() => void) | null = null;

  // Model cycling order (must match model IDs in ModelSelector.svelte)
  const MODEL_CYCLE = [
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001'
  ];

  function handleOpenSettings(event: CustomEvent<{ tab: string }>) {
    settingsInitialTab = event.detail.tab;
    showSettingsView();
  }

  // Load sidebar width from settings after they're loaded
  $effect(() => {
    if (!sidebarWidthInitialized && $settings.sidebar_width) {
      const savedWidth = $settings.sidebar_width;
      if (savedWidth >= MIN_SIDEBAR_WIDTH && savedWidth <= MAX_SIDEBAR_WIDTH) {
        sidebarWidth = savedWidth;
      }
      sidebarWidthInitialized = true;
    }
  });

  onMount(async () => {
    await settings.load();

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', $settings.theme);

    await sessions.load();
    sessions.setupListeners();

    // Load persisted sessions if enabled
    if ($settings.session_persistence.enabled) {
      await loadSessionsFromDisk();
    }

    // Setup auto-save for session persistence
    cleanupAutoSave = setupAutoSave();
    cleanupPeriodicSave = setupPeriodicAutoSave();

    await setupHotkeys();

    // Listen for session selection from SessionList
    window.addEventListener('switch-to-sessions', showSessionsView);
    // Listen for open-settings events from Start component
    window.addEventListener('open-settings', handleOpenSettings as EventListener);
  });

  onDestroy(() => {
    window.removeEventListener('switch-to-sessions', showSessionsView);
    window.removeEventListener('open-settings', handleOpenSettings as EventListener);

    // Cleanup auto-save handlers
    if (cleanupAutoSave) cleanupAutoSave();
    if (cleanupPeriodicSave) cleanupPeriodicSave();

    // Save sessions one final time on destroy
    saveSessionsToDisk();
  });

  async function sendTranscript() {
    if (!$recording.transcript) return;

    if ($settings.terminal_mode === 'Sdk') {
      // SDK mode: always create a new SDK session and send prompt
      const repoPath = $activeRepo?.path || '.';
      const model = $settings.default_model;

      // Always create a new session for each recording, optionally with voice transcription context
      const systemPrompt = $settings.audio.include_transcription_notice ? VOICE_TRANSCRIPTION_SYSTEM_PROMPT : undefined;
      const sessionId = await sdkSessions.createSession(repoPath, model, systemPrompt);
      activeSdkSessionId.set(sessionId);

      // Send the prompt to the new SDK session
      await sdkSessions.sendPrompt(sessionId, $recording.transcript);
      activeSessionId.set(null); // Clear PTY session selection
    } else {
      // PTY mode: create terminal session as before
      const sessionId = await sessions.createSession($recording.transcript);
      activeSessionId.set(sessionId);
      activeSdkSessionId.set(null); // Clear SDK session selection
    }
    recording.clearTranscript();
  }

  // Register the transcribe-to-input hotkey (only while recording/overlay is open)
  async function registerTranscribeHotkey() {
    if (transcribeHotkeyRegistered) return;
    try {
      await register($settings.hotkeys.transcribe_to_input, async () => {
        // Only works while recording
        if (!$isRecording) return;
        if (isTogglingRecording) return;
        isTogglingRecording = true;

        try {
          // Stop recording and paste
          await unregisterTranscribeHotkey();
          await overlay.hide();
          overlay.clearSessionInfo();

          const transcript = await recording.stopRecording(true);

          if (transcript) {
            // Paste the transcript into the currently focused app
            await invoke('paste_text', { text: transcript });
          }
        } finally {
          setTimeout(() => {
            isTogglingRecording = false;
          }, 200);
        }
      });
      transcribeHotkeyRegistered = true;
    } catch (error) {
      console.error('Failed to register transcribe hotkey:', error);
    }
  }

  // Unregister the transcribe-to-input hotkey (when overlay closes)
  async function unregisterTranscribeHotkey() {
    if (!transcribeHotkeyRegistered) return;
    try {
      await unregister($settings.hotkeys.transcribe_to_input);
      transcribeHotkeyRegistered = false;
    } catch (error) {
      console.error('Failed to unregister transcribe hotkey:', error);
    }
  }

  // Debounce flags for hotkeys that shouldn't repeat when held
  let isCyclingRepo = false;
  let isCyclingModel = false;

  // Register the cycle-repo hotkey (only while recording/overlay is open)
  async function registerCycleRepoHotkey() {
    if (cycleRepoHotkeyRegistered) {
      console.log('[Hotkey] Cycle repo hotkey already registered, skipping');
      return;
    }
    const currentSettings = get(settings);
    if (currentSettings.repos.length <= 1) {
      console.log('[Hotkey] Only', currentSettings.repos.length, 'repo(s) configured, skipping cycle repo hotkey');
      return;
    }

    const hotkeyString = currentSettings.hotkeys.cycle_repo;
    console.log('[Hotkey] Registering cycle repo hotkey:', hotkeyString);
    try {
      await register(hotkeyString, async () => {
        console.log('[Hotkey] Cycle repo hotkey pressed!');
        // Debounce to prevent rapid firing when key is held
        if (isCyclingRepo) {
          console.log('[Hotkey] Debouncing cycle repo');
          return;
        }
        isCyclingRepo = true;

        try {
          // Only works while recording
          if (!get(isRecording)) {
            console.log('[Hotkey] Not recording, ignoring cycle repo');
            return;
          }

          const s = get(settings);
          console.log('[Hotkey] Cycling repo from index', s.active_repo_index, 'to', (s.active_repo_index + 1) % s.repos.length);

          // Cycle to next repo
          const nextIndex = (s.active_repo_index + 1) % s.repos.length;
          await settings.setActiveRepo(nextIndex);

          // Update overlay with new repo info
          const newRepo = s.repos[nextIndex];
          if (newRepo) {
            let branch: string | null = null;
            try {
              branch = await invoke<string>('get_git_branch', { repoPath: newRepo.path });
            } catch (e) {
              console.error('Failed to get git branch:', e);
            }
            overlay.setSessionInfo(branch, get(settings).default_model, false);
          }
        } finally {
          setTimeout(() => {
            isCyclingRepo = false;
          }, 200);
        }
      });
      registeredCycleRepoHotkey = hotkeyString;
      cycleRepoHotkeyRegistered = true;
      console.log('[Hotkey] Successfully registered cycle repo hotkey:', hotkeyString);
    } catch (error) {
      console.error('Failed to register cycle repo hotkey:', error);
    }
  }

  // Unregister the cycle-repo hotkey (when overlay closes)
  async function unregisterCycleRepoHotkey() {
    if (!cycleRepoHotkeyRegistered || !registeredCycleRepoHotkey) return;
    try {
      await unregister(registeredCycleRepoHotkey);
      console.log('[Hotkey] Unregistered cycle repo hotkey:', registeredCycleRepoHotkey);
      cycleRepoHotkeyRegistered = false;
      registeredCycleRepoHotkey = null;
    } catch (error) {
      console.error('Failed to unregister cycle repo hotkey:', error);
    }
  }

  // Register the cycle-model hotkey (only while recording/overlay is open)
  async function registerCycleModelHotkey() {
    if (cycleModelHotkeyRegistered) return;

    const hotkeyString = get(settings).hotkeys.cycle_model;
    try {
      await register(hotkeyString, async () => {
        // Debounce to prevent rapid firing when key is held
        if (isCyclingModel) return;
        isCyclingModel = true;

        try {
          // Only works while recording
          if (!get(isRecording)) return;

          const currentSettings = get(settings);
          const currentOverlay = get(overlay);

          // Find current model index and cycle to next
          const currentIndex = MODEL_CYCLE.indexOf(currentSettings.default_model);
          const nextIndex = (currentIndex + 1) % MODEL_CYCLE.length;
          const nextModel = MODEL_CYCLE[nextIndex];

          // Update the default model
          settings.update(s => ({ ...s, default_model: nextModel }));
          await settings.save({ ...currentSettings, default_model: nextModel });

          // Update overlay with new model
          overlay.setSessionInfo(currentOverlay.sessionInfo.branch, nextModel, false);
        } finally {
          setTimeout(() => {
            isCyclingModel = false;
          }, 200);
        }
      });
      registeredCycleModelHotkey = hotkeyString;
      cycleModelHotkeyRegistered = true;
      console.log('[Hotkey] Registered cycle model hotkey:', hotkeyString);
    } catch (error) {
      console.error('Failed to register cycle model hotkey:', error);
    }
  }

  // Unregister the cycle-model hotkey (when overlay closes)
  async function unregisterCycleModelHotkey() {
    if (!cycleModelHotkeyRegistered || !registeredCycleModelHotkey) return;
    try {
      await unregister(registeredCycleModelHotkey);
      console.log('[Hotkey] Unregistered cycle model hotkey:', registeredCycleModelHotkey);
      cycleModelHotkeyRegistered = false;
      registeredCycleModelHotkey = null;
    } catch (error) {
      console.error('Failed to unregister cycle model hotkey:', error);
    }
  }

  async function setupHotkeys() {
    try {
      console.log('[Hotkey] Unregistering all hotkeys...');
      await unregisterAll();
      transcribeHotkeyRegistered = false;
      cycleRepoHotkeyRegistered = false;
      cycleModelHotkeyRegistered = false;
      registeredCycleRepoHotkey = null;
      registeredCycleModelHotkey = null;
      console.log('[Hotkey] All hotkeys unregistered, registering toggle_recording...');

      // Start Recording / Send hotkey
      // - If not recording: starts recording
      // - If recording: stops, transcribes, and sends to Claude
      await register($settings.hotkeys.toggle_recording, async () => {
        // Prevent multiple rapid fires
        if (isTogglingRecording) return;
        isTogglingRecording = true;

        try {
          if ($isRecording) {
            // Unregister hotkeys so they pass through to other apps
            await unregisterTranscribeHotkey();
            await unregisterCycleRepoHotkey();
            await unregisterCycleModelHotkey();
            // Hide overlay immediately before processing starts
            await overlay.hide();
            overlay.clearSessionInfo();
            await recording.stopRecording();

            // Auto-send transcript to create a new session
            if ($recording.transcript) {
              await sendTranscript();
            }
          } else {
            // Check if main window is focused before starting
            const mainWindow = getCurrentWindow();
            wasAppFocusedOnRecordStart = await mainWindow.isFocused();

            const repoPath = $activeRepo?.path || '.';
            const model = $settings.default_model;

            // Get current git branch for overlay display
            let branch: string | null = null;
            try {
              branch = await invoke<string>('get_git_branch', { repoPath });
            } catch (e) {
              console.error('Failed to get git branch:', e);
            }

            // Set overlay info - session will be created after transcription completes
            overlay.setMode('session');
            overlay.setSessionInfo(branch, model, false);

            await recording.startRecording($settings.audio.device_id || undefined);

            // Register hotkeys now that we're recording
            await registerTranscribeHotkey();
            await registerCycleRepoHotkey();
            await registerCycleModelHotkey();

            // Show overlay if app is not focused, or if show_when_focused is enabled
            if (!wasAppFocusedOnRecordStart || $settings.overlay.show_when_focused) {
              await overlay.show();
            }
          }
        } finally {
          // Small delay to prevent key repeat issues
          setTimeout(() => {
            isTogglingRecording = false;
          }, 200);
        }
      });

      // Note: transcribe_to_input, cycle_repo, and cycle_model hotkeys are registered dynamically when recording starts
      // and unregistered when recording stops, so they don't block other apps
    } catch (error) {
      console.error('Failed to register hotkeys:', error);
    }
  }

  function showSettingsView() {
    currentView = 'settings';
  }

  function showSessionsView() {
    currentView = 'sessions';
  }

  function showStartView() {
    currentView = 'start';
  }

  async function selectRepo(index: number) {
    await settings.setActiveRepo(index);
    showRepoSelector = false;
  }

  async function changeModel(newModel: string) {
    // Update the default model (only affects new sessions)
    settings.update(s => ({ ...s, default_model: newModel }));
    await settings.save({ ...$settings, default_model: newModel });
  }

  // Start recording for a NEW session (header button)
  async function startRecordingNewSession() {
    if ($isRecording) return;
    isRecordingForNewSession = true;

    const repoPath = $activeRepo?.path || '.';
    const model = $settings.default_model;

    // Get current git branch for overlay display
    let branch: string | null = null;
    try {
      branch = await invoke<string>('get_git_branch', { repoPath });
    } catch (e) {
      console.error('Failed to get git branch:', e);
    }

    // Set overlay info - session will be created after transcription completes
    overlay.setSessionInfo(branch, model, false);

    await recording.startRecording($settings.audio.device_id || undefined);

    // Register hotkeys now that we're recording
    await registerTranscribeHotkey();
    await registerCycleRepoHotkey();
    await registerCycleModelHotkey();

    // Show overlay
    await overlay.show();
  }

  // Stop recording and always create a new session with the transcript
  async function stopRecordingNewSession() {
    if (!$isRecording) return;

    // Unregister hotkeys so they pass through to other apps
    await unregisterTranscribeHotkey();
    await unregisterCycleRepoHotkey();
    await unregisterCycleModelHotkey();
    // Hide overlay immediately before processing starts
    await overlay.hide();
    overlay.clearSessionInfo();

    const transcript = await recording.stopRecording(true);
    if (transcript && isRecordingForNewSession) {
      if ($settings.terminal_mode === 'Sdk') {
        const repoPath = $activeRepo?.path || '.';
        const model = $settings.default_model;
        // Always create a new session
        const systemPrompt = $settings.audio.include_transcription_notice ? VOICE_TRANSCRIPTION_SYSTEM_PROMPT : undefined;
        const sessionId = await sdkSessions.createSession(repoPath, model, systemPrompt);
        activeSdkSessionId.set(sessionId);
        await sdkSessions.sendPrompt(sessionId, transcript);
        activeSessionId.set(null);
      } else {
        const sessionId = await sessions.createSession(transcript);
        activeSessionId.set(sessionId);
        activeSdkSessionId.set(null);
      }
      recording.clearTranscript();
    }
    isRecordingForNewSession = false;
  }
</script>

<div class="app-container h-screen flex flex-col bg-background">
  <header class="header flex items-center justify-between px-4 py-2 border-b border-border bg-surface">
    <div class="flex items-center gap-4">
      <button
        class="text-lg font-semibold text-text-primary hover:text-accent transition-colors"
        onclick={showStartView}
        title="Go to start page"
      >
        Claude Whisperer
      </button>
      
      <div class="relative">
        <button
          class="repo-selector flex items-center gap-2 px-3 py-1.5 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
          onclick={() => showRepoSelector = !showRepoSelector}
          title="Select repository"
        >
          {#if $activeRepo}
            <span class="text-text-primary">{$activeRepo.name}</span>
          {:else}
            <span class="text-text-muted">No repo selected</span>
          {/if}
          <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {#if showRepoSelector}
          <div class="absolute top-full left-0 mt-1 w-64 bg-surface-elevated border border-border rounded shadow-lg z-50">
            {#if $isRecording}
              <div class="px-3 py-2 border-b border-border bg-recording/10">
                <div class="flex items-center gap-2 text-xs text-recording">
                  <div class="w-1.5 h-1.5 bg-recording rounded-full animate-pulse-recording"></div>
                  <span>Recording - switch repository for this prompt</span>
                </div>
              </div>
            {/if}
            {#each $settings.repos as repo, index}
              <button
                class="w-full px-3 py-2 text-left text-sm hover:bg-border transition-colors relative"
                class:bg-accent={index === $settings.active_repo_index}
                class:text-white={index === $settings.active_repo_index}
                onclick={() => selectRepo(index)}
              >
                <div class="flex items-center justify-between">
                  <div class="flex-1 min-w-0">
                    <div class="font-medium flex items-center gap-2">
                      {repo.name}
                      {#if index === $settings.active_repo_index}
                        <svg class="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      {/if}
                    </div>
                    <div class="text-xs truncate" class:text-text-muted={index !== $settings.active_repo_index} class:opacity-80={index === $settings.active_repo_index}>
                      {repo.path}
                    </div>
                  </div>
                </div>
              </button>
            {/each}
            {#if $settings.repos.length === 0}
              <div class="px-3 py-2 text-sm text-text-muted">
                No repositories configured
              </div>
            {/if}
            <div class="border-t border-border">
              <button
                class="w-full px-3 py-2 text-left text-sm text-accent hover:bg-border transition-colors"
                onclick={() => {
                  showRepoSelector = false;
                  settingsInitialTab = 'repos';
                  showSettingsView();
                }}
              >
                + Add repository
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Global Model Selector -->
      <ModelSelector
        model={$settings.default_model}
        onchange={changeModel}
        size="sm"
      />
    </div>

    <div class="flex items-center gap-2">
      <!-- Usage Preview -->
      <UsagePreview />

      <!-- Record Button (sends to current session or creates new if none) -->
      {#if $isRecording && isRecordingForNewSession}
        <button
          class="px-3 py-1.5 text-sm bg-recording hover:bg-recording/90 text-white rounded transition-colors flex items-center gap-2"
          onclick={stopRecordingNewSession}
          title="Stop recording and send"
        >
          <div class="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          Stop & Send
        </button>
      {:else if !$isRecording}
        <button
          class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center gap-2"
          onclick={startRecordingNewSession}
          title="Record voice prompt"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
          Record
        </button>
      {/if}
      <button
        class="p-2 hover:bg-surface-elevated rounded transition-colors"
        class:bg-surface-elevated={currentView === 'settings'}
        onclick={showSettingsView}
        title="Settings"
      >
        <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  </header>

  <div class="main-content flex-1 flex overflow-hidden">
    <aside class="sidebar border-r border-border bg-surface flex flex-col relative" style="width: {sidebarWidth}px; min-width: {MIN_SIDEBAR_WIDTH}px; max-width: {MAX_SIDEBAR_WIDTH}px;">
      <button
        class="p-3 border-b border-border text-left hover:bg-surface-elevated transition-colors"
        class:bg-surface-elevated={currentView === 'sessions'}
        onclick={showSessionsView}
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-medium text-text-secondary">Sessions</h2>
            {#if $settings.mark_sessions_unread}
              {@const unreadCount = $sdkSessions.filter(s => s.unread).length}
              {#if unreadCount > 0}
                <span class="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500 text-white rounded-full">{unreadCount}</span>
              {/if}
            {/if}
          </div>
          {#if $sessions.length + $sdkSessions.length > 0}
            {@const activeCount = [...$sessions, ...$sdkSessions].filter(s => {
              if ('status' in s && typeof s.status === 'string') {
                return ['Starting', 'Running', 'querying'].includes(s.status);
              }
              return false;
            }).length}
            {@const doneCount = [...$sessions, ...$sdkSessions].filter(s => {
              if ('status' in s && typeof s.status === 'string') {
                return ['Completed', 'idle', 'done'].includes(s.status);
              }
              return false;
            }).length}
            {@const errorCount = [...$sessions, ...$sdkSessions].filter(s => {
              if ('status' in s && typeof s.status === 'string') {
                return ['Failed', 'error'].includes(s.status);
              }
              return false;
            }).length}
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-muted">{$sessions.length + $sdkSessions.length}</span>
              {#if activeCount > 0}
                <div class="flex items-center gap-1">
                  <div class="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                  <span class="text-xs text-emerald-400 font-medium">{activeCount}</span>
                </div>
              {/if}
              {#if doneCount > 0}
                <div class="flex items-center gap-1">
                  <div class="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                  <span class="text-xs text-blue-400 font-medium">{doneCount}</span>
                </div>
              {/if}
              {#if errorCount > 0}
                <div class="w-1.5 h-1.5 rounded-full bg-red-400"></div>
              {/if}
            </div>
          {/if}
        </div>
      </button>
      <div class="flex-1 overflow-hidden">
        <SessionList {currentView} />
      </div>
      <!-- Resize handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors"
        class:bg-accent={isResizing}
        onmousedown={startResize}
      ></div>
    </aside>

    <main class="flex-1 flex flex-col overflow-hidden">
      {#if currentView === 'start'}
        <Start />
      {:else if currentView === 'settings'}
        <Settings initialTab={settingsInitialTab} />
      {:else if $activeSdkSession}
        <!-- SDK Mode Session -->
        {@const sessionTime = $activeSdkSession.createdAt ? new Date($activeSdkSession.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        <div class="session-header flex items-center justify-between px-4 py-2 border-b border-border bg-surface-elevated">
          <div class="flex items-center gap-3">
            {#if sessionTime}
              <span class="text-sm text-text-muted">{sessionTime}</span>
            {/if}
            <ModelSelector
              model={$activeSdkSession.model}
              onchange={(newModel) => {
                if ($activeSdkSessionId) {
                  sdkSessions.updateSessionModel($activeSdkSessionId, newModel);
                }
              }}
              size="sm"
            />
          </div>
          <div class="flex items-center gap-2">
            <button
              class="copy-all-btn px-2 py-1 text-xs bg-surface hover:bg-border rounded transition-colors text-text-muted hover:text-text-primary flex items-center gap-1"
              onclick={async () => {
                const messages = $activeSdkSession?.messages ?? [];
                const text = messages
                  .filter(msg => msg.type !== 'done')
                  .map(msg => {
                    const prefix = msg.type === 'user' ? 'User: ' : msg.type === 'text' ? 'Claude: ' : '';
                    if (msg.type === 'user') return prefix + (msg.content ?? '');
                    if (msg.type === 'text') return prefix + (msg.content ?? '');
                    if (msg.type === 'error') return `Error: ${msg.content ?? ''}`;
                    if (msg.type === 'tool_start') return `[Tool: ${msg.tool}]\nInput: ${JSON.stringify(msg.input, null, 2)}`;
                    if (msg.type === 'tool_result') return `[Tool: ${msg.tool} completed]\nOutput: ${msg.output ?? ''}`;
                    return '';
                  })
                  .join('\n\n');
                await navigator.clipboard.writeText(text);
              }}
              title="Copy entire chat"
              disabled={!$activeSdkSession?.messages?.length}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
              </svg>
              Copy
            </button>
            <button
              class="p-1 hover:bg-border rounded transition-colors text-text-muted hover:text-error"
              onclick={() => {
                if ($activeSdkSessionId) {
                  sdkSessions.closeSession($activeSdkSessionId);
                  activeSdkSessionId.set(null);
                }
              }}
              title="Close session"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div class="terminal-wrapper flex-1 overflow-hidden">
          {#key $activeSdkSession.id}
            <SdkView sessionId={$activeSdkSession.id} />
          {/key}
        </div>
      {:else if $activeSession}
        <!-- PTY Mode Session -->
        <SessionHeader session={$activeSession} />
        <div class="terminal-wrapper flex-1 overflow-hidden">
          {#key $activeSession.id}
            <Terminal sessionId={$activeSession.id} />
          {/key}
        </div>
      {:else}
        <div class="flex-1 flex items-center justify-center text-text-muted">
          <div class="text-center">
            <svg class="w-16 h-16 mx-auto mb-4 text-text-muted opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p class="text-lg mb-2">No active session</p>
            <p class="text-sm">Record a voice prompt to start a new Claude session</p>
          </div>
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  .app-container {
    user-select: none;
  }

  .terminal-wrapper {
    min-height: 0;
  }

  .resize-handle {
    /* Extend the clickable area beyond the visible 4px width */
    padding-left: 3px;
    padding-right: 3px;
    margin-right: -3px;
    background-clip: content-box;
  }

  .resize-handle:hover,
  .resize-handle.bg-accent {
    background-color: var(--color-accent);
    opacity: 0.5;
  }

  .resize-handle.bg-accent {
    opacity: 1;
  }

  .sidebar {
    flex-shrink: 0;
  }
</style>
