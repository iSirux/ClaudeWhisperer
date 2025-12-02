<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import SdkView from '$lib/components/SdkView.svelte';
  import SessionList from '$lib/components/SessionList.svelte';
  import SessionHeader from '$lib/components/SessionHeader.svelte';
  import Transcript from '$lib/components/Transcript.svelte';
  import Settings from './settings/+page.svelte';
  import ModelSelector from '$lib/components/ModelSelector.svelte';
  import { sessions, activeSessionId, activeSession } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId, activeSdkSession } from '$lib/stores/sdkSessions';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { recording, isRecording } from '$lib/stores/recording';
  import { overlay } from '$lib/stores/overlay';
  import { sessionsOverlay } from '$lib/stores/sessionsOverlay';
  import { setupSessionStatsBroadcast } from '$lib/stores/sessionStats';
  import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';

  // Track whether we're in SDK mode for the active session
  $: isSdkMode = $settings.terminal_mode === 'Sdk';

  let currentView: 'sessions' | 'settings' = 'sessions';
  let showRepoSelector = false;
  let isTogglingRecording = false;
  let wasAppFocusedOnRecordStart = true;
  let settingsInitialTab = 'general';

  onMount(async () => {
    await settings.load();

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', $settings.theme);

    await sessions.load();
    sessions.setupListeners();

    // Start broadcasting session stats to other windows (like sessions-overlay)
    setupSessionStatsBroadcast();

    await setupHotkeys();

    // Listen for session selection from SessionList
    window.addEventListener('switch-to-sessions', showSessionsView);
  });

  onDestroy(() => {
    window.removeEventListener('switch-to-sessions', showSessionsView);
  });

  // Reactive logic to show/hide sessions overlay based on active sessions
  $: {
    if ($settings.overlay.sessions_overlay_enabled) {
      const hasActiveSessions =
        $sessions.some(s => s.status === 'Running' || s.status === 'Starting') ||
        $sdkSessions.some(s => s.status === 'querying');

      if (hasActiveSessions) {
        sessionsOverlay.show();
      } else {
        sessionsOverlay.hide();
      }
    } else {
      sessionsOverlay.hide();
    }
  }

  async function sendTranscript() {
    if (!$recording.transcript) return;

    if ($settings.terminal_mode === 'Sdk') {
      // SDK mode: create SDK session and send prompt
      const repoPath = $activeRepo?.path || '.';
      const model = $settings.default_model;
      let sessionId = $activeSdkSessionId;

      if (!sessionId) {
        // Create a new SDK session if none exists
        sessionId = await sdkSessions.createSession(repoPath, model);
        activeSdkSessionId.set(sessionId);
      }

      // Send the prompt to the SDK session
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

  async function setupHotkeys() {
    try {
      await unregisterAll();

      await register($settings.hotkeys.toggle_recording, async () => {
        // Prevent multiple rapid fires
        if (isTogglingRecording) return;
        isTogglingRecording = true;

        try {
          if ($isRecording) {
            await recording.stopRecording();
            await overlay.hide();
            overlay.clearSessionInfo();

            // Auto-send transcript if app wasn't focused when recording started
            if (!wasAppFocusedOnRecordStart && $recording.transcript) {
              await sendTranscript();
            }
          } else {
            // Check if main window is focused before starting
            const mainWindow = getCurrentWindow();
            wasAppFocusedOnRecordStart = await mainWindow.isFocused();

            // If app not focused and in SDK mode, start a new SDK session
            if (!wasAppFocusedOnRecordStart && $settings.terminal_mode === 'Sdk') {
              const repoPath = $activeRepo?.path || '.';
              const model = $settings.default_model;

              // Get current git branch
              let branch: string | null = null;
              try {
                branch = await invoke<string>('get_git_branch', { repoPath });
              } catch (e) {
                console.error('Failed to get git branch:', e);
              }

              // Set overlay to show we're creating a session
              overlay.setSessionInfo(branch, model, true);

              const sessionId = await sdkSessions.createSession(repoPath, model);
              activeSdkSessionId.set(sessionId);
              activeSessionId.set(null); // Clear PTY session selection

              // Update overlay to show session is created
              overlay.setSessionInfo(branch, model, false);
            }

            await recording.startRecording($settings.audio.device_id || undefined);

            // Only show overlay if app is not focused
            if (!wasAppFocusedOnRecordStart) {
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

      await register($settings.hotkeys.send_prompt, async () => {
        await sendTranscript();
      });

      await register($settings.hotkeys.switch_repo, () => {
        showRepoSelector = !showRepoSelector;
      });
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

  async function selectRepo(index: number) {
    await settings.setActiveRepo(index);
    showRepoSelector = false;
  }

  async function changeModel(newModel: string) {
    // Update the default model (only affects new sessions)
    settings.update(s => ({ ...s, default_model: newModel }));
  }
</script>

<div class="app-container h-screen flex flex-col bg-background">
  <header class="header flex items-center justify-between px-4 py-2 border-b border-border bg-surface">
    <div class="flex items-center gap-4">
      <h1 class="text-lg font-semibold text-text-primary">Claude Whisperer</h1>
      
      <div class="relative">
        <button
          class="repo-selector flex items-center gap-2 px-3 py-1.5 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
          class:ring-2={$isRecording}
          class:ring-recording={$isRecording}
          onclick={() => showRepoSelector = !showRepoSelector}
          title={$isRecording ? "Switch repository (recording in progress)" : "Select repository"}
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
    <aside class="sidebar w-64 border-r border-border bg-surface flex flex-col">
      <button
        class="p-3 border-b border-border text-left hover:bg-surface-elevated transition-colors"
        class:bg-surface-elevated={currentView === 'sessions'}
        onclick={showSessionsView}
      >
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-text-secondary">Sessions</h2>
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
                <div class="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
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
      <button
        class="sidebar-settings p-3 border-t border-border text-left hover:bg-surface-elevated transition-colors flex items-center gap-2"
        class:bg-surface-elevated={currentView === 'settings'}
        onclick={showSettingsView}
      >
        <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span class="text-sm font-medium text-text-secondary">Settings</span>
      </button>
    </aside>

    <main class="flex-1 flex flex-col overflow-hidden">
      {#if currentView === 'settings'}
        <Settings initialTab={settingsInitialTab} />
      {:else if $activeSdkSession}
        <!-- SDK Mode Session -->
        <div class="session-header flex items-center justify-between px-4 py-2 border-b border-border bg-surface-elevated">
          <div class="flex items-center gap-3">
            <span class="px-2 py-0.5 text-xs font-medium bg-accent text-white rounded">SDK</span>
            <span class="text-sm text-text-primary truncate">Session</span>
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
            <span class="text-xs text-text-muted">{$activeSdkSession.status}</span>
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
        <Transcript />
      {:else if $activeSession}
        <!-- PTY Mode Session -->
        <SessionHeader session={$activeSession} />
        <div class="terminal-wrapper flex-1 overflow-hidden">
          {#key $activeSession.id}
            <Terminal sessionId={$activeSession.id} />
          {/key}
        </div>
        <Transcript />
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
        <Transcript />
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
</style>
