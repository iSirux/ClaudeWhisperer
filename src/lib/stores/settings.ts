import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface WhisperConfig {
  endpoint: string;
  model: string;
  language: string;
}

export interface HaikuConfig {
  enabled: boolean;
  api_key: string;
  model: string;
}

export interface GitConfig {
  create_branch: boolean;
  auto_merge: boolean;
  create_pr: boolean;
  use_worktrees: boolean;
}

export interface HotkeyConfig {
  toggle_recording: string;
  toggle_open_mic: string;
  send_prompt: string;
  switch_repo: string;
}

export interface OverlayConfig {
  show_transcript: boolean;
  transcript_lines: number;
  show_settings: boolean;
  show_terminals: boolean;
}

export interface AudioConfig {
  device_id: string | null;
  open_mic: boolean;
  voice_command: string;
  use_voice_command: boolean;
  use_hotkey: boolean;
}

export interface RepoConfig {
  path: string;
  name: string;
}

export interface AppConfig {
  whisper: WhisperConfig;
  haiku: HaikuConfig;
  git: GitConfig;
  hotkeys: HotkeyConfig;
  overlay: OverlayConfig;
  audio: AudioConfig;
  repos: RepoConfig[];
  active_repo_index: number;
  default_model: string;
}

const defaultConfig: AppConfig = {
  whisper: {
    endpoint: 'http://localhost:8000/v1/audio/transcriptions',
    model: 'base',
    language: 'en',
  },
  haiku: {
    enabled: false,
    api_key: '',
    model: 'claude-3-haiku-20240307',
  },
  git: {
    create_branch: true,
    auto_merge: false,
    create_pr: false,
    use_worktrees: true,
  },
  hotkeys: {
    toggle_recording: 'CommandOrControl+Shift+Space',
    toggle_open_mic: 'CommandOrControl+Shift+M',
    send_prompt: 'CommandOrControl+Enter',
    switch_repo: 'CommandOrControl+Shift+R',
  },
  overlay: {
    show_transcript: true,
    transcript_lines: 3,
    show_settings: true,
    show_terminals: true,
  },
  audio: {
    device_id: null,
    open_mic: false,
    voice_command: 'go go',
    use_voice_command: true,
    use_hotkey: true,
  },
  repos: [],
  active_repo_index: 0,
  default_model: 'claude-sonnet-4-20250514',
};

function createSettingsStore() {
  const { subscribe, set, update } = writable<AppConfig>(defaultConfig);

  return {
    subscribe,
    set,
    update,

    async load() {
      try {
        const config = await invoke<AppConfig>('get_config');
        set(config);
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    },

    async save(config: AppConfig) {
      try {
        await invoke('save_config', { newConfig: config });
        set(config);
      } catch (error) {
        console.error('Failed to save config:', error);
        throw error;
      }
    },

    async addRepo(path: string, name: string) {
      try {
        await invoke('add_repo', { path, name });
        await this.load();
      } catch (error) {
        console.error('Failed to add repo:', error);
        throw error;
      }
    },

    async removeRepo(index: number) {
      try {
        await invoke('remove_repo', { index });
        await this.load();
      } catch (error) {
        console.error('Failed to remove repo:', error);
        throw error;
      }
    },

    async setActiveRepo(index: number) {
      try {
        await invoke('set_active_repo', { index });
        await this.load();
      } catch (error) {
        console.error('Failed to set active repo:', error);
        throw error;
      }
    },
  };
}

export const settings = createSettingsStore();

export const activeRepo = derived(settings, ($settings) => {
  return $settings.repos[$settings.active_repo_index] || null;
});
