/**
 * Repo icon images: turn a project's own favicon/logo file into the small
 * square PNG data URL stored on `RepoConfig.icon_image`.
 *
 * The Explore pass reports a repo-relative path (e.g. `static/favicon.png`);
 * the bytes are read through the backend (the webview can't load `file://`),
 * then rasterized here to a fixed-size PNG so the config stays small and every
 * consumer can render it with a plain `<img>` regardless of the source format
 * (ico/svg included).
 */

import { invoke } from '@tauri-apps/api/core';

/** Rendered size of a stored icon image. Large enough for the `lg` badge (40px) on hidpi. */
const ICON_SIZE = 96;

/** Reject anything that rasterizes to a wildly non-square image — those are wordmarks, not icons. */
const MAX_ASPECT_RATIO = 2.5;

interface FetchedImage {
  base64: string;
  mediaType: string;
}

/**
 * Read `relativePath` inside `repoPath` and rasterize it to a square PNG data URL.
 * Returns null when the file is missing, unreadable, not an image, or not
 * roughly square — callers fall back to the curated icon set.
 */
export async function loadRepoIconImage(
  repoPath: string,
  relativePath: string
): Promise<string | null> {
  const cleaned = relativePath.trim().replace(/^\.\//, '');
  if (!cleaned) return null;

  let fetched: FetchedImage;
  try {
    fetched = await invoke<FetchedImage>('read_repo_image', {
      repoPath,
      relativePath: cleaned,
    });
  } catch (err) {
    console.warn('[repoIconImage] Could not read icon file', cleaned, err);
    return null;
  }

  try {
    return await rasterizeIconImage(fetched);
  } catch (err) {
    console.warn('[repoIconImage] Could not rasterize icon file', cleaned, err);
    return null;
  }
}

/** Draw a fetched image centered on a transparent square canvas and export it as PNG. */
async function rasterizeIconImage(fetched: FetchedImage): Promise<string | null> {
  const src =
    fetched.mediaType === 'image/svg+xml'
      ? svgObjectUrl(fetched.base64)
      : `data:${fetched.mediaType};base64,${fetched.base64}`;

  try {
    const img = await loadImage(src);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return null;

    const ratio = Math.max(width / height, height / width);
    if (ratio > MAX_ASPECT_RATIO) return null;

    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Contain: keep the whole logo visible, centered, on transparency.
    const scale = Math.min(ICON_SIZE / width, ICON_SIZE / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    ctx.drawImage(
      img,
      (ICON_SIZE - drawWidth) / 2,
      (ICON_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight
    );

    return canvas.toDataURL('image/png');
  } finally {
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }
}

/**
 * Build an object URL for an SVG, giving it intrinsic dimensions if it only has
 * a viewBox — an `<img>` renders a width/height-less SVG at the default 300x150
 * replaced-element size, which would letterbox the logo.
 */
function svgObjectUrl(base64: string): string {
  let text = new TextDecoder().decode(
    Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  );

  const openTag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (openTag && !/\bwidth\s*=/i.test(openTag) && !/\bheight\s*=/i.test(openTag)) {
    const viewBox = openTag.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1];
    const parts = viewBox?.trim().split(/[\s,]+/).map(Number);
    if (parts && parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const sized = openTag.replace(/^<svg\b/i, `<svg width="${parts[2]}" height="${parts[3]}"`);
      text = text.replace(openTag, sized);
    }
  }

  return URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}
