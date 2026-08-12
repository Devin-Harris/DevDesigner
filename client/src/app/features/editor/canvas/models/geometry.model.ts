import type { TableModel } from '@dbdesigner/shared';

/** Which side of a table node a connector attaches to. */
export type Side = 'left' | 'right';

/** A world-space point. */
export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned box in world coords (a table's footprint). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A column resolved to its owning table and row index. */
export interface ColumnLocation {
  table: TableModel;
  index: number;
}
