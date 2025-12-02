<script lang="ts">
  import { onMount } from 'svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import SdkView from '$lib/components/SdkView.svelte';
  import SessionList from '$lib/components/SessionList.svelte';
  import SessionHeader from '$lib/components/SessionHeader.svelte';
  import Transcript from '$lib/components/Transcript.svelte';
  import Settings from './settings/+page.svelte';
  import { sessions, activeSessionId, activeSession } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId, activeSdkSession } from '$lib/stores/sdkSessions';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { recording, isRecording } from '$lib/stores/recording';
  import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';

  // Track whether we're in SDK mode for the active session
  $: isSdkMode = $settings.terminal_mode === 'Sdk';

  let currentView: 'sessions' | 'settings' = 'sessions';
  let showRepoSelector = false;

  onMount(async () => {
    await settings.load();

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', $settings.theme);

    await sessions.load();
    sessions.setupListeners();

    await setupHotkeys();
  });

  async function setupHotkeys() {
    try {
      await unregisterAll();

      await register($settings.hotkeys.toggle_recording, async () => {
        if ($isRecording) {
          await recording.stopRecording();
        } else {
          await recording.startRecording($settings.audio.device_id || undefined);
        }
      });

      await register($settings.hotkeys.send_prompt, async () => {
        if ($recording.transcript) {
          if ($settings.terminal_mode === 'Sdk') {
            // SDK mode: create SDK session and send prompt
            const repoPath = $activeRepo?.path || '.';
            let sessionId = $activeSdkSessionId;

            if (!sessionId) {
              // Create a new SDK session if none exists
              sessionId = await sdkSessions.createSession(repoPath);
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
</script>

<div class="app-container h-screen flex flex-col bg-background">
  <header class="header flex items-center justify-between px-4 py-2 border-b border-border bg-surface">
    <div class="flex items-center gap-4">
      <h1 class="text-lg font-semibold text-text-primary">Claude Whisperer</h1>
      
      <div class="relative">
        <button
          class="repo-selector flex items-center gap-2 px-3 py-1.5 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
          onclick={() => showRepoSelector = !showRepoSelector}
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
            {#each $settings.repos as repo, index}
              <button
                class="w-full px-3 py-2 text-left text-sm hover:bg-border transition-colors"
                class:bg-accent={index === $settings.active_repo_index}
                onclick={() => selectRepo(index)}
              >
                <div class="font-medium text-text-primary">{repo.name}</div>
                <div class="text-xs text-text-muted truncate">{repo.path}</div>
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
                onclick={showSettingsView}
              >
                + Add repository
              </button>
            </div>
          </div>
        {/if}
      </div>
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
        <h2 class="text-sm font-medium text-text-secondary">Sessions</h2>
      </button>
      <div class="flex-1 overflow-hidden">
        <SessionList />
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
        <Settings />
      {:else if $activeSdkSession}
        <!-- SDK Mode Session -->
        <div class="session-header flex items-center justify-between px-4 py-2 border-b border-border bg-surface-elevated">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 text-xs font-medium bg-accent text-white rounded">SDK</span>
            <span class="text-sm text-text-primary truncate">Session</span>
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
