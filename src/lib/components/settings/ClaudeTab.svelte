<script lang="ts">
  import { settings } from "$lib/stores/settings";
  import { ALL_MODELS } from "$lib/utils/models";
  import {
    getModelBadgeBgColor,
    getModelTextColor,
  } from "$lib/utils/modelColors";
  import "./toggle.css";

  function toggleModel(modelId: string) {
    const currentEnabled = $settings.enabled_models || [];
    const isEnabled = currentEnabled.includes(modelId);

    if (isEnabled) {
      // Don't allow disabling if it would leave less than 1 model enabled
      if (currentEnabled.length <= 1) {
        return;
      }
      // Remove the model
      const newEnabled = currentEnabled.filter((id: string) => id !== modelId);
      settings.update((s) => ({ ...s, enabled_models: newEnabled }));

      // If the default model was disabled, switch to the first enabled model
      if ($settings.default_model === modelId && newEnabled.length > 0) {
        settings.update((s) => ({ ...s, default_model: newEnabled[0] }));
      }
    } else {
      // Add the model
      settings.update((s) => ({
        ...s,
        enabled_models: [...currentEnabled, modelId],
      }));
    }
  }

  function isModelEnabled(modelId: string): boolean {
    return ($settings.enabled_models || []).includes(modelId);
  }
</script>

<div class="space-y-4">
  <div>
    <label class="block text-sm font-medium text-text-secondary mb-1"
      >Terminal Mode</label
    >
    <select
      class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
      bind:value={$settings.terminal_mode}
    >
      <option value="Interactive">Interactive</option>
      <option value="Prompt">Prompt (-p flag)</option>
      <option value="Sdk">SDK (Agent SDK)</option>
    </select>
    <p class="text-xs text-text-muted mt-1">
      {#if $settings.terminal_mode === "Interactive"}
        Full terminal control with multi-turn conversations.
      {:else if $settings.terminal_mode === "Prompt"}
        Runs single prompt and exits. Good for one-shot tasks.
      {:else if $settings.terminal_mode === "Sdk"}
        Uses Claude Agent SDK for structured messages and tool
        visibility.
      {/if}
    </p>
  </div>
  {#if $settings.terminal_mode === "Interactive" || $settings.terminal_mode === "Prompt"}
    <div class="flex items-center justify-between">
      <div>
        <label class="text-sm font-medium text-text-secondary"
          >Skip Permissions</label
        >
        <p class="text-xs text-text-muted">
          Use --dangerously-skip-permissions flag
        </p>
      </div>
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.skip_permissions}
      />
    </div>
  {/if}

  <div class="border-t border-border pt-4 mt-4">
    <h3 class="text-sm font-medium text-text-primary mb-2">
      Enabled Models
    </h3>
    <p class="text-xs text-text-muted mb-3">
      Select which models are available in the model selector and for
      hotkey cycling. At least one model must remain enabled.
    </p>
    <div class="space-y-2">
      {#each ALL_MODELS as model}
        {@const enabled = isModelEnabled(model.id)}
        {@const isOnlyEnabled =
          enabled && ($settings.enabled_models || []).length === 1}
        <button
          class="w-full flex items-center justify-between p-3 rounded border-2 transition-all {enabled
            ? 'border-accent bg-accent/10'
            : 'border-border opacity-50'}"
          class:cursor-not-allowed={isOnlyEnabled}
          onclick={() => toggleModel(model.id)}
          title={isOnlyEnabled
            ? "At least one model must remain enabled"
            : model.title}
        >
          <div class="flex items-center gap-3">
            <div
              class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors"
              class:border-accent={enabled}
              class:bg-accent={enabled}
              class:border-border={!enabled}
            >
              {#if enabled}
                <svg
                  class="w-3 h-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              {/if}
            </div>
            <div class="text-left">
              <div class="flex items-center gap-2">
                <span
                  class="text-sm font-medium px-2 py-0.5 rounded {getModelBadgeBgColor(
                    model.id
                  )} {getModelTextColor(model.id)}">{model.label}</span
                >
              </div>
              <p class="text-xs text-text-muted mt-0.5">
                {model.title}
              </p>
            </div>
          </div>
          {#if isOnlyEnabled}
            <span class="text-xs text-text-muted">Required</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="border-t border-border pt-4 mt-4">
    <h3 class="text-sm font-medium text-text-primary mb-3">
      Transcription
    </h3>
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
</div>
