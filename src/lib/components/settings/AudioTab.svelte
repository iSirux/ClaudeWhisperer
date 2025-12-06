<script lang="ts">
  import {
    settings,
    VOICE_COMMAND_PRESETS,
    TRANSCRIBE_COMMAND_PRESETS,
    CANCEL_COMMAND_PRESETS,
    OPEN_MIC_PRESETS,
  } from "$lib/stores/settings";
  import { onMount } from "svelte";
  import { isValidVoiceCommand } from "$lib/utils/voiceCommands";
  import { isValidWakeCommand } from "$lib/stores/openMic";
  import "./toggle.css";

  let audioDevices: MediaDeviceInfo[] = $state([]);
  let loadingDevices = $state(false);
  let customCommand = $state("");
  let customCommandError = $state("");
  let customTranscribeCommand = $state("");
  let customTranscribeCommandError = $state("");
  let customCancelCommand = $state("");
  let customCancelCommandError = $state("");
  let customWakeCommand = $state("");
  let customWakeCommandError = $state("");

  onMount(() => {
    loadAudioDevices();
  });

  async function loadAudioDevices() {
    loadingDevices = true;
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
        });
      const devices = await navigator.mediaDevices.enumerateDevices();
      audioDevices = devices.filter((d) => d.kind === "audioinput");
    } catch (error) {
      console.error("Failed to enumerate audio devices:", error);
    }
    loadingDevices = false;
  }

  function toggleVoiceCommand(command: string) {
    const activeCommands = $settings.audio.voice_commands.active_commands;
    const index = activeCommands.indexOf(command);
    if (index === -1) {
      $settings.audio.voice_commands.active_commands = [
        ...activeCommands,
        command,
      ];
    } else {
      $settings.audio.voice_commands.active_commands = activeCommands.filter(
        (c) => c !== command
      );
    }
  }

  function isCommandActive(command: string): boolean {
    return $settings.audio.voice_commands.active_commands.includes(command);
  }

  function addCustomCommand() {
    const trimmed = customCommand.trim().toLowerCase();
    if (!trimmed) {
      customCommandError = "";
      return;
    }

    if (!isValidVoiceCommand(trimmed)) {
      customCommandError = "Command must be 2-30 characters";
      return;
    }

    // Check if already exists (in presets or active commands)
    const allCommands = [
      ...VOICE_COMMAND_PRESETS,
      ...$settings.audio.voice_commands.active_commands,
    ].map((c) => c.toLowerCase());

    if (allCommands.includes(trimmed)) {
      customCommandError = "Command already exists";
      return;
    }

    $settings.audio.voice_commands.active_commands = [
      ...$settings.audio.voice_commands.active_commands,
      trimmed,
    ];
    customCommand = "";
    customCommandError = "";
  }

  function removeCustomCommand(command: string) {
    $settings.audio.voice_commands.active_commands =
      $settings.audio.voice_commands.active_commands.filter(
        (c) => c !== command
      );
  }

  // Get custom commands (commands not in presets)
  function getCustomCommands(): string[] {
    const presetSet = new Set(
      VOICE_COMMAND_PRESETS.map((c) => c.toLowerCase())
    );
    return $settings.audio.voice_commands.active_commands.filter(
      (c) => !presetSet.has(c.toLowerCase())
    );
  }

  // Transcribe command functions
  function toggleTranscribeCommand(command: string) {
    const transcribeCommands = $settings.audio.voice_commands.transcribe_commands ?? [];
    const index = transcribeCommands.indexOf(command);
    if (index === -1) {
      $settings.audio.voice_commands.transcribe_commands = [
        ...transcribeCommands,
        command,
      ];
    } else {
      $settings.audio.voice_commands.transcribe_commands = transcribeCommands.filter(
        (c) => c !== command
      );
    }
  }

  function isTranscribeCommandActive(command: string): boolean {
    return ($settings.audio.voice_commands.transcribe_commands ?? []).includes(command);
  }

  function addCustomTranscribeCommand() {
    const trimmed = customTranscribeCommand.trim().toLowerCase();
    if (!trimmed) {
      customTranscribeCommandError = "";
      return;
    }

    if (!isValidVoiceCommand(trimmed)) {
      customTranscribeCommandError = "Command must be 2-30 characters";
      return;
    }

    // Check if already exists (in presets or active commands)
    const allCommands = [
      ...TRANSCRIBE_COMMAND_PRESETS,
      ...($settings.audio.voice_commands.transcribe_commands ?? []),
    ].map((c) => c.toLowerCase());

    if (allCommands.includes(trimmed)) {
      customTranscribeCommandError = "Command already exists";
      return;
    }

    $settings.audio.voice_commands.transcribe_commands = [
      ...($settings.audio.voice_commands.transcribe_commands ?? []),
      trimmed,
    ];
    customTranscribeCommand = "";
    customTranscribeCommandError = "";
  }

  function removeCustomTranscribeCommand(command: string) {
    $settings.audio.voice_commands.transcribe_commands =
      ($settings.audio.voice_commands.transcribe_commands ?? []).filter(
        (c) => c !== command
      );
  }

  // Get custom transcribe commands (commands not in presets)
  function getCustomTranscribeCommands(): string[] {
    const presetSet = new Set(
      TRANSCRIBE_COMMAND_PRESETS.map((c) => c.toLowerCase())
    );
    return ($settings.audio.voice_commands.transcribe_commands ?? []).filter(
      (c) => !presetSet.has(c.toLowerCase())
    );
  }

  // Cancel command functions
  function toggleCancelCommand(command: string) {
    const cancelCommands = $settings.audio.voice_commands.cancel_commands ?? [];
    const index = cancelCommands.indexOf(command);
    if (index === -1) {
      $settings.audio.voice_commands.cancel_commands = [
        ...cancelCommands,
        command,
      ];
    } else {
      $settings.audio.voice_commands.cancel_commands = cancelCommands.filter(
        (c) => c !== command
      );
    }
  }

  function isCancelCommandActive(command: string): boolean {
    return ($settings.audio.voice_commands.cancel_commands ?? []).includes(command);
  }

  function addCustomCancelCommand() {
    const trimmed = customCancelCommand.trim().toLowerCase();
    if (!trimmed) {
      customCancelCommandError = "";
      return;
    }

    if (!isValidVoiceCommand(trimmed)) {
      customCancelCommandError = "Command must be 2-30 characters";
      return;
    }

    // Check if already exists (in presets or active commands)
    const allCommands = [
      ...CANCEL_COMMAND_PRESETS,
      ...($settings.audio.voice_commands.cancel_commands ?? []),
    ].map((c) => c.toLowerCase());

    if (allCommands.includes(trimmed)) {
      customCancelCommandError = "Command already exists";
      return;
    }

    $settings.audio.voice_commands.cancel_commands = [
      ...($settings.audio.voice_commands.cancel_commands ?? []),
      trimmed,
    ];
    customCancelCommand = "";
    customCancelCommandError = "";
  }

  function removeCustomCancelCommand(command: string) {
    $settings.audio.voice_commands.cancel_commands =
      ($settings.audio.voice_commands.cancel_commands ?? []).filter(
        (c) => c !== command
      );
  }

  // Get custom cancel commands (commands not in presets)
  function getCustomCancelCommands(): string[] {
    const presetSet = new Set(
      CANCEL_COMMAND_PRESETS.map((c) => c.toLowerCase())
    );
    return ($settings.audio.voice_commands.cancel_commands ?? []).filter(
      (c) => !presetSet.has(c.toLowerCase())
    );
  }

  // Open Mic wake command functions
  function toggleWakeCommand(command: string) {
    const wakeCommands = $settings.audio.open_mic.wake_commands;
    const index = wakeCommands.indexOf(command);
    if (index === -1) {
      $settings.audio.open_mic.wake_commands = [...wakeCommands, command];
    } else {
      $settings.audio.open_mic.wake_commands = wakeCommands.filter(
        (c) => c !== command
      );
    }
  }

  function isWakeCommandActive(command: string): boolean {
    return $settings.audio.open_mic.wake_commands.includes(command);
  }

  function addCustomWakeCommand() {
    const trimmed = customWakeCommand.trim().toLowerCase();
    if (!trimmed) {
      customWakeCommandError = "";
      return;
    }

    if (!isValidWakeCommand(trimmed)) {
      customWakeCommandError = "Command must be 2-30 characters";
      return;
    }

    // Check if already exists (in presets or active commands)
    const allCommands = [
      ...OPEN_MIC_PRESETS,
      ...$settings.audio.open_mic.wake_commands,
    ].map((c) => c.toLowerCase());

    if (allCommands.includes(trimmed)) {
      customWakeCommandError = "Command already exists";
      return;
    }

    $settings.audio.open_mic.wake_commands = [
      ...$settings.audio.open_mic.wake_commands,
      trimmed,
    ];
    customWakeCommand = "";
    customWakeCommandError = "";
  }

  function removeCustomWakeCommand(command: string) {
    $settings.audio.open_mic.wake_commands =
      $settings.audio.open_mic.wake_commands.filter((c) => c !== command);
  }

  // Get custom wake commands (commands not in presets)
  function getCustomWakeCommands(): string[] {
    const presetSet = new Set(OPEN_MIC_PRESETS.map((c) => c.toLowerCase()));
    return $settings.audio.open_mic.wake_commands.filter(
      (c) => !presetSet.has(c.toLowerCase())
    );
  }
