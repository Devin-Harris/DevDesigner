import type { TableModel } from '@dbdesigner/shared';
import {
  ANCHOR_GAP,
  GRID_SIZE,
  HEADER_CHAR_W,
  HEADER_FIXED_W,
  HEADER_H,
  MAX_NAME_CHARS,
  MAX_TABLE_SCALE,
  MIN_TABLE_SCALE,
  NAME_CHAR_W,
  NODE_WIDTH,
  ROW_FIXED_W,
  ROW_H,
  UNSIGNED_CHIP_W,
  VARCHAR_FIXED_W,
} from '../constants/canvas.constants';
import { isNumericType } from '@dbdesigner/shared';
import type { Box, ColumnLocation, Point, Side } from '../models/geometry.model';

// Memoize by table reference: the store hands the same object to the renderer
// and every connector in a render pass, so this collapses repeated work and is
// invalidated automatically when an edit produces a new table object.
const widthCache = new WeakMap<TableModel, number>();

/**
 * Rendered width of a table node. Grows past NODE_WIDTH so the longest column or
 * table name shows in full, capped at MAX_NAME_CHARS (longer names ellipsize).
 * Pure and shared by the renderer and the connector geometry so anchors always
 * align with the drawn edge.
 */
export function tableWidth(table: TableModel): number {
  return Math.round(tableBaseWidth(table) * tableScale(table));
}

/** Display scale of a table (1 = natural size), clamped to the supported range. */
export function tableScale(table: TableModel): number {
  const s = table.scale;
  return s && s > 0 ? Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, s)) : 1;
}

/**
 * Unscaled width: always fits the content (any legacy manual width is ignored).
 * Cached per table object.
 */
export function tableBaseWidth(table: TableModel): number {
  const cached = widthCache.get(table);
  if (cached !== undefined) {
    return cached;
  }
  const chars = (name: string): number => Math.min(name.length, MAX_NAME_CHARS);
  let need = HEADER_FIXED_W + chars(table.name) * HEADER_CHAR_W;
  for (const column of table.columns) {
    const fixed =
      ROW_FIXED_W +
      (column.dataType.name === 'VARCHAR' ? VARCHAR_FIXED_W : 0) +
      (isNumericType(column.dataType.name) ? UNSIGNED_CHIP_W : 0);
    need = Math.max(need, fixed + chars(column.name) * NAME_CHAR_W);
  }
  const width = Math.max(NODE_WIDTH, Math.ceil(need));
  widthCache.set(table, width);
  return width;
}

/** Rendered height of a node (header + rows), for hit-testing and alignment. */
export function nodeHeight(columnCount: number, scale = 1): number {
  return (HEADER_H + Math.max(1, columnCount) * ROW_H) * scale;
}

/** Rendered (scaled) height of a table. */
export function tableHeight(table: TableModel): number {
  return nodeHeight(table.columns.length, tableScale(table));
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
    x: side === 'right' ? table.x + tableWidth(table) + ANCHOR_GAP : table.x - ANCHOR_GAP,
    y: table.y + (HEADER_H + index * ROW_H + ROW_H / 2) * tableScale(table),
  };
}

/** A table's world-space footprint. */
export function tableBox(table: TableModel): Box {
  return {
    x0: table.x,
    y0: table.y,
    x1: table.x + tableWidth(table),
    y1: table.y + nodeHeight(table.columns.length, tableScale(table)),
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
