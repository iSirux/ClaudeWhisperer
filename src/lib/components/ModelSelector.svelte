<script lang="ts">
  import {
    getModelBgColor,
    getModelRingColor,
    getModelHoverBgColor,
  } from "$lib/utils/modelColors";

  interface Props {
    model: string;
    onchange: (model: string) => void;
    size?: "sm" | "md";
  }

  let { model, onchange, size = "sm" }: Props = $props();

  const models = [
    {
      id: "claude-opus-4-5-20251101",
      label: "Opus",
      title: "Claude Opus 4.5 - Most capable model",
    },
    {
      id: "claude-sonnet-4-5-20250929",
      label: "Sonnet",
      title: "Claude Sonnet 4.5 - Balanced performance",
    },
    {
      id: "claude-sonnet-4-5-20250929[1m]",
      label: "Sonnet 1M",
      title: "Claude Sonnet 4.5 - 1M token context window",
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Haiku",
      title: "Claude Haiku 4.5 - Fastest model",
    },
  ];

  const sizeClasses = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-2 text-sm",
  };

  function getButtonClasses(id: string, isSelected: boolean): string {
    const base = `rounded font-medium transition-all ${sizeClasses[size]}`;

    if (isSelected) {
      return `${base} ${getModelBgColor(id)} text-white shadow-md ring-2 ${getModelRingColor(id)} ring-opacity-50 scale-105`;
    }

    return `${base} text-text-secondary ${getModelHoverBgColor(id)}`;
  }
</script>

<div class="flex items-center gap-1 px-2 py-1 bg-surface-elevated rounded">
  {#each models as { id, label, title }}
    <button
      class={getButtonClasses(id, model === id)}
      onclick={() => onchange(id)}
      {title}
    >
      {label}
    </button>
  {/each}
</div>
