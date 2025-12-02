<script lang="ts">
  import { settings, type Theme } from '$lib/stores/settings';
  import { invoke } from '@tauri-apps/api/core';
  import { onMount, onDestroy } from 'svelte';

  let activeTab = 'general';
  let testingWhisper = false;
  let whisperStatus: 'idle' | 'success' | 'error' = 'idle';
  let newRepoPath = '';
  let newRepoName = '';
  let audioDevices: MediaDeviceInfo[] = [];
  let loadingDevices = false;
  let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  // Debounced auto-save
  async function autoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    if (statusTimeout) clearTimeout(statusTimeout);

    saveTimeout = setTimeout(async () => {
      saveStatus = 'saving';
      try {
        await invoke('save_config', { newConfig: $settings });
        saveStatus = 'saved';
        statusTimeout = setTimeout(() => saveStatus = 'idle', 2000);
      } catch (error) {
        console.error('Failed to save settings:', error);
        saveStatus = 'error';
        statusTimeout = setTimeout(() => saveStatus = 'idle', 3000);
      }
    }, 500);
  }

  // Subscribe to settings changes for auto-save
  let isInitialLoad = true;
  const unsubscribe = settings.subscribe(() => {
    if (isInitialLoad) {
      isInitialLoad = false;
      return;
    }
    autoSave();
  });

  onMount(() => {
    loadAudioDevices();
  });

  onDestroy(() => {
    unsubscribe();
    if (saveTimeout) clearTimeout(saveTimeout);
    if (statusTimeout) clearTimeout(statusTimeout);
  });

  async function loadAudioDevices() {
    loadingDevices = true;
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      const devices = await navigator.mediaDevices.enumerateDevices();
      audioDevices = devices.filter(d => d.kind === 'audioinput');
    } catch (error) {
      console.error('Failed to enumerate audio devices:', error);
    }
    loadingDevices = false;
  }

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'audio', label: 'Audio' },
    { id: 'whisper', label: 'Whisper' },
    { id: 'haiku', label: 'Haiku' },
    { id: 'git', label: 'Git' },
    { id: 'hotkeys', label: 'Hotkeys' },
    { id: 'overlay', label: 'Overlay' },
    { id: 'repos', label: 'Repositories' },
  ];

  async function testWhisperConnection() {
    testingWhisper = true;
    whisperStatus = 'idle';
    try {
      const result = await invoke<boolean>('test_whisper_connection');
      whisperStatus = result ? 'success' : 'error';
    } catch {
      whisperStatus = 'error';
    }
    testingWhisper = false;
  }

  async function addRepo() {
    if (!newRepoPath || !newRepoName) return;
    settings.update(s => ({
      ...s,
      repos: [...s.repos, { path: newRepoPath, name: newRepoName }]
    }));
    newRepoPath = '';
    newRepoName = '';
  }

  function removeRepo(index: number) {
    settings.update(s => {
      const newRepos = s.repos.filter((_, i) => i !== index);
      let newActiveIndex = s.active_repo_index;
      if (newActiveIndex >= newRepos.length && newRepos.length > 0) {
        newActiveIndex = newRepos.length - 1;
      }
      return { ...s, repos: newRepos, active_repo_index: newActiveIndex };
    });
  }

  async function browseFolder() {
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openDialog({
        directory: true,
        multiple: false,
      });
      if (selected) {
        newRepoPath = selected as string;
        if (!newRepoName) {
          newRepoName = newRepoPath.split(/[/\\]/).pop() || '';
        }
      }
    } catch (error) {
      console.error('Failed to open folder dialog:', error);
    }
  }
</script>