</script>

<div class="space-y-4">
  <div>
    <label class="block text-sm font-medium text-text-secondary mb-1"
      >Microphone</label
    >
    <div class="flex gap-2">
      <select
        class="flex-1 px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
        bind:value={$settings.audio.device_id}
        disabled={loadingDevices}
      >
        <option value={null}>System Default</option>
        {#each audioDevices as device}
          <option value={device.deviceId}
            >{device.label ||
              `Microphone ${device.deviceId.slice(0, 8)}`}</option
          >
        {/each}
      </select>
      <button
        class="px-3 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
        onclick={loadAudioDevices}
        disabled={loadingDevices}
      >
        {#if loadingDevices}
          <div
            class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
          ></div>
        {:else}
          Refresh
        {/if}
      </button>
    </div>
  </div>
  <div class="flex items-center justify-between">
    <label class="text-sm font-medium text-text-secondary"
      >Use Hotkey</label
    >
    <input
      type="checkbox"
      class="toggle"
      bind:checked={$settings.audio.use_hotkey}
    />
  </div>
  <div class="border-t border-border pt-4 mt-4">
    <div class="flex items-center justify-between">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Play Sound on Completion</label
        >
        <p class="text-xs text-text-muted mt-0.5">
          Play a notification sound when SDK session completes
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.play_sound_on_completion}
      />
    </div>
    <div class="flex items-center justify-between mt-4">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Play Sound on Repo Select</label
        >
        <p class="text-xs text-text-muted mt-0.5">
          Play a confirmation sound when selecting a repository
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.play_sound_on_repo_select}
      />
    </div>
    <div class="flex items-center justify-between mt-4">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Play Sound on Open Mic Trigger</label
        >
        <p class="text-xs text-text-muted mt-0.5">
          Play a sound when a wake command starts recording
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.play_sound_on_open_mic_trigger}
      />
    </div>
    <div class="flex items-center justify-between mt-4">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Play Sound on Voice Command</label
        >
        <p class="text-xs text-text-muted mt-0.5">
          Play a sound when a voice command (like "go go") is detected
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.play_sound_on_voice_command}
      />
    </div>
  </div>
  <div class="border-t border-border pt-4 mt-4">
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1"
        >Recording Linger Time</label
      >
      <p class="text-xs text-text-muted mb-2">
        Delay before stopping recording to prevent audio cutoff (0 to
        disable)
      </p>
      <div class="flex items-center gap-3">
        <input
          type="range"
          min="0"
          max="1000"
          step="50"
          class="flex-1 accent-accent"
          bind:value={$settings.audio.recording_linger_ms}
        />
        <span class="text-sm text-text-primary w-16 text-right"
          >{$settings.audio.recording_linger_ms}ms</span
        >
      </div>
    </div>
  </div>
  <div class="border-t border-border pt-4 mt-4">
    <div class="flex items-center justify-between">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Include Transcription Notice</label
        >
        <p class="text-xs text-text-muted mt-0.5">
          Tell Claude the prompt was voice-transcribed and may contain
          minor errors
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.include_transcription_notice}
      />
    </div>
  </div>

  <!-- Voice Commands Section -->
  <div class="border-t border-border pt-4 mt-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Voice Commands</label
        >
        <p class="text-xs text-text-muted mt-0.5">
          Say a command at the end of your recording to automatically send the
          prompt
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.voice_commands.enabled}
      />
    </div>

    {#if $settings.audio.voice_commands.enabled}
      <div class="space-y-3 mt-4">
        <!-- Preset Commands -->
        <div>
          <label class="block text-xs font-medium text-text-muted mb-2"
            >Preset Commands</label
          >
          <div class="flex flex-wrap gap-2">
            {#each VOICE_COMMAND_PRESETS as command}
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-full border transition-colors {isCommandActive(
                  command
                )
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-elevated text-text-secondary border-border hover:border-accent hover:text-text-primary'}"
                onclick={() => toggleVoiceCommand(command)}
              >
                "{command}"
              </button>
            {/each}
          </div>
        </div>

        <!-- Custom Commands -->
        <div>
          <label class="block text-xs font-medium text-text-muted mb-2"
            >Custom Commands</label
          >
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Add custom command..."
              class="flex-1 px-3 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={customCommand}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomCommand();
                }
              }}
            />
            <button
              type="button"
              class="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
              onclick={addCustomCommand}
              disabled={!customCommand.trim()}
            >
              Add
            </button>
          </div>
          {#if customCommandError}
            <p class="text-xs text-red-500 mt-1">{customCommandError}</p>
          {/if}

          {#if getCustomCommands().length > 0}
            <div class="flex flex-wrap gap-2 mt-2">
              {#each getCustomCommands() as command}
                <div
                  class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full bg-accent text-white"
                >
                  <span>"{command}"</span>
                  <button
                    type="button"
                    class="ml-1 hover:bg-white/20 rounded-full p-0.5 transition-colors"
                    onclick={() => removeCustomCommand(command)}
                    title="Remove command"
                  >
                    <svg
                      class="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Active Commands Summary -->
        {#if $settings.audio.voice_commands.active_commands.length > 0}
          <p class="text-xs text-text-muted">
            Active commands: {$settings.audio.voice_commands.active_commands.length}
            - Commands will be removed from the transcript before sending
          </p>
        {:else}
          <p class="text-xs text-yellow-500">
            No commands selected. Select at least one command to enable voice
            triggering.
          </p>
        {/if}

        <!-- Transcribe Commands Section -->
        <div class="border-t border-border/50 pt-4 mt-4">
          <div class="mb-3">
            <label class="text-sm font-medium text-text-secondary"
              >Transcribe-to-Input Commands</label
            >
            <p class="text-xs text-text-muted mt-0.5">
              Say these commands to paste the transcription into the current app instead of sending to Claude
            </p>
          </div>

          <!-- Preset Transcribe Commands -->
          <div>
            <label class="block text-xs font-medium text-text-muted mb-2"
              >Preset Commands</label
            >
            <div class="flex flex-wrap gap-2">
              {#each TRANSCRIBE_COMMAND_PRESETS as command}
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded-full border transition-colors {isTranscribeCommandActive(
                    command
                  )
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-surface-elevated text-text-secondary border-border hover:border-blue-500 hover:text-text-primary'}"
                  onclick={() => toggleTranscribeCommand(command)}
                >
                  "{command}"
                </button>
              {/each}
            </div>
          </div>

          <!-- Custom Transcribe Commands -->
          <div class="mt-3">
            <label class="block text-xs font-medium text-text-muted mb-2"
              >Custom Commands</label
            >
            <div class="flex gap-2">
              <input
                type="text"
                placeholder="Add custom command..."
                class="flex-1 px-3 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:border-blue-500"
                bind:value={customTranscribeCommand}
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTranscribeCommand();
                  }
                }}
              />
              <button
                type="button"
                class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                onclick={addCustomTranscribeCommand}
                disabled={!customTranscribeCommand.trim()}
              >
                Add
              </button>
            </div>
            {#if customTranscribeCommandError}
              <p class="text-xs text-red-500 mt-1">{customTranscribeCommandError}</p>
            {/if}

            {#if getCustomTranscribeCommands().length > 0}
              <div class="flex flex-wrap gap-2 mt-2">
                {#each getCustomTranscribeCommands() as command}
                  <div
                    class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full bg-blue-600 text-white"
                  >
                    <span>"{command}"</span>
                    <button
                      type="button"
                      class="ml-1 hover:bg-white/20 rounded-full p-0.5 transition-colors"
                      onclick={() => removeCustomTranscribeCommand(command)}
                      title="Remove command"
                    >
                      <svg
                        class="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Active Transcribe Commands Summary -->
          {#if ($settings.audio.voice_commands.transcribe_commands ?? []).length > 0}
            <p class="text-xs text-text-muted mt-3">
              Active transcribe commands: {($settings.audio.voice_commands.transcribe_commands ?? []).length}
              - Commands will paste the transcript into the current app
            </p>
          {:else}
            <p class="text-xs text-text-muted mt-3">
              No transcribe commands selected. Optional: select commands to enable voice-triggered transcription.
            </p>
          {/if}
        </div>

        <!-- Cancel Commands Section -->
        <div class="border-t border-border/50 pt-4 mt-4">
          <div class="mb-3">
            <label class="text-sm font-medium text-text-secondary"
              >Cancel/Discard Commands</label
            >
            <p class="text-xs text-text-muted mt-0.5">
              Say these commands to cancel and discard the current recording
            </p>
          </div>

          <!-- Preset Cancel Commands -->
          <div>
            <label class="block text-xs font-medium text-text-muted mb-2"
              >Preset Commands</label
            >
            <div class="flex flex-wrap gap-2">
              {#each CANCEL_COMMAND_PRESETS as command}
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded-full border transition-colors {isCancelCommandActive(
                    command
                  )
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-surface-elevated text-text-secondary border-border hover:border-red-500 hover:text-text-primary'}"
                  onclick={() => toggleCancelCommand(command)}
                >
                  "{command}"
                </button>
              {/each}
            </div>
          </div>

          <!-- Custom Cancel Commands -->
          <div class="mt-3">
            <label class="block text-xs font-medium text-text-muted mb-2"
              >Custom Commands</label
            >
            <div class="flex gap-2">
              <input
                type="text"
                placeholder="Add custom command..."
                class="flex-1 px-3 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:border-red-500"
                bind:value={customCancelCommand}
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomCancelCommand();
                  }
                }}
              />
              <button
                type="button"
                class="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
                onclick={addCustomCancelCommand}
                disabled={!customCancelCommand.trim()}
              >
                Add
              </button>
            </div>
            {#if customCancelCommandError}
              <p class="text-xs text-red-500 mt-1">{customCancelCommandError}</p>
            {/if}

            {#if getCustomCancelCommands().length > 0}
              <div class="flex flex-wrap gap-2 mt-2">
                {#each getCustomCancelCommands() as command}
                  <div
                    class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full bg-red-600 text-white"
                  >
                    <span>"{command}"</span>
                    <button
                      type="button"
                      class="ml-1 hover:bg-white/20 rounded-full p-0.5 transition-colors"
                      onclick={() => removeCustomCancelCommand(command)}
                      title="Remove command"
                    >
                      <svg
                        class="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Active Cancel Commands Summary -->
          {#if ($settings.audio.voice_commands.cancel_commands ?? []).length > 0}
            <p class="text-xs text-text-muted mt-3">
              Active cancel commands: {($settings.audio.voice_commands.cancel_commands ?? []).length}
              - Recording will be discarded when these commands are detected
            </p>
          {:else}
            <p class="text-xs text-text-muted mt-3">
              No cancel commands selected. Optional: select commands to enable voice-triggered cancellation.
            </p>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Open Mic Section -->
  <div class="border-t border-border pt-4 mt-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <label class="text-sm font-medium text-text-secondary">Open Mic</label>
        <p class="text-xs text-text-muted mt-0.5">
          Passively listen for wake commands to start recording hands-free
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.audio.open_mic.enabled}
        disabled={!$settings.vosk?.enabled}
      />
    </div>

    {#if !$settings.vosk?.enabled}
      <p class="text-xs text-yellow-500">
        Vosk must be enabled for open mic mode. Enable it in the Vosk tab.
      </p>
    {:else if $settings.audio.open_mic.enabled}
      <div class="space-y-3 mt-4">
        <!-- Preset Wake Commands -->
        <div>
          <label class="block text-xs font-medium text-text-muted mb-2"
            >Wake Commands</label
          >
          <div class="flex flex-wrap gap-2">
            {#each OPEN_MIC_PRESETS as command}
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-full border transition-colors {isWakeCommandActive(
                  command
                )
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-surface-elevated text-text-secondary border-border hover:border-green-500 hover:text-text-primary'}"
                onclick={() => toggleWakeCommand(command)}
              >
                "{command}"
              </button>
            {/each}
          </div>
        </div>

        <!-- Custom Wake Commands -->
        <div>
          <label class="block text-xs font-medium text-text-muted mb-2"
            >Custom Wake Commands</label
          >
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Add custom wake command..."
              class="flex-1 px-3 py-1.5 bg-background border border-border rounded text-sm focus:outline-none focus:border-green-500"
              bind:value={customWakeCommand}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomWakeCommand();
                }
              }}
            />
            <button
              type="button"
              class="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
              onclick={addCustomWakeCommand}
              disabled={!customWakeCommand.trim()}
            >
              Add
            </button>
          </div>
          {#if customWakeCommandError}
            <p class="text-xs text-red-500 mt-1">{customWakeCommandError}</p>
          {/if}

          {#if getCustomWakeCommands().length > 0}
            <div class="flex flex-wrap gap-2 mt-2">
              {#each getCustomWakeCommands() as command}
                <div
                  class="flex items-center gap-1 px-3 py-1.5 text-sm rounded-full bg-green-600 text-white"
                >
                  <span>"{command}"</span>
                  <button
                    type="button"
                    class="ml-1 hover:bg-white/20 rounded-full p-0.5 transition-colors"
                    onclick={() => removeCustomWakeCommand(command)}
                    title="Remove command"
                  >
                    <svg
                      class="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Active Wake Commands Summary -->
        {#if $settings.audio.open_mic.wake_commands.length > 0}
          <p class="text-xs text-text-muted">
            Active wake commands: {$settings.audio.open_mic.wake_commands
              .length} - Say any of these to start recording
          </p>
        {:else}
          <p class="text-xs text-yellow-500">
            No wake commands selected. Select at least one command to enable
            open mic.
          </p>
        {/if}
      </div>
    {/if}
  </div>
</div>
