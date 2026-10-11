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
 * Which items are kept out of look-alike matching: forward, every tagged item of `a`
 * and the tagged items of `b` that `a` also tags; `reversed` (`a` is the later slide,
 * going back) mirrors that. See `reservedIn`.
 */
const tagGuards = <A extends { morphId?: string }, B extends { morphId?: string }>(
  a: readonly A[],
  b: readonly B[],
  reversed: boolean,
): { tagA: (x: A) => boolean; tagB: (x: B) => boolean } =>
  reversed
    ? { tagA: reservedIn(b) as (x: A) => boolean, tagB: hasTag }
    : { tagA: hasTag, tagB: reservedIn(a) as (x: B) => boolean };

/**
 * Whether an item of the NEW slide is reserved by its tag: it is tagged and some item
 * of the old slide carries the same tag. A tag nothing on the old slide claims leaves
 * it open to untagged look-alikes.
 */
const reservedIn = (
  from: readonly { morphId?: string }[],
): ((x: { morphId?: string }) => boolean) => {
  const tags = new Set(from.filter(hasTag).map((x) => x.morphId));
  // Solo tags (diagram-spec `newSoloTag`) mean "never morph": always reserved.
  const solo = (x: { morphId?: string }): boolean =>
    (morphTagOf(x.morphId) ?? '').startsWith('solo-');
  return (x) => hasTag(x) && (solo(x) || tags.has(x.morphId));
};

/**
 * Pair the participants of two diagrams: same tag; then same label (closest
 * position first); then similar labels ("API" -> "API Gateway"); finally, when the
 * same number of participants is left on both sides, left-to-right (a renamed
 * participant keeps its seat).
 */
