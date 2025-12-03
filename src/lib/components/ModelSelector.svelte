<script lang="ts">
  interface Props {
    model: string;
    onchange: (model: string) => void;
    size?: 'sm' | 'md';
  }

  let { model, onchange, size = 'sm' }: Props = $props();

  const models = [
    { id: 'claude-opus-4-5', label: 'Opus', title: 'Claude Opus 4.5 - Most capable model' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet', title: 'Claude Sonnet 4.5 - Balanced performance' },
    { id: 'claude-sonnet-4-5-20250929[1m]', label: 'Sonnet 1M', title: 'Claude Sonnet 4.5 - 1M token context window' },
    { id: 'claude-haiku-4-5', label: 'Haiku', title: 'Claude Haiku 4.5 - Fastest model' },
  ];

  const sizeClasses = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-2 text-sm'
  };
</script>

<div class="flex items-center gap-1 px-2 py-1 bg-surface-elevated rounded">
  {#each models as { id, label, title }}
    <button
      class="rounded font-medium transition-all {sizeClasses[size]}"
      class:bg-accent={model === id}
      class:text-white={model === id}
      class:shadow-md={model === id}
      class:ring-2={model === id}
      class:ring-accent={model === id}
      class:ring-opacity-50={model === id}
      class:scale-105={model === id}
      class:text-text-secondary={model !== id}
      class:hover:bg-border={model !== id}
      onclick={() => onchange(id)}
      {title}
    >
      {label}
    </button>
  {/each}
</div>
