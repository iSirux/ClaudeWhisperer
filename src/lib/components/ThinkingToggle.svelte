<script lang="ts">
  import type { ThinkingLevel } from "$lib/stores/sdkSessions";

  interface Props {
    thinkingLevel: ThinkingLevel;
    onchange: (level: ThinkingLevel) => void;
    size?: "sm" | "md";
  }

  let { thinkingLevel, onchange, size = "sm" }: Props = $props();

  const isOn = $derived(thinkingLevel !== null);

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] gap-1",
    md: "px-3 py-1 text-xs gap-1.5",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
  };

  function toggle() {
    onchange(isOn ? null : "on");
  }
</script>

<button
  class="flex items-center rounded font-medium transition-all {sizeClasses[size]} {isOn
    ? 'bg-cyan-600 text-white shadow-md ring-1 ring-cyan-500/50'
    : 'bg-surface-elevated text-text-secondary hover:bg-cyan-500/20'}"
  onclick={toggle}
  title={isOn ? "Thinking enabled - click to disable" : "Thinking disabled - click to enable"}
>
  <svg
    class="{iconSizes[size]} {isOn ? 'text-white' : 'text-text-muted'}"
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
  <span>Thinking</span>
</button>
