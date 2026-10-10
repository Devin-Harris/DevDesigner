import {
  matchMorphItems,
  type CanvasElementModel,
  type LifelineModel,
  type PointModel,
  type RelationshipModel,
  type SequenceDiagramModel,
  type SequenceMessageModel,
  type TableModel,
} from '@dbdesigner/shared';
import { buildDiagramSvg } from '../export/diagram-svg.helper';
import type { RenderedSlide, SlideItem } from './slide-render.service';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRID_ID = 'dbd-export-grid';

/** Longest text (in characters) that is morphed glyph by glyph; longer just cross-fades. */
const MAX_CHAR_MORPH = 360;

/** A slide's SVG, taken apart into the pieces a morph animates. */
interface Side {
  root: SVGSVGElement;
  /** The world -> slide-local `<g transform>` holding all content. */
  main: SVGGElement;
  items: Map<string, SVGGElement>;
  /** Content that isn't a tagged table/element (connectors, sequence diagrams). */
  rest: Element[];
}

function parse(slide: RenderedSlide, gridId: string): Side {
  const text = gridId === GRID_ID ? slide.svg : slide.svg.split(GRID_ID).join(gridId);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement as unknown as SVGSVGElement;
  const main = root.querySelector(':scope > g') as SVGGElement | null;
  const items = new Map<string, SVGGElement>();
  const rest: Element[] = [];
  if (main) {
    for (const child of Array.from(main.children)) {
      const id = child.getAttribute('data-eid') ?? child.getAttribute('data-tid');
      if (id && child instanceof SVGGElement) {
        items.set(id, child);
      } else {
        rest.push(child);
      }
    }
  }
  return {
    root,
    main: main ?? (doc.createElementNS(SVG_NS, 'g') as SVGGElement),
    items,
    rest,
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolate angles the short way round. */
function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + delta * t;
}

/** Fade in over the first half so a still-opaque twin never dips in brightness. */
const fadeIn = (t: number): number => Math.min(1, t * 2);
/** Fade out over the second half (the incoming twin is already opaque by then). */
const fadeOut = (t: number): number => 1 - Math.max(0, t * 2 - 1);

function parseColor(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) {
    return t < 0.5 ? a : b;
  }
  return `rgb(${ca.map((v, i) => Math.round(lerp(v, cb[i], t))).join(',')})`;
}

function mixOptionalColor(
  a: string | undefined,
  b: string | undefined,
  t: number,
): string | undefined {
  if (a && b) {
    return mixColor(a, b, t);
  }
  return t < 0.5 ? a : b;
}

type Offset = { x: number; y: number };

