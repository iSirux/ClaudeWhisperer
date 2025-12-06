<script lang="ts">
  import { settings } from "$lib/stores/settings";
  import "./toggle.css";
</script>

<div class="space-y-4">
  <div>
    <label class="block text-sm font-medium text-text-secondary mb-1"
      >Session List Sort Order</label
    >
    <select
      class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
      bind:value={$settings.session_sort_order}
    >
      <option value="Chronological">Chronological (newest first)</option>
      <option value="StatusThenChronological"
        >Status, then chronological</option
      >
    </select>
    <p class="text-xs text-text-muted mt-1">
      {#if $settings.session_sort_order === "Chronological"}
        Sessions sorted by creation time, newest first.
      {:else}
        Active sessions first, then by creation time.
      {/if}
    </p>
  </div>
  <div class="flex items-center justify-between">
    <div>
      <label class="text-sm font-medium text-text-secondary"
        >Mark Completed Sessions as Unread</label
      >
      <p class="text-xs text-text-muted">
        Highlight sessions that have completed until you click on them
      </p>
    </div>
    <input
      type="checkbox"
      class="toggle"
      bind:checked={$settings.mark_sessions_unread}
    />
  </div>
  <div class="flex items-center justify-between">
    <div>
      <label class="text-sm font-medium text-text-secondary"
        >Show Latest Message Preview</label
      >
      <p class="text-xs text-text-muted">
        Display a snippet of the latest response in each SDK session
      </p>
    </div>
    <input
      type="checkbox"
      class="toggle"
      bind:checked={$settings.show_latest_message_preview}
    />
  </div>
  <div class="border-t border-border pt-4 mt-4">
    <h3 class="text-sm font-medium text-text-primary mb-3">
      Session List Row Limits
    </h3>
    <div class="space-y-4">
      <div>
        <label
          class="block text-sm font-medium text-text-secondary mb-1"
          >User Prompt Rows</label
        >
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="1"
            max="6"
            step="1"
            class="flex-1 accent-accent"
            bind:value={$settings.session_prompt_rows}
          />
          <span class="text-sm text-text-primary w-8 text-right"
            >{$settings.session_prompt_rows}</span
          >
        </div>
        <p class="text-xs text-text-muted mt-1">
          Maximum rows to show for user prompts in session list
        </p>
      </div>
      <div>
        <label
          class="block text-sm font-medium text-text-secondary mb-1"
          >Agent Response Rows</label
        >
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="1"
            max="6"
            step="1"
            class="flex-1 accent-accent"
            bind:value={$settings.session_response_rows}
          />
          <span class="text-sm text-text-primary w-8 text-right"
            >{$settings.session_response_rows}</span
          >
        </div>
        <p class="text-xs text-text-muted mt-1">
          Maximum rows to show for agent responses in session list
        </p>
      </div>
    </div>
  </div>
</div>
