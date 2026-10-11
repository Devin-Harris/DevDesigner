// Pairing of the parts of two sequence diagrams for a morph transition: which
// participant of slide A is which participant of slide B, which message is which.
// Pure (no DOM) so the client's morph stage and the MCP preview share it. Tagged
// parts (a `tag:<name>` morph id) pair ONLY with the same tag, exactly like tagged
// slide objects; untagged parts pair by name and wording.

import { morphTagOf, textSimilarity } from './index';

export interface SeqLifelineLike {
  id: string;
  label: string;
  x: number;
  morphId?: string;
}

export interface SeqMessageLike {
  id: string;
  fromLifelineId: string;
  toLifelineId: string;
  label?: string;
  style: string;
  /** World Y; only the order between messages of one diagram matters. */
  y: number;
  morphId?: string;
}

export interface SeqDiagramLike {
  id: string;
  title?: string;
  morphId?: string;
  lifelines: readonly SeqLifelineLike[];
}

type Pair = [number, number];

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Greedy assignment: candidates are scored (null = not allowed), the cheapest
 * first, each item used once. `tagged` items only take part when `byTag`.
 */
function assign<A, B>(
  a: readonly A[],
  b: readonly B[],
  usedA: Set<number>,
  usedB: Set<number>,
  out: Pair[],
  score: (x: A, y: B, i: number, j: number) => number | null,
  taggedA: (x: A) => boolean,
  taggedB: (x: B) => boolean,
  byTag = false,
): void {
  const cands: Array<{ i: number; j: number; cost: number }> = [];
  a.forEach((x, i) => {
    if (usedA.has(i) || (!byTag && taggedA(x))) return;
    b.forEach((y, j) => {
      if (usedB.has(j) || (!byTag && taggedB(y))) return;
      const cost = score(x, y, i, j);
      if (cost !== null) cands.push({ i, j, cost });
    });
  });
  cands.sort((p, q) => p.cost - q.cost || p.i - q.i || p.j - q.j);
  for (const c of cands) {
    if (!usedA.has(c.i) && !usedB.has(c.j)) {
      usedA.add(c.i);
      usedB.add(c.j);
      out.push([c.i, c.j]);
    }
  }
}

const hasTag = (x: { morphId?: string }): boolean => morphTagOf(x.morphId) !== null;

/**
 * Pair the participants of two diagrams: same tag; then same label (closest
 * position first); then similar labels ("API" -> "API Gateway"); finally, when the
 * same number of participants is left on both sides, left-to-right (a renamed
 * participant keeps its seat).
 */
export function matchLifelines(
  a: readonly SeqLifelineLike[],
  b: readonly SeqLifelineLike[],
): Pair[] {
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: Pair[] = [];
  const run = (
    score: (x: SeqLifelineLike, y: SeqLifelineLike, i: number, j: number) => number | null,
    byTag = false,
  ): void => assign(a, b, usedA, usedB, out, score, hasTag, hasTag, byTag);

  run((x, y) => (x.morphId && x.morphId === y.morphId ? Math.abs(x.x - y.x) : null), true);
  run((x, y) => (norm(x.label) && norm(x.label) === norm(y.label) ? Math.abs(x.x - y.x) : null));
  run((x, y) => {
    const s = textSimilarity(x.label, y.label);
    return s >= 0.6 ? (1 - s) * 1000 + Math.abs(x.x - y.x) / 1000 : null;
  });
  const restA = a.map((_x, i) => i).filter((i) => !usedA.has(i) && !hasTag(a[i]));
  const restB = b.map((_x, j) => j).filter((j) => !usedB.has(j) && !hasTag(b[j]));
  if (restA.length > 0 && restA.length === restB.length) {
    const byX = (list: readonly SeqLifelineLike[], idx: number[]): number[] =>
      [...idx].sort((p, q) => list[p].x - list[q].x);
    const sa = byX(a, restA);
    const sb = byX(b, restB);
    sa.forEach((i, k) => {
      usedA.add(i);
      usedB.add(sb[k]);
      out.push([i, sb[k]]);
    });
  }
  return out;
}

/**
 * Pair the messages of two diagrams. `lifelinePairs` (from matchLifelines) lets
 * "the same participant" count as the same end. Order of passes: same tag; same
 * ends + same wording; same ends + similar wording; same ends (the wording was
 * edited, the step is the same); same wording on different ends (re-targeted).
 * Within a pass the messages at the closest row win, so a diagram that grew
 * keeps its earlier messages in place.
 */
