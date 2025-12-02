import { writable } from 'svelte/store';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { primaryMonitor } from '@tauri-apps/api/window';

interface SessionsOverlayStore {
  visible: boolean;
  position: { x: number; y: number };
}

function getSessionsOverlayWindow() {
  return WebviewWindow.getByLabel('sessions-overlay');
}

function createSessionsOverlayStore() {
  const { subscribe, set, update } = writable<SessionsOverlayStore>({
    visible: false,
    position: { x: 0, y: 0 },
  });

  return {
    subscribe,

    async show() {
      try {
        const overlayWindow = await getSessionsOverlayWindow();
        if (overlayWindow) {
          await overlayWindow.show();
        }
        update((s) => ({ ...s, visible: true }));
      } catch (error) {
        console.error('Failed to show sessions overlay:', error);
      }
    },

    async hide() {
      try {
        const overlayWindow = await getSessionsOverlayWindow();
        if (overlayWindow) {
          await overlayWindow.hide();
        }
        update((s) => ({ ...s, visible: false }));
      } catch (error) {
        console.error('Failed to hide sessions overlay:', error);
      }
    },

    async toggle() {
      const current = await new Promise<boolean>((resolve) => {
        const unsubscribe = subscribe((s) => {
          resolve(s.visible);
          unsubscribe();
        });
      });

      if (current) {
        await this.hide();
      } else {
        await this.show();
      }
    },

    async setPosition(x: number, y: number) {
      try {
        const overlayWindow = await getSessionsOverlayWindow();
        if (overlayWindow) {
          await overlayWindow.setPosition(new PhysicalPosition(x, y));
        }
        update((s) => ({ ...s, position: { x, y } }));
      } catch (error) {
        console.error('Failed to set sessions overlay position:', error);
      }
    },

    async positionBottomRight() {
      try {
        const monitor = await primaryMonitor();
        if (monitor) {
          // Position at bottom right with some margin (window is 180x32)
          const x = monitor.size.width - 180 - 20; // width + margin
          const y = monitor.size.height - 32 - 60; // height + margin for taskbar
          await this.setPosition(x, y);
        }
      } catch (error) {
        console.error('Failed to position sessions overlay:', error);
      }
    },
  };
}

export const sessionsOverlay = createSessionsOverlayStore();
