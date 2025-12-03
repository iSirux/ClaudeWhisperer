<script lang="ts">
  import { settings, type Theme } from '$lib/stores/settings';
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
    { id: 'themes', label: 'Themes' },
    { id: 'system', label: 'System' },
    { id: 'audio', label: 'Audio' },
    { id: 'whisper', label: 'Whisper' },
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
          {#if $settings.terminal_mode === 'Interactive' || $settings.terminal_mode === 'Prompt'}
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary">Skip Permissions</label>
                <p class="text-xs text-text-muted">Use --dangerously-skip-permissions flag</p>
              </div>
              <input type="checkbox" class="toggle" bind:checked={$settings.skip_permissions} />
            </div>
          {/if}
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Show Branch in Sessions</label>
              <p class="text-xs text-text-muted">Display git branch name in session list</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.show_branch_in_sessions} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Session List Sort Order</label>
            <select class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent" bind:value={$settings.session_sort_order}>
              <option value="Chronological">Chronological (newest first)</option>
              <option value="StatusThenChronological">Status, then chronological</option>
            </select>
            <p class="text-xs text-text-muted mt-1">
              {#if $settings.session_sort_order === 'Chronological'}
                Sessions sorted by creation time, newest first.
              {:else}
                Active sessions first, then by creation time.
              {/if}
            </p>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Mark Completed Sessions as Unread</label>
              <p class="text-xs text-text-muted">Highlight sessions that have completed until you click on them</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.mark_sessions_unread} />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary">Show Latest Message Preview</label>
              <p class="text-xs text-text-muted">Display a snippet of the latest response in each SDK session</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.show_latest_message_preview} />
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <h3 class="text-sm font-medium text-text-primary mb-3">Session List Row Limits</h3>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">User Prompt Rows</label>
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    class="flex-1 accent-accent"
                    bind:value={$settings.session_prompt_rows}
                  />
                  <span class="text-sm text-text-primary w-8 text-right">{$settings.session_prompt_rows}</span>
                </div>
                <p class="text-xs text-text-muted mt-1">Maximum rows to show for user prompts in session list</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-text-secondary mb-1">Agent Response Rows</label>
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    class="flex-1 accent-accent"
                    bind:value={$settings.session_response_rows}
                  />
                  <span class="text-sm text-text-primary w-8 text-right">{$settings.session_response_rows}</span>
                </div>
                <p class="text-xs text-text-muted mt-1">Maximum rows to show for agent responses in session list</p>
              </div>
            </div>
          </div>
        </div>

      {:else if activeTab === 'themes'}
        <div class="space-y-4">
          <div>
            <p class="text-sm text-text-secondary mb-4">Choose a theme that suits your preference. Dark themes are easier on the eyes in low-light conditions.</p>

            <h3 class="text-sm font-medium text-text-primary mb-3">Dark Themes</h3>
            <div class="grid grid-cols-2 gap-2 mb-6">
              {#each [
                { id: 'Midnight' as Theme, label: 'Midnight', desc: 'Deep dark', colors: ['#0f0f0f', '#1a1a1a', '#6366f1'] },
                { id: 'Slate' as Theme, label: 'Slate', desc: 'Blue-gray dark', colors: ['#1e293b', '#334155', '#3b82f6'] },
                { id: 'Ocean' as Theme, label: 'Ocean', desc: 'Deep blue', colors: ['#0c1222', '#1a2744', '#0ea5e9'] },
                { id: 'Forest' as Theme, label: 'Forest', desc: 'Earthy green', colors: ['#0d1512', '#1a2820', '#22c55e'] },
                { id: 'Mocha' as Theme, label: 'Mocha', desc: 'Warm brown', colors: ['#1a1614', '#2a2420', '#c2956e'] },
                { id: 'Torch' as Theme, label: 'Torch', desc: 'Fiery orange', colors: ['#1a1210', '#2a1e18', '#f97316'] },
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

            <h3 class="text-sm font-medium text-text-primary mb-3">Light Themes</h3>
            <div class="grid grid-cols-2 gap-2">
              {#each [
                { id: 'Snow' as Theme, label: 'Snow', desc: 'Clean white', colors: ['#ffffff', '#f1f5f9', '#6366f1'] },
                { id: 'Sand' as Theme, label: 'Sand', desc: 'Warm cream', colors: ['#fefdfb', '#f5f0e8', '#d97706'] },
                { id: 'Rose' as Theme, label: 'Rose', desc: 'Soft pink', colors: ['#fffbfc', '#fce7eb', '#e11d48'] },
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
                      <div class="w-4 h-4 rounded-sm border border-border/20" style="background-color: {color}"></div>
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
                  <label class="block text-sm font-medium text-text-secondary mb-1">Sessions to Restore on Startup</label>
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      min="1"
                      max="50"
                      step="1"
                      class="flex-1 accent-accent"
                      bind:value={$settings.session_persistence.restore_sessions}
                    />
                    <span class="text-sm text-text-primary w-12 text-right">{$settings.session_persistence.restore_sessions}</span>
                  </div>
                  <p class="text-xs text-text-muted mt-1">Number of recent sessions to load when the app starts</p>
                </div>
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
          <div class="border-t border-border pt-4 mt-4">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary">Include Transcription Notice</label>
                <p class="text-xs text-text-muted mt-0.5">Tell Claude the prompt was voice-transcribed and may contain minor errors</p>
              </div>
              <input type="checkbox" class="toggle" bind:checked={$settings.audio.include_transcription_notice} />
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
          <div class="p-3 bg-surface-elevated rounded border border-border">
            <p class="text-xs text-text-muted">
              <strong class="text-text-secondary">Recording flow:</strong> Press the Record hotkey to start recording.
              While recording, press either hotkey to stop:
            </p>
            <ul class="text-xs text-text-muted mt-1 ml-4 list-disc">
              <li><strong>Record & Send</strong> — transcribes and sends to Claude</li>
              <li><strong>Transcribe Only</strong> — transcribes and pastes to current app</li>
            </ul>
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Record & Send</label>
            <p class="text-xs text-text-muted mb-2">Starts recording. Press again to transcribe and send to Claude.</p>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.toggle_recording} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Transcribe Only</label>
            <p class="text-xs text-text-muted mb-2">While recording, transcribes and pastes into current app (does not send to Claude)</p>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.transcribe_to_input} />
          </div>
          <div class="border-t border-border pt-4">
            <label class="block text-sm font-medium text-text-secondary mb-1">Cycle Repository</label>
            <p class="text-xs text-text-muted mb-2">While recording, cycles through repositories</p>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.cycle_repo} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1">Cycle Model</label>
            <p class="text-xs text-text-muted mb-2">While recording, cycles through models (Opus → Sonnet → Haiku)</p>
            <input type="text" class="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono focus:outline-none focus:border-accent" bind:value={$settings.hotkeys.cycle_model} />
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
            <div>
              <label class="text-sm font-medium text-text-secondary">Show Hotkey Hints</label>
              <p class="text-xs text-text-muted mt-0.5">Display keyboard shortcuts in the overlay while recording</p>
            </div>
            <input type="checkbox" class="toggle" bind:checked={$settings.overlay.show_hotkey_hints} />
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
