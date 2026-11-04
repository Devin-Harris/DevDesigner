import type { Box } from '../models/geometry.model';

/** An alignment line: at `x = pos` (axis 'x') or `y = pos` (axis 'y'), spanning `from..to`. */
export interface AlignGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

/** An equal-spacing marker: a gap from `a` to `b` along `axis`, drawn at `cross`. */
export interface GapGuide {
  axis: 'x' | 'y';
  a: number;
  b: number;
  cross: number;
}

export interface SmartSnap {
  /** Correction to add to the raw drag offset. */
  ox: number;
  oy: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: AlignGuide[];
  gaps: GapGuide[];
}

/** Snap reach in screen px; divided by zoom so it feels the same at every zoom. */
const SNAP_PX = 6;
/** Only the nearest few visible items compete, like Figma/PowerPoint. */
const MAX_TARGETS = 40;

type Axis = 'x' | 'y';
const lo = (b: Box, a: Axis) => (a === 'x' ? b.x0 : b.y0);
const hi = (b: Box, a: Axis) => (a === 'x' ? b.x1 : b.y1);
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
const overlaps = (p: Box, q: Box, a: Axis) => lo(p, a) < hi(q, a) && lo(q, a) < hi(p, a);
const intersects = (p: Box, q: Box) => overlaps(p, q, 'x') && overlaps(p, q, 'y');

/** Pick the targets that matter: on screen, nearest the moving box first. */
export function snapTargets(moving: Box, targets: readonly Box[], view: Box | null): Box[] {
  const cx = (moving.x0 + moving.x1) / 2;
  const cy = (moving.y0 + moving.y1) / 2;
  const dist = (b: Box) => Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy);
  return targets
    .filter((b) => !view || intersects(b, view))
    .map((b) => ({ b, d: dist(b) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, MAX_TARGETS)
    .map((p) => p.b);
}

interface Candidate {
  delta: number;
  gaps?: (shifted: Box) => GapGuide[];
}

/** Best offset along one axis from edge/center alignment and equal spacing. */
function bestOnAxis(m: Box, targets: readonly Box[], a: Axis, thr: number): Candidate | null {
  let best: Candidate | null = null;
  const consider = (c: Candidate) => {
    if (Math.abs(c.delta) <= thr && (!best || Math.abs(c.delta) < Math.abs(best.delta) - 0.01)) best = c;
  };
  const mLines = [lo(m, a), (lo(m, a) + hi(m, a)) / 2, hi(m, a)];
  for (const t of targets) {
    const tLines = [lo(t, a), (lo(t, a) + hi(t, a)) / 2, hi(t, a)];
    for (const ml of mLines) for (const tl of tLines) consider({ delta: tl - ml });
  }
  // Spacing only among items in the same row/column as the moving box.
  const c = other(a);
  const row = targets.filter((t) => overlaps(t, m, c)).sort((p, q) => lo(p, a) - lo(q, a));
  const size = hi(m, a) - lo(m, a);
  const crossOf = (p: Box, q: Box) => (Math.max(lo(p, c), lo(q, c)) + Math.min(hi(p, c), hi(q, c))) / 2;
  const gap = (p: Box, q: Box): GapGuide => ({ axis: a, a: hi(p, a), b: lo(q, a), cross: crossOf(p, q) });
  // Centered between two neighbours.
  for (const l of row) {
    for (const r of row) {
      if (hi(l, a) >= lo(r, a)) continue;
      const start = (hi(l, a) + lo(r, a) - size) / 2;
      if (start < hi(l, a)) continue;
      consider({ delta: start - lo(m, a), gaps: (s) => [gap(l, s), gap(s, r)] });
    }
  }
  // Continuing an existing gap between two adjacent items (lists of cards).
  for (let i = 0; i + 1 < row.length; i++) {
    const p = row[i];
    const q = row[i + 1];
    const g = lo(q, a) - hi(p, a);
    if (g <= 0) continue;
    consider({ delta: hi(q, a) + g - lo(m, a), gaps: (s) => [gap(p, q), gap(q, s)] });
    consider({ delta: lo(p, a) - g - size - lo(m, a), gaps: (s) => [gap(s, p), gap(p, q)] });
  }
  return best as Candidate | null;
}

/** Alignment lines the (already snapped) box sits exactly on. */
function linesOn(m: Box, targets: readonly Box[], a: Axis): AlignGuide[] {
  const c = other(a);
  const mLines = [lo(m, a), (lo(m, a) + hi(m, a)) / 2, hi(m, a)];
  const out = new Map<number, AlignGuide>();
  for (const t of targets) {
    const tLines = [lo(t, a), (lo(t, a) + hi(t, a)) / 2, hi(t, a)];
    for (const ml of mLines) {
      if (!tLines.some((tl) => Math.abs(tl - ml) < 0.5)) continue;
      const key = Math.round(ml * 2);
      const g = out.get(key) ?? { axis: a, pos: ml, from: lo(m, c), to: hi(m, c) };
      g.from = Math.min(g.from, lo(t, c));
      g.to = Math.max(g.to, hi(t, c));
      out.set(key, g);
    }
  }
  return [...out.values()];
}

/**
 * Figma-style smart guides: snap `moving` to the edges/centers of nearby
 * targets and to equal spacing in a row or column. `zoom` scales the reach.
 */
export function smartSnap(moving: Box, targets: readonly Box[], zoom: number): SmartSnap {
  const thr = SNAP_PX / zoom;
  const bx = bestOnAxis(moving, targets, 'x', thr);
  const by = bestOnAxis(moving, targets, 'y', thr);
  const ox = bx?.delta ?? 0;
  const oy = by?.delta ?? 0;
  const s: Box = { x0: moving.x0 + ox, y0: moving.y0 + oy, x1: moving.x1 + ox, y1: moving.y1 + oy };
  return {
    ox,
    oy,
    snappedX: !!bx,
    snappedY: !!by,
    guides: [...(bx ? linesOn(s, targets, 'x') : []), ...(by ? linesOn(s, targets, 'y') : [])],
    gaps: [...(bx?.gaps?.(s) ?? []), ...(by?.gaps?.(s) ?? [])],
  };
}
