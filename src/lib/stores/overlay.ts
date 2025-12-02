import { writable } from 'svelte/store';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { primaryMonitor } from '@tauri-apps/api/window';

interface OverlayStore {
  visible: boolean;
  position: { x: number; y: number };
}

function getOverlayWindow() {
  return WebviewWindow.getByLabel('overlay');
}

function createOverlayStore() {
  const { subscribe, set, update } = writable<OverlayStore>({
    visible: false,
    position: { x: 0, y: 0 },
  });

  return {
    subscribe,

    async show() {
      try {
        const overlayWindow = await getOverlayWindow();
        if (overlayWindow) {
          await overlayWindow.show();
          await overlayWindow.setFocus();
        }
        update((s) => ({ ...s, visible: true }));
      } catch (error) {
        console.error('Failed to show overlay:', error);
      }
    },

    async hide() {
      try {
        const overlayWindow = await getOverlayWindow();
        if (overlayWindow) {
          await overlayWindow.hide();
        }
        update((s) => ({ ...s, visible: false }));
      } catch (error) {
        console.error('Failed to hide overlay:', error);
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
        const overlayWindow = await getOverlayWindow();
        if (overlayWindow) {
          await overlayWindow.setPosition(new PhysicalPosition(x, y));
        }
        update((s) => ({ ...s, position: { x, y } }));
      } catch (error) {
        console.error('Failed to set overlay position:', error);
      }
    },

    async centerTop() {
      try {
        const monitor = await primaryMonitor();
        if (monitor) {
          const x = Math.round((monitor.size.width - 400) / 2);
          const y = 20;
          await this.setPosition(x, y);
        }
      } catch (error) {
        console.error('Failed to center overlay:', error);
      }
    },
  };
}

export const overlay = createOverlayStore();