export function matchLifelines(
  a: readonly SeqLifelineLike[],
  b: readonly SeqLifelineLike[],
  reversed = false,
): Pair[] {
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: Pair[] = [];
  const { tagA, tagB } = tagGuards(a, b, reversed);
  const run = (
    score: (x: SeqLifelineLike, y: SeqLifelineLike, i: number, j: number) => number | null,
    byTag = false,
  ): void => assign(a, b, usedA, usedB, out, score, tagA, tagB, byTag);

  run((x, y) => (x.morphId && x.morphId === y.morphId ? Math.abs(x.x - y.x) : null), true);
  run((x, y) => (norm(x.label) && norm(x.label) === norm(y.label) ? Math.abs(x.x - y.x) : null));
  run((x, y) => {
    const s = textSimilarity(x.label, y.label);
    return s >= 0.6 ? (1 - s) * 1000 + Math.abs(x.x - y.x) / 1000 : null;
  });
  const restA = a.map((_x, i) => i).filter((i) => !usedA.has(i) && !tagA(a[i]));
  const restB = b.map((_x, j) => j).filter((j) => !usedB.has(j) && !tagB(b[j]));
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
 * "the same participant" count as the same end.
 *
 * Tagged messages pair by tag first. The rest are aligned like a text diff: the
 * pairing keeps the messages in their order (so a step stays at its own row and
 * rows added or removed shift the ones after them), choosing the alignment with
 * the best total score. A pair scores by how much it shares: same ends and
 * wording > same ends, edited wording > one end moved (the arrow grows or
 * shrinks) > same wording re-targeted; the further a message has to travel,
 * the less it is worth. Anything the ordered alignment left out then gets a
 * second chance without the ordering constraint (a message that was moved).
 */
export function matchMessages(
  a: readonly SeqMessageLike[],
  b: readonly SeqMessageLike[],
  lifelinePairs: readonly Pair[],
  lifelinesA: readonly SeqLifelineLike[],
  lifelinesB: readonly SeqLifelineLike[],
  reversed = false,
): Pair[] {
  // A shared key per participant: paired participants share one, others are alone.
  const keyA = new Map<string, string>();
  const keyB = new Map<string, string>();
  lifelinePairs.forEach(([i, j], k) => {
    keyA.set(lifelinesA[i].id, `p${k}`);
    keyB.set(lifelinesB[j].id, `p${k}`);
  });
  const end = (id: string, keys: Map<string, string>, side: string): string =>
    keys.get(id) ?? `${side}:${id}`;

  const rank = (list: readonly SeqMessageLike[]): number[] => {
    const order = list.map((m, i) => ({ y: m.y, i })).sort((p, q) => p.y - q.y || p.i - q.i);
    const out = new Array<number>(list.length).fill(0);
    order.forEach((e, r) => (out[e.i] = r));
    return out;
  };
  const rowA = rank(a);
  const rowB = rank(b);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: Pair[] = [];
  const { tagA, tagB } = tagGuards(a, b, reversed);

  // Tag pass.
  assign(
    a,
    b,
    usedA,
    usedB,
    out,
    (x, y, i, j) =>
      x.morphId && x.morphId === y.morphId ? Math.abs(rowA[i] - rowB[j]) : null,
    hasTag,
    hasTag,
    true,
  );

  /** Worth of pairing a[i] with b[j] (null / <= 0 = never pair). */
  const worth = (i: number, j: number): number | null => {
    const x = a[i];
    const y = b[j];
    if (x.style !== y.style) return null;
    const fromSame = end(x.fromLifelineId, keyA, 'a') === end(y.fromLifelineId, keyB, 'b');
    const toSame = end(x.toLifelineId, keyA, 'a') === end(y.toLifelineId, keyB, 'b');
    const la = norm(x.label);
    const lb = norm(y.label);
    const sameLabel = la === lb;
    const similar = !sameLabel && la !== '' && lb !== '' && textSimilarity(la, lb) >= 0.5;
    let base: number | null = null;
    if (fromSame && toSame) {
      base = sameLabel ? 10 : similar ? 8 : 6;
    } else if (fromSame || toSame) {
      // One end moved: the arrow grows / shrinks. Needs the wording to back it up.
      base = sameLabel ? 6 : similar ? 5 : null;
    } else if (sameLabel && la !== '') {
      base = 4;
    }
    if (base === null) return null;
    const net = base - Math.min(Math.abs(rowA[i] - rowB[j]), 6) * 1.25;
    return net > 0 ? net : null;
  };

  // Ordered alignment (weighted LCS) of what is left.
  const restA = a.map((_m, i) => i).filter((i) => !usedA.has(i) && !tagA(a[i]));
  const restB = b.map((_m, j) => j).filter((j) => !usedB.has(j) && !tagB(b[j]));
  restA.sort((p, q) => rowA[p] - rowA[q]);
  restB.sort((p, q) => rowB[p] - rowB[q]);
  const n = restA.length;
  const m = restB.length;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const gain: Array<Array<number | null>> = Array.from({ length: n }, (_r, p) =>
    restB.map((j) => worth(restA[p], j)),
  );
  for (let p = 1; p <= n; p += 1) {
    for (let q = 1; q <= m; q += 1) {
      const g = gain[p - 1][q - 1];
      best[p][q] = Math.max(
        best[p - 1][q],
        best[p][q - 1],
        g === null ? 0 : best[p - 1][q - 1] + g,
      );
    }
  }
  for (let p = n, q = m; p > 0 && q > 0; ) {
    const g = gain[p - 1][q - 1];
    if (g !== null && best[p][q] === best[p - 1][q - 1] + g) {
      out.push([restA[p - 1], restB[q - 1]]);
      usedA.add(restA[p - 1]);
      usedB.add(restB[q - 1]);
      p -= 1;
      q -= 1;
    } else if (best[p][q] === best[p - 1][q]) {
      p -= 1;
    } else {
      q -= 1;
    }
  }

  // Second chance, order ignored: messages that moved to another place.
  assign(
    a,
    b,
    usedA,
    usedB,
    out,
    (_x, _y, i, j) => {
      const w = worth(i, j);
      return w === null ? null : 100 - w;
    },
    tagA,
    tagB,
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
  reversed = false,
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
  const { tagA, tagB } = tagGuards(a, b, reversed);
  const run = (
    score: (x: SeqDiagramLike, y: SeqDiagramLike) => number | null,
    byTag = false,
  ): void => assign(a, b, usedA, usedB, out, score, tagA, tagB, byTag);
  run((x, y) => (x.morphId && x.morphId === y.morphId ? 0 : null), true);
  run((x, y) => {
    const s = share(x, y);
    if (s < 0.5) return null;
    const sameTitle = norm(x.title) !== '' && norm(x.title) === norm(y.title);
    return 1 - s - (sameTitle ? 0.01 : 0);
  });
  return out;
}
