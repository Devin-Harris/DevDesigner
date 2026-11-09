import type { TableModel } from '@devdesigner/shared';
import { HEADER_H, ROW_H } from '../constants/canvas.constants';
import type { Point, Side } from '../models/geometry.model';
import { columnAnchor, tableBox, tableScale } from './node-metrics.helper';

/** How far (screen px) from a table the cursor can be and still snap to a row. */
export const LINK_SNAP_PX = 32;

export interface LinkSnap {
  columnId: string;
  tableId: string;
  side: Side;
  /** Connector anchor the line will attach to (just outside the row). */
  anchor: Point;
}

/**
 * Find the column row a link drag should snap to. The cursor only has to be near
 * a table (not exactly on the small connect handle): inside it, in its margin, or
 * above/below it within the snap radius. The nearest table wins (later tables, i.e.
 * those drawn on top, win ties) and the row is the one under the cursor's y,
 * clamped to the first/last row.
 */
export function findLinkSnap(
  tables: readonly TableModel[],
  cursor: Point,
  excludeColumnId: string | null,
  zoom: number,
): LinkSnap | null {
  const radius = LINK_SNAP_PX / Math.max(zoom, 0.01);
  let best: { table: TableModel; dist: number } | null = null;
  for (const table of tables) {
    if (table.columns.length === 0) {
      continue;
    }
    const box = tableBox(table);
    const dx = Math.max(box.x0 - cursor.x, 0, cursor.x - box.x1);
    const dy = Math.max(box.y0 - cursor.y, 0, cursor.y - box.y1);
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
      continue;
    }
    if (!best || dist <= best.dist) {
      best = { table, dist };
    }
  }
  if (!best) {
    return null;
  }

  const { table } = best;
  const raw = Math.floor((cursor.y - table.y - HEADER_H * tableScale(table)) / (ROW_H * tableScale(table)));
  const index = Math.min(table.columns.length - 1, Math.max(0, raw));
  let column = table.columns[index];
  if (column.id === excludeColumnId) {
    // Never snap a link onto its own origin: slide to the neighbouring row.
    const alt = table.columns[index + 1] ?? table.columns[index - 1];
    if (!alt) {
      return null;
    }
    column = alt;
  }
  const row = table.columns.indexOf(column);
  const box = tableBox(table);
  const side: Side = cursor.x >= (box.x0 + box.x1) / 2 ? 'right' : 'left';
  return {
    columnId: column.id,
    tableId: table.id,
    side,
    anchor: columnAnchor(table, row, side),
  };
}