/** The element at progress `t` between its two slide versions (slide-local coordinates). */
function blendElement(
  a: CanvasElementModel,
  b: CanvasElementModel,
  t: number,
  offA: Offset,
  offB: Offset,
): CanvasElementModel {
  const pick = t < 0.5 ? a : b;
  const num = (x: number | undefined, y: number | undefined): number | undefined =>
    x !== undefined && y !== undefined ? lerp(x, y, t) : (y ?? x);
  let points: PointModel[] | undefined = pick.points;
  if (a.points && b.points && a.points.length === b.points.length) {
    points = a.points.map((p, i) => ({
      x: lerp(p.x, b.points![i].x, t),
      y: lerp(p.y, b.points![i].y, t),
    }));
  }
  return {
    ...pick,
    id: b.id,
    startBinding: b.startBinding,
    endBinding: b.endBinding,
    x: lerp(a.x - offA.x, b.x - offB.x, t),
    y: lerp(a.y - offA.y, b.y - offB.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    angle: lerpAngle(a.angle ?? 0, b.angle ?? 0, t),
    strokeColor: mixColor(a.strokeColor, b.strokeColor, t),
    backgroundColor: mixOptionalColor(a.backgroundColor, b.backgroundColor, t),
    strokeWidth: lerp(a.strokeWidth, b.strokeWidth, t),
    opacity: lerp(a.opacity, b.opacity, t),
    cornerRadius: num(a.cornerRadius, b.cornerRadius),
    fontSize: num(a.fontSize, b.fontSize),
    curvature: num(a.curvature, b.curvature),
    points,
  };
}

/** Fraction of lifeline labels two sequence diagrams share (0..1). */
function diagramSimilarity(
  a: RenderedSlide['sequences'],
  b: RenderedSlide['sequences'],
  da: SequenceDiagramModel,
  db: SequenceDiagramModel,
): number {
  const la = a.lifelines.filter((l) => l.diagramId === da.id).map((l) => l.label);
  const lb = b.lifelines.filter((l) => l.diagramId === db.id).map((l) => l.label);
  if (!la.length || !lb.length) {
    return 0;
  }
  const pool = [...lb];
  let hit = 0;
  for (const label of la) {
    const k = pool.indexOf(label);
    if (k >= 0) {
      pool.splice(k, 1);
      hit += 1;
    }
  }
  return hit / Math.max(la.length, lb.length);
}

interface SeqPair {
  a: SequenceDiagramModel;
  b: SequenceDiagramModel;
}

interface Glyph {
  ch: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  family: string;
  weight: string;
  /** Index of the word (run of non-space characters) this glyph belongs to. */
  w: number;
}

/** One animated character: moves from `a` to `b`, or fades out (b null) / in (a null). */
interface CharMove {
  el: SVGTextElement;
  a: Glyph | null;
  b: Glyph | null;
}

/** Non-space characters of an on-screen <text>, with where each one actually sits. */
function readGlyphs(text: SVGTextElement, off: Offset): Glyph[] | null {
  const content = text.textContent ?? '';
  const n = text.getNumberOfChars();
  if (n === 0 || n !== content.length) {
    return null;
  }
  const size = Number(text.getAttribute('font-size')) || 16;
  const out: Glyph[] = [];
  let word = 0;
  let inWord = false;
  for (let i = 0; i < n; i += 1) {
    const ch = content[i];
    if (/\s/.test(ch)) {
      if (inWord) {
        word += 1;
        inWord = false;
      }
      continue;
    }
    inWord = true;
    const p = text.getStartPositionOfChar(i);
    out.push({
      ch,
      x: p.x - off.x,
      y: p.y - off.y,
      size,
      fill: text.getAttribute('fill') ?? '#000',
      family: text.getAttribute('font-family') ?? 'sans-serif',
      weight: text.getAttribute('font-weight') ?? 'normal',
      w: word,
    });
  }
  return out;
}

/**
 * Pair the glyphs of two texts, preferring whole words: words that appear in both
 * (in order) keep their letters together and glide as a unit; only the words left
 * over in between are matched letter by letter, and only within the same gap, so a
 * letter never jumps into an unrelated word further along.
 */
function matchGlyphs(ga: readonly Glyph[], gb: readonly Glyph[]): Array<[number, number]> {
  const group = (g: readonly Glyph[]): number[][] => {
    const words: number[][] = [];
    g.forEach((x, i) => (words[x.w] ??= []).push(i));
    return words.filter(Boolean);
  };
  const wa = group(ga);
  const wb = group(gb);
  const text = (g: readonly Glyph[], idx: number[]): string => idx.map((i) => g[i].ch).join('');
  const wordPairs = lcsPairs(
    wa.map((w) => text(ga, w)),
    wb.map((w) => text(gb, w)),
  );
  const out: Array<[number, number]> = [];
  const gap = (fromA: number, toA: number, fromB: number, toB: number): void => {
    const ia = wa.slice(fromA, toA).flat();
    const ib = wb.slice(fromB, toB).flat();
    for (const [i, j] of lcsPairs(
      ia.map((i) => ga[i].ch),
      ib.map((j) => gb[j].ch),
    )) {
      out.push([ia[i], ib[j]]);
    }
  };
  let pa = 0;
  let pb = 0;
  for (const [i, j] of wordPairs) {
    gap(pa, i, pb, j);
    wa[i].forEach((gi, k) => out.push([gi, wb[j][k]]));
    pa = i + 1;
    pb = j + 1;
  }
  gap(pa, wa.length, pb, wb.length);
  return out;
}

/** Pair characters of two strings by longest common subsequence: [indexA, indexB][]. */
function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return out;
}

