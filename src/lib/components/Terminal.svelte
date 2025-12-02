<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { sessions } from '$lib/stores/sessions';
  import '@xterm/xterm/css/xterm.css';

  export let sessionId: string;

  let terminalEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let unlistenOutput: UnlistenFn | null = null;
  let unlistenClosed: UnlistenFn | null = null;
  let resizeObserver: ResizeObserver | null = null;

  onMount(async () => {
    terminal = new Terminal({
      theme: {
        background: '#0f0f0f',
        foreground: '#ffffff',
        cursor: '#ffffff',
        cursorAccent: '#0f0f0f',
        selectionBackground: '#6366f1',
        selectionForeground: '#ffffff',
        black: '#0f0f0f',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#ffffff',
        brightBlack: '#666666',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(terminalEl);

    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed to load, falling back to canvas renderer');
    }

    fitAddon.fit();

    const { rows, cols } = terminal;
    await sessions.resizeSession(sessionId, rows, cols);

    terminal.onData(async (data) => {
      await sessions.writeToSession(sessionId, data);
    });

    unlistenOutput = await listen<string>(`terminal-output-${sessionId}`, (event) => {
      terminal?.write(event.payload);
    });

    unlistenClosed = await listen(`terminal-closed-${sessionId}`, () => {
      sessions.updateSession(sessionId, { status: 'Completed' });
    });

    resizeObserver = new ResizeObserver(() => {
      if (fitAddon && terminal) {
        fitAddon.fit();
        const { rows, cols } = terminal;
        sessions.resizeSession(sessionId, rows, cols);
      }
    });
    resizeObserver.observe(terminalEl);
  });

  onDestroy(() => {
    unlistenOutput?.();
    unlistenClosed?.();
    resizeObserver?.disconnect();
    terminal?.dispose();
  });
</script>

<div class="terminal-container" bind:this={terminalEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    background: #0f0f0f;
    padding: 8px;
    box-sizing: border-box;
  }

  :global(.terminal-container .xterm) {
    height: 100%;
  }

  :global(.terminal-container .xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
