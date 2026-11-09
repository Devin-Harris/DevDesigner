import type {
  CanvasElementModel,
  SchemaModel,
  SchemaMutation,
  SequenceMessageModel,
  TableModel,
} from '@devdesigner/shared';
import { columnAnchor } from '../editor/canvas/helpers/node-metrics.helper';

/** The slice of ProjectStore the player drives (local only: nothing is saved). */
export interface PlayerStore {
  schema(): SchemaModel | null;
  applyRemoteBatch(mutations: readonly SchemaMutation[]): void;
  setActiveSlide(id: string | null): void;
}

/** World-space rectangle. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the guiding cursor should go, in world coordinates (null hides it).
 * `box` outlines what is being typed into; `caret` turns the cursor into a text caret.
 */
export type CursorFn = (at: { x: number; y: number; label?: string; box?: Box; caret?: boolean; h?: number } | null) => void;

/** Steps the page performs around the build (outside the canvas). */
export interface PlayerHooks {
  /** Glide the view so this world box fills the showcase. */
  frame?: (box: Box) => Promise<void>;
  /** Slides: show the real transition (morph pairs) UI for slide `from` → `to`, then return. */
  transition?: (fromId: string, toId: string, pairs: [string, string][]) => Promise<void>;
  /** Right-click at a world point, then choose `pick` from the menu. */
  menu?: (at: { x: number; y: number }, items: { label: string; kbd?: string }[], pick: string) => Promise<void>;
  /** Sequence: select a message and set its style / colour with the editor's message toolbar. */
  messageStyle?: (m: SequenceMessageModel) => Promise<void>;
  /** Slides: right-click the previous slide in the slide panel and choose Duplicate slide. */
  duplicateSlide?: () => Promise<void>;
  /** Data model: show the SQL export of what was built, then return. */
  sqlExport?: () => Promise<void>;
  /** Slides: the simplified slide panel — which slide frames it lists (null hides it). */
  panel?: (state: { frames: string[]; active: number } | null) => void;
  /** Measurements of what the editor actually rendered, in world coordinates. */
  dom?: {
    /** Where the caret sits after `typed` in the rendered text inside `box`. */
    caret(box: Box, typed: string): { x: number; y: number; h: number } | null;
    /** The `index`-th message (top to bottom) of the shown sequence diagram. */
    message(index: number): { line: Box; label: () => Box | null; hide(hidden: boolean): void } | null;
    /** Reveal every message label (a divider's label has no line of its own to reveal it). */
    revealLabels(): void;
  };
}



/** Run options: lanes (one per person) each build a share of the example at the same time. */
export interface PlayerOptions {
  /** Which items this lane builds (default: everything). */
  pick?: (kind: 'element' | 'table' | 'diagram' | 'relationship', item: { id: string }) => boolean;
  /** Clear the canvas first (only the first lane should). Default true. */
  clear?: boolean;
  /** Extra wait before this lane starts, ms. */
  startDelay?: number;
  /** Build from this finished schema instead of the store's (lanes started after the clear). */
  source?: SchemaModel;
  /** Pace multiplier for every pause (0.5 = twice as fast). */
  speed?: number;
}

/** The part of a schema a lane builds. */
function pickShare(s: SchemaModel, pick: NonNullable<PlayerOptions['pick']>): SchemaModel {
  const tables = s.tables.filter((t) => pick('table', t));
  const diagrams = s.sequenceDiagrams.filter((d) => pick('diagram', d));
  const ids = new Set(diagrams.map((d) => d.id));
  return {
    ...s,
    elements: s.elements.filter((e) => pick('element', e)),
    tables,
    relationships: s.relationships.filter((r) => pick('relationship', r)),
    sequenceDiagrams: diagrams,
    lifelines: s.lifelines.filter((l) => ids.has(l.diagramId)),
    sequenceMessages: s.sequenceMessages.filter((m) => ids.has(m.diagramId)),
  };
}

class Aborted extends Error {}

/**
 * Rebuilds the loaded example in front of the viewer, the way a person would make
 * it: snapshot the finished schema, clear the canvas, then replay it as a series of
 * local "remote" mutations — shapes dragged out and labelled, text and code typed
 * character by character, table columns added one at a time, messages dragged
 * between participants, slides framed and filled one after another. Real components
 * render every step; nothing is persisted.
 */
