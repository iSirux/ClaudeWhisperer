<script lang="ts">
  import { settings } from "$lib/stores/settings";
  import "./toggle.css";
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <label class="text-sm font-medium text-text-secondary"
      >Create New Branch</label
    >
    <input
      type="checkbox"
      class="toggle"
      bind:checked={$settings.git.create_branch}
    />
  </div>
  {#if $settings.git.create_branch}
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium text-text-secondary"
        >Use Git Worktrees</label
      >
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.git.use_worktrees}
      />
    </div>
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium text-text-secondary"
        >Auto-merge to Main</label
      >
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.git.auto_merge}
      />
    </div>
    <div class="flex items-center justify-between">
      <label class="text-sm font-medium text-text-secondary"
        >Create Pull Request</label
      >
      <input
        type="checkbox"
        class="toggle"
        bind:checked={$settings.git.create_pr}
      />
    </div>
  {/if}
</div>
