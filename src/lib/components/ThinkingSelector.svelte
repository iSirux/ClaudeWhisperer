<script lang="ts">
  import type { ThinkingLevel } from "$lib/stores/sdkSessions";

  interface Props {
    thinkingLevel: ThinkingLevel;
    onchange: (level: ThinkingLevel) => void;
    size?: "sm" | "md";
  }

  let { thinkingLevel, onchange, size = "sm" }: Props = $props();

  // Simple off/on toggle for thinking mode
  const isOn = $derived(thinkingLevel !== null);

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-3 py-1 text-xs",
  };

  function getButtonClasses(forOn: boolean, isSelected: boolean): string {
    const base = `rounded font-medium transition-all ${sizeClasses[size]}`;

    if (isSelected) {
      if (!forOn) {
        return `${base} bg-zinc-600 text-white shadow-md ring-2 ring-zinc-500 ring-opacity-50 scale-105`;
      }
      // Active thinking mode gets cyan color
      return `${base} bg-cyan-600 text-white shadow-md ring-2 ring-cyan-500 ring-opacity-50 scale-105`;
    }

    return `${base} text-text-secondary hover:bg-cyan-500/20`;
  }
</script>

<div
  class="flex items-center gap-0.5 px-1.5 py-0.5 bg-surface-elevated rounded"
  title="Thinking"
>
  <svg
    class="w-3.5 h-3.5 text-text-muted mr-0.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
    />
  </svg>
  <button
    class={getButtonClasses(false, !isOn)}
    onclick={() => onchange(null)}
    title="Thinking disabled"
  >
    Off
  </button>
  <button
    class={getButtonClasses(true, isOn)}
    onclick={() => onchange("on")}
    title="Thinking enabled"
  >
    On
  </button>
</div>
