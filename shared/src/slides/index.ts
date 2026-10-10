// Slide-sequence and morph-matching logic for presentation mode. Pure functions
// over plain data so the client (and tests) can share them without any DOM.

import type { SlideConfig, SlideTransition } from '../models';

/** What a transition into a slide does when none has been configured. */
export const DEFAULT_SLIDE_TRANSITION: SlideTransition = {
  type: 'none',
  duration: 600,
  easing: 'ease-in-out',
};

/** The effective transition into a slide (its own, else the default). */
export function effectiveTransition(slide: SlideConfig | undefined): SlideTransition {
  return { ...DEFAULT_SLIDE_TRANSITION, ...(slide?.transition ?? {}) };
}

/** The minimal frame shape the sequence helpers need. */
export interface SlideFrameLike {
  id: string;
  x: number;
  y: number;
  slide?: SlideConfig;
}

/**
 * The slide sequence: the frames that carry a `slide` config, ordered by it
 * (ties fall back to reading order so a duplicated frame lands next to its source).
 */
export function slideSequence<T extends SlideFrameLike>(frames: readonly T[]): T[] {
  return frames
    .filter((f) => f.slide !== undefined)
    .sort(
      (a, b) =>
        (a.slide?.order ?? 0) - (b.slide?.order ?? 0) ||
        a.y - b.y ||
        a.x - b.x ||
        (a.id < b.id ? -1 : 1),
    );
}

/** The slides that will actually be shown (hidden ones skipped). */
export function presentableSlides<T extends SlideFrameLike>(frames: readonly T[]): T[] {
  return slideSequence(frames).filter((f) => !f.slide?.hidden);
}

// ---- Morph matching -------------------------------------------------------

/** One element or table on a slide, in slide-local coordinates. */
export interface MorphItem {
  /** Lineage key: the element's morphId, else its own id (tables: own id). */
  key: string;
  kind: 'element' | 'table';
  /** Element type (rectangle/text/...) or 'table'. */
  type: string;
  /** Text content, or the table name. */
  text: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Dice coefficient over character bigrams, 0..1. */
export function textSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) {
    return x ? 1 : 0;
  }
  if (x.length < 2 || y.length < 2) {
    return 0;
  }
  // One text grown or trimmed from the other ("Hello" -> "Hello, world") is the same text.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 3 && long.includes(short)) {
    return Math.max(0.7, short.length / long.length);
  }
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i += 1) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i += 1) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

function dist(a: MorphItem, b: MorphItem): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function sizeRatioOk(a: MorphItem, b: MorphItem): boolean {
  const ok = (p: number, q: number): boolean => {
    const hi = Math.max(p, q);
    const lo = Math.min(p, q);
    return hi < 1 || lo / hi >= 0.75;
  };
  return ok(a.w, b.w) && ok(a.h, b.h);
}

/**
 * Pair items of two consecutive slides for a morph. Returns [fromIndex, toIndex]
 * pairs; anything unpaired fades out (from) or in (to). Passes, strongest first:
 *   1. shared lineage key (copied slides, or a manual pairing),
 *   2. same type and identical text,
 *   3. same type and similar text,
 *   4. same type, no text, similar size, nearby.
 * Within a pass the closest candidates win; each item is used at most once.
 */
export function matchMorphItems(
  from: readonly MorphItem[],
  to: readonly MorphItem[],
  maxDistance = 160,
): Array<[number, number]> {
  const usedFrom = new Set<number>();
  const usedTo = new Set<number>();
  const pairs: Array<[number, number]> = [];

  const pass = (score: (a: MorphItem, b: MorphItem) => number | null): void => {
    const candidates: Array<{ i: number; j: number; cost: number }> = [];
    from.forEach((a, i) => {
      if (usedFrom.has(i)) {
        return;
      }
      to.forEach((b, j) => {
        if (usedTo.has(j) || a.kind !== b.kind) {
          return;
        }
        const cost = score(a, b);
        if (cost !== null) {
          candidates.push({ i, j, cost });
        }
      });
    });
    candidates.sort((p, q) => p.cost - q.cost);
    for (const c of candidates) {
      if (!usedFrom.has(c.i) && !usedTo.has(c.j)) {
        usedFrom.add(c.i);
        usedTo.add(c.j);
        pairs.push([c.i, c.j]);
      }
    }
  };

  pass((a, b) => (a.key === b.key ? dist(a, b) : null));
  pass((a, b) =>
    a.type === b.type && a.text.trim() && a.text.trim() === b.text.trim() ? dist(a, b) : null,
  );
  pass((a, b) => {
    if (a.type !== b.type || !a.text.trim() || !b.text.trim()) {
      return null;
    }
    const s = textSimilarity(a.text, b.text);
    return s >= 0.6 ? (1 - s) * 1000 + dist(a, b) / 1000 : null;
  });
  pass((a, b) => {
    if (a.type !== b.type || a.text.trim() || b.text.trim() || a.kind !== 'element') {
      return null;
    }
    const d = dist(a, b);
    return d <= maxDistance && sizeRatioOk(a, b) ? d : null;
  });
  return pairs;
}
