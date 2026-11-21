import type { Signal } from '@angular/core';
import type { ShapeView } from '../models/shape-view.model';
import type { Box, Point } from '../models/geometry.model';

/** Module-level pieces of canvas-view.service. */

export const dim = (v: ShapeView): ShapeView => ({ ...v, opacity: v.opacity * 0.5 });

export const lock = (v: ShapeView): ShapeView => ({ ...v, locked: true });

/** `make(v)`, made once per view object. */
export function variant(cache: WeakMap<ShapeView, ShapeView>, v: ShapeView, make: (v: ShapeView) => ShapeView): ShapeView {
   let out = cache.get(v);
   if (!out) {
      out = make(v);
      cache.set(v, out);
   }
   return out;
}

/** Above this many elements + tables the canvas draws only what is near the view (perf P2.5). */
export const CULL_THRESHOLD = 300;

/** Extra drawn area around the view, as a share of its size, so a pan rarely changes the DOM. */
export const CULL_MARGIN = 0.75;

export const boxesOverlap = (a: Box, b: Box): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** A relationship end being re-pointed, drawn to the cursor before it is released. */
export interface RelinkPreview {
   relationshipId: string;
   which: 'source' | 'target';
   cursor: Point;
}

/** What the canvas view reads from sub-features; the editor entry wires it with `connect`. */
export interface CanvasViewHost {
   /** The text element being edited inline (drawn by the editor overlay, not the layer). */
   readonly editingTextId: Signal<string | null>;
   readonly relinkPreview: Signal<RelinkPreview | null>;
}
