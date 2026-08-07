import type { Action } from 'svelte/action';
import { QUOTE_MIN_CHARS } from '$lib/utils/quote';

/**
 * Svelte action that tracks the user's text selection inside a container and
 * reports it as a quotable snippet (with a viewport rect for anchoring a
 * popover). Generic on purpose: `SdkView` attaches it to its whole root, which
 * covers the transcript AND the session dock (PR diff, validation findings) in
 * one wiring, and other views can reuse it as-is.
 *
 * Reports `null` whenever there is nothing to quote: collapsed selection, a
 * selection outside the container or inside an excluded subtree / form field,
 * too short a selection, or a selection scrolled out of the container's box.
 * The last case keeps the underlying range, so scrolling back re-reports it.
 */
export interface QuoteSelection {
  /** Selected text, verbatim — formatting happens at insert time. */
  text: string;
  /** True when the selection sits inside a <pre>/<code> subtree. */
  isCode: boolean;
  /** Provenance from the nearest `[data-quote-source]` ancestor, e.g. "Bash output". */
  sourceLabel?: string;
  /** Viewport rect of the selection, for anchoring UI to it. */
  rect: DOMRect;
}

export interface SelectionQuoteParams {
  /** When false, the action reports nothing (feature off / view not interactive). */
  enabled?: boolean;
  /** Minimum trimmed length before a selection counts. */
  minChars?: number;
  /** CSS selector for subtrees inside the node that must never produce quotes. */
  exclude?: string;
  onChange: (selection: QuoteSelection | null) => void;
}

function elementOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node.parentElement;
}

function isFormField(el: HTMLElement | null): boolean {
  return !!el?.closest('input, textarea, select, [contenteditable="true"]');
}

export const selectionQuote: Action<HTMLElement, SelectionQuoteParams> = (
  node,
  initial
) => {
  let params = initial;
  /** The live selection, kept across scrolls so the rect can be recomputed. */
  let current: {
    range: Range;
    text: string;
    isCode: boolean;
    sourceLabel?: string;
    /** Scroll container the selection lives in, for clipping the reported rect. */
    scroller: HTMLElement;
  } | null = null;
  /** Whether the last emit was non-null, so `null` is only emitted on change. */
  let reported = false;
  let recomputeFrame = 0;
  let publishFrame = 0;

  /**
   * Nearest scrollable ancestor within the node (the transcript, a dock panel,
   * …), so a selection scrolled out of *its own* pane stops being reported even
   * though it's still inside the node's box.
   */
  function scrollerOf(el: HTMLElement): HTMLElement {
    let cursor: HTMLElement | null = el;
    while (cursor && cursor !== node) {
      const overflowY = getComputedStyle(cursor).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        cursor.scrollHeight > cursor.clientHeight
      ) {
        return cursor;
      }
      cursor = cursor.parentElement;
    }
    return node;
  }

  /**
   * Viewport rect of the range, or null when it has no geometry (the DOM under
   * it was replaced by a streaming re-render) or has scrolled out of view.
   */
  function rectOf(range: Range, scroller: HTMLElement): DOMRect | null {
    let rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      const first = range.getClientRects()[0];
      if (!first) return null;
      rect = first;
    }
    if (rect.width === 0 && rect.height === 0) return null;
    const host = scroller.getBoundingClientRect();
    if (rect.bottom < host.top || rect.top > host.bottom) return null;
    return rect;
  }

  function clear() {
    current = null;
    publish();
  }

  function publish() {
    const rect = current ? rectOf(current.range, current.scroller) : null;
    if (!current || !rect) {
      if (reported) {
        reported = false;
        params.onChange(null);
      }
      return;
    }
    reported = true;
    params.onChange({
      text: current.text,
      isCode: current.isCode,
      sourceLabel: current.sourceLabel,
      rect,
    });
  }

  function recompute() {
    recomputeFrame = 0;
    if (params.enabled === false) return clear();

    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return clear();
    }

    const anchor = elementOf(selection.anchorNode);
    const focus = elementOf(selection.focusNode);
    if (!anchor || !focus) return clear();
    if (!node.contains(anchor) || !node.contains(focus)) return clear();
    if (isFormField(anchor) || isFormField(focus)) return clear();
    if (
      params.exclude &&
      (anchor.closest(params.exclude) || focus.closest(params.exclude))
    ) {
      return clear();
    }

    const text = selection.toString();
    if (text.trim().length < (params.minChars ?? QUOTE_MIN_CHARS)) {
      return clear();
    }

    const range = selection.getRangeAt(0);
    const common = elementOf(range.commonAncestorContainer) ?? anchor;
    current = {
      range,
      text,
      // `data-quote-code` marks code-like regions that aren't <pre>/<code>
      // (e.g. the PR diff's line grid).
      isCode: !!common.closest('pre, code, [data-quote-code]'),
      sourceLabel:
        common.closest<HTMLElement>('[data-quote-source]')?.dataset
          .quoteSource || undefined,
      scroller: scrollerOf(common),
    };
    publish();
  }

  function scheduleRecompute() {
    if (recomputeFrame) return;
    recomputeFrame = requestAnimationFrame(recompute);
  }

  /** Scroll/resize only move the selection — reuse the range, skip re-extraction. */
  function schedulePublish() {
    if (publishFrame) return;
    publishFrame = requestAnimationFrame(() => {
      publishFrame = 0;
      publish();
    });
  }

  document.addEventListener('selectionchange', scheduleRecompute);
  document.addEventListener('scroll', schedulePublish, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', schedulePublish);

  return {
    update(next: SelectionQuoteParams) {
      params = next;
      scheduleRecompute();
    },
    destroy() {
      document.removeEventListener('selectionchange', scheduleRecompute);
      document.removeEventListener('scroll', schedulePublish, true);
      window.removeEventListener('resize', schedulePublish);
      if (recomputeFrame) cancelAnimationFrame(recomputeFrame);
      if (publishFrame) cancelAnimationFrame(publishFrame);
      if (reported) params.onChange(null);
    },
  };
};
