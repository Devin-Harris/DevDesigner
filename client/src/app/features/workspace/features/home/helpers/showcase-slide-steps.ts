/* eslint-disable @typescript-eslint/consistent-type-assertions -- the scripted showcase builds partial rows and mutations by hand */
import type { CanvasElementModel, SchemaMutation } from '@devdesigner/shared';
import type { StepContext } from './showcase-step-context';
import type { CanvasSteps } from './showcase-canvas-steps';

/** Showcase steps for slides: building a slide's items and playing a morph between two. */
export function createSlideSteps(ctx: StepContext, canvas: CanvasSteps) {
   const { store, cursor, hooks, apply, wait, point, update, snap } = ctx;
   const { dragOut, typeText } = canvas;
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
      const tag = (e: CanvasElementModel) => (e.morphId?.startsWith('tag:solo') ? null : (e.morphId ?? null));

      // 1. Side by side (slide 2 as its own block for a moment, so both show).
      store.setActiveSlide(f1.id);
      apply(
         {
            kind: 'element.updated',
            element: {
               ...f2,
               x: f2.x + dx,
               slide: { ...f2.slide!, presentation: `${deck} · next` },
            } as CanvasElementModel,
         },
         ...kids2.map((e) => ({ kind: 'element.updated', element: { ...e, x: e.x + dx } }) as SchemaMutation)
      );
      hooks.panel?.({ frames: ids, active: 0 });
      await hooks.frame?.({ x: f1.x - 40, y: f1.y - 80, w: f1.width + dx + 80, h: f1.height + 160 });
      await point(f1.x + f1.width / 2, f1.y - 40, 'Map pairs', 700);

      // 2. Pair arrows: each tagged object on slide 1 to its match on slide 2.
      const pairs = kids1
         .map((a) => ({ a, b: kids2.find((b) => tag(a) && tag(b) === tag(a)) }))
         .filter((p): p is { a: CanvasElementModel; b: CanvasElementModel } => !!p.b);
      const arrows: string[] = [];
      for (const { a, b } of pairs.sort(
         (p, q) => (p.a.type === 'rectangle' ? -1 : 1) - (q.a.type === 'rectangle' ? -1 : 1)
      )) {
         const from = {
            x: a.x + Math.min(a.width, a.type === 'text' ? 330 : a.width),
            y: a.y + Math.min(a.height, 60) / 2,
         };
         const to = { x: b.x + dx, y: b.y + Math.min(b.height, 60) / 2 };
         await point(from.x, from.y, 'Pair', 450);
         const id = `showcase-pair-${a.id}`;
         let arrow = {
            id,
            type: 'arrow',
            x: from.x,
            y: from.y,
            width: 0,
            height: 0,
            angle: 0,
            points: [
               { x: 0, y: 0 },
               { x: 0, y: 0 },
            ],
            strokeColor: '#7c5cff',
            fillStyle: 'none',
            strokeWidth: 4,
            strokeStyle: 'solid',
            opacity: 100,
            zIndex: 9999,
            endArrowhead: 'arrow',
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
         ...kids2.map((e) => ({ kind: 'element.updated', element: e }) as SchemaMutation)
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
         for (const e of kids2)
            if (!kids1.some((a) => tag(a) && tag(a) === tag(e)))
               apply({ kind: 'element.deleted', elementId: `showcase-in-${e.id}` });
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
      tag: (e: CanvasElementModel) => string | null
   ): Promise<void> {
      const shift = { x: f1.x - f2.x, y: f1.y - f2.y };
      const incoming = kids2
         .filter((e) => !kids1.some((a) => tag(a) && tag(a) === tag(e)))
         .map(
            (e) =>
               ({
                  ...e,
                  id: `showcase-in-${e.id}`,
                  slideId: f1.id,
                  x: e.x + shift.x,
                  y: e.y + shift.y,
                  opacity: 0,
               }) as CanvasElementModel
         );
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
               muts.push({
                  kind: 'element.updated',
                  element: { ...a, opacity: Math.round(100 * (1 - Math.min(1, k * 1.6))) } as CanvasElementModel,
               });
            }
         }
         for (const e of incoming)
            muts.push({
               kind: 'element.updated',
               element: { ...e, opacity: Math.round(100 * Math.max(0, k * 1.6 - 0.6)) } as CanvasElementModel,
            });
         apply(...muts);
         await wait(30);
      }
   }

   return { buildSlideItems, byElements, showMorph, playMorph };
}
