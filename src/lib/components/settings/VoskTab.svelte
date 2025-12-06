<script lang="ts">
  import { settings } from "$lib/stores/settings";
  import { invoke } from "@tauri-apps/api/core";
  import "./toggle.css";

  interface VoskConnectionTestResult {
    connected: boolean;
    error: string | null;
  }

  let testingVosk = $state(false);
  let voskStatus: "idle" | "success" | "error" = $state("idle");
  let voskTestResult: VoskConnectionTestResult | null = $state(null);

  async function testVoskConnection() {
    testingVosk = true;
    voskStatus = "idle";
    voskTestResult = null;
    try {
      const result = await invoke<VoskConnectionTestResult>(
        "test_vosk_connection"
      );
      voskTestResult = result;
      voskStatus = result.connected ? "success" : "error";
    } catch (error) {
      voskStatus = "error";
      voskTestResult = {
        connected: false,
        error: String(error),
      };
    }
    testingVosk = false;
  }
</script>

<div class="space-y-4">
  <div class="p-3 bg-surface rounded-lg border border-border/50">
    <p class="text-sm text-text-secondary">
      Vosk provides <strong>real-time transcription</strong> while you speak.
      It runs alongside Whisper:
    </p>
    <ul class="mt-2 text-sm text-text-muted list-disc list-inside">
      <li>Vosk shows live text in the overlay as you speak</li>
      <li>Whisper provides the final accurate transcription</li>
      <li>Requires a local Vosk server (Docker recommended)</li>
    </ul>
  </div>

  <!-- Enable toggle -->
  <div class="flex items-center justify-between">
    <span class="text-sm text-text-secondary"
      >Enable Vosk real-time transcription</span
    >
    <input
      type="checkbox"
      class="toggle"
      bind:checked={$settings.vosk.enabled}
    />
  </div>

  {#if $settings.vosk.enabled}
    <!-- WebSocket Endpoint -->
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1"
        >WebSocket Endpoint</label
      >
      <input
        type="text"
        class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
        bind:value={$settings.vosk.endpoint}
        placeholder="ws://localhost:2700"
      />
      <p class="text-xs text-text-muted mt-1">
        Default Vosk server uses port 2700
      </p>
    </div>

    <!-- Sample Rate -->
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1"
        >Sample Rate</label
      >
      <select
        class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
        bind:value={$settings.vosk.sample_rate}
      >
        <option value={8000}>8000 Hz (telephony)</option>
        <option value={16000}>16000 Hz (recommended)</option>
        <option value={44100}>44100 Hz (CD quality)</option>
        <option value={48000}>48000 Hz (professional)</option>
      </select>
      <p class="text-xs text-text-muted mt-1">
        Must match the Vosk model's expected sample rate (usually 16kHz)
      </p>
    </div>

    <!-- Show in overlay toggle -->
    <div class="flex items-center justify-between">
      <span class="text-sm text-text-secondary"
        >Show real-time transcript in overlay</span
      >
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.vosk.show_realtime_transcript}
      />
    </div>

    <!-- Accumulate transcript toggle -->
    <div class="flex items-center justify-between">
      <div>
        <span class="text-sm text-text-secondary"
          >Accumulate text across pauses</span
        >
        <p class="text-xs text-text-muted mt-1">
          When enabled, text accumulates as you speak with pauses. When
          disabled, the transcript resets after each pause.
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.vosk.accumulate_transcript}
      />
    </div>

    <!-- Connection test -->
    <div class="pt-4 border-t border-border/50">
      <button
        class="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed"
        onclick={testVoskConnection}
        disabled={testingVosk}
      >
        {testingVosk ? "Testing..." : "Test Connection"}
      </button>
      {#if voskStatus === "success"}
        <span class="ml-2 text-success text-sm"
          >Connected successfully!</span
        >
      {:else if voskStatus === "error" && voskTestResult}
        <span class="ml-2 text-error text-sm"
          >{voskTestResult.error || "Connection failed"}</span
        >
      {/if}
    </div>

    <!-- Docker Setup -->
    {@const voskDockerCommand = (() => {
      const parts = ["docker run -d"];

      // Auto-restart option
      if ($settings.vosk.docker.auto_restart) {
        parts.push("--restart unless-stopped");
      }

      // Port mapping
      parts.push("-p 2700:2700");

      // Container name
      if ($settings.vosk.docker.container_name) {
        parts.push(`--name ${$settings.vosk.docker.container_name}`);
      }

      // Image (Vosk uses alphacep images, CPU only)
      parts.push("alphacep/kaldi-en:latest");

      return parts.join(" \\\n  ");
    })()}
    <div class="border-t border-border pt-4 mt-4">
      <label class="block text-sm font-medium text-text-secondary mb-3"
        >Docker Setup</label
      >

      <!-- Auto-restart Option -->
      <div class="flex items-center justify-between mb-4">
        <div>
          <label class="text-sm font-medium text-text-secondary"
            >Auto-start with Docker</label
          >
          <p class="text-xs text-text-muted">
            Container starts automatically when Docker Engine starts
          </p>
        </div>
        <input
          type="checkbox"
          class="toggle"
          checked={$settings.vosk.docker.auto_restart}
          onchange={(e) => {
            const checked = (e.target as HTMLInputElement).checked;
            settings.update((s) => ({
              ...s,
              vosk: {
                ...s.vosk,
                docker: { ...s.vosk.docker, auto_restart: checked },
              },
            }));
          }}
        />
      </div>

      <!-- Container Name -->
      <div class="mb-4">
        <label class="block text-xs font-medium text-text-muted mb-2"
          >Container Name</label
        >
        <input
          type="text"
          class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent font-mono"
          value={$settings.vosk.docker.container_name}
          oninput={(e) => {
            const value = (e.target as HTMLInputElement).value;
            settings.update((s) => ({
              ...s,
              vosk: {
                ...s.vosk,
                docker: { ...s.vosk.docker, container_name: value },
              },
            }));
          }}
          placeholder="claude-whisperer-vosk"
        />
      </div>

      <!-- Generated Command -->
      <div class="mb-3">
        <label class="block text-xs font-medium text-text-muted mb-2"
          >Docker Command</label
        >
        <div class="relative group">
          <pre
            class="p-3 bg-background border border-border rounded text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">{voskDockerCommand}</pre>
          <button
            class="absolute top-2 right-2 p-1.5 bg-surface-elevated hover:bg-border rounded text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
            onclick={async () => {
              await navigator.clipboard.writeText(
                voskDockerCommand.replace(/\s*\\\n\s*/g, " ")
              );
            }}
            title="Copy to clipboard"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        </div>
        <button
          class="mt-2 px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded transition-colors flex items-center gap-2"
          onclick={async () => {
            const singleLine = voskDockerCommand.replace(/\s*\\\n\s*/g, " ");
            try {
              await invoke("run_in_terminal", { command: singleLine });
            } catch (e) {
              console.error("Failed to run in terminal:", e);
            }
          }}
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Run in Terminal
        </button>
      </div>

      <p class="text-xs text-text-muted">
        Other language models: <code class="bg-surface px-1 rounded"
          >kaldi-cn</code
        >, <code class="bg-surface px-1 rounded">kaldi-ru</code>,
        <code class="bg-surface px-1 rounded">kaldi-fr</code>,
        <code class="bg-surface px-1 rounded">kaldi-de</code>
      </p>
    </div>
  {/if}
</div>