interface Pair {
  a: SlideItem;
  b: SlideItem;
}

/**
 * A code block whose code changed: the card's bounds are drawn live (so they grow
 * or shrink smoothly), lines that are in both versions stay and glide to their new
 * row, removed lines fade out late, and new lines fade in.
 */
interface CodeMorph {
  pair: Pair;
  clip: SVGRectElement;
  moves: Array<{ el: SVGGElement; dx: number; dy: number }>;
  fadeOut: SVGGElement[];
  fadeIn: SVGGElement[];
}

/**
 * The morph transition between two slides, as a live SVG, behaving like
 * PowerPoint's Morph: an object that is on both slides is drawn ONCE and glides
 * from its first state to its second (position, size, rotation, colors, line
 * width, font size). It is re-rendered every frame, so shapes stay crisp and are
 * never stretched. Changed text animates glyph by glyph; arrows and relationship
 * lines follow what they are attached to; everything else fades out or in.
 * Works on copies of the slides' own data, never on project data.
 */
export class MorphStage {
  readonly svg: SVGSVGElement;
  private readonly to: RenderedSlide;
  private readonly offA: Offset;
  private readonly offB: Offset;
  private readonly elementPairs: Pair[] = [];
  private readonly tablePairs: Pair[] = [];
  private readonly codes: CodeMorph[] = [];
  private readonly seqPairs: SeqPair[] = [];
  private readonly fromSeq: RenderedSlide['sequences'];
  private readonly toSeq: RenderedSlide['sequences'];
  private codeSeq = 0;
  private readonly liveRels: RelationshipModel[] = [];
  private readonly outgoing: SVGGElement[] = [];
  private readonly incoming: SVGGElement[] = [];
  private readonly restA = document.createElementNS(SVG_NS, 'g');
  private readonly restB = document.createElementNS(SVG_NS, 'g');
  private readonly live = document.createElementNS(SVG_NS, 'g');
  private readonly bgB = document.createElementNS(SVG_NS, 'g');
  /** Text pairs drawn glyph by glyph (by slide-B id) instead of through the live scene. */
  private readonly glyphIds = new Set<string>();
  private readonly chars: CharMove[] = [];
  private charLayer: SVGGElement | null = null;
  /** Hidden static copies of changed text, kept only so their glyphs can be measured. */
  private measure: SVGGElement | null = null;
  private lastT = 0;

