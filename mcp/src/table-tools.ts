// Spreadsheet-style table tools (the `grid` drawing element: rows/columns of text,
// header row, merged cells, per-cell styling). Not ERD tables - those are add_table.
// Content is the JSON grid format from @dbdesigner/shared, written through the
// granular element endpoints so realtime + permissions stay the server's.

import { z } from 'zod';
import {
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  elementRect,
  findFreeSpot,
  gridApplyOps,
  gridFromRows,
  gridSizes,
  parseGrid,
  schemaRects,
  serializeGrid,
  tableRect,
  type CanvasElementModel,
  type GridOp,
  type ProjectGraphResponse,
} from '@dbdesigner/shared';
import type { DbDesignerApi } from './api';
import { colorArg } from './colors';
import { UserError, findTarget } from './model';
import { resolveSlide, type ToolFn } from './presentation-tools';

const projectId = z.string().describe('Project id (from list_projects).');
const cells = z.array(z.array(z.string())).describe('Rows of cell text, top to bottom (use \\n for a line break inside a cell).');
const idx = z.number().int().min(0);
const block = { r0: idx, c0: idx, r1: idx, c1: idx };

const cellStyle = z
  .object({
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    align: z.enum(TEXT_ALIGNS as unknown as [string, ...string[]]).nullable().optional(),
    vAlign: z.enum(VERTICAL_ALIGNS as unknown as [string, ...string[]]).nullable().optional(),
    color: z.string().nullable().optional().describe('Text color: palette name or #hex.'),
    fill: z.string().nullable().optional().describe('Cell background: palette name (soft tints read best) or #hex.'),
  })
  .describe('Per-cell overrides; null clears one back to the table default.');

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setCells'), row: idx, col: idx, values: cells.describe('Block of text written with its top-left at row/col; writing past the edge grows the table.') }),
  z.object({ op: z.literal('insertRows'), at: idx.describe('Index the first new row gets (0 = top, rowCount = append).'), count: z.number().int().min(1).optional(), values: cells.optional() }),
  z.object({ op: z.literal('deleteRows'), at: idx, count: z.number().int().min(1).optional() }),
  z.object({ op: z.literal('insertColumns'), at: idx.describe('Index the first new column gets (0 = left, columnCount = append).'), count: z.number().int().min(1).optional(), values: cells.optional().describe('values[k] = the k-th new column, top to bottom.') }),
  z.object({ op: z.literal('deleteColumns'), at: idx, count: z.number().int().min(1).optional() }),
  z.object({ op: z.literal('merge'), ...block }).describe('Merge the block r0,c0..r1,c1 into one cell (texts are joined).'),
  z.object({ op: z.literal('unmerge'), ...block }),
  z.object({ op: z.literal('style'), ...block, style: cellStyle }),
  z.object({ op: z.literal('header'), on: z.boolean() }).describe('Bold first row on/off.'),
  z.object({ op: z.literal('columnWidths'), widths: z.array(z.number().positive().nullable()).describe('Px per column; null keeps one.') }),
  z.object({ op: z.literal('rowHeights'), heights: z.array(z.number().positive().nullable()).describe('Px per row (rows still grow to fit text); null keeps one.') }),
]);

type Schema = ProjectGraphResponse['schema'];

function findGrid(schema: Schema, ref: string): CanvasElementModel {
  const el = schema.elements.find((e) => e.id === ref);
  if (!el) throw new UserError(`No element "${ref}". Use find_items or get_project_summary for grid table ids.`);
  if (el.type !== 'grid') {
    throw new UserError(`Element "${ref}" is a ${el.type}, not a grid table.`);
  }
  return el;
}

/** Resolve a style op's colors (palette names -> hex). */
function resolveOps(ops: z.infer<typeof opSchema>[]): GridOp[] {
  return ops.map((o) => {
    if (o.op !== 'style') return o as GridOp;
    const style = { ...o.style };
    if (style.color) style.color = colorArg(style.color, 'the cell text');
    if (style.fill) style.fill = colorArg(style.fill, 'the cell fill');
    return { ...o, style } as GridOp;
  });
}

