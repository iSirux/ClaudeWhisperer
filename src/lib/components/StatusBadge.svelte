<script lang="ts">
  export let createBranch: boolean;
  export let autoMerge: boolean;

  $: badges = [
    createBranch ? 'New branch' : 'Main',
    autoMerge ? 'Automerge' : null,
  ].filter(Boolean);
</script>

<div class="flex items-center gap-1">
  {#each badges as badge}
    <span 
      class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-elevated text-text-secondary border border-border"
    >
      {badge}
    </span>
  {/each}
</div>
