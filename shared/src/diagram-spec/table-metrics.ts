// Table card metrics: the one source of truth for how big the editor draws an ERD
// table. The client renders with these (canvas.constants re-exports them) and the
// MCP / auto-layout estimate with them, so connector anchors, previews and layout
// all agree with the canvas.

import { isNumericType } from '../sql';
import type { TableModel } from '../models';

/** Default and minimum table width; a card grows past it to fit long names. */
export const TABLE_NODE_WIDTH = 280;
/** Header and row heights. Connector anchors are derived from these. */
export const TABLE_HEADER_H = 40;
export const TABLE_ROW_H = 34;

/** Smallest / largest uniform scale a table can be resized to. */
export const MIN_TABLE_SCALE = 0.4;
export const MAX_TABLE_SCALE = 3;

// Dynamic-width estimation. A card widens so its longest name shows in full, up to
// a name of MAX_NAME_CHARS; longer names ellipsize. The reserved widths approximate
// the non-name controls in a row / header, kept a touch generous so names are never
// clipped early.
export const MAX_NAME_CHARS = 50;
export const NAME_CHAR_W = 8;
export const HEADER_CHAR_W = 8.5;
export const ROW_FIXED_W = 220;
export const VARCHAR_FIXED_W = 50;
/** The UN (unsigned) chip, shown only on numeric columns. */
export const UNSIGNED_CHIP_W = 24;
export const HEADER_FIXED_W = 92;

/**
 * Natural (unscaled) width of a table card: fits the longest table / column name.
 * Any legacy manual `width` is ignored, exactly like the editor.
 */
export function estimateTableWidth(
  name: string,
  columns: ReadonlyArray<{ name: string; dataType: { name: string } }>,
): number {
  const chars = (s: string): number => Math.min(s.length, MAX_NAME_CHARS);
  let need = HEADER_FIXED_W + chars(name) * HEADER_CHAR_W;
  for (const column of columns) {
    const fixed =
      ROW_FIXED_W +
      (column.dataType.name === 'VARCHAR' ? VARCHAR_FIXED_W : 0) +
      (isNumericType(column.dataType.name) ? UNSIGNED_CHIP_W : 0);
    need = Math.max(need, fixed + chars(column.name) * NAME_CHAR_W);
  }
  return Math.max(TABLE_NODE_WIDTH, Math.ceil(need));
}

/** Natural (unscaled) height of a table card: header plus at least one row. */
export function estimateTableHeight(columnCount: number): number {
  return TABLE_HEADER_H + Math.max(1, columnCount) * TABLE_ROW_H;
}

/** A table's effective display scale (1 = natural size), clamped like the editor does. */
export function tableDisplayScale(table: Pick<TableModel, 'scale'>): number {
  const s = table.scale;
  return s && s > 0 ? Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, s)) : 1;
}
