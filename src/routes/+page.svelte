<script lang="ts">
  import { onMount } from 'svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import SessionList from '$lib/components/SessionList.svelte';
  import Transcript from '$lib/components/Transcript.svelte';
  import { sessions, activeSessionId, activeSession } from '$lib/stores/sessions';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { recording, isRecording } from '$lib/stores/recording';
  import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';

  let showSettings = false;
  let showRepoSelector = false;

  onMount(async () => {
    await settings.load();
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
          await sessions.createSession($recording.transcript);
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

  function toggleSettings() {
    showSettings = !showSettings;
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
                onclick={toggleSettings}
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
        onclick={toggleSettings}
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
      <div class="p-3 border-b border-border">
        <h2 class="text-sm font-medium text-text-secondary">Sessions</h2>
      </div>
      <div class="flex-1 overflow-hidden">
        <SessionList />
      </div>
    </aside>

    <main class="flex-1 flex flex-col overflow-hidden">
      {#if $activeSession}
        <div class="terminal-wrapper flex-1 overflow-hidden">
          <Terminal sessionId={$activeSession.id} />
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

      <Transcript />
    </main>
  </div>
</div>

{#if showSettings}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={() => showSettings = false}>
    <div class="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onclick={(e) => e.stopPropagation()}>
      {#await import('./settings/+page.svelte') then { default: Settings }}
        <Settings onClose={() => showSettings = false} />
      {/await}
    </div>
  </div>
{/if}

<style>
  .app-container {
    user-select: none;
  }

  .terminal-wrapper {
    min-height: 0;
  }
</style>