  constructor(from: RenderedSlide, to: RenderedSlide) {
    this.to = to;
    this.fromSeq = from.sequences;
    this.toSeq = to.sequences;
    this.offA = { x: from.originX, y: from.originY };
    this.offB = { x: to.originX, y: to.originY };
    const a = parse(from, GRID_ID);
    const b = parse(to, `${GRID_ID}-b`);

    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', `0 0 ${to.width} ${to.height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    this.svg = svg;

    // Shared definitions (markers, hatch patterns, grid, embedded fonts).
    const defs = document.createElementNS(SVG_NS, 'defs');
    const seen = new Set<string>();
    for (const side of [a, b]) {
      for (const d of Array.from(side.root.querySelectorAll(':scope > defs > *'))) {
        const id = d.getAttribute('id');
        if (id && seen.has(id)) {
          continue;
        }
        if (id) {
          seen.add(id);
        }
        defs.appendChild(document.importNode(d, true));
      }
    }
    svg.appendChild(defs);

    const bgA = document.createElementNS(SVG_NS, 'g');
    for (const r of Array.from(a.root.querySelectorAll(':scope > rect'))) {
      bgA.appendChild(document.importNode(r, true));
    }
    for (const r of Array.from(b.root.querySelectorAll(':scope > rect'))) {
      this.bgB.appendChild(document.importNode(r, true));
    }
    svg.append(bgA, this.bgB);

    // Pair the objects that exist on both slides.
    const fromItems = from.items.filter((i) => a.items.has(i.id));
    const toItems = to.items.filter((i) => b.items.has(i.id));
    const matchedA = new Set<string>();
    const matchedB = new Set<string>();
    for (const [i, j] of matchMorphItems(fromItems, toItems)) {
      const pair: Pair = { a: fromItems[i], b: toItems[j] };
      if (pair.a.element && pair.b.element) {
        this.elementPairs.push(pair);
      } else if (pair.a.table && pair.b.table) {
        this.tablePairs.push(pair);
      } else {
        continue;
      }
      matchedA.add(pair.a.id);
      matchedB.add(pair.b.id);
    }

    // Relationship lines between two matched tables are redrawn live, so their
    // static copies are left out of both slides' backgrounds.
    const columnToTable = (items: readonly SlideItem[]): Map<string, string> => {
      const out = new Map<string, string>();
      for (const item of items) {
        for (const c of item.table?.columns ?? []) {
          out.set(c.id, item.id);
        }
      }
      return out;
    };
    const liveRelIds = (
      rels: readonly RelationshipModel[],
      items: readonly SlideItem[],
      matchedIds: Set<string>,
    ): Set<string> => {
      const col = columnToTable(items);
      return new Set(
        rels
          .filter((r) => {
            const s = col.get(r.sourceColumnId);
            const t = col.get(r.targetColumnId);
            return !!s && !!t && matchedIds.has(s) && matchedIds.has(t);
          })
          .map((r) => r.id),
      );
    };
    const ridA = liveRelIds(from.relationships, from.items, matchedA);
    const ridB = liveRelIds(to.relationships, to.items, matchedB);
    this.liveRels.push(...to.relationships.filter((r) => ridB.has(r.id)));

    // Sequence diagrams on both slides are paired by their participants and drawn
    // live (lifelines and messages glide, the box grows); others cross-fade.
    const usedSeqA = new Set<string>();
    const usedSeqB = new Set<string>();
    const cands: Array<{ da: SequenceDiagramModel; db: SequenceDiagramModel; score: number }> = [];
    for (const da of from.sequences.diagrams) {
      for (const db of to.sequences.diagrams) {
        const score = diagramSimilarity(from.sequences, to.sequences, da, db);
        if (score >= 0.5) {
          cands.push({ da, db, score });
        }
      }
    }
    cands.sort((x, y) => y.score - x.score);
    for (const c of cands) {
      if (!usedSeqA.has(c.da.id) && !usedSeqB.has(c.db.id)) {
        usedSeqA.add(c.da.id);
        usedSeqB.add(c.db.id);
        this.seqPairs.push({ a: c.da, b: c.db });
      }
    }

    const shell = (side: Side): SVGGElement => {
      const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      const tr = side.main.getAttribute('transform');
      if (tr) {
        g.setAttribute('transform', tr);
      }
      return g;
    };
    const buildRest = (
      side: Side,
      live: Set<string>,
      liveSeq: Set<string>,
      target: SVGGElement,
    ): void => {
      const s = shell(side);
      for (const el of side.rest) {
        const rid = el.getAttribute('data-rid');
        if (rid && live.has(rid)) {
          continue;
        }
        const sid = el.getAttribute('data-seq');
        if (sid && liveSeq.has(sid)) {
          continue;
        }
        s.appendChild(document.importNode(el, true));
      }
      target.appendChild(s);
    };
    buildRest(a, ridA, usedSeqA, this.restA);
    buildRest(b, ridB, usedSeqB, this.restB);
    svg.append(this.restA, this.restB);

    // Objects on only one slide fade out / in right where they are.
    const onlyHere = (
      side: Side,
      items: readonly SlideItem[],
      matchedIds: Set<string>,
      into: SVGGElement[],
    ): void => {
      for (const item of items) {
        if (matchedIds.has(item.id)) {
          continue;
        }
        const g = shell(side);
        g.appendChild(document.importNode(side.items.get(item.id)!, true));
        svg.appendChild(g);
        into.push(g);
      }
    };
    onlyHere(a, fromItems, matchedA, this.outgoing);
    onlyHere(b, toItems, matchedB, this.incoming);

    // Changed text keeps hidden static copies so its glyph positions can be measured.
    const textPairs = this.textPairs();
    if (textPairs.length) {
      const m = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      m.setAttribute('opacity', '0');
      for (const p of textPairs) {
        const ga = shell(a);
        ga.setAttribute('data-side', 'a');
        ga.setAttribute('data-id', p.a.id);
        ga.appendChild(document.importNode(a.items.get(p.a.id)!, true));
        const gb = shell(b);
        gb.setAttribute('data-side', 'b');
        gb.setAttribute('data-id', p.b.id);
        gb.appendChild(document.importNode(b.items.get(p.b.id)!, true));
        m.append(ga, gb);
      }
      svg.appendChild(m);
      this.measure = m;
    }

    svg.appendChild(this.live);

    // Code blocks with changed code: line-level morph on top of the live card.
    for (const p of this.elementPairs) {
      if (p.a.type === 'code' && p.b.type === 'code' && p.a.text !== p.b.text) {
        const code = this.buildCodeMorph(p, a, b, shell);
        if (code) {
          this.codes.push(code);
        }
      }
    }
    this.update(0);
  }

