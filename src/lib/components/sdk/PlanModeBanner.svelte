<script lang="ts">
  import type { PlanModeState } from '$lib/stores/sdkSessions';

  let {
    planMode,
    onExitPlanMode,
  }: {
    planMode: PlanModeState;
    onExitPlanMode?: () => void;
  } = $props();

  // Calculate progress
  let progress = $derived(() => {
    if (planMode.questions.length === 0) return 0;
    const answeredCount = planMode.answers.length;
    return Math.round((answeredCount / planMode.questions.length) * 100);
  });

  let statusText = $derived(() => {
    if (planMode.isComplete) {
      return 'Plan ready for implementation';
    }
    if (planMode.questions.length === 0) {
      return 'Gathering requirements...';
    }
    const answeredCount = planMode.answers.length;
    return `${answeredCount} of ${planMode.questions.length} questions answered`;
  });
</script>

<div class="plan-mode-banner flex items-center gap-3 px-3 py-2 bg-cyan-500/10 border-b border-cyan-500/20">
  <!-- Plan mode icon -->
  <div class="flex items-center gap-2">
    <svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
    <span class="text-xs font-medium text-cyan-400">Plan Mode</span>
  </div>

  <!-- Progress bar -->
  {#if !planMode.isComplete && planMode.questions.length > 0}
    <div class="flex-1 max-w-48">
      <div class="h-1.5 bg-cyan-500/20 rounded-full overflow-hidden">
        <div
          class="h-full bg-cyan-500 transition-all duration-300"
          style="width: {progress()}%"
        ></div>
      </div>
    </div>
  {/if}

  <!-- Status text -->
  <span class="text-xs text-text-secondary">{statusText()}</span>

  <!-- Feature name (when complete) -->
  {#if planMode.isComplete && planMode.featureName}
    <span class="text-xs text-cyan-400 font-medium">{planMode.featureName}</span>
  {/if}

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Exit button (if handler provided) -->
  {#if onExitPlanMode}
    <button
      class="text-xs text-text-muted hover:text-text-secondary transition-colors"
      onclick={onExitPlanMode}
      title="Exit plan mode"
    >
      Exit
    </button>
  {/if}
</div>
