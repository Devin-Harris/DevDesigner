/** A simplified world-space footprint of one canvas element. */
export interface MinimapItem {
   kind: 'table' | 'sequence' | 'shape' | 'frame' | 'text' | 'line';
   x0: number;
   y0: number;
   x1: number;
   y1: number;
   /** Absolute world points for line/arrow/freehand items. */
   points?: { x: number; y: number }[];
}