  private buildCodeMorph(
    p: Pair,
    a: Side,
    b: Side,
    shell: (side: Side) => SVGGElement,
  ): CodeMorph | null {
    const ga = a.items.get(p.a.id);
    const gb = b.items.get(p.b.id);
    if (!ga || !gb) {
      return null;
    }
    const read = (g: SVGGElement): { code: SVGTextElement[]; nums: SVGTextElement[] } => {
      const texts = Array.from(g.querySelectorAll('text')) as unknown as SVGTextElement[];
      return {
        code: texts.filter((t) => t.getAttribute('xml:space') === 'preserve'),
        nums: texts.filter(
          (t) => t.getAttribute('text-anchor') === 'end' && /^\d+$/.test(t.textContent ?? ''),
        ),
      };
    };
    const ra = read(ga);
    const rb = read(gb);
    const pos = (t: SVGTextElement): { x: number; y: number } => ({
      x: Number(t.getAttribute('x')) || 0,
      y: Number(t.getAttribute('y')) || 0,
    });

    // The card clip follows the live (growing) bounds; everything text-like sits inside it.
    const clipId = `dbd-morph-clip-${(this.codeSeq += 1)}`;
    const clipPath = document.createElementNS(SVG_NS, 'clipPath');
    clipPath.setAttribute('id', clipId);
    const clip = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
    clipPath.appendChild(clip);
    this.svg.querySelector('defs')?.appendChild(clipPath);
    const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    layer.setAttribute('clip-path', `url(#${clipId})`);
    this.svg.appendChild(layer);

    const out: CodeMorph = { pair: p, clip, moves: [], fadeOut: [], fadeIn: [] };
    const place = (side: Side, t: SVGTextElement, into: SVGGElement[]): SVGGElement => {
      const holder = shell(side);
      holder.appendChild(t.cloneNode(true));
      const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      g.appendChild(holder);
      layer.appendChild(g);
      into.push(g);
      return g;
    };
    const pairUp = (
      la: SVGTextElement[],
      lb: SVGTextElement[],
      pairs: Array<[number, number]>,
    ): void => {
      const usedA = new Set(pairs.map((x) => x[0]));
      const usedB = new Set(pairs.map((x) => x[1]));
      for (const [i, j] of pairs) {
        const g = place(b, lb[j], []);
        const pa = pos(la[i]);
        const pb = pos(lb[j]);
        // Both positions are canvas coordinates of different slides: compare them
        // relative to their own slide so only the in-slide movement is animated.
        out.moves.push({
          el: g,
          dx: pa.x - this.offA.x - (pb.x - this.offB.x),
          dy: pa.y - this.offA.y - (pb.y - this.offB.y),
        });
      }
      la.forEach((t, i) => {
        if (!usedA.has(i)) {
          place(a, t, out.fadeOut);
        }
      });
      lb.forEach((t, j) => {
        if (!usedB.has(j)) {
          place(b, t, out.fadeIn);
        }
      });
    };
    pairUp(
      ra.code,
      rb.code,
      lcsPairs(
        ra.code.map((t) => t.textContent ?? ''),
        rb.code.map((t) => t.textContent ?? ''),
      ),
    );
    // Gutter numbers: the k-th number is the same number on both slides.
    const n = Math.min(ra.nums.length, rb.nums.length);
    pairUp(
      ra.nums,
      rb.nums,
      Array.from({ length: n }, (_v, k): [number, number] => [k, k]),
    );
    return out;
  }

