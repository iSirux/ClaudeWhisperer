<script lang="ts">
  import { settings, type Theme } from '$lib/stores/settings';
  import { usageStats, formatDuration, formatDate, formatRelativeTime, getWeeklyStats, getTotalForPeriod, formatTokens, formatCost } from '$lib/stores/usageStats';
  import { invoke } from '@tauri-apps/api/core';
  import { onMount, onDestroy } from 'svelte';

  // Accept an initial tab from parent component
  interface Props {
    initialTab?: string;
  }
  let { initialTab = 'general' }: Props = $props();

  let activeTab = $state(initialTab);

  // Update active tab when initialTab prop changes
  $effect(() => {
    activeTab = initialTab;
  });

  let testingWhisper = $state(false);
  let whisperStatus: 'idle' | 'success' | 'error' = $state('idle');
  let newRepoPath = $state('');
  let newRepoName = $state('');
  let audioDevices: MediaDeviceInfo[] = $state([]);
  let loadingDevices = $state(false);
  let saveStatus: 'idle' | 'saving' | 'error' = $state('idle');
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
        saveStatus = 'idle';
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
    usageStats.load();
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
    { id: 'system', label: 'System' },
    { id: 'audio', label: 'Audio' },
    { id: 'whisper', label: 'Whisper' },
    { id: 'git', label: 'Git' },
    { id: 'hotkeys', label: 'Hotkeys' },
    { id: 'overlay', label: 'Overlay' },
    { id: 'repos', label: 'Repositories' },
    { id: 'usage', label: 'Usage' },
  ];

  let resettingStats = $state(false);

  async function resetStats() {
    if (!confirm('Are you sure you want to reset all usage statistics? This cannot be undone.')) {
      return;
    }
    resettingStats = true;
    try {
      await usageStats.reset();
    } catch (error) {
      console.error('Failed to reset stats:', error);
    }
    resettingStats = false;
  }

  // Helper to get model distribution percentages
  function getModelPercentage(count: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((count / total) * 100);
  }

  // Get repo name from path
  function getRepoName(path: string): string {
    const repo = $settings.repos.find(r => r.path === path);
    return repo?.name || path.split(/[/\\]/).pop() || path;
  }

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
    console.log('[addRepo] Called with path:', newRepoPath, 'name:', newRepoName);
    if (!newRepoPath || !newRepoName) {
      console.log('[addRepo] Missing path or name, returning');
      return;
    }
    console.log('[addRepo] Calling settings.addRepo...');
    try {
      await settings.addRepo(newRepoPath, newRepoName);
      console.log('[addRepo] Successfully added repo');
      newRepoPath = '';
      newRepoName = '';
    } catch (error) {
      console.error('[addRepo] Failed to add repo:', error);
    }
  }

  async function removeRepo(index: number) {
    console.log('[removeRepo] Removing repo at index:', index);
    try {
      await settings.removeRepo(index);
      console.log('[removeRepo] Successfully removed repo');
    } catch (error) {
      console.error('[removeRepo] Failed to remove repo:', error);
    }
  }

  async function browseFolder() {
    console.log('[browseFolder] Opening folder dialog...');
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      console.log('[browseFolder] Dialog plugin imported, calling openDialog...');
      const selected = await openDialog({
        directory: true,
        multiple: false,
      });
      console.log('[browseFolder] Dialog result:', selected);
      if (selected) {
        newRepoPath = selected as string;
        console.log('[browseFolder] Set newRepoPath to:', newRepoPath);
        if (!newRepoName) {
          newRepoName = newRepoPath.split(/[/\\]/).pop() || '';
          console.log('[browseFolder] Auto-set newRepoName to:', newRepoName);
        }
      } else {
        console.log('[browseFolder] No folder selected (user cancelled)');
      }
    } catch (error) {
      console.error('[browseFolder] Failed to open folder dialog:', error);
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
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Show Branch in Sessions</label>
              <p class="text-xs text-text-muted">Display git branch name in session list</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.show_branch_in_sessions} />
          </div>
        </div>

      {:else if activeTab === 'system'}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Minimize to Tray</label>
              <p class="text-xs text-text-muted">Keep running in system tray when window is closed</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.system.minimize_to_tray} />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Start Minimized</label>
              <p class="text-xs text-text-muted">Start app minimized to system tray</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.system.start_minimized} />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Start on Login</label>
              <p class="text-xs text-text-muted">Automatically start when you log in to your computer</p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              checked={$settings.system.autostart}
              onchange={async (e) => {
                const enabled = (e.target as HTMLInputElement).checked;
                try {
                  await invoke('toggle_autostart', { enabled });
                  settings.update(s => ({ ...s, system: { ...s.system, autostart: enabled } }));
                } catch (error) {
                  console.error('Failed to toggle autostart:', error);
                  (e.target as HTMLInputElement).checked = !enabled;
                }
              }}
            />
          </div>

          <div class="border-t border-border pt-4 mt-4">
            <h3 class="text-sm font-medium text-text-primary mb-3">Session Persistence</h3>
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <label class="text-sm font-medium text-text-secondary">Restore Sessions on Startup</label>
                  <p class="text-xs text-text-muted">Save and restore session history between app restarts</p>
                </div>
                <input type="checkbox" class="toggle" bind:checked={$settings.session_persistence.enabled} />
              </div>
              {#if $settings.session_persistence.enabled}
                <div>
                  <label class="block text-sm font-medium text-text-secondary mb-1">Maximum Sessions to Keep</label>
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      min="10"
                      max="200"
                      step="10"
                      class="flex-1 accent-accent"
                      bind:value={$settings.session_persistence.max_sessions}
                    />
                    <span class="text-sm text-text-primary w-12 text-right">{$settings.session_persistence.max_sessions}</span>
                  </div>
                  <p class="text-xs text-text-muted mt-1">Older sessions will be automatically removed when the limit is exceeded</p>
                </div>
                <button
                  class="px-3 py-1.5 text-sm text-error border border-error/30 hover:bg-error/10 rounded transition-colors"
                  onclick={async () => {
                    if (confirm('Are you sure you want to clear all saved sessions? This cannot be undone.')) {
                      const { clearPersistedSessions } = await import('$lib/stores/sessionPersistence');
                      await clearPersistedSessions();
                    }
                  }}
                >
                  Clear Saved Sessions
                </button>
              {/if}
            </div>
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
          <div class="border-t border-border pt-4 mt-4">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary">Play Sound on Completion</label>
                <p class="text-xs text-text-muted mt-0.5">Play a notification sound when SDK session completes</p>
              </div>
              <input type="checkbox" class="toggle" bind:checked={$settings.audio.play_sound_on_completion} />
            </div>
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Recording Linger Time</label>
              <p class="text-xs text-text-muted mb-2">Delay before stopping recording to prevent audio cutoff (0 to disable)</p>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="50"
                  class="flex-1 accent-accent"
                  bind:value={$settings.audio.recording_linger_ms}
                />
                <span class="text-sm text-text-primary w-16 text-right">{$settings.audio.recording_linger_ms}ms</span>
              </div>
            </div>
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

          <div class="border-t border-border pt-4 mt-4">
            <label class="block text-sm font-medium text-text-secondary mb-2">Docker Setup</label>
            <p class="text-xs text-text-muted mb-2">GPU (CUDA):</p>
            <div class="relative group mb-3">
              <pre class="p-3 bg-background border border-border rounded text-xs font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all">docker run -d --gpus all -p 8000:8000 -v ~/.cache/huggingface:/root/.cache/huggingface fedirz/faster-whisper-server:latest-cuda</pre>
              <button
                class="absolute top-2 right-2 p-1.5 bg-surface-elevated hover:bg-border rounded text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                onclick={async () => {
                  await navigator.clipboard.writeText('docker run -d --gpus all -p 8000:8000 -v ~/.cache/huggingface:/root/.cache/huggingface fedirz/faster-whisper-server:latest-cuda');
                }}
                title="Copy to clipboard"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
            <p class="text-xs text-text-muted mb-2">CPU only:</p>
            <div class="relative group">
              <pre class="p-3 bg-background border border-border rounded text-xs font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all">docker run -d -p 8000:8000 -v ~/.cache/huggingface:/root/.cache/huggingface fedirz/faster-whisper-server:latest-cpu</pre>
              <button
                class="absolute top-2 right-2 p-1.5 bg-surface-elevated hover:bg-border rounded text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                onclick={async () => {
                  await navigator.clipboard.writeText('docker run -d -p 8000:8000 -v ~/.cache/huggingface:/root/.cache/huggingface fedirz/faster-whisper-server:latest-cpu');
                }}
                title="Copy to clipboard"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
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
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Transcribe to Input</label>
            <p class="text-xs text-text-muted mb-2">Record, transcribe, and paste into any application</p>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.transcribe_to_input} />
          </div>
        </div>

      {:else if activeTab === 'overlay'}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Show Overlay When Focused</label>
              <p class="text-xs text-text-muted mt-0.5">Show the recording overlay even when the app is in focus</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_when_focused} />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Show Settings Info</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_settings} />
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary">Show Active Terminals</label>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_terminals} />
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary">Sessions Status Overlay</label>
                <p class="text-xs text-text-muted mt-0.5">Show a small overlay with active sessions status</p>
              </div>
              <input type="checkbox" class="toggle" bind:checked={$settings.overlay.sessions_overlay_enabled} />
            </div>
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

      {:else if activeTab === 'usage'}
        <div class="space-y-6">
          <!-- Token Usage & Cost (Most Important) -->
          {#if $usageStats.token_stats && ($usageStats.token_stats.total_input_tokens > 0 || $usageStats.token_stats.total_output_tokens > 0)}
            <div>
              <h3 class="text-sm font-medium text-text-primary mb-3">Token Usage & Cost</h3>
              <div class="p-4 bg-surface-elevated rounded-lg">
                <!-- Total Cost Banner -->
                <div class="flex items-center justify-between mb-4 pb-4 border-b border-border">
                  <div>
                    <div class="text-3xl font-bold text-warning">{formatCost($usageStats.token_stats.total_cost_usd)}</div>
                    <div class="text-xs text-text-muted">Total Cost (USD)</div>
                  </div>
                  <div class="text-right">
                    <div class="text-xl font-bold text-text-primary">{formatTokens($usageStats.token_stats.total_input_tokens + $usageStats.token_stats.total_output_tokens)}</div>
                    <div class="text-xs text-text-muted">Total Tokens</div>
                  </div>
                </div>

                <!-- Token Breakdown -->
                <div class="grid grid-cols-2 gap-4">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <svg class="w-4 h-4 text-blue-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 8a.5.5 0 0 1 .5-.5h5.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H4.5A.5.5 0 0 1 4 8z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium text-text-primary">{formatTokens($usageStats.token_stats.total_input_tokens)}</div>
                      <div class="text-xs text-text-muted">Input Tokens</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                      <svg class="w-4 h-4 text-purple-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M12 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium text-text-primary">{formatTokens($usageStats.token_stats.total_output_tokens)}</div>
                      <div class="text-xs text-text-muted">Output Tokens</div>
                    </div>
                  </div>
                </div>

                <!-- Cache Stats (if any) -->
                {#if $usageStats.token_stats.total_cache_read_tokens > 0 || $usageStats.token_stats.total_cache_creation_tokens > 0}
                  <div class="mt-4 pt-4 border-t border-border">
                    <div class="text-xs text-text-muted mb-2">Prompt Caching</div>
                    <div class="grid grid-cols-2 gap-4">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                          <svg class="w-4 h-4 text-green-400" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814l-3.5-2.5z"/>
                          </svg>
                        </div>
                        <div>
                          <div class="text-sm font-medium text-success">{formatTokens($usageStats.token_stats.total_cache_read_tokens)}</div>
                          <div class="text-xs text-text-muted">Cache Reads (90% savings)</div>
                        </div>
                      </div>
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                          <svg class="w-4 h-4 text-orange-400" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 3zm4 8a4 4 0 0 1-8 0V5a4 4 0 1 1 8 0v6z"/>
                          </svg>
                        </div>
                        <div>
                          <div class="text-sm font-medium text-text-primary">{formatTokens($usageStats.token_stats.total_cache_creation_tokens)}</div>
                          <div class="text-xs text-text-muted">Cache Writes</div>
                        </div>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Overview Stats -->
          <div>
            <h3 class="text-sm font-medium text-text-primary mb-3">Overview</h3>
            <div class="grid grid-cols-2 gap-3">
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_sessions}</div>
                <div class="text-xs text-text-muted">Total Sessions</div>
              </div>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_prompts}</div>
                <div class="text-xs text-text-muted">Total Prompts</div>
              </div>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_recordings}</div>
                <div class="text-xs text-text-muted">Voice Recordings</div>
              </div>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_tool_calls}</div>
                <div class="text-xs text-text-muted">Tool Calls</div>
              </div>
            </div>
          </div>

          <!-- Streak & Activity -->
          <div>
            <h3 class="text-sm font-medium text-text-primary mb-3">Activity</h3>
            <div class="grid grid-cols-2 gap-3">
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="flex items-center gap-2">
                  <span class="text-xl">🔥</span>
                  <div>
                    <div class="text-lg font-bold text-text-primary">{$usageStats.streak_days} days</div>
                    <div class="text-xs text-text-muted">Current Streak</div>
                  </div>
                </div>
              </div>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="flex items-center gap-2">
                  <span class="text-xl">🏆</span>
                  <div>
                    <div class="text-lg font-bold text-text-primary">{$usageStats.longest_streak} days</div>
                    <div class="text-xs text-text-muted">Longest Streak</div>
                  </div>
                </div>
              </div>
            </div>

            {#if $usageStats.session_stats.first_session_at}
              <div class="mt-3 p-3 bg-surface-elevated rounded-lg">
                <div class="flex justify-between text-sm">
                  <span class="text-text-muted">Using since</span>
                  <span class="text-text-primary">{formatDate($usageStats.session_stats.first_session_at)}</span>
                </div>
                {#if $usageStats.session_stats.last_session_at}
                  <div class="flex justify-between text-sm mt-1">
                    <span class="text-text-muted">Last activity</span>
                    <span class="text-text-primary">{formatRelativeTime($usageStats.session_stats.last_session_at)}</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Session Types -->
          <div>
            <h3 class="text-sm font-medium text-text-primary mb-3">Session Types</h3>
            <div class="p-3 bg-surface-elevated rounded-lg space-y-2">
              <div class="flex justify-between items-center">
                <span class="text-sm text-text-secondary">SDK Sessions</span>
                <span class="text-sm font-medium text-text-primary">{$usageStats.session_stats.total_sdk_sessions}</span>
              </div>
              <div class="w-full bg-border rounded-full h-2">
                <div
                  class="bg-accent h-2 rounded-full transition-all"
                  style="width: {getModelPercentage($usageStats.session_stats.total_sdk_sessions, $usageStats.session_stats.total_sessions)}%"
                ></div>
              </div>
              <div class="flex justify-between items-center mt-2">
                <span class="text-sm text-text-secondary">PTY Sessions</span>
                <span class="text-sm font-medium text-text-primary">{$usageStats.session_stats.total_pty_sessions}</span>
              </div>
              <div class="w-full bg-border rounded-full h-2">
                <div
                  class="bg-success h-2 rounded-full transition-all"
                  style="width: {getModelPercentage($usageStats.session_stats.total_pty_sessions, $usageStats.session_stats.total_sessions)}%"
                ></div>
              </div>
            </div>
          </div>

          <!-- Model Usage -->
          {#if $usageStats.model_usage.opus_sessions + $usageStats.model_usage.sonnet_sessions + $usageStats.model_usage.haiku_sessions > 0}
            {@const totalModels = $usageStats.model_usage.opus_sessions + $usageStats.model_usage.sonnet_sessions + $usageStats.model_usage.haiku_sessions}
            <div>
              <h3 class="text-sm font-medium text-text-primary mb-3">Model Usage</h3>
              <div class="p-3 bg-surface-elevated rounded-lg space-y-3">
                <div class="flex items-center gap-3">
                  <div class="w-20 text-sm text-text-secondary">Opus</div>
                  <div class="flex-1 bg-border rounded-full h-2">
                    <div class="bg-purple-500 h-2 rounded-full" style="width: {getModelPercentage($usageStats.model_usage.opus_sessions, totalModels)}%"></div>
                  </div>
                  <div class="w-12 text-right text-sm text-text-primary">{$usageStats.model_usage.opus_sessions}</div>
                </div>
                <div class="flex items-center gap-3">
                  <div class="w-20 text-sm text-text-secondary">Sonnet</div>
                  <div class="flex-1 bg-border rounded-full h-2">
                    <div class="bg-blue-500 h-2 rounded-full" style="width: {getModelPercentage($usageStats.model_usage.sonnet_sessions, totalModels)}%"></div>
                  </div>
                  <div class="w-12 text-right text-sm text-text-primary">{$usageStats.model_usage.sonnet_sessions}</div>
                </div>
                <div class="flex items-center gap-3">
                  <div class="w-20 text-sm text-text-secondary">Haiku</div>
                  <div class="flex-1 bg-border rounded-full h-2">
                    <div class="bg-green-500 h-2 rounded-full" style="width: {getModelPercentage($usageStats.model_usage.haiku_sessions, totalModels)}%"></div>
                  </div>
                  <div class="w-12 text-right text-sm text-text-primary">{$usageStats.model_usage.haiku_sessions}</div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Recording Stats -->
          {#if $usageStats.session_stats.total_recordings > 0}
            <div>
              <h3 class="text-sm font-medium text-text-primary mb-3">Voice Recording</h3>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <div class="text-lg font-bold text-text-primary">{formatDuration($usageStats.session_stats.total_recording_duration_ms)}</div>
                    <div class="text-xs text-text-muted">Total Recording Time</div>
                  </div>
                  <div>
                    <div class="text-lg font-bold text-text-primary">{$usageStats.session_stats.total_transcriptions}</div>
                    <div class="text-xs text-text-muted">Transcriptions</div>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Top Tools -->
          {#if $usageStats.most_used_tools.length > 0}
            <div>
              <h3 class="text-sm font-medium text-text-primary mb-3">Top Tools</h3>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="space-y-2">
                  {#each $usageStats.most_used_tools.slice(0, 8) as [tool, count]}
                    <div class="flex justify-between items-center">
                      <span class="text-sm text-text-secondary font-mono">{tool}</span>
                      <span class="text-sm font-medium text-text-primary">{count}</span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- Repo Usage -->
          {#if $usageStats.repo_usage.length > 0}
            <div>
              <h3 class="text-sm font-medium text-text-primary mb-3">Repository Activity</h3>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="space-y-2">
                  {#each $usageStats.repo_usage.sort((a, b) => b.session_count - a.session_count).slice(0, 5) as repo}
                    <div class="flex justify-between items-center">
                      <span class="text-sm text-text-secondary truncate flex-1">{getRepoName(repo.repo_path)}</span>
                      <div class="flex gap-3 text-sm">
                        <span class="text-text-muted">{repo.session_count} sessions</span>
                        <span class="text-text-primary">{repo.prompt_count} prompts</span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- Weekly Activity Chart (simple bars) -->
          {#if $usageStats.daily_stats.length > 0}
            {@const weeklyStats = getWeeklyStats($usageStats.daily_stats)}
            {@const maxSessions = Math.max(...weeklyStats.map(d => d.sessions), 1)}
            {@const weekTotals = getTotalForPeriod($usageStats.daily_stats, 7)}
            <div>
              <h3 class="text-sm font-medium text-text-primary mb-3">Last 7 Days</h3>
              <div class="p-3 bg-surface-elevated rounded-lg">
                <div class="flex items-end justify-between gap-1 h-20">
                  {#each weeklyStats as day}
                    <div class="flex-1 flex flex-col items-center gap-1">
                      <div
                        class="w-full bg-accent rounded-t transition-all min-h-[4px]"
                        style="height: {(day.sessions / maxSessions) * 100}%"
                        title="{day.sessions} sessions, {day.prompts} prompts"
                      ></div>
                      <div class="text-[10px] text-text-muted">{day.date.slice(-2)}</div>
                    </div>
                  {/each}
                </div>
                <div class="mt-3 pt-3 border-t border-border grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div class="text-sm font-medium text-text-primary">{weekTotals.sessions}</div>
                    <div class="text-[10px] text-text-muted">Sessions</div>
                  </div>
                  <div>
                    <div class="text-sm font-medium text-text-primary">{weekTotals.prompts}</div>
                    <div class="text-[10px] text-text-muted">Prompts</div>
                  </div>
                  <div>
                    <div class="text-sm font-medium text-text-primary">{weekTotals.recordings}</div>
                    <div class="text-[10px] text-text-muted">Recordings</div>
                  </div>
                  <div>
                    <div class="text-sm font-medium text-text-primary">{weekTotals.toolCalls}</div>
                    <div class="text-[10px] text-text-muted">Tool Calls</div>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Reset Stats -->
          <div class="border-t border-border pt-4">
            <button
              class="px-3 py-1.5 text-sm text-error border border-error/30 hover:bg-error/10 rounded transition-colors flex items-center gap-2"
              onclick={resetStats}
              disabled={resettingStats}
            >
              {#if resettingStats}
                <div class="w-3 h-3 border-2 border-error border-t-transparent rounded-full animate-spin"></div>
              {/if}
              Reset All Statistics
            </button>
            <p class="text-xs text-text-muted mt-2">This will permanently delete all usage statistics.</p>
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
