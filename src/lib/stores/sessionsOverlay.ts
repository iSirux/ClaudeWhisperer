import { writable, get } from 'svelte/store';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { primaryMonitor } from '@tauri-apps/api/window';

const POSITION_STORAGE_KEY = 'sessions-overlay-position';

interface SessionsOverlayStore {
  visible: boolean;
  position: { x: number; y: number };
}

function getSessionsOverlayWindow() {
  return WebviewWindow.getByLabel('sessions-overlay');
}

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const saved = localStorage.getItem(POSITION_STORAGE_KEY);
    if (saved) {
      const pos = JSON.parse(saved);
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        return pos;
      }
    }
  } catch (error) {
    console.error('Failed to load saved position:', error);
  }
  return null;
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

    getPosition(): { x: number; y: number } {
      return get({ subscribe }).position;
    },

    savePosition() {
      const { position } = get({ subscribe });
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
      } catch (error) {
        console.error('Failed to save position:', error);
      }
    },

    async positionBottomRight() {
      try {
        // First check if there's a saved position
        const savedPos = loadSavedPosition();
        if (savedPos) {
          await this.setPosition(savedPos.x, savedPos.y);
          return;
        }

        // Otherwise position at bottom right
        const monitor = await primaryMonitor();
        if (monitor) {
          // Position at bottom right with some margin (window is 200x32)
          const x = monitor.size.width - 200 - 20; // width + margin
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
