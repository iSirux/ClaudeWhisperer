<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recording, isRecording } from '$lib/stores/recording';

  export let height: number = 60;
  export let barWidth: number = 3;
  export let barGap: number = 2;
  export let color: string = '#ef4444'; // recording red color
  export let smoothingTimeConstant: number = 0.8;

  let canvas: HTMLCanvasElement;
  let animationId: number;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let dataArray: Uint8Array | null = null;

  async function setupAudioVisualization() {
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

      draw();
    } catch (error) {
      console.error('Failed to setup audio visualization:', error);
    }
  }

  function draw() {
    if (!canvas || !analyser || !dataArray) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    animationId = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barTotalWidth = barWidth + barGap;
    const barCount = Math.floor(canvas.width / barTotalWidth);

    // Sample the data array evenly
    const step = Math.floor(dataArray.length / barCount);

    for (let i = 0; i < barCount; i++) {
      const dataIndex = i * step;
      const value = dataArray[dataIndex];

      // Normalize value to 0-1 range
      const normalized = value / 255;

      // Calculate bar height (minimum 2px for visibility even at low volumes)
      const barHeight = Math.max(2, normalized * canvas.height);

      // Calculate x position
      const x = i * barTotalWidth;

      // Center the bar vertically
      const y = (canvas.height - barHeight) / 2;

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
    analyser = null;
    dataArray = null;
  }

  // Watch for recording state changes
  $: if ($isRecording && canvas && $recording.stream) {
    setupAudioVisualization();
  } else if (!$isRecording) {
    cleanup();
  }

  onDestroy(() => {
    cleanup();
  });
</script>

<canvas
  bind:this={canvas}
  width={300}
  height={height}
  class="waveform-canvas"
  style="width: 100%; height: {height}px;"
></canvas>

<style>
  .waveform-canvas {
    display: block;
  }
</style>
