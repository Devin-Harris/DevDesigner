/* eslint-disable @typescript-eslint/consistent-type-assertions -- the scripted showcase builds partial rows and mutations by hand */
import type { CanvasElementModel, SchemaModel, SchemaMutation, SequenceMessageModel } from '@devdesigner/shared';
import { createCanvasSteps } from './showcase-canvas-steps';
import { createSlideSteps } from './showcase-slide-steps';
import type { StepContext } from './showcase-step-context';

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
export type CursorFn = (
   at: { x: number; y: number; label?: string; box?: Box; caret?: boolean; h?: number } | null
) => void;

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
   opts: PlayerOptions = {}
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
      grow?: (cur: CanvasElementModel, typed: string) => CanvasElementModel
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

   // ---- steps (showcase-canvas-steps.ts, showcase-slide-steps.ts) ----
   const ctx: StepContext = { store, cursor, hooks, apply, wait, point, update, boxOf, typeChars, full, snap };
   const canvasSteps = createCanvasSteps(ctx);
   const {
      drawPen,
      shrinkText,
      buildCodeTrio,
      dragOut,
      typeText,
      typeCode,
      drawArrow,
      buildTable,
      drawRelationship,
      buildSequence,
   } = canvasSteps;
   const { buildSlideItems, showMorph } = createSlideSteps(ctx, canvasSteps);

   try {
      // ---- clear ----
      if (opts.clear !== false)
         apply(
            ...full.relationships.map(
               (r) => ({ kind: 'relationship.deleted', relationshipId: r.id }) as SchemaMutation
            ),
            ...full.tables.map((t) => ({ kind: 'table.deleted', tableId: t.id }) as SchemaMutation),
            ...full.elements.map((e) => ({ kind: 'element.deleted', elementId: e.id }) as SchemaMutation),
            ...full.sequenceMessages.map((m) => ({ kind: 'message.deleted', messageId: m.id }) as SchemaMutation),
            ...full.lifelines.map((l) => ({ kind: 'lifeline.deleted', lifelineId: l.id }) as SchemaMutation),
            ...full.sequenceDiagrams.map(
               (d) => ({ kind: 'sequenceDiagram.deleted', diagramId: d.id }) as SchemaMutation
            )
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
            else if (['rectangle', 'ellipse', 'diamond', 'triangle'].includes(el.type)) await dragOut(el);
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
               const sources = matched
                  .filter(shapeOf)
                  .map((c) => c.from)
                  .sort((a, b) => b.y - a.y || a.x - b.x);
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
                  from: {
                     ...from,
                     id: k.id,
                     slideId: f.id,
                     x: from.x + dx,
                     y: from.y + dy,
                     morphId: `tag:solo-${k.id}`,
                  } as CanvasElementModel,
               }));
               // A real duplicate copies everything, including what this slide will not keep.
               const extras = prevKids
                  .filter((e) => !found.some((c) => c.from.id === e.id))
                  .map(
                     (e) =>
                        ({
                           ...e,
                           id: `dup-${e.id}`,
                           slideId: f.id,
                           x: e.x + dx,
                           y: e.y + dy,
                           morphId: `tag:solo-dup-${e.id}`,
                        }) as CanvasElementModel
                  );
               apply(
                  ...copies.map(({ from }) => ({ kind: 'element.created', element: from }) as SchemaMutation),
                  ...extras.map((e) => ({ kind: 'element.created', element: e }) as SchemaMutation)
               );
               store.setActiveSlide(f.id);
               hooks.panel?.({ frames: [...shown], active: i });
               await wait(600);
               // Remove what this slide does not need: select it, then Delete.
               for (const e of extras) {
                  cursor({ x: e.x + Math.min(e.width, 200) / 2, y: e.y + e.height / 2, label: 'Select' });
                  await wait(380);
                  cursor({
                     x: e.x + Math.min(e.width, 200) / 2,
                     y: e.y + e.height / 2,
                     label: 'Delete',
                     box: { x: e.x, y: e.y, w: Math.min(e.width, 420), h: e.height },
                  });
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
                  [
                     { label: 'Add table', kbd: 'T' },
                     { label: 'Auto layout' },
                     { label: 'Import SQL…' },
                     { label: 'Export SQL…' },
                     { label: 'Export image…' },
                  ],
                  'Export SQL…'
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
}
