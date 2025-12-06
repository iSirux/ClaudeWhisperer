<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { isOpenMicListening } from "$lib/stores/openMic";

  let transcript = $state("");
  let isListening = $derived($isOpenMicListening);
  let unlistenTranscript: UnlistenFn | null = null;
  let unlistenVisualization: UnlistenFn | null = null;

  // Timer to reset transcript after inactivity
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  const RESET_DELAY_MS = 3000;

  // Canvas for waveform
  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let animationId: number;
  let resizeObserver: ResizeObserver | null = null;

  // Audio visualization data from open mic store
  let audioData: number[] | null = null;

  const barWidth = 2;
  const barGap = 2;
  const waveColor = "#ef4444"; // Recording red

  // Draw waveform from audio data
  function drawWaveform() {
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    animationId = requestAnimationFrame(drawWaveform);

    const displayWidth = container.getBoundingClientRect().width;
    const displayHeight = container.getBoundingClientRect().height;

    // Clear canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const barTotalWidth = barWidth + barGap;
    const barCount = Math.floor(displayWidth / barTotalWidth);
    const halfBarCount = Math.floor(barCount / 2);

    // Use audio data if available, otherwise show minimal bars
    const data = audioData || [];

    // Only use first 50% of frequency data (voice range) for left half
    const voiceDataLength = Math.max(1, Math.floor(data.length * 0.5));
    const step =
      data.length > 0
        ? Math.max(1, Math.floor(voiceDataLength / halfBarCount))
        : 1;

    // Noise floor detection: low variance AND low max value (must have BOTH)
    const voiceData = data.slice(0, voiceDataLength);
    const min = voiceData.length > 0 ? Math.min(...voiceData) : 0;
    const max = voiceData.length > 0 ? Math.max(...voiceData) : 0;
    const variance = max - min;
    // Noise floor = low variance (<15) AND max is low (<50) - both required
    const isNoiseFloor = variance < 15 && max < 50;

    for (let i = 0; i < barCount; i++) {
      let normalized: number;

      if (data.length > 0) {
        // Mirror: left half uses normal index, right half mirrors from center
        const mirrorIndex = i < halfBarCount ? i : barCount - 1 - i;
        const dataIndex = Math.min(mirrorIndex * step, voiceDataLength - 1);
        const value = data[dataIndex] || 0;

        // Normalize value to 0-1 range, but zero out if it's just noise floor
        normalized = isNoiseFloor ? 0 : value / 255;
      } else {
        // Minimal baseline when no audio data
        normalized = 0.05;
      }

      // Calculate bar height (minimum 2px)
      const barHeight = Math.max(2, normalized * displayHeight);

      const x = i * barTotalWidth;
      const y = (displayHeight - barHeight) / 2;

      ctx.fillStyle = waveColor;
      ctx.globalAlpha = 0.5; // Semi-transparent to be behind text
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateCanvasSize() {
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }

  async function startWaveform() {
    if (container) {
      resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });
      resizeObserver.observe(container);
      updateCanvasSize();
    }

    // Listen for visualization data from open mic store
    unlistenVisualization = await listen<{ data: number[] }>(
      "open-mic-visualization",
      (event) => {
        audioData = event.payload?.data ?? null;
      }
    );

    drawWaveform();
  }

  function stopWaveform() {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (unlistenVisualization) {
      unlistenVisualization();
      unlistenVisualization = null;
    }
    audioData = null;
  }

  function resetTranscriptTimer() {
    // Clear any existing timer
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
    // Set a new timer to reset transcript after 3 seconds of no updates
    resetTimer = setTimeout(() => {
      transcript = "";
    }, RESET_DELAY_MS);
  }

  onMount(async () => {
    // Listen to dedicated open-mic event (separate from recording to avoid interference)
    unlistenTranscript = await listen<{ text: string }>(
      "open-mic-realtime-transcript",
      (event) => {
        const text = event.payload?.text ?? "";
        console.log("[OpenMicMarquee] received", {
          text,
          prevTranscript: transcript,
        });
        // Always update transcript - empty string clears it
        transcript = text;
        // Reset the inactivity timer on each update (only for non-empty text)
        if (text) {
          resetTranscriptTimer();
        }
      }
    );
  });

  onDestroy(() => {
    unlistenTranscript?.();
    stopWaveform();
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  });

  // Start/stop waveform based on listening state
  $effect(() => {
    if (isListening && canvas && container) {
      startWaveform();
    } else {
      stopWaveform();
    }
  });
</script>

{#if isListening}
  <div class="open-mic-marquee" bind:this={container}>
    <!-- Waveform canvas behind text -->
    <canvas bind:this={canvas} class="waveform-canvas"></canvas>
    <!-- Text overlay -->
    <div class="transcript-container">
      <span class="transcript-text">
        {transcript || ""}
        <!-- {transcript || "Listening..."} -->
      </span>
    </div>
  </div>
{/if}

<style>
  .open-mic-marquee {
    position: relative;
    width: 200px;
    height: 28px;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .waveform-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 0;
    padding: 0 8px;
  }

  .transcript-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0 8px;
    z-index: 1;
  }

  .transcript-text {
    position: relative;
    z-index: 1;
    white-space: nowrap;
    font-size: 11px;
    color: var(--color-text-primary);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      "Liberation Mono", monospace;
    text-shadow:
      0 0 4px var(--color-surface-elevated),
      0 0 8px var(--color-surface-elevated);
  }
</style>
