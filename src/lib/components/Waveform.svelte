<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recording, isRecording } from '$lib/stores/recording';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';

  export let height: number = 60;
  export let barWidth: number = 3;
  export let barGap: number = 2;
  export let color: string = '#ef4444'; // recording red color
  export let smoothingTimeConstant: number = 0.8;
  // When true, listens for audio-visualization events from main window
  // When false (default), uses local stream from recording store
  export let useEvents: boolean = false;

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let animationId: number;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let dataArray: Uint8Array | null = null;
  let eventDataArray: number[] | null = null;
  let unlistenVisualization: UnlistenFn | null = null;
  let resizeObserver: ResizeObserver | null = null;

  // Update canvas size to match container and handle high-DPI displays
  function updateCanvasSize() {
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Set the canvas buffer size to match display size * device pixel ratio
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;

    // Scale the canvas context to handle high-DPI
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }

  async function setupLocalAudioVisualization() {
    if (!$isRecording || !$recording.stream) return;

    try {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = smoothingTimeConstant;

      const source = audioContext.createMediaStreamSource($recording.stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);

      drawLocal();
    } catch (error) {
      console.error('Failed to setup audio visualization:', error);
    }
  }

  async function setupEventBasedVisualization() {
    try {
      unlistenVisualization = await listen<{ data: number[] | null }>('audio-visualization', (event) => {
        eventDataArray = event.payload.data;
      });

      drawFromEvents();
    } catch (error) {
      console.error('Failed to setup event-based visualization:', error);
    }
  }

  function drawLocal() {
    if (!canvas || !analyser || !dataArray) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    animationId = requestAnimationFrame(drawLocal);

    analyser.getByteFrequencyData(dataArray);

    drawBars(ctx, Array.from(dataArray));
  }

  function drawFromEvents() {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    animationId = requestAnimationFrame(drawFromEvents);

    if (eventDataArray) {
      drawBars(ctx, eventDataArray);
    } else {
      // Clear canvas when no data
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function drawBars(ctx: CanvasRenderingContext2D, data: number[]) {
    if (!container) return;

    // Get the actual display dimensions (not the scaled buffer size)
    const displayWidth = container.getBoundingClientRect().width;
    const displayHeight = height;
    const dpr = window.devicePixelRatio || 1;

    // Clear the entire canvas buffer
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const barTotalWidth = barWidth + barGap;
    const barCount = Math.floor(displayWidth / barTotalWidth);

    // Sample the data array evenly
    const step = Math.max(1, Math.floor(data.length / barCount));

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.min(i * step, data.length - 1);
      const value = data[dataIndex] || 0;

      // Normalize value to 0-1 range
      const normalized = value / 255;

      // Calculate bar height (minimum 2px for visibility even at low volumes)
      const barHeight = Math.max(2, normalized * displayHeight);

      // Calculate x position
      const x = i * barTotalWidth;

      // Center the bar vertically
      const y = (displayHeight - barHeight) / 2;

      // Draw bar with rounded corners
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }
  }

  function cleanup() {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (unlistenVisualization) {
      unlistenVisualization();
      unlistenVisualization = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    analyser = null;
    dataArray = null;
    eventDataArray = null;
  }

  onMount(() => {
    // Set up resize observer to update canvas size when container changes
    if (container) {
      resizeObserver = new ResizeObserver(() => {
        updateCanvasSize();
      });
      resizeObserver.observe(container);
      // Initial size update
      updateCanvasSize();
    }

    if (useEvents) {
      // In event mode, start listening immediately
      setupEventBasedVisualization();
    }
  });

  // Watch for recording state changes (for local mode only)
  $: if (!useEvents && $isRecording && canvas && $recording.stream) {
    setupLocalAudioVisualization();
  } else if (!useEvents && !$isRecording) {
    cleanup();
  }

  onDestroy(() => {
    cleanup();
  });
</script>

<div bind:this={container} class="waveform-container" style="height: {height}px;">
  <canvas
    bind:this={canvas}
    class="waveform-canvas"
    style="width: 100%; height: {height}px;"
  ></canvas>
</div>

<style>
  .waveform-container {
    width: 100%;
    position: relative;
  }

  .waveform-canvas {
    display: block;
  }
</style>