  private textPairs(): Pair[] {
    return this.elementPairs.filter(
      (p) =>
        p.a.type !== 'code' &&
        p.b.type !== 'code' &&
        !!p.a.text.trim() &&
        !!p.b.text.trim() &&
        p.a.text !== p.b.text,
    );
  }

  /**
   * Changed text between matched text elements is morphed glyph by glyph:
   * characters present in both slides slide to their new place, new ones fade in,
   * removed ones fade out. Needs the stage attached to the document (glyph
   * positions are measured from the real layout), so call it right after append.
   */
  async prepare(): Promise<void> {
    const measure = this.measure;
    if (!measure) {
      return;
    }
    try {
      await Promise.race([
        document.fonts?.ready ?? Promise.resolve(),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    } catch {
      /* measure with whatever font is available */
    }
    const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    for (const p of this.textPairs()) {
      let ga: Glyph[] | null = null;
      let gb: Glyph[] | null = null;
      try {
        const find = (side: 'a' | 'b', id: string): SVGTextElement | null =>
          measure.querySelector(`g[data-side="${side}"][data-id="${CSS.escape(id)}"] text`);
        const ta = find('a', p.a.id);
        const tb = find('b', p.b.id);
        ga = ta ? readGlyphs(ta, this.offA) : null;
        gb = tb ? readGlyphs(tb, this.offB) : null;
      } catch (err) {
        console.warn('morph: could not measure text', err);
      }
      if (!ga || !gb || ga.length > MAX_CHAR_MORPH || gb.length > MAX_CHAR_MORPH) {
        continue;
      }
      const matched = matchGlyphs(ga, gb);
      const usedA = new Set(matched.map((m) => m[0]));
      const usedB = new Set(matched.map((m) => m[1]));
      const make = (g: Glyph): SVGTextElement => {
        const el = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
        el.setAttribute('font-family', g.family);
        el.setAttribute('font-weight', g.weight);
        el.textContent = g.ch;
        layer.appendChild(el);
        return el;
      };
      for (const [i, j] of matched) {
        this.chars.push({ el: make(ga[i]), a: ga[i], b: gb[j] });
      }
      ga.forEach((g, i) => {
        if (!usedA.has(i)) {
          this.chars.push({ el: make(g), a: g, b: null });
        }
      });
      gb.forEach((g, j) => {
        if (!usedB.has(j)) {
          this.chars.push({ el: make(g), a: null, b: g });
        }
      });
      this.glyphIds.add(p.b.id);
    }
    measure.remove();
    this.measure = null;
    if (this.chars.length) {
      this.svg.appendChild(layer);
      this.charLayer = layer;
    }
    this.update(this.lastT);
  }

  /** Render the morph at progress `t` (0 = first slide, 1 = second), already eased. */
  update(t: number): void {
    this.lastT = t;
    this.bgB.setAttribute('opacity', String(fadeIn(t)));
    this.restA.setAttribute('opacity', String(fadeOut(t)));
    this.restB.setAttribute('opacity', String(fadeIn(t)));
    for (const g of this.outgoing) {
      g.setAttribute('opacity', String(1 - t));
    }
    for (const g of this.incoming) {
      g.setAttribute('opacity', String(t));
    }

    // Matched objects are re-rendered at their in-between state, in slide-local space.
    const elements: CanvasElementModel[] = [];
    for (const p of this.elementPairs) {
      const glyphs = this.glyphIds.has(p.b.id);
      if (glyphs && p.b.type === 'text') {
        continue;
      }
      const blended = blendElement(p.a.element!, p.b.element!, t, this.offA, this.offB);
      const isCode = this.codes.some((c) => c.pair === p);
      // A shape's label (or a changing code block's lines) is drawn by its own layer.
      elements.push(glyphs || isCode ? { ...blended, text: '' } : blended);
      if (isCode) {
        const c = this.codes.find((x) => x.pair === p)!;
        c.clip.setAttribute('x', String(blended.x));
        c.clip.setAttribute('y', String(blended.y));
        c.clip.setAttribute('width', String(Math.max(0, blended.width)));
        c.clip.setAttribute('height', String(Math.max(0, blended.height)));
        c.clip.setAttribute('rx', String(blended.cornerRadius ?? 8));
      }
    }
    const tables: TableModel[] = this.tablePairs.map((p) => ({
      ...p.b.table!,
      x: lerp(p.a.table!.x - this.offA.x, p.b.table!.x - this.offB.x, t),
      y: lerp(p.a.table!.y - this.offA.y, p.b.table!.y - this.offB.y, t),
    }));
    const seq = this.seqPairs.length
      ? this.blendSequences(t)
      : { diagrams: [], lifelines: [], messages: [], smooth: false };
    if (elements.length || tables.length || seq.diagrams.length) {
      this.live.innerHTML = buildDiagramSvg(
        tables,
        this.liveRels,
        elements,
        seq,
        { x: 0, y: 0, width: this.to.width, height: this.to.height },
        this.to.imageData,
      ).body;
    } else {
      this.live.innerHTML = '';
    }

    for (const c of this.codes) {
      for (const m of c.moves) {
        m.el.setAttribute('transform', `translate(${m.dx * (1 - t)} ${m.dy * (1 - t)})`);
      }
      for (const g of c.fadeOut) {
        g.setAttribute('opacity', String(fadeOut(t)));
      }
      for (const g of c.fadeIn) {
        g.setAttribute('opacity', String(fadeIn(t)));
      }
    }

    for (const c of this.chars) {
      const single = !(c.a && c.b);
      const only = (c.a ?? c.b)!;
      const from = c.a ?? only;
      const to = c.b ?? only;
      const f = single ? 0 : t;
      c.el.setAttribute('x', String(lerp(from.x, to.x, f)));
      c.el.setAttribute('y', String(lerp(from.y, to.y, f)));
      c.el.setAttribute('font-size', String(lerp(from.size, to.size, f)));
      c.el.setAttribute('fill', mixColor(from.fill, to.fill, f));
      c.el.setAttribute('opacity', String(c.a && c.b ? 1 : c.a ? 1 - t : t));
    }
  }

  /** The live sequence diagrams at progress `t`, in slide-local coordinates. */
  private blendSequences(t: number): {
    diagrams: SequenceDiagramModel[];
    lifelines: LifelineModel[];
    messages: SequenceMessageModel[];
    smooth: boolean;
  } {
    const diagrams: SequenceDiagramModel[] = [];
    const lifelines: LifelineModel[] = [];
    const messages: SequenceMessageModel[] = [];
    const offA = this.offA;
    const offB = this.offB;
    const row = (m: SequenceMessageModel, d: SequenceDiagramModel): number =>
      Math.max(1, Math.round((m.y - (d.originY + d.headerHeight)) / d.rowSpacing));

    for (const { a: da, b: db } of this.seqPairs) {
      const originY = lerp(da.originY - offA.y, db.originY - offB.y, t);
      const headerHeight = lerp(da.headerHeight, db.headerHeight, t);
      const rowSpacing = lerp(da.rowSpacing, db.rowSpacing, t);
      diagrams.push({
        ...db,
        originY,
        headerHeight,
        rowSpacing,
        lifelineSpacing: lerp(da.lifelineSpacing, db.lifelineSpacing, t),
        backgroundColor: mixOptionalColor(da.backgroundColor, db.backgroundColor, t),
      });
      const hb = originY + headerHeight;

      // Participants: the same label is the same participant.
      const llA = this.fromSeq.lifelines.filter((l) => l.diagramId === da.id);
      const llB = this.toSeq.lifelines.filter((l) => l.diagramId === db.id);
      const takenA = new Set<string>();
      const idOfA = new Map<string, string>();
      const labelOf = new Map<string, string>();
      for (const lb of llB) {
        labelOf.set(lb.id, lb.label);
        const la = llA.find((l) => !takenA.has(l.id) && l.label === lb.label);
        if (la) {
          takenA.add(la.id);
          idOfA.set(la.id, lb.id);
          lifelines.push({
            ...lb,
            x: lerp(la.x - offA.x, lb.x - offB.x, t),
            width: lerp(la.width, lb.width, t),
            color: mixOptionalColor(la.color, lb.color, t),
          });
        } else if (t >= 0.5) {
          lifelines.push({ ...lb, x: lb.x - offB.x });
        }
      }
      for (const la of llA) {
        labelOf.set(la.id, la.label);
        if (!takenA.has(la.id) && t < 0.5) {
          idOfA.set(la.id, la.id);
          lifelines.push({ ...la, x: la.x - offA.x, diagramId: db.id });
        }
      }

      // Messages: the same participants and wording is the same message.
      const msA = this.fromSeq.messages.filter((m) => m.diagramId === da.id);
      const msB = this.toSeq.messages.filter((m) => m.diagramId === db.id);
      const key = (m: SequenceMessageModel): string =>
        `${labelOf.get(m.fromLifelineId)}|${labelOf.get(m.toLifelineId)}|${m.label ?? ''}|${m.style}`;
      const usedA = new Set<string>();
      for (const mb of msB) {
        const ma = msA.find((m) => !usedA.has(m.id) && key(m) === key(mb));
        if (ma) {
          usedA.add(ma.id);
          messages.push({
            ...mb,
            diagramId: db.id,
            y: hb + rowSpacing * lerp(row(ma, da), row(mb, db), t),
            color: mixOptionalColor(ma.color, mb.color, t),
          });
        } else if (t >= 0.5) {
          messages.push({ ...mb, diagramId: db.id, y: hb + rowSpacing * row(mb, db) });
        }
      }
      if (t < 0.5) {
        for (const ma of msA) {
          if (usedA.has(ma.id)) {
            continue;
          }
          const from = idOfA.get(ma.fromLifelineId);
          const to = idOfA.get(ma.toLifelineId);
          if (from && to) {
            messages.push({
              ...ma,
              diagramId: db.id,
              fromLifelineId: from,
              toLifelineId: to,
              y: hb + rowSpacing * row(ma, da),
            });
          }
        }
      }
    }
    return { diagrams, lifelines, messages, smooth: true };
  }

  /** Number of objects that glide between the slides (0 = it is just a cross-fade). */
  get pairedCount(): number {
    return this.elementPairs.length + this.tablePairs.length + this.seqPairs.length;
  }

  dispose(): void {
    this.charLayer?.remove();
    this.svg.remove();
  }
}
