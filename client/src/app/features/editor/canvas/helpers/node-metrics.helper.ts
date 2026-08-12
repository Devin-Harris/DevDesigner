import type { TableModel } from '@dbdesigner/shared';
import {
  ANCHOR_GAP,
  GRID_SIZE,
  HEADER_H,
  NODE_WIDTH,
  ROW_H,
} from '../constants/canvas.constants';
import type { Box, ColumnLocation, Point, Side } from '../models/geometry.model';

/** Rendered height of a node (header + rows), for hit-testing and alignment. */
export function nodeHeight(columnCount: number): number {
  return HEADER_H + Math.max(1, columnCount) * ROW_H;
}

/** Snap a coordinate to the grid. */
export function snapToGrid(value: number, size = GRID_SIZE): number {
  return Math.round(value / size) * size;
}

/** +1 for a right-side exit, -1 for a left-side exit. */
export function sideDir(side: Side): 1 | -1 {
  return side === 'right' ? 1 : -1;
}

/** World-space anchor just outside a table's column row, on the given side. */
export function columnAnchor(table: TableModel, index: number, side: Side): Point {
  return {
    x: side === 'right' ? table.x + NODE_WIDTH + ANCHOR_GAP : table.x - ANCHOR_GAP,
    y: table.y + HEADER_H + index * ROW_H + ROW_H / 2,
  };
}

/** A table's world-space footprint. */
export function tableBox(table: TableModel): Box {
  return {
    x0: table.x,
    y0: table.y,
    x1: table.x + NODE_WIDTH,
    y1: table.y + nodeHeight(table.columns.length),
  };
}

/** Index every column by id so relationships resolve to a table + row quickly. */
export function buildColumnLocations(
  tables: readonly TableModel[],
): Map<string, ColumnLocation> {
  const map = new Map<string, ColumnLocation>();
  for (const table of tables) {
    table.columns.forEach((column, index) => map.set(column.id, { table, index }));
  }
  return map;
}