export function matchMessages(
  a: readonly SeqMessageLike[],
  b: readonly SeqMessageLike[],
  lifelinePairs: readonly Pair[],
  lifelinesA: readonly SeqLifelineLike[],
  lifelinesB: readonly SeqLifelineLike[],
): Pair[] {
  // A shared key per participant: paired participants share one, others are alone.
  const keyA = new Map<string, string>();
  const keyB = new Map<string, string>();
  lifelinePairs.forEach(([i, j], k) => {
    keyA.set(lifelinesA[i].id, `p${k}`);
    keyB.set(lifelinesB[j].id, `p${k}`);
  });
  const ends = (m: SeqMessageLike, keys: Map<string, string>, side: string): string =>
    `${keys.get(m.fromLifelineId) ?? `${side}:${m.fromLifelineId}`}>${
      keys.get(m.toLifelineId) ?? `${side}:${m.toLifelineId}`
    }|${m.style}`;

  const orderA = [...a].map((m, i) => ({ m, i })).sort((p, q) => p.m.y - q.m.y);
  const orderB = [...b].map((m, j) => ({ m, j })).sort((p, q) => p.m.y - q.m.y);
  const rowA = new Map(orderA.map((e, r) => [e.i, r]));
  const rowB = new Map(orderB.map((e, r) => [e.j, r]));

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: Pair[] = [];
  const run = (
    score: (x: SeqMessageLike, y: SeqMessageLike, i: number, j: number) => number | null,
    byTag = false,
  ): void => assign(a, b, usedA, usedB, out, score, hasTag, hasTag, byTag);
  const near = (i: number, j: number): number => Math.abs((rowA.get(i) ?? 0) - (rowB.get(j) ?? 0));
  const sameEnds = (x: SeqMessageLike, y: SeqMessageLike): boolean =>
    ends(x, keyA, 'a') === ends(y, keyB, 'b');

  run((x, y, i, j) => (x.morphId && x.morphId === y.morphId ? near(i, j) : null), true);
  run((x, y, i, j) =>
    sameEnds(x, y) && (x.label ?? '').trim() === (y.label ?? '').trim() ? near(i, j) : null,
  );
  run((x, y, i, j) => {
    if (!sameEnds(x, y) || !norm(x.label) || !norm(y.label)) return null;
    const s = textSimilarity(x.label!, y.label!);
    return s >= 0.5 ? (1 - s) * 1000 + near(i, j) : null;
  });
  run((x, y, i, j) => (sameEnds(x, y) ? 1000 + near(i, j) : null));
  run((x, y, i, j) =>
    norm(x.label) && norm(x.label) === norm(y.label) && x.style === y.style
      ? 2000 + near(i, j)
      : null,
  );
  return out;
}

/**
 * Pair the sequence diagrams of two slides: same tag, else the most shared
 * participant labels (at least half), a matching title breaking ties.
 */
export function matchDiagrams(
  a: readonly SeqDiagramLike[],
  b: readonly SeqDiagramLike[],
): Pair[] {
  const share = (x: SeqDiagramLike, y: SeqDiagramLike): number => {
    if (!x.lifelines.length || !y.lifelines.length) return 0;
    const pool = y.lifelines.map((l) => norm(l.label));
    let hit = 0;
    for (const l of x.lifelines) {
      const k = pool.indexOf(norm(l.label));
      if (k >= 0) {
        pool.splice(k, 1);
        hit += 1;
      }
    }
    return hit / Math.max(x.lifelines.length, y.lifelines.length);
  };
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: Pair[] = [];
  const run = (
    score: (x: SeqDiagramLike, y: SeqDiagramLike) => number | null,
    byTag = false,
  ): void => assign(a, b, usedA, usedB, out, score, hasTag, hasTag, byTag);
  run((x, y) => (x.morphId && x.morphId === y.morphId ? 0 : null), true);
  run((x, y) => {
    const s = share(x, y);
    if (s < 0.5) return null;
    const sameTitle = norm(x.title) !== '' && norm(x.title) === norm(y.title);
    return 1 - s - (sameTitle ? 0.01 : 0);
  });
  return out;
}
