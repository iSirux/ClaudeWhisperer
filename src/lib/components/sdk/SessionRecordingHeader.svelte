<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PendingTranscriptionInfo } from '$lib/stores/sdkSessions';
  import { getShortModelName, getModelBadgeBgColor, getModelTextColor } from '$lib/utils/modelColors';
  import Waveform from '../Waveform.svelte';

  interface Props {
    pendingTranscription: PendingTranscriptionInfo;
    sessionId: string;
    /** Whether this is showing completed/historical recording info (not pending) */
    completed?: boolean;
    onRetry?: () => void;
    onCancel?: () => void;
  }

  let { pendingTranscription, sessionId, completed = false, onRetry, onCancel }: Props = $props();

  // Live timer for recording duration
  let elapsedMs = $state(0);
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  // Format duration in mm:ss format
  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Get the display duration (live elapsed or final recorded)
  let displayDuration = $derived.by(() => {
    if (pendingTranscription.status === 'recording' && pendingTranscription.recordingStartedAt) {
      return formatDuration(elapsedMs);
    }
    if (pendingTranscription.recordingDurationMs) {
      return formatDuration(pendingTranscription.recordingDurationMs);
    }
    return null;
  });

  // Start/stop timer based on recording status
  $effect(() => {
    if (pendingTranscription.status === 'recording' && pendingTranscription.recordingStartedAt) {
      // Start live timer
      const startTime = pendingTranscription.recordingStartedAt;
      const updateElapsed = () => {
        elapsedMs = Date.now() - startTime;
      };
      updateElapsed(); // Initial update
      timerInterval = setInterval(updateElapsed, 100); // Update every 100ms

      return () => {
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
      };
    }
  });

  // For static waveform display (when not recording)
  let staticCanvas = $state<HTMLCanvasElement | null>(null);
  let staticContainer = $state<HTMLDivElement | null>(null);

  const barWidth = 3;
  const barGap = 2;
  const height = 48;
  const liveColor = '#ef4444'; // recording red (same as overlay)
  const staticColor = '#8b5cf6'; // violet-500 for completed waveform

  // Draw static waveform from history with high-DPI support
  function drawStaticWaveform() {
    if (!staticCanvas || !staticContainer || !pendingTranscription.audioVisualizationHistory?.length) return;

    const ctx = staticCanvas.getContext('2d');
    if (!ctx) return;

    const history = pendingTranscription.audioVisualizationHistory;
    const rect = staticContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = rect.width;
    const displayHeight = height;

    // Set canvas buffer size for high-DPI
    staticCanvas.width = displayWidth * dpr;
    staticCanvas.height = displayHeight * dpr;

    // Scale context for high-DPI
    ctx.scale(dpr, dpr);

    // For each snapshot, compute a representative "volume" level
    // Use the average of the top N frequency values (where voice energy is concentrated)
    // This gives a better representation than averaging all bins
    const volumes = history.map(snapshot => {
      // Sort descending and take average of top 20% of bins
      const sorted = [...snapshot].sort((a, b) => b - a);
      const topCount = Math.max(1, Math.floor(sorted.length * 0.2));
      const topSum = sorted.slice(0, topCount).reduce((a, b) => a + b, 0);
      return topSum / topCount;
    });

    // Create a data array that fits the canvas width
    const barTotalWidth = barWidth + barGap;
    const barCount = Math.floor(displayWidth / barTotalWidth);

    for (let i = 0; i < barCount; i++) {
      const historyIndex = Math.floor(i * volumes.length / barCount);
      const value = volumes[historyIndex] || 0;
      const normalized = value / 255;
      const barHeight = Math.max(2, normalized * displayHeight);
      const x = i * barTotalWidth;
      const y = (displayHeight - barHeight) / 2;

      ctx.fillStyle = staticColor;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
  }

  // Determine what to show based on status
  $effect(() => {
    if (pendingTranscription.status !== 'recording') {
      // Static visualization from history - draw after a tick to ensure canvas is ready
      setTimeout(() => drawStaticWaveform(), 0);
    }
  });

  // Status helpers
  function getStatusText(status: PendingTranscriptionInfo['status']): string {
    switch (status) {
      case 'recording': return 'Recording...';
      case 'transcribing': return 'Transcribing...';
      case 'processing': return 'Processing...';
      default: return 'Pending';
    }
  }

  function getStatusColor(status: PendingTranscriptionInfo['status']): string {
    switch (status) {
      case 'recording': return 'text-recording'; // red, matches overlay
      case 'transcribing': return 'text-amber-400';
      case 'processing': return 'text-blue-400';
      default: return 'text-text-muted';
    }
  }

  function getDotColor(status: PendingTranscriptionInfo['status']): string {
    switch (status) {
      case 'recording': return 'bg-recording'; // red, matches overlay
      case 'transcribing': return 'bg-amber-400';
      case 'processing': return 'bg-blue-400';
      default: return 'bg-text-muted';
    }
  }
</script>

<div class="session-recording-header" class:completed>
  <!-- Waveform visualization -->
  <div class="waveform-container">
    {#if pendingTranscription.status === 'recording' && !completed}
      <!-- Live waveform using the same component as Overlay -->
      <Waveform height={height} barWidth={barWidth} barGap={barGap} color={liveColor} useEvents={true} />
    {:else if pendingTranscription.audioVisualizationHistory?.length}
      <!-- Static waveform from recorded history -->
      <div bind:this={staticContainer} class="static-waveform-container" style="height: {height}px;">
        <canvas
          bind:this={staticCanvas}
          class="waveform-canvas"
          style="width: 100%; height: {height}px;"
        ></canvas>
      </div>
    {:else}
      <!-- Placeholder when no waveform data -->
      <div class="waveform-placeholder" style="height: {height}px"></div>
    {/if}
  </div>

  <!-- Status indicator (only show when pending, not completed) -->
  {#if !completed}
    <div class="status-row">
      <div class="status-indicator">
        <span class="status-dot {getDotColor(pendingTranscription.status)}" class:animate-pulse={pendingTranscription.status !== 'recording'}></span>
        {#if pendingTranscription.status === 'recording'}
          <span class="status-dot {getDotColor(pendingTranscription.status)} animate-pulse-recording"></span>
        {/if}
        <span class="status-text {getStatusColor(pendingTranscription.status)}">
          {getStatusText(pendingTranscription.status)}
        </span>
        {#if displayDuration}
          <span class="duration-text">{displayDuration}</span>
        {/if}
      </div>

      {#if pendingTranscription.status === 'recording' && onCancel}
        <button class="cancel-btn" onclick={onCancel} title="Cancel recording">
          Cancel
        </button>
      {/if}
    </div>
  {:else if displayDuration}
    <!-- Show duration in completed mode -->
    <div class="duration-row">
      <span class="duration-label">Duration:</span>
      <span class="duration-text">{displayDuration}</span>
    </div>
  {/if}

  <!-- Transcription error with retry (only show when pending) -->
  {#if pendingTranscription.transcriptionError && !completed}
    <div class="error-section">
      <div class="error-message">
        <span class="error-icon">!</span>
        <span>Transcription failed: {pendingTranscription.transcriptionError}</span>
      </div>
      {#if onRetry}
        <button class="retry-btn" onclick={onRetry}>
          Retry Transcription
        </button>
      {/if}
    </div>
  {/if}

  <!-- Transcript preview (show original vs cleaned in completed mode) -->
  {#if pendingTranscription.transcript && !pendingTranscription.transcriptionError}
    <div class="transcript-section">
      {#if completed && pendingTranscription.wasCleanedUp && pendingTranscription.cleanedTranscript !== pendingTranscription.transcript}
        <!-- In completed mode, show both original and cleaned -->
        <div class="transcript-comparison">
          <div class="original-transcript">
            <div class="transcript-label">Original:</div>
            <div class="transcript-text muted">{pendingTranscription.transcript}</div>
          </div>
          <div class="cleaned-transcript">
            <div class="transcript-label-row">
              <span class="auto-badge">AUTO</span>
              <span class="transcript-label">Cleaned:</span>
            </div>
            <div class="transcript-text">{pendingTranscription.cleanedTranscript}</div>
          </div>
        </div>
      {:else}
        <div class="transcript-label">{completed ? 'Voice input:' : 'Transcript:'}</div>
        <div class="transcript-text">
          {pendingTranscription.cleanedTranscript || pendingTranscription.transcript}
        </div>
        {#if !completed && pendingTranscription.wasCleanedUp && pendingTranscription.cleanedTranscript !== pendingTranscription.transcript}
          <div class="cleanup-note">
            <span class="cleanup-icon">&#10003;</span>
            Cleaned up by LLM
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- LLM Recommendations -->
  {#if pendingTranscription.modelRecommendation || pendingTranscription.repoRecommendation}
    <div class="recommendations-section">
      {#if pendingTranscription.modelRecommendation}
        <div class="recommendation model-recommendation">
          <div class="recommendation-header">
            <svg class="recommendation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
            <span class="auto-badge">AUTO</span>
            <span class="recommendation-label">Model</span>
            <span class="model-badge {getModelBadgeBgColor(pendingTranscription.modelRecommendation.modelId)} {getModelTextColor(pendingTranscription.modelRecommendation.modelId)}">
              {getShortModelName(pendingTranscription.modelRecommendation.modelId)}
            </span>
            {#if pendingTranscription.modelRecommendation.thinkingLevel}
              <span class="thinking-badge">
                <svg class="thinking-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                {pendingTranscription.modelRecommendation.thinkingLevel}
              </span>
            {/if}
          </div>
          <div class="reasoning-container">
            <svg class="quote-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
            </svg>
            <blockquote class="reasoning">{pendingTranscription.modelRecommendation.reasoning}</blockquote>
          </div>
        </div>
      {/if}

      {#if pendingTranscription.repoRecommendation}
        <div class="recommendation repo-recommendation">
          <div class="recommendation-header">
            <svg class="recommendation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span class="auto-badge">AUTO</span>
            <span class="recommendation-label">Repository</span>
            <span class="repo-name">{pendingTranscription.repoRecommendation.repoName}</span>
            <span class="confidence confidence-{pendingTranscription.repoRecommendation.confidence}">
              {#if pendingTranscription.repoRecommendation.confidence === 'high'}
                <svg class="confidence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {:else if pendingTranscription.repoRecommendation.confidence === 'medium'}
                <svg class="confidence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              {:else}
                <svg class="confidence-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              {/if}
              {pendingTranscription.repoRecommendation.confidence}
            </span>
          </div>
          <div class="reasoning-container">
            <svg class="quote-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
            </svg>
            <blockquote class="reasoning">{pendingTranscription.repoRecommendation.reasoning}</blockquote>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .session-recording-header {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .session-recording-header.completed {
    background: var(--color-surface-elevated);
    border-color: var(--color-border);
  }

  .session-recording-header.completed .waveform-container {
    height: 36px;
  }

  .session-recording-header.completed .waveform-canvas {
    height: 36px;
  }

  .waveform-container {
    width: 100%;
    margin-bottom: 0.75rem;
    background: var(--color-surface-elevated);
    border-radius: 6px;
    padding: 0.5rem;
    overflow: hidden;
  }

  .waveform-canvas {
    display: block;
    width: 100%;
    height: 48px;
  }

  .static-waveform-container {
    width: 100%;
    position: relative;
  }

  .waveform-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface);
    border-radius: 4px;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.animate-pulse-recording {
    animation: pulse-recording 1s ease-in-out infinite;
  }

  @keyframes pulse-recording {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }

  .status-text {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .duration-text {
    font-size: 0.875rem;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    color: var(--color-text-secondary);
    margin-left: 0.5rem;
  }

  .duration-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.5rem;
  }

  .duration-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .cancel-btn {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: rgba(239, 68, 68, 0.1);
    color: var(--color-error);
    border: 1px solid var(--color-error);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cancel-btn:hover {
    background: var(--color-error);
    color: white;
  }

  .error-section {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #ef4444;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .error-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: #ef4444;
    color: white;
    border-radius: 50%;
    font-size: 0.75rem;
    font-weight: bold;
  }

  .retry-btn {
    font-size: 0.75rem;
    padding: 0.375rem 0.75rem;
    background: transparent;
    color: #ef4444;
    border: 1px solid #ef4444;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .retry-btn:hover {
    background: #ef4444;
    color: white;
  }

  .transcript-section {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: var(--color-surface-elevated);
    border-radius: 6px;
  }

  .transcript-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-bottom: 0.25rem;
  }

  .transcript-text {
    font-size: 0.875rem;
    color: var(--color-text-primary);
    line-height: 1.4;
  }

  .transcript-text.muted {
    color: var(--color-text-muted);
    text-decoration: line-through;
    font-size: 0.8rem;
  }

  .transcript-comparison {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .original-transcript,
  .cleaned-transcript {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .transcript-label-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .cleanup-note {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.5rem;
    font-size: 0.75rem;
    color: var(--color-success);
  }

  .cleanup-icon {
    font-size: 0.625rem;
  }

  .recommendations-section {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .recommendation {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border-left: 3px solid;
    position: relative;
  }

  .model-recommendation {
    border-left-color: #8b5cf6;
    background: linear-gradient(to right, rgba(139, 92, 246, 0.08), transparent);
  }

  .repo-recommendation {
    border-left-color: #22c55e;
    background: linear-gradient(to right, rgba(34, 197, 94, 0.08), transparent);
  }

  .recommendation-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .recommendation-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .model-recommendation .recommendation-icon {
    color: #8b5cf6;
  }

  .repo-recommendation .recommendation-icon {
    color: #22c55e;
  }

  .auto-badge {
    padding: 0.1875rem 0.5rem;
    border-radius: 4px;
    background: linear-gradient(
      135deg,
      rgb(168, 85, 247) 0%,
      rgb(245, 158, 11) 50%,
      rgb(168, 85, 247) 100%
    );
    background-size: 200% 200%;
    animation: shimmer 3s ease-in-out infinite;
    color: white;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  @keyframes shimmer {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }

  .recommendation-label {
    color: var(--color-text-muted);
    font-weight: 500;
    font-size: 0.8125rem;
  }

  .model-badge {
    padding: 0.1875rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.75rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .thinking-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1875rem 0.5rem;
    border-radius: 4px;
    background: rgba(139, 92, 246, 0.15);
    border: 1px solid rgba(139, 92, 246, 0.3);
    color: #a78bfa;
    font-size: 0.6875rem;
    font-weight: 600;
  }

  .thinking-icon {
    width: 12px;
    height: 12px;
  }

  .repo-name {
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: 0.875rem;
  }

  .confidence {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1875rem 0.5rem;
    border-radius: 4px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: capitalize;
  }

  .confidence-icon {
    width: 12px;
    height: 12px;
  }

  .confidence-high {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #4ade80;
  }

  .confidence-medium {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.3);
    color: #fbbf24;
  }

  .confidence-low {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .reasoning-container {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface);
    border-radius: 6px;
    margin-top: 0.25rem;
  }

  .quote-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--color-text-muted);
    opacity: 0.5;
    margin-top: 0.125rem;
  }

  .reasoning {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    line-height: 1.5;
    margin: 0;
  }
</style>
