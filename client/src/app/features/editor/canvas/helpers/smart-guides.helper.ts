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

/** Positive gaps between neighbours along `a` that share a row/column. */
function rowGaps(boxes: readonly Box[], a: Axis): [Box, Box][] {
  const c = other(a);
  const sorted = [...boxes].sort((p, q) => lo(p, a) - lo(q, a));
  const out: [Box, Box][] = [];
  for (let i = 0; i < sorted.length; i++) {
    // Every later box in the same row that nothing sits wholly in front of. Two
    // boxes side by side (e.g. a card and a wide text beside it) are both
    // neighbours; taking only the nearest would hide the other's gap.
    const p = sorted[i];
    const later = sorted.slice(i + 1).filter((b) => lo(b, a) > hi(p, a) && overlaps(b, p, c));
    for (const q of later) {
      if (!later.some((b) => b !== q && hi(b, a) <= lo(q, a))) out.push([p, q]);
    }
  }
  return out;
}

/**
 * Best offset along one axis from edge/center alignment and equal spacing.
 * `parts` are the individual moving items, whose own gaps count as references.
 */
function bestOnAxis(m: Box, parts: readonly Box[], targets: readonly Box[], a: Axis, thr: number): Candidate | null {
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
  // Matching a gap already used in this row (or inside the moving selection),
  // placed against the nearest item on either side (lists of cards).
  const shift = (b: Box, s: Box): Box => {
    const dx = s.x0 - m.x0;
    const dy = s.y0 - m.y0;
    return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
  };
  const refs: { g: number; marks: (s: Box) => GapGuide[] }[] = [
    ...rowGaps(row, a).map(([p, q]) => ({ g: lo(q, a) - hi(p, a), marks: () => [gap(p, q)] })),
    ...rowGaps(parts.length > 1 ? parts : [], a).map(([p, q]) => ({
      g: lo(q, a) - hi(p, a),
      marks: (s: Box) => [gap(shift(p, s), shift(q, s))],
    })),
  ];
  const before = row.filter((t) => hi(t, a) <= lo(m, a) + thr).pop();
  const after = row.find((t) => lo(t, a) >= hi(m, a) - thr);
  for (const { g, marks } of refs) {
    if (before) consider({ delta: hi(before, a) + g - lo(m, a), gaps: (s) => [...marks(s), gap(before, s)] });
    if (after) consider({ delta: lo(after, a) - g - hi(m, a), gaps: (s) => [gap(s, after), ...marks(s)] });
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
export function smartSnap(moving: Box, targets: readonly Box[], zoom: number, parts: readonly Box[] = []): SmartSnap {
  const thr = SNAP_PX / zoom;
  const bx = bestOnAxis(moving, parts, targets, 'x', thr);
  const by = bestOnAxis(moving, parts, targets, 'y', thr);
  const ox = bx?.delta ?? 0;
  const oy = by?.delta ?? 0;
  const s: Box = { x0: moving.x0 + ox, y0: moving.y0 + oy, x1: moving.x1 + ox, y1: moving.y1 + oy };
  return {
    ox,
    oy,
    snappedX: !!bx,
    snappedY: !!by,
    guides: [...(bx ? linesOn(s, targets, 'x') : []), ...(by ? linesOn(s, targets, 'y') : [])],
    gaps: [...withMatchingGaps(bx?.gaps?.(s) ?? [], s, targets, 'x'), ...withMatchingGaps(by?.gaps?.(s) ?? [], s, targets, 'y')],
  };
}

/**
 * Smart guides for a resize or a point drag: only the given moving edge
 * positions (`xs` / `ys`, world coords) snap to target edges/centers. `box` is
 * the item as it stands (unsnapped), used to span the guide lines.
 */
export function smartSnapEdges(
  box: Box,
  xs: readonly number[],
  ys: readonly number[],
  targets: readonly Box[],
  zoom: number,
): SmartSnap {
  const thr = SNAP_PX / zoom;
  const best = (vals: readonly number[], a: Axis): { d: number; at: number } | null => {
    let out: { d: number; at: number } | null = null;
    for (const t of targets) {
      for (const tl of [lo(t, a), (lo(t, a) + hi(t, a)) / 2, hi(t, a)]) {
        for (const v of vals) {
          const d = tl - v;
          if (Math.abs(d) <= thr && (!out || Math.abs(d) < Math.abs(out.d))) out = { d, at: tl };
        }
      }
    }
    return out;
  };
  const bx = best(xs, 'x');
  const by = best(ys, 'y');
  const s: Box = {
    x0: Math.min(box.x0, bx?.at ?? box.x0),
    x1: Math.max(box.x1, bx?.at ?? box.x1),
    y0: Math.min(box.y0, by?.at ?? box.y0),
    y1: Math.max(box.y1, by?.at ?? box.y1),
  };
  const guideAt = (pos: number, a: Axis): AlignGuide => {
    const c = other(a);
    const g: AlignGuide = { axis: a, pos, from: lo(s, c), to: hi(s, c) };
    for (const t of targets) {
      if (![lo(t, a), (lo(t, a) + hi(t, a)) / 2, hi(t, a)].some((tl) => Math.abs(tl - pos) < 0.5)) continue;
      g.from = Math.min(g.from, lo(t, c));
      g.to = Math.max(g.to, hi(t, c));
    }
    return g;
  };
  return {
    ox: bx?.d ?? 0,
    oy: by?.d ?? 0,
    snappedX: !!bx,
    snappedY: !!by,
    guides: [...(bx ? [guideAt(bx.at, 'x')] : []), ...(by ? [guideAt(by.at, 'y')] : [])],
    gaps: [],
  };
}

/**
 * The snap only names the gap(s) it matched; also mark every other neighbour
 * pair in the same row/column whose gap equals one of them, so a whole evenly
 * spaced run lights up rather than just the reference pair.
 */
function withMatchingGaps(marks: GapGuide[], s: Box, targets: readonly Box[], a: Axis): GapGuide[] {
  if (!marks.length) return marks;
  const c = other(a);
  const sizes = marks.map((g) => g.b - g.a);
  const row = [...targets.filter((t) => overlaps(t, s, c)), s];
  const out = [...marks];
  const key = (g: GapGuide) => `${Math.round(g.a * 2)}:${Math.round(g.b * 2)}`;
  const seen = new Set(out.map(key));
  for (const [p, q] of rowGaps(row, a)) {
    const g = lo(q, a) - hi(p, a);
    // Equal as the labels show them (gaps measured to glyphs are fractional).
    if (!sizes.some((v) => Math.abs(v - g) < 1 || Math.round(v) === Math.round(g))) continue;
    const cross = (Math.max(lo(p, c), lo(q, c)) + Math.min(hi(p, c), hi(q, c))) / 2;
    const m: GapGuide = { axis: a, a: hi(p, a), b: lo(q, a), cross };
    if (seen.has(key(m))) continue;
    seen.add(key(m));
    out.push(m);
  }
  return out;
}