export async function playBuild(
  store: PlayerStore,
  abort: AbortSignal,
  cursor: CursorFn,
  hooks: PlayerHooks = {},
  opts: PlayerOptions = {},
): Promise<void> {
  const final = opts.source ?? store.schema();
  if (!final) return;
  const full = structuredClone(final) as SchemaModel;
  // A lane builds only its share (several lanes run at once: one per person).
  const snap = opts.pick ? pickShare(full, opts.pick) : full;

  const apply = (...m: SchemaMutation[]): void => {
    if (abort.aborted) throw new Aborted();
    store.applyRemoteBatch(m);
  };
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      if (abort.aborted) return reject(new Aborted());
      const t = setTimeout(resolve, ms * (opts.speed ?? 1));
      abort.addEventListener('abort', () => (clearTimeout(t), reject(new Aborted())), { once: true });
    });
  const point = async (x: number, y: number, label?: string, ms = 420): Promise<void> => {
    cursor({ x, y, label });
    await wait(ms);
  };
  const update = (el: CanvasElementModel, patch: Partial<CanvasElementModel>): CanvasElementModel => {
    const next = { ...el, ...patch } as CanvasElementModel;
    apply({ kind: 'element.updated', element: next });
    return next;
  };
  const boxOf = (el: CanvasElementModel): Box => ({ x: el.x, y: el.y, w: el.width, h: el.height });

  /**
   * Type `full` into a field one character at a time (a few per tick for long text,
   * so nothing takes more than ~2.5 s), with the caret following the text.
   * `caretAt` estimates where the caret sits for the text typed so far.
   */
  const typeChars = async (
    el: CanvasElementModel,
    field: 'text' | 'diffText',
    full: string,
    caretAt: (typed: string) => { x: number; y: number },
    box: Box,
    from = 0,
    to = full.length,
    grow?: (cur: CanvasElementModel, typed: string) => CanvasElementModel,
  ): Promise<CanvasElementModel> => {
    let cur = el;
    const n = to - from;
    const per = Math.max(1, Math.ceil(n / 80));
    for (let i = from + per; ; i += per) {
      const end = Math.min(i, to);
      const typed = full.slice(0, end) + full.slice(to);
      cur = update(cur, { [field]: typed } as Partial<CanvasElementModel>);
      if (grow) cur = grow(cur, full.slice(0, end));
      await wait(32);
      const done = full.slice(0, end);
      const real = field === 'text' && cur.type !== 'code' ? hooks.dom?.caret(box, done) : null;
      cursor({ ...(real ?? caretAt(done)), box: grow ? boxOf(cur) : box, caret: true });
      if (end >= to) break;
    }
    return cur;
  };

  try {
    // ---- clear ----
    if (opts.clear !== false)
      apply(
        ...full.relationships.map((r) => ({ kind: 'relationship.deleted', relationshipId: r.id }) as SchemaMutation),
        ...full.tables.map((t) => ({ kind: 'table.deleted', tableId: t.id }) as SchemaMutation),
        ...full.elements.map((e) => ({ kind: 'element.deleted', elementId: e.id }) as SchemaMutation),
        ...full.sequenceMessages.map((m) => ({ kind: 'message.deleted', messageId: m.id }) as SchemaMutation),
        ...full.lifelines.map((l) => ({ kind: 'lifeline.deleted', lifelineId: l.id }) as SchemaMutation),
        ...full.sequenceDiagrams.map((d) => ({ kind: 'sequenceDiagram.deleted', diagramId: d.id }) as SchemaMutation),
      );
    await wait((opts.clear === false ? 0 : 500) + (opts.startDelay ?? 0));

    const byZ = [...snap.elements].sort((a, b) => a.zIndex - b.zIndex);
    const frames = byZ.filter((e) => e.type === 'frame');
    const isArrow = (e: CanvasElementModel) => e.type === 'arrow' || e.type === 'line';

    const codes = byZ.filter((e) => e.type === 'code');
    if (codes.length === 3) {
      await buildCodeTrio(codes);
      cursor(null);
      return;
    }

    const buildElements = async (els: CanvasElementModel[]): Promise<void> => {
      for (const el of els.filter((e) => !isArrow(e))) {
        if (el.type === 'code') await typeCode(el);
        else if (el.type === 'text') await typeText(el);
        else if (['rectangle', 'ellipse', 'diamond'].includes(el.type)) await dragOut(el);
        else if (el.type === 'freedraw') await drawPen(el);
        else {
          await point(el.x, el.y);
          apply({ kind: 'element.created', element: el });
          await wait(250);
        }
      }
      for (const a of els.filter(isArrow)) await drawArrow(a);
    };

    if (frames.length) {
      // Slides: frame one, fill it, then add the next (slides stack on one spot).
      // Anything in this share that is not on a slide comes first.
      for (const d of snap.sequenceDiagrams.filter((x) => !x.slideId)) await buildSequence(d.id);
      await buildElements(byZ.filter((e) => e.type !== 'frame' && !e.slideId));
      const shown: string[] = [];
      hooks.panel?.({ frames: [], active: 0 });
      const tag = (e: CanvasElementModel) => (e.morphId && !e.morphId.startsWith('tag:solo') ? e.morphId : null);
      const pairsToWire: [string, string][] = [];
      for (const [i, f] of frames.entries()) {
        shown.push(f.id);
        const kids = byZ.filter((e) => e.slideId === f.id);
        if (i === 0) {
          hooks.panel?.({ frames: [...shown], active: i });
          await dragOut(f, 'Frame → slide', () => store.setActiveSlide(f.id));
          await wait(200);
          await buildSlideItems(kids);
        } else {
          // Copy the previous slide's objects onto a new slide (untagged: pairs are wired up later)...
          const prev = frames[i - 1];
          const prevKids = byZ.filter((e) => e.slideId === prev.id);
          if (hooks.duplicateSlide) await hooks.duplicateSlide();
          else await point(prev.x + prev.width - 40, prev.y - 30, 'Duplicate slide', 600);
          apply({ kind: 'element.created', element: f });
          const dx = f.x - prev.x;
          const dy = f.y - prev.y;
          const matched = kids
            .map((k) => ({ k, from: prevKids.find((a) => tag(a) && tag(a) === tag(k)) }))
            .filter((c): c is { k: CanvasElementModel; from: CanvasElementModel } => !!c.from);
          // Shapes are picked up bottom row first, left to right; each goes to the lowest free
          // spot of its colour, so the bars still fill from the bottom up.
          const shapeOf = (c: { k: CanvasElementModel }) => c.k.type !== 'text';
          const sources = matched.filter(shapeOf).map((c) => c.from).sort((a, b) => b.y - a.y || a.x - b.x);
          const free = matched.filter(shapeOf).map((c) => c.k);
          const found = [
            ...matched.filter((c) => !shapeOf(c)),
            ...sources.map((from) => {
              const pool = free.filter((t) => (t.backgroundColor ?? '') === (from.backgroundColor ?? ''));
              const k = (pool.length ? pool : free).sort((a, b) => b.y - a.y || a.x - b.x)[0];
              free.splice(free.indexOf(k), 1);
              return { k, from };
            }),
          ];
          for (const c of found) pairsToWire.push([c.from.id, c.k.id]);
          const copies = found.map(({ k, from }) => ({
            k: { ...k, morphId: `tag:solo-${k.id}` } as CanvasElementModel,
            from: { ...from, id: k.id, slideId: f.id, x: from.x + dx, y: from.y + dy, morphId: `tag:solo-${k.id}` } as CanvasElementModel,
          }));
          // A real duplicate copies everything, including what this slide will not keep.
          const extras = prevKids
            .filter((e) => !found.some((c) => c.from.id === e.id))
            .map((e) => ({ ...e, id: `dup-${e.id}`, slideId: f.id, x: e.x + dx, y: e.y + dy, morphId: `tag:solo-dup-${e.id}` }) as CanvasElementModel);
          apply(
            ...copies.map(({ from }) => ({ kind: 'element.created', element: from }) as SchemaMutation),
            ...extras.map((e) => ({ kind: 'element.created', element: e }) as SchemaMutation),
          );
          store.setActiveSlide(f.id);
          hooks.panel?.({ frames: [...shown], active: i });
          await wait(600);
          // Remove what this slide does not need: select it, then Delete.
          for (const e of extras) {
            cursor({ x: e.x + Math.min(e.width, 200) / 2, y: e.y + e.height / 2, label: 'Select' });
            await wait(380);
            cursor({ x: e.x + Math.min(e.width, 200) / 2, y: e.y + e.height / 2, label: 'Delete', box: { x: e.x, y: e.y, w: Math.min(e.width, 420), h: e.height } });
            await wait(450);
            apply({ kind: 'element.deleted', elementId: e.id });
            cursor({ x: e.x + Math.min(e.width, 200) / 2, y: e.y + e.height / 2 });
            await wait(300);
          }
          // ...then drag each one to its new place (text first, then the squares).
          const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
          // Text first, then the shapes in pick-up order (bottom row of the grid first, left to right).
          const order = copies;
          for (const { k: to, from } of order) {
            if (to.type === 'text' && from.fontSize && to.fontSize && to.fontSize !== from.fontSize) {
              await shrinkText(from, to);
              continue;
            }
            const grab = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
            await point(grab.x, grab.y, undefined, 200);
            const steps = 7;
            for (let s = 1; s <= steps; s++) {
              const t = s / steps;
              const k = 1 - Math.pow(1 - t, 3);
              const el = {
                ...to,
                x: lerp(from.x, to.x, k),
                y: lerp(from.y, to.y, k),
                width: lerp(from.width, to.width, k),
                height: lerp(from.height, to.height, k),
                ...(from.fontSize && to.fontSize ? { fontSize: lerp(from.fontSize, to.fontSize, k) } : {}),
              } as CanvasElementModel;
              apply({ kind: 'element.updated', element: el });
              cursor({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
              await wait(18);
            }
            apply({ kind: 'element.updated', element: to });
            await wait(40);
          }
          cursor(null);
          await wait(250);
          // New objects on this slide only (they fade in during the morph).
          await buildSlideItems(kids.filter((k) => !found.some((c) => c.k.id === k.id)));
        }
        await wait(400);
      }
      if (frames.length > 1) {
        if (hooks.transition) {
          const f = frames[1];
          await point(f.x + f.width - 120, f.y - 30, 'Transition', 650);
          cursor(null);
          hooks.panel?.({ frames: shown, active: 1 });
          await hooks.transition(frames[0].id, f.id, pairsToWire);
        } else {
          await showMorph(frames[0], frames[1], shown);
        }
      }
    } else {
      await buildElements(byZ);
      for (const t of [...snap.tables].sort((a, b) => a.x - b.x || a.y - b.y)) await buildTable(t);
      for (const r of snap.relationships) await drawRelationship(r);
      if (snap.tables.length && hooks.sqlExport) {
        const right = Math.max(...snap.tables.map((t) => t.x + 260));
        const top = Math.min(...snap.tables.map((t) => t.y));
        // Make room on the right for the export panel, then right-click the empty canvas there.
        const left = Math.min(...snap.tables.map((t) => t.x));
        const bottom = Math.max(...snap.tables.map((t) => t.y + 40 + t.columns.length * 28));
        await hooks.frame?.({ x: left - 30, y: top - 40, w: (right - left) * 2.15 + 60, h: bottom - top + 80 });
        if (hooks.menu)
          await hooks.menu(
            { x: right + (right - left) * 0.25, y: top + 40 },
            [{ label: 'Add table', kbd: 'T' }, { label: 'Auto layout' }, { label: 'Import SQL…' }, { label: 'Export SQL…' }, { label: 'Export image…' }],
            'Export SQL…',
          );
        cursor(null);
        await hooks.sqlExport();
      }
      for (const d of snap.sequenceDiagrams) await buildSequence(d.id);
    }
    cursor(null);
  } catch (err) {
    if (!(err instanceof Aborted)) throw err;
  }

  // ---- steps ----

  /** Freehand: the stroke grows point by point under the cursor. */
  async function drawPen(el: CanvasElementModel): Promise<void> {
    const pts = el.points ?? [];
    if (pts.length < 2) {
      apply({ kind: 'element.created', element: el });
      return;
    }
    await point(el.x + pts[0].x, el.y + pts[0].y, 'Pen', 380);
    apply({ kind: 'element.created', element: { ...el, points: pts.slice(0, 2) } });
    const per = Math.max(1, Math.ceil(pts.length / 30));
    for (let i = 2; i <= pts.length; i += per) {
      const end = Math.min(i, pts.length);
      apply({ kind: 'element.updated', element: { ...el, points: pts.slice(0, end) } });
      const p = pts[end - 1];
      cursor({ x: el.x + p.x, y: el.y + p.y });
      await wait(26);
    }
    apply({ kind: 'element.updated', element: el });
    await wait(200);
  }

  /**
   * Resize a text box by its corner handle: the text scales with it (fit-to-glyph text),
   * then it is moved into place. The cursor stays on the handle the whole time.
   */
  async function shrinkText(from: CanvasElementModel, to: CanvasElementModel): Promise<void> {
    const glyphW = (e: CanvasElementModel, fs: number) => Math.min(e.width, (e.text ?? '').length * fs * 0.55);
    const corner = (x: number, y: number, fs: number, h: number) => ({ x: x + glyphW(from, fs), y: y + h });
    const c0 = corner(from.x, from.y, from.fontSize!, from.height);
    await point(from.x + glyphW(from, from.fontSize!) / 2, from.y + from.height / 2, 'Select', 380);
    const sel = (x: number, y: number, fs: number, h: number) => ({ x, y, w: glyphW(from, fs), h });
    cursor({ ...c0, label: 'Resize', box: sel(from.x, from.y, from.fontSize!, from.height) });
    await wait(450);
    // 1. Drag the corner in: the text shrinks, top-left fixed.
    const steps = 14;
    let fs = from.fontSize!;
    let h = from.height;
    for (let s = 1; s <= steps; s++) {
      const k = 1 - Math.pow(1 - s / steps, 2);
      fs = from.fontSize! + (to.fontSize! - from.fontSize!) * k;
      h = from.height + (to.height - from.height) * k;
      apply({ kind: 'element.updated', element: { ...to, x: from.x, y: from.y, fontSize: fs, height: h } as CanvasElementModel });
      cursor({ ...corner(from.x, from.y, fs, h), label: 'Resize', box: sel(from.x, from.y, fs, h) });
      await wait(30);
    }
    await wait(250);
    // 2. Move it into place.
    if (to.x !== from.x || to.y !== from.y) {
      const grab = { x: from.x + glyphW(from, fs) / 2, y: from.y + h / 2 };
      cursor({ ...grab, box: sel(from.x, from.y, fs, h) });
      await wait(200);
      for (let s = 1; s <= 8; s++) {
        const k = 1 - Math.pow(1 - s / 8, 3);
        const x = from.x + (to.x - from.x) * k;
        const y = from.y + (to.y - from.y) * k;
        apply({ kind: 'element.updated', element: { ...to, x, y } as CanvasElementModel });
        cursor({ x: x + glyphW(from, fs) / 2, y: y + h / 2, box: sel(x, y, fs, h) });
        await wait(22);
      }
    }
    apply({ kind: 'element.updated', element: to });
    await wait(150);
  }

  /** Slide contents: text typed; the first shape dragged out, the rest copied quickly (Alt-drag). */
  async function buildSlideItems(kids: CanvasElementModel[]): Promise<void> {
    let shapes = 0;
    for (const el of kids) {
      if (el.type === 'text') await typeText(el);
      else if (el.type === 'rectangle' && shapes++ > 0) {
        cursor({ x: el.x + el.width / 2, y: el.y + el.height / 2, label: 'Alt-drag to copy' });
        apply({ kind: 'element.created', element: el });
        await wait(110);
      } else if (['rectangle', 'ellipse', 'diamond'].includes(el.type)) await dragOut(el);
      else {
        apply({ kind: 'element.created', element: el });
        await wait(120);
      }
    }
  }

  /** A dashed line from `a` that follows the cursor to `b`, removed at the end. */
  async function dragGuide(a: { x: number; y: number }, b: { x: number; y: number }, key: string, steps: number, label?: string): Promise<void> {
    let guide = {
      id: `showcase-guide-${key}`,
      type: 'line',
      x: a.x,
      y: a.y,
      width: 0,
      height: 0,
      angle: 0,
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      strokeColor: '#7c5cff',
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'dashed',
      opacity: 100,
      zIndex: 9999,
    } as unknown as CanvasElementModel;
    apply({ kind: 'element.created', element: guide });
    for (let i = 1; i <= steps; i++) {
      const k = 1 - Math.pow(1 - i / steps, 2);
      const p = { x: (b.x - a.x) * k, y: (b.y - a.y) * k };
      guide = update(guide, { points: [{ x: 0, y: 0 }, p], width: Math.abs(p.x), height: Math.abs(p.y) });
      cursor({ x: a.x + p.x, y: a.y + p.y, label });
      await wait(30);
    }
    await wait(120);
    apply({ kind: 'element.deleted', elementId: guide.id });
  }

  /**
   * Code: a wide block on top and two half-width blocks under it. The bottom pair
   * starts stretched to the top block's width, then "Fit to content" shrinks each
   * to its code — the right one keeps its right edge on the top block's.
   */
  async function buildCodeTrio(codes: CanvasElementModel[]): Promise<void> {
    const [top, left, right] = codes;
    const gap = 40;
    const y = top.y + top.height + gap;
    const half = (top.width - gap) / 2;
    const tall = Math.max(left.height, right.height) + 36;
    const fitL = { ...left, x: top.x, y };
    const fitR = { ...right, x: top.x + top.width - right.width, y };
    const startL = { ...fitL, width: half, height: tall };
    const startR = { ...fitR, x: top.x + top.width - half, width: half, height: tall };
    await hooks.frame?.({ x: top.x - 20, y: top.y - 20, w: top.width + 40, h: y + tall - top.y + 40 });
    await typeCode(top);

    // Left: typed as one messy line (the block widens to keep it in view)...
    const formatted = left.text ?? '';
    const messy = formatted.replace(/\s*\n\s*/g, ' ').toLowerCase();
    const view = { x: top.x - 20, y: top.y - 20, w: top.width + 40, h: y + tall - top.y + 40 };
    const needL = 44 + messy.length * (left.fontSize ?? 14) * 0.6 + 24;
    await hooks.frame?.({ ...view, w: Math.max(top.width, needL) + 40 });
    let cur = await typeCode({ ...startL, text: messy }, null);
    // ...then dragged back to the width we want...
    await point(cur.x + cur.width, cur.y + cur.height / 2, 'Resize', 450);
    const wide = cur.width;
    for (let i = 1; i <= 12; i++) {
      const w = wide + (half - wide) * (1 - Math.pow(1 - i / 12, 3));
      cur = update(cur, { width: w });
      cursor({ x: cur.x + w, y: cur.y + cur.height / 2, label: 'Resize' });
      await wait(28);
    }
    await hooks.frame?.(view);
    await wait(200);
    // ...and Format tidies it.
    if (hooks.menu) await hooks.menu({ x: startL.x + half * 0.55, y: startL.y + 40 }, [{ label: 'Format', kbd: 'Shift+Alt+F' }, { label: 'Fit to content', kbd: 'Shift+Alt+S' }, { label: 'Copy code' }, { label: 'Duplicate', kbd: 'Ctrl+D' }, { label: 'Delete', kbd: 'Del' }], 'Format');
    else await point(startL.x + half - 60, startL.y + 14, 'Format', 550);
    apply({ kind: 'element.updated', element: { ...startL, text: formatted } as CanvasElementModel });
    await wait(650);
    await typeCode(startR, fitR);

    // Fit to content (Shift+Alt+S): both shrink to their code; the right one keeps its right edge.
    const area = { x: startL.x, y, w: top.width, h: tall };
    // Select both bottom blocks with a marquee drag...
    const m0 = { x: area.x - 24, y: area.y - 20 };
    await point(m0.x, m0.y, 'Select both', 450);
    for (let i = 1; i <= 12; i++) {
      const k = 1 - Math.pow(1 - i / 12, 2);
      const w = (area.w + 48) * k;
      const h = (area.h + 40) * k;
      cursor({ x: m0.x + w, y: m0.y + h, label: 'Select both', box: { x: m0.x, y: m0.y, w, h } });
      await wait(30);
    }
    cursor({ x: m0.x + area.w + 48, y: m0.y + area.h + 40, box: area });
    await wait(350);
    // ...then right-click → Fit to content: both shrink the moment it is clicked.
    if (hooks.menu) await hooks.menu({ x: startR.x + startR.width * 0.4, y: startR.y + 50 }, [{ label: 'Format', kbd: 'Shift+Alt+F' }, { label: 'Fit to content', kbd: 'Shift+Alt+S' }, { label: 'Copy code' }, { label: 'Duplicate', kbd: 'Ctrl+D' }, { label: 'Delete', kbd: 'Del' }], 'Fit to content');
    const steps = 14;
    const ease = (i: number) => 1 - Math.pow(1 - i / steps, 3);
    for (let i = 1; i <= steps; i++) {
      const k = ease(i);
      const l = { width: half + (fitL.width - half) * k, height: tall + (fitL.height - tall) * k };
      const r = { width: half + (fitR.width - half) * k, height: tall + (fitR.height - tall) * k };
      apply(
        { kind: 'element.updated', element: { ...fitL, ...l } as CanvasElementModel },
        { kind: 'element.updated', element: { ...fitR, ...r, x: top.x + top.width - r.width } as CanvasElementModel },
      );
      // The selection outline follows both blocks as they shrink.
      const rx = top.x + top.width - r.width;
      cursor({ x: rx + r.width * 0.4, y: y + 50, box: { x: fitL.x, y, w: rx + r.width - fitL.x, h: Math.max(l.height, r.height) } });
      await wait(28);
    }
    cursor(null);
    await wait(600);

    // Then drag the left block's edge so the row fills the width again.
    const full = fitR.x - gap - fitL.x;
    await point(fitL.x + fitL.width, fitL.y + fitL.height / 2, 'Resize', 500);
    for (let i = 1; i <= steps; i++) {
      const w = fitL.width + (full - fitL.width) * ease(i);
      apply({ kind: 'element.updated', element: { ...fitL, width: w } as CanvasElementModel });
      cursor({ x: fitL.x + w, y: fitL.y + fitL.height / 2, label: 'Resize' });
      await wait(30);
    }
    cursor(null);
    await wait(500);
  }

  function byElements(f: CanvasElementModel): CanvasElementModel[] {
    return snap.elements.filter((e) => e.slideId === f.id).sort((a, b) => a.zIndex - b.zIndex);
  }

  /**
   * Simplified morph pairing: lift slide 2 out beside slide 1, draw the pair
   * arrow from slide 1's object to its match on slide 2, put slide 2 back, then
   * play the transition on slide 1 — paired objects glide and resize into their
   * slide-2 places, the rest fade out or in.
   */
  async function showMorph(f1: CanvasElementModel, f2: CanvasElementModel, ids: string[]): Promise<void> {
    const deck = f1.slide?.presentation ?? '';
    const dx = f1.width + 220;
    const kids1 = byElements(f1);
    const kids2 = byElements(f2);
    const tag = (e: CanvasElementModel) => (e.morphId?.startsWith('tag:solo') ? null : e.morphId ?? null);

    // 1. Side by side (slide 2 as its own block for a moment, so both show).
    store.setActiveSlide(f1.id);
    apply(
      { kind: 'element.updated', element: { ...f2, x: f2.x + dx, slide: { ...f2.slide!, presentation: `${deck} · next` } } as CanvasElementModel },
      ...kids2.map((e) => ({ kind: 'element.updated', element: { ...e, x: e.x + dx } }) as SchemaMutation),
    );
    hooks.panel?.({ frames: ids, active: 0 });
    await hooks.frame?.({ x: f1.x - 40, y: f1.y - 80, w: f1.width + dx + 80, h: f1.height + 160 });
    await point(f1.x + f1.width / 2, f1.y - 40, 'Map pairs', 700);

    // 2. Pair arrows: each tagged object on slide 1 to its match on slide 2.
    const pairs = kids1
      .map((a) => ({ a, b: kids2.find((b) => tag(a) && tag(b) === tag(a)) }))
      .filter((p): p is { a: CanvasElementModel; b: CanvasElementModel } => !!p.b);
    const arrows: string[] = [];
    for (const { a, b } of pairs.sort((p, q) => (p.a.type === 'rectangle' ? -1 : 1) - (q.a.type === 'rectangle' ? -1 : 1))) {
      const from = { x: a.x + Math.min(a.width, a.type === 'text' ? 330 : a.width), y: a.y + Math.min(a.height, 60) / 2 };
      const to = { x: b.x + dx, y: b.y + Math.min(b.height, 60) / 2 };
      await point(from.x, from.y, 'Pair', 450);
      const id = `showcase-pair-${a.id}`;
      let arrow = {
        id, type: 'arrow', x: from.x, y: from.y, width: 0, height: 0, angle: 0,
        points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], strokeColor: '#7c5cff', fillStyle: 'none',
        strokeWidth: 4, strokeStyle: 'solid', opacity: 100, zIndex: 9999, endArrowhead: 'arrow',
      } as unknown as CanvasElementModel;
      apply({ kind: 'element.created', element: arrow });
      for (let i = 1; i <= 16; i++) {
        const k = 1 - Math.pow(1 - i / 16, 2);
        const pt = { x: (to.x - from.x) * k, y: (to.y - from.y) * k };
        arrow = update(arrow, { points: [{ x: 0, y: 0 }, pt], width: Math.abs(pt.x), height: Math.abs(pt.y) });
        cursor({ x: from.x + pt.x, y: from.y + pt.y, label: a.text ?? 'Pair' });
        await wait(30);
      }
      arrows.push(id);
      await wait(500);
    }
    cursor(null);
    await wait(1400);

    // 3. Back to one slide, then play the transition.
    apply(
      ...arrows.map((id) => ({ kind: 'element.deleted', elementId: id }) as SchemaMutation),
      { kind: 'element.updated', element: f2 },
      ...kids2.map((e) => ({ kind: 'element.updated', element: e }) as SchemaMutation),
    );
    store.setActiveSlide(f1.id);
    await hooks.frame?.({ x: f1.x - 30, y: f1.y - 90, w: f1.width + 60, h: f1.height + 120 });
    for (let run = 0; run < 2; run++) {
      await point(f1.x + f1.width - 90, f1.y - 40, '▶ Play transition', 650);
      cursor(null);
      await playMorph(f1, f2, kids1, kids2, tag);
      hooks.panel?.({ frames: ids, active: 1 });
      await wait(1500);
      // Reset to slide 1 for the next run (or to show where it started).
      apply(...kids1.map((e) => ({ kind: 'element.updated', element: e }) as SchemaMutation));
      for (const e of kids2) if (!kids1.some((a) => tag(a) && tag(a) === tag(e))) apply({ kind: 'element.deleted', elementId: `showcase-in-${e.id}` });
      store.setActiveSlide(f1.id);
      hooks.panel?.({ frames: ids, active: 0 });
      await wait(700);
    }
    store.setActiveSlide(f2.id);
    hooks.panel?.({ frames: ids, active: 1 });
  }

  async function playMorph(
    f1: CanvasElementModel,
    f2: CanvasElementModel,
    kids1: CanvasElementModel[],
    kids2: CanvasElementModel[],
    tag: (e: CanvasElementModel) => string | null,
  ): Promise<void> {
    const shift = { x: f1.x - f2.x, y: f1.y - f2.y };
    const incoming = kids2
      .filter((e) => !kids1.some((a) => tag(a) && tag(a) === tag(e)))
      .map((e) => ({ ...e, id: `showcase-in-${e.id}`, slideId: f1.id, x: e.x + shift.x, y: e.y + shift.y, opacity: 0 }) as CanvasElementModel);
    apply(...incoming.map((e) => ({ kind: 'element.created', element: e }) as SchemaMutation));
    const dur = f2.slide?.transition?.duration ?? 900;
    const steps = Math.max(12, Math.round(dur / 30));
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const muts: SchemaMutation[] = [];
      for (const a of kids1) {
        const b = kids2.find((x) => tag(a) && tag(x) === tag(a));
        if (b) {
          muts.push({
            kind: 'element.updated',
            element: {
              ...a,
              x: lerp(a.x, b.x + shift.x, k),
              y: lerp(a.y, b.y + shift.y, k),
              width: lerp(a.width, b.width, k),
              height: lerp(a.height, b.height, k),
              ...(a.fontSize && b.fontSize ? { fontSize: lerp(a.fontSize, b.fontSize, k) } : {}),
            } as CanvasElementModel,
          });
        } else {
          muts.push({ kind: 'element.updated', element: { ...a, opacity: Math.round(100 * (1 - Math.min(1, k * 1.6))) } as CanvasElementModel });
        }
      }
      for (const e of incoming) muts.push({ kind: 'element.updated', element: { ...e, opacity: Math.round(100 * Math.max(0, k * 1.6 - 0.6)) } as CanvasElementModel });
      apply(...muts);
      await wait(30);
    }
  }

  async function dragOut(el: CanvasElementModel, label?: string, created?: () => void): Promise<void> {
    await point(el.x, el.y, label);
    const text = el.text ?? '';
    let cur = { ...el, width: 4, height: 4, text: '', runs: undefined } as CanvasElementModel;
    apply({ kind: 'element.created', element: cur });
    created?.();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const k = 1 - Math.pow(1 - i / steps, 3);
      cur = update(cur, { width: Math.max(4, el.width * k), height: Math.max(4, el.height * k) });
      cursor({ x: el.x + cur.width, y: el.y + cur.height, label });
      await wait(28);
    }
    if (text) {
      await wait(200);
      // Shape labels are centred: the caret sits right of the centred text.
      const fs = el.fontSize ?? 18;
      const cw = fs * 0.55;
      await typeChars(
        cur,
        'text',
        text,
        (t) => ({ x: el.x + el.width / 2 + (t.length * cw) / 2 + 2, y: el.y + el.height / 2 - fs * 0.6 }),
        boxOf(el),
      );
      await wait(200);
    }
    apply({ kind: 'element.updated', element: el });
    await wait(220);
  }

  async function typeText(el: CanvasElementModel): Promise<void> {
    const fs = el.fontSize ?? 20;
    const lh = fs * (el.lineHeight ?? 1.25);
    await point(el.x, el.y + 4, 'Text', 380);
    const cur = { ...el, text: '', runs: undefined } as CanvasElementModel;
    apply({ kind: 'element.created', element: cur });
    const cw = fs * (el.bold ? 0.56 : 0.5);
    await typeChars(
      cur,
      'text',
      el.text ?? '',
      (t) => {
        const lines = t.split('\n');
        return { x: el.x + lines[lines.length - 1].length * cw + 2, y: el.y + (lines.length - 1) * lh };
      },
      boxOf(el),
    );
    await wait(250);
    apply({ kind: 'element.updated', element: el });
    await wait(200);
  }

  /** Card metrics of a code block: title bar, gutter, character and line size. */
  function codeCaret(el: CanvasElementModel, left = 0) {
    const fs = el.fontSize ?? 14;
    const lh = fs * 1.6;
    const cw = fs * 0.6;
    return (t: string) => {
      const lines = t.split('\n');
      return { x: el.x + left + 44 + lines[lines.length - 1].length * cw, y: el.y + 34 + (lines.length - 1) * lh };
    };
  }

  /** Widen a code block to the right when the typed text runs past its edge. */
  function growCode(cur: CanvasElementModel, typed: string): CanvasElementModel {
    const fs = cur.fontSize ?? 14;
    const longest = Math.max(...typed.split('\n').map((l) => l.length));
    const need = 44 + longest * fs * 0.6 + 24;
    return need > cur.width ? update(cur, { width: need }) : cur;
  }

  async function typeCode(el: CanvasElementModel, settle: CanvasElementModel | null = el): Promise<CanvasElementModel> {
    await point(el.x + 40, el.y + 40, el.fileName ?? 'Code', 380);
    const diff = el.diffText;
    let cur = { ...el, text: '', diffText: undefined } as CanvasElementModel;
    apply({ kind: 'element.created', element: cur });
    const text = el.text ?? '';
    cur = await typeChars(cur, 'text', text, codeCaret(el), boxOf(el), 0, text.length, el.diffText ? undefined : growCode);
    if (diff) {
      await wait(400);
      cursor({ x: el.x + el.width - 60, y: el.y + 14, label: 'Show diff' });
      await wait(500);
      // Start the right side as a copy, then type only what changes.
      cur = update(cur, { diffText: text });
      await wait(450);
      let p = 0;
      while (p < text.length && p < diff.length && text[p] === diff[p]) p++;
      let s = 0;
      while (s < text.length - p && s < diff.length - p && text[text.length - 1 - s] === diff[diff.length - 1 - s]) s++;
      cur = update(cur, { diffText: diff.slice(0, p) + diff.slice(diff.length - s) });
      const right = { x: el.x + el.width / 2, y: el.y, w: el.width / 2, h: el.height };
      cur = await typeChars(cur, 'diffText', diff, codeCaret(el, el.width / 2), right, p, diff.length - s);
    }
    await wait(300);
    if (settle) {
      cur = { ...settle, width: el.width, height: el.height, x: el.x, y: el.y } as CanvasElementModel;
      apply({ kind: 'element.updated', element: cur });
    }
    await wait(400);
    return cur;
  }

  async function drawArrow(el: CanvasElementModel): Promise<void> {
    const pts = el.points ?? [];
    const end = pts[pts.length - 1] ?? { x: 0, y: 0 };
    await point(el.x, el.y, undefined, 320);
    let cur = { ...el, text: '', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }], width: 0, height: 0 } as CanvasElementModel;
    apply({ kind: 'element.created', element: cur });
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const p = { x: end.x * k, y: end.y * k };
      cur = update(cur, { points: [{ x: 0, y: 0 }, p], width: Math.abs(p.x), height: Math.abs(p.y) });
      cursor({ x: el.x + p.x, y: el.y + p.y });
      await wait(30);
    }
    apply({ kind: 'element.updated', element: el });
    await wait(200);
  }

  async function buildTable(t: TableModel): Promise<void> {
    await point(t.x, t.y, 'New table');
    apply({ kind: 'table.created', table: { ...t, columns: [] } });
    await wait(260);
    for (const [i, c] of t.columns.entries()) {
      const a = columnAnchor(t, i, 'left');
      cursor({ x: a.x + 70, y: a.y, label: c.name });
      apply({ kind: 'column.created', tableId: t.id, column: c });
      await wait(220);
    }
    await wait(150);
  }

  /** Drag from the key column to the referencing column: a dashed guide follows the cursor, then the real connector lands. */
  async function drawRelationship(r: SchemaModel['relationships'][number]): Promise<void> {
    const src = full.tables.find((t) => t.columns.some((c) => c.id === r.sourceColumnId));
    const tgt = full.tables.find((t) => t.columns.some((c) => c.id === r.targetColumnId));
    if (!src || !tgt) {
      apply({ kind: 'relationship.created', relationship: r });
      return;
    }
    const right = tgt.x + 40 > src.x;
    const a = columnAnchor(src, src.columns.findIndex((c) => c.id === r.sourceColumnId), right ? 'right' : 'left');
    const b = columnAnchor(tgt, tgt.columns.findIndex((c) => c.id === r.targetColumnId), right ? 'left' : 'right');
    await point(a.x, a.y, 'Drag key → key', 450);
    await dragGuide(a, b, `rel-${r.id}`, 16, 'Drag key → key');
    apply({ kind: 'relationship.created', relationship: r });
    await wait(380);
  }

  async function buildSequence(diagramId: string): Promise<void> {
    const d = snap.sequenceDiagrams.find((x) => x.id === diagramId)!;
    const lifelines = snap.lifelines.filter((l) => l.diagramId === diagramId).sort((a, b) => a.order - b.order);
    const messages = snap.sequenceMessages.filter((m) => m.diagramId === diagramId).sort((a, b) => a.y - b.y);
    const top = d.originY ?? 0;
    const first = lifelines[0];
    await point(first ? first.x : 0, top + 20, 'Sequence');
    apply({ kind: 'sequenceDiagram.created', diagram: d });
    for (const l of lifelines) {
      cursor({ x: l.x + l.width / 2, y: top + 20, label: l.label });
      apply({ kind: 'lifeline.created', lifeline: l });
      await wait(260);
    }
    for (const m of messages) await addMessage(m);
  }

  async function addMessage(m: SequenceMessageModel): Promise<void> {
    const from = snap.lifelines.find((l) => l.id === m.fromLifelineId);
    const to = snap.lifelines.find((l) => l.id === m.toLifelineId);
    const d = snap.sequenceDiagrams.find((x) => x.id === m.diagramId);
    const top = d?.originY ?? 0;
    if (!from || !to) {
      apply({ kind: 'message.created', message: m });
      return;
    }
    const fx = from.x + from.width / 2;
    const tx = to.x + to.width / 2;
    const index = snap.sequenceMessages.filter((x) => x.diagramId === m.diagramId && x.y < m.y && x.style !== 'break').length;
    // Every message starts as a plain call; returns, dividers and colours are set afterwards.
    const plain = { ...m, style: 'solid', color: undefined } as SequenceMessageModel;
    // Create it, then measure the real line and hide it while the drag is shown.
    apply({ kind: 'message.created', message: { ...plain, label: '' } });
    await wait(40);
    const dom = hooks.dom?.message(index);
    const line = dom?.line ?? { x: Math.min(fx, tx), y: top + m.y, w: Math.abs(tx - fx), h: 0 };
    const y = line.y + line.h / 2;
    const [ax, bx] = fx < tx ? [line.x, line.x + line.w] : [line.x + line.w, line.x];
    await point(ax, y, undefined, 300);
    await dragGuide({ x: ax, y }, { x: bx, y }, `seq-${m.id}`, 12);
    dom?.hide(false);
    await wait(160);
    // A divider becomes a Break first, so its label is typed straight into the divider.
    if (m.style === 'break') {
      if (hooks.messageStyle) await hooks.messageStyle({ ...m, label: '' });
      else apply({ kind: 'message.updated', message: { ...m, label: '' } });
      const label = m.label ?? '';
      for (let i = 1; i <= label.length; i++) {
        apply({ kind: 'message.updated', message: { ...m, label: label.slice(0, i) } });
        hooks.dom?.revealLabels();
        await wait(34);
      }
      apply({ kind: 'message.updated', message: m });
      await wait(260);
      return;
    }
    // Then type the label; the box and caret follow the rendered label.
    const label = m.label ?? '';
    for (let i = 1; i <= label.length; i++) {
      apply({ kind: 'message.updated', message: { ...plain, label: label.slice(0, i) } });
      await wait(34);
      const lb = dom?.label();
      if (lb) {
        const box = { x: lb.x - 6, y: lb.y - 3, w: Math.max(lb.w + 12, 40), h: lb.h + 6 };
        cursor({ x: lb.x + lb.w + 1, y: lb.y, h: lb.h, box, caret: true });
      }
    }
    if (m.style !== 'solid' || m.color) {
      apply({ kind: 'message.updated', message: plain });
      await wait(200);
      if (hooks.messageStyle) await hooks.messageStyle(m);
    }
    apply({ kind: 'message.updated', message: m });
    hooks.dom?.revealLabels();
    await wait(260);
  }
}
