import type { CanvasElementModel, ElementBinding, TableModel, UpdateElementDto } from '@devdesigner/shared';
import { absolutePoints, elementBox, focusAt, tableBox, type RotatedBox } from './element-geometry.helper';
import { lineEnds } from './render/shape-primitives';
import type { Point } from '../models/geometry.model';

/** Lines/arrows with an end bound to `targetId`. */
export function linesBoundTo(elements: readonly CanvasElementModel[], targetId: string): CanvasElementModel[] {
   return elements.filter(
      (e) =>
         (e.type === 'line' || e.type === 'arrow') &&
         (e.startBinding?.targetId === targetId || e.endBinding?.targetId === targetId)
   );
}

/** Resolve a binding to its target's box from tables + elements (messages are not resolved). */
export function bindingBoxResolver(
   elements: readonly CanvasElementModel[],
   tables: readonly TableModel[]
): (binding: ElementBinding) => RotatedBox | null {
   const elById = new Map(elements.map((e) => [e.id, e]));
   const tById = new Map(tables.map((t) => [t.id, t]));
   return (b) => {
      if (b.targetKind === 'table') {
         const t = tById.get(b.targetId);
         return t ? tableBox(t) : null;
      }
      if (b.targetKind === 'element') {
         const e = elById.get(b.targetId);
         return e ? { ...elementBox(e), angle: e.angle } : null;
      }
      return null;
   };
}

/**
 * The patch that pins a bound line where it is drawn right now: its stored points become
 * the drawn ends (keeping elbow bends), so it stays put when `targetId` goes away. With
 * `rebindTo`, the ends bound to `targetId` move to that element instead of being dropped.
 */
export function freezeLinePatch(
   line: CanvasElementModel,
   targetId: string,
   resolve: (binding: ElementBinding) => RotatedBox | null,
   rebindTo?: string
): UpdateElementDto {
   const ends = lineEnds(line, resolve);
   const stored = absolutePoints(line);
   // Elbow routes run through the stored interior bends between the drawn ends.
   const pts =
      line.elbow && ends.length >= 2 ? [ends[0], ...stored.slice(1, -1), ends[ends.length - 1]] : ends;
   // An end that stays bound keeps its drawn spot: pin it with a focus aimed at where it
   // is drawn now, else it re-aims at its new neighbour (a both-bound connector aims at
   // the other target's center, a half-bound line at its next point).
   const pin = (b: ElementBinding, at: Point | undefined): ElementBinding | undefined => {
      if (b.focus || !at) return undefined;
      const box = resolve(b);
      if (!box) return undefined;
      // Halfway along the center->end ray stays inside the box, so the focus isn't clamped
      // (the drawn end sits a small gap outside the outline).
      const cx = (box.x0 + box.x1) / 2;
      const cy = (box.y0 + box.y1) / 2;
      const focus = focusAt(box, { x: (cx + at.x) / 2, y: (cy + at.y) / 2 });
      return focus ? { ...b, focus } : undefined;
   };
   const swap = (b: ElementBinding | undefined, at: Point | undefined): ElementBinding | null | undefined => {
      if (!b) return undefined;
      if (b.targetId !== targetId) return rebindTo ? undefined : pin(b, at);
      return rebindTo ? { ...b, targetKind: 'element', targetId: rebindTo } : null;
   };
   const startBinding = swap(line.startBinding, pts[0]);
   const endBinding = swap(line.endBinding, pts[pts.length - 1]);
   const bindings = {
      ...(startBinding !== undefined ? { startBinding } : {}),
      ...(endBinding !== undefined ? { endBinding } : {}),
   };
   if (pts.length < 2) {
      return bindings;
   }
   const o = pts[0];
   return {
      x: o.x,
      y: o.y,
      points: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
      ...bindings,
   };
}