/** What get_grid_table / the write tools report back. */
function describeGrid(el: CanvasElementModel): object {
  const g = parseGrid(el.text);
  const { cols, rows } = gridSizes(g, el.width, el.height);
  const styles = Object.entries(g.styles ?? {});
  return {
    id: el.id,
    x: el.x,
    y: el.y,
    width: Math.round(el.width),
    height: Math.round(el.height),
    rowCount: g.rows.length,
    columnCount: g.cols.length,
    header: g.header,
    fontSize: el.fontSize ?? 14,
    columnWidths: cols.map(Math.round),
    rowHeights: rows.map(Math.round),
    rows: g.cells,
    ...(g.merges?.length ? { merges: g.merges.map((m) => ({ r0: m.r, c0: m.c, r1: m.r + m.rs - 1, c1: m.c + m.cs - 1 })) } : {}),
    ...(styles.length ? { cellStyles: Object.fromEntries(styles) } : {}),
    ...(el.slideId ? { slideId: el.slideId } : {}),
  };
}

export function registerTableTools(tool: ToolFn, api: DbDesignerApi): void {
  const graph = async (id: string): Promise<Schema> =>
    (await api.get<ProjectGraphResponse>(`/projects/${id}`)).schema;

  tool(
    'add_grid_table',
    'Add a spreadsheet/Word-style TABLE of text (rows x columns, optional bold header row) to the canvas - for comparisons, specs, schedules, status lists. NOT a database table (use add_table / apply_diagram_spec for ERD tables). Columns size to their content; rows grow to fit wrapped text. Edit it later with edit_grid_table (cells, rows/columns, merges, per-cell styles). Position is auto-chosen free space unless x/y or near is given; with `slide` it goes on that presentation slide (x/y then slide-local).',
    {
      projectId,
      rows: cells.describe('Rows of cell text; with header (default) the first row is the header.'),
      header: z.boolean().optional().describe('Bold first row (default true).'),
      columnWidths: z.array(z.number().positive()).optional().describe('Px per column (default: fit content, 80-320).'),
      fontSize: z.number().min(6).max(96).optional().describe('Default 14.'),
      merges: z.array(z.object(block)).optional().describe('Blocks to merge after filling, e.g. {r0:0,c0:0,r1:0,c1:2} for a title spanning three columns.'),
      cellStyles: z.array(z.object({ ...block, style: cellStyle })).optional().describe('Per-cell styling, applied to each block.'),
      strokeColor: z.string().optional().describe('Border + text color: palette name or #hex (default ink).'),
      backgroundColor: z.string().optional().describe("Table background: palette name or #hex (default the theme surface)."),
      x: z.number().optional(),
      y: z.number().optional(),
      near: z.string().optional().describe('Table name or element id to place beside.'),
      slide: z.string().optional().describe('Slide id or 1-based slide number to place it on.'),
      presentation: z.string().optional().describe('Presentation name, when `slide` is a number and there are several.'),
    },
    {},
    async (a) => {
      if (!a.rows.length) throw new UserError('rows must have at least one row.');
      const fontSize = a.fontSize ?? 14;
      let edit = gridFromRows(a.rows, { header: a.header, fontSize, columnWidths: a.columnWidths, merges: a.merges });
      const ops: z.infer<typeof opSchema>[] = [
        ...(a.cellStyles ?? []).map((s) => ({ op: 'style' as const, ...s })),
      ];
      if (ops.length) {
        try {
          edit = gridApplyOps(
            { text: serializeGrid(edit.grid), width: edit.width, height: edit.height, fontSize },
            resolveOps(ops),
          );
        } catch (err) {
          throw new UserError((err as Error).message);
        }
      }
      const schema = await graph(a.projectId);
      let pos: { x: number; y: number };
      let slideId: string | undefined;
      if (a.slide) {
        const frame = resolveSlide(schema, a.slide, a.presentation);
        slideId = frame.id;
        pos = { x: frame.x + (a.x ?? 64), y: frame.y + (a.y ?? 160) };
      } else if (typeof a.x === 'number' && typeof a.y === 'number') {
        pos = { x: a.x, y: a.y };
      } else {
        let nearRect;
        if (a.near) {
          const t = findTarget(schema, a.near);
          nearRect = t.kind === 'table' ? tableRect(t.table) : elementRect(t.element);
        }
        pos = findFreeSpot(schemaRects(schema), edit.width, edit.height, { near: nearRect, gap: 40 });
      }
      const el = await api.post<CanvasElementModel>(`/projects/${a.projectId}/elements`, {
        type: 'grid',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: Math.round(edit.width),
        height: Math.round(edit.height),
        angle: 0,
        strokeColor: colorArg(a.strokeColor, 'the table') || '#1e1e1e',
        backgroundColor: colorArg(a.backgroundColor, 'the table background') || 'surface',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        opacity: 100,
        cornerRadius: 4,
        fontSize,
        fontFamily: 'normal',
        text: serializeGrid(edit.grid),
        ...(slideId ? { slideId } : {}),
      });
      return describeGrid(el);
    },
  );

  tool(
    'get_grid_table',
    'Read a grid table (spreadsheet-style table element): its cell text as rows, sizes, header flag, merges and per-cell styles. Indices are 0-based; merged-away cells read as "".',
    { projectId, tableId: z.string().describe('Grid table element id.') },
    { readOnly: true },
    async ({ projectId: id, tableId }) => describeGrid(findGrid(await graph(id), tableId)),
  );

  tool(
    'edit_grid_table',
    'Edit a grid table (spreadsheet-style table element) with a list of operations applied in order, as one change: setCells (write a block of text; grows the table if needed), insertRows / deleteRows, insertColumns / deleteColumns, merge / unmerge a block, style a block (bold, italic, align, vAlign, color, fill), header on/off, columnWidths, rowHeights. Indices are 0-based and refer to the table as it is at that step (call get_grid_table first). Inserting grows the table; rows grow to fit text. Also takes table-wide fontSize / colors.',
    {
      projectId,
      tableId: z.string().describe('Grid table element id.'),
      ops: z.array(opSchema).optional(),
      fontSize: z.number().min(6).max(96).optional().describe('Table-wide text size.'),
      strokeColor: z.string().optional().describe('Border + default text color.'),
      backgroundColor: z.string().optional().describe('Table background.'),
    },
    {},
    async ({ projectId: id, tableId, ops, fontSize, strokeColor, backgroundColor }) => {
      const el = findGrid(await graph(id), tableId);
      if (!ops?.length && fontSize === undefined && !strokeColor && !backgroundColor) {
        throw new UserError('Nothing to change: give ops and/or fontSize / strokeColor / backgroundColor.');
      }
      let edit;
      try {
        edit = gridApplyOps({ ...el, fontSize: fontSize ?? el.fontSize }, resolveOps(ops ?? []));
      } catch (err) {
        throw new UserError((err as Error).message);
      }
      const updated = await api.patch<CanvasElementModel>(`/elements/${tableId}`, {
        text: serializeGrid(edit.grid),
        width: Math.round(edit.width),
        height: Math.round(edit.height),
        ...(fontSize !== undefined ? { fontSize } : {}),
        ...(strokeColor ? { strokeColor: colorArg(strokeColor, 'the table') } : {}),
        ...(backgroundColor
          ? { backgroundColor: colorArg(backgroundColor, 'the table background'), fillStyle: 'solid' }
          : {}),
      });
      return describeGrid(updated);
    },
  );
}
