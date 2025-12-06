<script lang="ts">
  import { onDestroy } from "svelte";
  import type { PendingTranscriptionInfo } from "$lib/stores/sdkSessions";
  import {
    getShortModelName,
    getModelBadgeBgColor,
    getModelTextColor,
  } from "$lib/utils/modelColors";
  import Waveform from "../Waveform.svelte";
  import TranscriptDiff from "../TranscriptDiff.svelte";

  interface Props {
    pendingTranscription: PendingTranscriptionInfo;
    sessionId: string;
    /** Whether this is showing completed/historical recording info (not pending) */
    completed?: boolean;
    onRetry?: () => void;
    onCancel?: () => void;
    /** Whether to show approval UI (for pending_approval state) */
    showApproval?: boolean;
    /** The prompt waiting for approval */
    approvalPrompt?: string;
    /** Repository name for display in approval mode */
    repoName?: string;
    /** Callback when user approves the prompt (with optional edited text) */
    onApprove?: (editedPrompt?: string) => void;
    /** Callback when user cancels the approval */
    onCancelApproval?: () => void;
  }

  let {
    pendingTranscription,
    sessionId,
    completed = false,
    onRetry,
    onCancel,
    showApproval = false,
    approvalPrompt,
    repoName,
    onApprove,
    onCancelApproval,
  }: Props = $props();

  // Approval mode state
  let isEditingPrompt = $state(false);
  let editedPrompt = $state('');
  let textareaEl: HTMLTextAreaElement | null = $state(null);

  // Initialize edited prompt when approval mode is shown
  $effect(() => {
    if (showApproval && approvalPrompt) {
      editedPrompt = approvalPrompt;
    }
  });

  // Auto-resize textarea
  function autoResizeTextarea() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      const maxHeight = 200;
      const newHeight = Math.min(textareaEl.scrollHeight, maxHeight);
      textareaEl.style.height = newHeight + 'px';
      textareaEl.style.overflowY = textareaEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }

  // Focus textarea when entering edit mode
  $effect(() => {
    if (isEditingPrompt && textareaEl) {
      textareaEl.focus();
      textareaEl.select();
      autoResizeTextarea();
    }
  });

  function handleApprove() {
    if (onApprove) {
      // Only pass edited prompt if it was actually changed
      const promptToSend = editedPrompt !== approvalPrompt ? editedPrompt : undefined;
      onApprove(promptToSend);
    }
  }

  function handleCancelApproval() {
    if (onCancelApproval) {
      onCancelApproval();
    }
  }

  // Live timer for recording duration
  let elapsedMs = $state(0);
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  // Format duration in mm:ss format
  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  // Get the display duration (live elapsed or final recorded)
  let displayDuration = $derived.by(() => {
    if (
      pendingTranscription.status === "recording" &&
      pendingTranscription.recordingStartedAt
    ) {
      return formatDuration(elapsedMs);
    }
    if (pendingTranscription.recordingDurationMs) {
      return formatDuration(pendingTranscription.recordingDurationMs);
    }
    return null;
  });

  // Start/stop timer based on recording status
  $effect(() => {
    if (
      pendingTranscription.status === "recording" &&
      pendingTranscription.recordingStartedAt
    ) {
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
  const liveColor = "#ef4444"; // recording red (same as overlay)

  // Draw static waveform from history with high-DPI support
  // Creates a mirrored waveform with gradient and glow for a more impressive look
  function drawStaticWaveform() {
    if (
      !staticCanvas ||
      !staticContainer ||
      !pendingTranscription.audioVisualizationHistory?.length
    )
      return;

    const ctx = staticCanvas.getContext("2d");
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
    const volumes = history.map((snapshot) => {
      const sorted = [...snapshot].sort((a, b) => b - a);
      const topCount = Math.max(1, Math.floor(sorted.length * 0.2));
      const topSum = sorted.slice(0, topCount).reduce((a, b) => a + b, 0);
      return topSum / topCount;
    });

    const barTotalWidth = barWidth + barGap;
    const barCount = Math.floor(displayWidth / barTotalWidth);
    const centerY = displayHeight / 2;

    // Create gradient for the bars (violet to pink/magenta)
    const gradient = ctx.createLinearGradient(0, 0, displayWidth, 0);
    gradient.addColorStop(0, "#8b5cf6");    // violet-500
    gradient.addColorStop(0.5, "#a78bfa");  // violet-400
    gradient.addColorStop(1, "#c084fc");    // purple-400

    // Draw glow layer first (subtle blur effect)
    ctx.save();
    ctx.filter = "blur(4px)";
    ctx.globalAlpha = 0.4;

    for (let i = 0; i < barCount; i++) {
      const historyIndex = Math.floor((i * volumes.length) / barCount);
      const value = volumes[historyIndex] || 0;
      const normalized = value / 255;
      // Each half gets half the height, with minimum visibility
      const halfBarHeight = Math.max(1.5, (normalized * displayHeight) / 2);
      const x = i * barTotalWidth;

      ctx.fillStyle = "#8b5cf6";

      // Top bar (grows upward from center)
      ctx.beginPath();
      ctx.roundRect(x, centerY - halfBarHeight, barWidth, halfBarHeight, barWidth / 2);
      ctx.fill();

      // Bottom bar (grows downward from center) - slightly shorter for reflection effect
      ctx.beginPath();
      ctx.roundRect(x, centerY, barWidth, halfBarHeight * 0.85, barWidth / 2);
      ctx.fill();
    }
    ctx.restore();

    // Draw main bars with gradient
    for (let i = 0; i < barCount; i++) {
      const historyIndex = Math.floor((i * volumes.length) / barCount);
      const value = volumes[historyIndex] || 0;
      const normalized = value / 255;
      const halfBarHeight = Math.max(1.5, (normalized * displayHeight) / 2);
      const x = i * barTotalWidth;

      // Top bar (full opacity)
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, centerY - halfBarHeight, barWidth, halfBarHeight, barWidth / 2);
      ctx.fill();

      // Bottom bar (reflection with fade) - slightly shorter and more transparent
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, centerY, barWidth, halfBarHeight * 0.85, barWidth / 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw center line (subtle)
    ctx.strokeStyle = "rgba(139, 92, 246, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(displayWidth, centerY);
    ctx.stroke();
  }

  // Determine what to show based on status
  $effect(() => {
    if (pendingTranscription.status !== "recording") {
      // Static visualization from history - draw after a tick to ensure canvas is ready
      setTimeout(() => drawStaticWaveform(), 0);
    }
  });

  // Status helpers
  function getStatusText(status: PendingTranscriptionInfo["status"]): string {
    switch (status) {
      case "recording":
        return "Recording...";
      case "transcribing":
        return "Transcribing...";
      case "processing":
        return "Processing...";
      default:
        return "Pending";
    }
  }

  function getStatusColor(status: PendingTranscriptionInfo["status"]): string {
    switch (status) {
      case "recording":
        return "text-recording"; // red, matches overlay
      case "transcribing":
        return "text-amber-400";
      case "processing":
        return "text-blue-400";
      default:
        return "text-text-muted";
    }
  }

  function getDotColor(status: PendingTranscriptionInfo["status"]): string {
    switch (status) {
      case "recording":
        return "bg-recording"; // red, matches overlay
      case "transcribing":
        return "bg-amber-400";
      case "processing":
        return "bg-blue-400";
      default:
        return "bg-text-muted";
    }
  }
</script>

<div class="session-recording-header" class:completed>
  <!-- Waveform visualization -->
  <div class="waveform-container">
    {#if pendingTranscription.status === "recording" && !completed}
      <!-- Live waveform using the same component as Overlay -->
      <Waveform
        {height}
        {barWidth}
        {barGap}
        color={liveColor}
        useEvents={true}
      />
    {:else if pendingTranscription.audioVisualizationHistory?.length}
      <!-- Static waveform from recorded history -->
      <div
        bind:this={staticContainer}
        class="static-waveform-container"
        style="height: {height}px;"
      >
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
        <span
          class="status-dot {getDotColor(pendingTranscription.status)}"
          class:animate-pulse={pendingTranscription.status !== "recording"}
        ></span>
        {#if pendingTranscription.status === "recording"}
          <span
            class="status-dot {getDotColor(
              pendingTranscription.status
            )} animate-pulse-recording"
          ></span>
        {/if}
        <span class="status-text {getStatusColor(pendingTranscription.status)}">
          {getStatusText(pendingTranscription.status)}
        </span>
        {#if displayDuration}
          <span class="duration-text">{displayDuration}</span>
        {/if}
      </div>

      {#if pendingTranscription.status === "recording" && onCancel}
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
        <span
          >Transcription failed: {pendingTranscription.transcriptionError}</span
        >
      </div>
      {#if onRetry}
        <button class="retry-btn" onclick={onRetry}>
          Retry Transcription
        </button>
      {/if}
    </div>
  {/if}

  <!-- Transcript preview section -->
  {#if pendingTranscription.transcript && !pendingTranscription.transcriptionError}
    <div class="transcript-section">
      <!-- Source transcripts section (show when vosk exists) -->
      {#if pendingTranscription.voskTranscript}
        <div class="source-transcripts">
          <div class="source-header">
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <span>Source Transcripts</span>
          </div>
          <div class="sources-grid">
            <!-- Whisper transcript -->
            <div class="source-item whisper">
              <div class="source-label">
                <span class="source-badge whisper-badge">Whisper</span>
              </div>
              <div class="source-text">{pendingTranscription.transcript}</div>
            </div>
            <!-- Vosk transcript -->
            <div class="source-item vosk">
              <div class="source-label">
                <span class="source-badge vosk-badge">Vosk</span>
              </div>
              <div class="source-text">
                {pendingTranscription.voskTranscript}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Diff visualization (collapsible) - shows diffs for each source -->
      <!-- Show if: cleanup changed something OR vosk differs from whisper (at least one source has a diff) -->
      {#if (pendingTranscription.wasCleanedUp && pendingTranscription.cleanedTranscript && pendingTranscription.cleanedTranscript !== pendingTranscription.transcript) || (pendingTranscription.voskTranscript && pendingTranscription.voskTranscript !== pendingTranscription.transcript)}
        <div class="diff-container">
          <TranscriptDiff
            original={pendingTranscription.transcript}
            cleaned={pendingTranscription.cleanedTranscript || pendingTranscription.transcript}
            voskTranscript={pendingTranscription.voskTranscript}
            usedDualSource={!!pendingTranscription.voskTranscript}
            corrections={pendingTranscription.cleanupCorrections || []}
            collapsed={!completed}
          />
        </div>
      {/if}

      <!-- Final transcript (cleaned or original) -->
      {#if pendingTranscription.wasCleanedUp && pendingTranscription.cleanedTranscript}
        <div class="final-transcript">
          <div class="transcript-label-row">
            <span class="transcript-label"
              >{completed ? "Voice input" : "Final transcript"}</span
            >
            <span class="cleaned-badge">Cleaned</span>
          </div>
          <div class="transcript-text">
            {pendingTranscription.cleanedTranscript}
          </div>
        </div>
      {:else}
        <div class="final-transcript">
          <div class="transcript-label">
            {completed ? "Voice input:" : "Transcript:"}
          </div>
          <div class="transcript-text">{pendingTranscription.transcript}</div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- LLM Recommendations -->
  {#if pendingTranscription.modelRecommendation || pendingTranscription.repoRecommendation}
    <div class="recommendations-section">
      {#if pendingTranscription.modelRecommendation}
        <div class="recommendation model-recommendation">
          <div class="recommendation-header">
            <span class="auto-badge">Auto</span>
            <span class="recommendation-label">Model</span>
            <span
              class="model-badge {getModelBadgeBgColor(
                pendingTranscription.modelRecommendation.modelId
              )} {getModelTextColor(
                pendingTranscription.modelRecommendation.modelId
              )}"
            >
              {getShortModelName(
                pendingTranscription.modelRecommendation.modelId
              )}
            </span>
            {#if pendingTranscription.modelRecommendation.thinkingLevel}
              <span class="thinking-badge">
                {pendingTranscription.modelRecommendation.thinkingLevel}
              </span>
            {/if}
          </div>
          <p class="reasoning">
            {pendingTranscription.modelRecommendation.reasoning}
          </p>
        </div>
      {/if}

      {#if pendingTranscription.repoRecommendation}
        <div class="recommendation repo-recommendation">
          <div class="recommendation-header">
            <span class="auto-badge">Auto</span>
            <span class="recommendation-label">Repository</span>
            <span class="repo-name"
              >{pendingTranscription.repoRecommendation.repoName}</span
            >
            <span
              class="confidence confidence-{pendingTranscription
                .repoRecommendation.confidence}"
            >
              {pendingTranscription.repoRecommendation.confidence}
            </span>
          </div>
          <p class="reasoning">
            {pendingTranscription.repoRecommendation.reasoning}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Approval UI -->
  {#if showApproval && approvalPrompt}
    <div class="approval-section">
      <div class="approval-header">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Review your prompt before sending</span>
      </div>

      <!-- Repository info -->
      {#if repoName}
        <div class="approval-repo">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span class="repo-label">Repository:</span>
          <span class="repo-value">{repoName}</span>
        </div>
      {/if}

      <!-- Editable prompt -->
      <div class="approval-prompt">
        {#if isEditingPrompt}
          <textarea
            bind:this={textareaEl}
            bind:value={editedPrompt}
            oninput={autoResizeTextarea}
            class="prompt-textarea"
            placeholder="Enter your prompt..."
            rows="2"
          ></textarea>
        {:else}
          <div class="prompt-display" onclick={() => isEditingPrompt = true}>
            <span class="prompt-text">{editedPrompt || approvalPrompt}</span>
            <button class="edit-inline-btn" onclick={(e) => { e.stopPropagation(); isEditingPrompt = true; }} title="Edit prompt">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        {/if}
      </div>

      <!-- Action buttons -->
      <div class="approval-actions">
        <button class="cancel-approval-btn" onclick={handleCancelApproval}>
          Cancel
        </button>
        {#if isEditingPrompt}
          <button class="done-edit-btn" onclick={() => isEditingPrompt = false}>
            Done Editing
          </button>
        {/if}
        <button class="approve-btn" onclick={handleApprove}>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Send to Claude
        </button>
      </div>
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
    0%,
    100% {
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
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      monospace;
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
    gap: 0.375rem;
    padding: 0.625rem 0.75rem;
    border-radius: 6px;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
  }

  .recommendation-header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .auto-badge {
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    background: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
    color: white;
    font-size: 0.6875rem;
    font-weight: 600;
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
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.2);
    color: #a78bfa;
    font-size: 0.6875rem;
    font-weight: 500;
  }

  .repo-name {
    color: var(--color-text-primary);
    font-weight: 600;
    font-size: 0.875rem;
  }

  .confidence {
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: capitalize;
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

  .reasoning {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
    line-height: 1.4;
    margin: 0;
  }

  .diff-container {
    margin-top: 0.75rem;
  }

  .dual-source-badge {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 4px;
    font-size: 0.6875rem;
    color: #a78bfa;
    font-weight: 500;
    width: fit-content;
  }

  .final-transcript {
    margin-top: 0.5rem;
  }

  .cleaned-badge {
    padding: 0.125rem 0.375rem;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 3px;
    font-size: 0.625rem;
    font-weight: 600;
    color: #4ade80;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .source-transcripts {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--color-border);
  }

  .source-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .sources-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .sources-grid.single {
    grid-template-columns: 1fr;
  }

  .source-item {
    padding: 0.5rem 0.625rem;
    background: var(--color-surface);
    border-radius: 6px;
    border: 1px solid var(--color-border);
  }

  .source-item.whisper {
    border-left: 2px solid var(--color-accent);
  }

  .source-item.vosk {
    border-left: 2px solid #a78bfa;
  }

  .source-label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .source-badge {
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.025em;
  }

  .whisper-badge {
    background: rgba(var(--color-accent-rgb, 59, 130, 246), 0.15);
    border: 1px solid rgba(var(--color-accent-rgb, 59, 130, 246), 0.3);
    color: var(--color-accent);
  }

  .vosk-badge {
    background: rgba(139, 92, 246, 0.15);
    border: 1px solid rgba(139, 92, 246, 0.3);
    color: #a78bfa;
  }

  .source-desc {
    font-size: 0.625rem;
    color: var(--color-text-muted);
  }

  .source-text {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    max-height: 4rem;
    overflow-y: auto;
  }

  /* Approval UI Styles */
  .approval-section {
    margin-top: 1rem;
    padding: 1rem;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-accent);
    border-radius: 8px;
  }

  .approval-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-accent);
    margin-bottom: 0.75rem;
  }

  .approval-repo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    margin-bottom: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-surface);
    border-radius: 6px;
  }

  .repo-label {
    color: var(--color-text-muted);
  }

  .repo-value {
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .approval-prompt {
    margin-bottom: 0.75rem;
  }

  .prompt-display {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: text;
    transition: border-color 0.15s ease;
  }

  .prompt-display:hover {
    border-color: var(--color-accent);
  }

  .prompt-display .prompt-text {
    font-size: 0.875rem;
    color: var(--color-text-primary);
    line-height: 1.5;
    flex: 1;
  }

  .edit-inline-btn {
    flex-shrink: 0;
    padding: 0.25rem;
    color: var(--color-text-muted);
    background: transparent;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .edit-inline-btn:hover {
    color: var(--color-accent);
    background: rgba(var(--color-accent-rgb, 59, 130, 246), 0.1);
  }

  .prompt-textarea {
    width: 100%;
    padding: 0.75rem;
    background: var(--color-surface);
    border: 1px solid var(--color-accent);
    border-radius: 6px;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-family: inherit;
    line-height: 1.5;
    resize: none;
    overflow-y: hidden;
  }

  .prompt-textarea:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--color-accent-rgb, 59, 130, 246), 0.2);
  }

  .approval-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .cancel-approval-btn {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cancel-approval-btn:hover {
    color: var(--color-error);
    border-color: var(--color-error);
    background: rgba(239, 68, 68, 0.1);
  }

  .done-edit-btn {
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .done-edit-btn:hover {
    background: var(--color-surface-elevated);
    border-color: var(--color-text-muted);
  }

  .approve-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: white;
    background: var(--color-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .approve-btn:hover {
    filter: brightness(1.1);
  }

  .approve-btn:active {
    transform: scale(0.98);
  }
</style>