<div class="settings-panel flex flex-col h-full">
  <header class="flex items-center justify-between px-4 py-3 border-b border-border">
    <h2 class="text-lg font-semibold text-text-primary">Settings</h2>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <nav class="w-40 border-r border-border bg-surface-elevated p-2 overflow-y-auto">
      {#each tabs as tab}
        <button
          class="w-full px-3 py-2 text-left text-sm rounded transition-colors"
          class:bg-accent={activeTab === tab.id}
          class:text-white={activeTab === tab.id}
          class:text-text-secondary={activeTab !== tab.id}
          class:hover:bg-border={activeTab !== tab.id}
          onclick={() => activeTab = tab.id}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    <div class="flex-1 p-4 overflow-y-auto">
      {#if activeTab === 'general'}
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">Theme</label>
            <div class="grid grid-cols-2 gap-2">
              {#each [
                { id: 'Midnight' as Theme, label: 'Midnight', desc: 'Deep dark', colors: ['#0f0f0f', '#1a1a1a', '#6366f1'] },
                { id: 'Slate' as Theme, label: 'Slate', desc: 'Blue-gray dark', colors: ['#1e293b', '#334155', '#3b82f6'] },
                { id: 'Snow' as Theme, label: 'Snow', desc: 'Clean light', colors: ['#ffffff', '#f1f5f9', '#6366f1'] },
                { id: 'Sand' as Theme, label: 'Sand', desc: 'Warm light', colors: ['#fefdfb', '#f5f0e8', '#d97706'] },
              ] as theme}
                <button
                  class="flex items-center gap-3 p-3 rounded border-2 transition-all"
                  class:border-accent={$settings.theme === theme.id}
                  class:border-border={$settings.theme !== theme.id}
                  onclick={() => {
                    settings.update(s => ({ ...s, theme: theme.id }));
                    document.documentElement.setAttribute('data-theme', theme.id);
                  }}
                >
                  <div class="flex gap-0.5">
                    {#each theme.colors as color}
                      <div class="w-4 h-4 rounded-sm" style="background-color: {color}"></div>
                    {/each}
                  </div>
                  <div class="text-left">
                    <div class="text-sm font-medium text-text-primary">{theme.label}</div>
                    <div class="text-xs text-text-muted">{theme.desc}</div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Default Model</label>
            <select class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.default_model}>
              <option value="claude-opus-4-5">Opus 4.5</option>
              <option value="claude-sonnet-4-5-20250929">Sonnet 4.5</option>
              <option value="claude-haiku-4-5">Haiku 4.5</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Terminal Mode</label>
            <select class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.terminal_mode}>
              <option value="Interactive">Interactive</option>
              <option value="Prompt">Prompt (-p flag)</option>
              <option value="Sdk">SDK (Agent SDK)</option>
            </select>
            <p class="text-xs text-text-muted mt-1">
              {#if $settings.terminal_mode === 'Interactive'}
                Full terminal control with multi-turn conversations.
              {:else if $settings.terminal_mode === 'Prompt'}
                Runs single prompt and exits. Good for one-shot tasks.
              {:else if $settings.terminal_mode === 'Sdk'}
                Uses Claude Agent SDK for structured messages and tool visibility.
              {/if}
            </p>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Skip Permissions</label>
              <p class="text-xs text-text-muted">Use --dangerously-skip-permissions flag</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.skip_permissions} />
          </div>
        </div>

      {:else if activeTab === 'audio'}
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Microphone</label>
            <div class="flex gap-2">
              <select
                class="flex-1 px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.audio.device_id}
                disabled={loadingDevices}
              >
                <option value={null}>System Default</option>
                {#each audioDevices as device}
                  <option value={device.deviceId}>{device.label || `Microphone ${device.deviceId.slice(0, 8)}`}</option>
                {/each}
              </select>
              <button
                class="px-3 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
                onclick={loadAudioDevices}
                disabled={loadingDevices}
              >
                {#if loadingDevices}
                  <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
                {:else}
                  Refresh
                {/if}
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Open Mic Mode</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.audio.open_mic} />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Use Voice Command</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.audio.use_voice_command} />
          </div>
          {#if $settings.audio.use_voice_command}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Voice Command</label>
              <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.audio.voice_command} placeholder="go go" />
            </div>
          {/if}
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Use Hotkey</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.audio.use_hotkey} />
          </div>
        </div>

      {:else if activeTab === 'whisper'}
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Whisper Endpoint</label>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.whisper.endpoint} placeholder="http://localhost:8000/v1/audio/transcriptions" />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Model</label>
            <select class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.whisper.model}>
              <option value="Systran/faster-whisper-base">Systran/faster-whisper-base</option>
              <option value="Systran/faster-whisper-large-v3">Systran/faster-whisper-large-v3</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Language</label>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.whisper.language} placeholder="en" />
          </div>
          <button class="px-4 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors flex items-center gap-2" onclick={testWhisperConnection} disabled={testingWhisper}>
            {#if testingWhisper}
              <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
              Testing...
            {:else}
              Test Connection
            {/if}
          </button>
          {#if whisperStatus === 'success'}
            <p class="text-sm text-success">Connection successful!</p>
          {:else if whisperStatus === 'error'}
            <p class="text-sm text-error">Connection failed. Check your endpoint.</p>
          {/if}
        </div>

      {:else if activeTab === 'haiku'}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Enable Prompt Interpretation</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.haiku.enabled} />
          </div>
          {#if $settings.haiku.enabled}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">API Key</label>
              <input type="password" class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.haiku.api_key} placeholder="sk-ant-..." />
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Model</label>
              <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.haiku.model} placeholder="claude-3-haiku-20240307" />
            </div>
          {/if}
        </div>

      {:else if activeTab === 'git'}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Create New Branch</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.git.create_branch} />
          </div>
          {#if $settings.git.create_branch}
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-secondary">Use Git Worktrees</label>
              <input type="checkbox" class="toggle" bind:checked={$settings.git.use_worktrees} />
            </div>
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-secondary">Auto-merge to Main</label>
              <input type="checkbox" class="toggle" bind:checked={$settings.git.auto_merge} />
            </div>
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-secondary">Create Pull Request</label>
              <input type="checkbox" class="toggle" bind:checked={$settings.git.create_pr} />
            </div>
          {/if}
        </div>

      {:else if activeTab === 'hotkeys'}
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Toggle Recording</label>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.toggle_recording} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Send Prompt</label>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.send_prompt} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Switch Repository</label>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.switch_repo} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Toggle Open Mic</label>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.toggle_open_mic} />
          </div>
        </div>

      {:else if activeTab === 'overlay'}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Show Transcript</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_transcript} />
          </div>
          {#if $settings.overlay.show_transcript}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Transcript Lines</label>
              <input type="number" min="1" max="10" class="w-20 px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.overlay.transcript_lines} />
            </div>
          {/if}
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Show Settings Info</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_settings} />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Show Active Terminals</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_terminals} />
          </div>
        </div>

      {:else if activeTab === 'repos'}
        <div class="space-y-4">
          <div class="space-y-2">
            {#each $settings.repos as repo, index}
              <div class="flex items-center gap-2 p-2 bg-surface-elevated rounded">
                <div class="flex-1">
                  <div class="font-medium text-sm text-text-primary">{repo.name}</div>
                  <div class="text-xs text-text-muted truncate">{repo.path}</div>
                </div>
                <button class="p-1 text-text-muted hover:text-error transition-colors" onclick={() => removeRepo(index)}>
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            {/each}
          </div>

          <div class="border-t border-border pt-4">
            <h3 class="text-sm font-medium text-text-secondary mb-2">Add Repository</h3>
            <div class="space-y-2">
              <div class="flex gap-2">
                <input type="text" class="flex-1 px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={newRepoPath} placeholder="Path to repository" />
                <button class="px-3 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors" onclick={browseFolder}>Browse</button>
              </div>
              <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={newRepoName} placeholder="Display name" />
              <button class="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded text-sm transition-colors" onclick={addRepo} disabled={!newRepoPath || !newRepoName}>Add Repository</button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if saveStatus !== 'idle'}
    <footer class="flex justify-end items-center gap-2 px-4 py-2 border-t border-border">
      {#if saveStatus === 'saving'}
        <div class="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
        <span class="text-xs text-text-muted">Saving...</span>
      {:else if saveStatus === 'saved'}
        <svg class="w-3 h-3 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        <span class="text-xs text-text-muted">Saved</span>
      {:else if saveStatus === 'error'}
        <svg class="w-3 h-3 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span class="text-xs text-error">Failed to save</span>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .toggle {
    appearance: none;
    width: 36px;
    height: 20px;
    background: var(--color-border);
    border-radius: 10px;
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle:checked {
    background: var(--color-accent);
  }

  .toggle::before {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }

  .toggle:checked::before {
    transform: translateX(16px);
  }
</style>
