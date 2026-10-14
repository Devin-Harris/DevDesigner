// Tools that make an agent's loop cheaper and safer: see the result (render_preview),
// find things (find_items / get_items_detail), undo a bad step (undo_last_change),
// group / connect / duplicate in one call, and sync a schema from SQL DDL.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Resvg } from '@resvg/resvg-js';
import {
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  edgePoint,
  elementRect,
  isUnsignedType,
  parseDataType,
  presentationOf,
  presentationSlides,
  soloMorphId,
  tableRect,
  type CanvasElementModel,
  type DiagramSpec,
  type ImportIntoProjectResponse,
  type ProjectExportFile,
  type ProjectExportImage,
  type ProjectGraphResponse,
  type RelationshipModel,
  type SchemaModel,
  type SchemaMutation,
} from '@dbdesigner/shared';
import type { DbDesignerApi } from './api';
import { applySpec } from './apply';
import { Batch, type BatchSection } from './batch';
import { colorArg } from './colors';
import { planUndo, type Journal } from './journal';
import { collectItems, unionOf, type LayoutItem } from './layout';
import { UserError, findTable, formatDataType } from './model';
import { resolveSlide, slideFrames, type ToolFn } from './presentation-tools';
import { renderSvg, type Rect } from './render';
import { describeDiff, diffSchema } from './schema-diff';
import { parseSqlDdl } from './sql-import';

const projectId = z.string().describe('Project id (from list_projects).');
const confirm = z.literal(true).describe('Must be true. Destructive: confirm the user actually wants this.');

/** A tool result carrying MCP content blocks (images) instead of plain JSON text. */
export interface RichResult {
  __rich: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
}
export const isRich = (v: unknown): v is RichResult => !!v && typeof v === 'object' && '__rich' in v;

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

function emptyFile(schema: Partial<SchemaModel>, images: ProjectExportImage[] = []): ProjectExportFile {
  return {
    format: PROJECT_EXPORT_FORMAT,
    version: PROJECT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: 'Copy', description: null, type: 'ERD' },
    schema: {
      tables: [],
      relationships: [],
      notes: [],
      elements: [],
      sequenceDiagrams: [],
      lifelines: [],
      sequenceMessages: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      home: null,
      ...schema,
    },
    ...(images.length ? { images } : {}),
  };
}

export function registerAgentTools(tool: ToolFn, api: DbDesignerApi, journal: Journal): void {
  const graph = (id: string): Promise<ProjectGraphResponse> => api.get<ProjectGraphResponse>(`/projects/${id}`);
  const importFile = async (id: string, file: ProjectExportFile, linkExisting = false): Promise<SchemaMutation[]> =>
    (await api.post<ImportIntoProjectResponse>(`/projects/${id}/import-content`, { file, ...(linkExisting ? { linkExisting } : {}) }))
      .mutations;

  /** Base64 of the image files behind these elements (missing files are skipped). */
  const imagesFor = async (elements: CanvasElementModel[]): Promise<ProjectExportImage[]> => {
    const ids = [...new Set(elements.filter((e) => e.type === 'image' && e.fileId).map((e) => e.fileId as string))];
    const out: ProjectExportImage[] = [];
    for (const fid of ids) {
      try {
        const { mimeType, data } = await api.getBytes(`/images/${fid}`);
        out.push({ id: fid, mimeType, data: data.toString('base64') });
      } catch {
        // gone: the import drops the element
      }
    }
    return out;
  };

  // ---- Undo ------------------------------------------------------------------------------

  tool(
    'list_changes',
    'List the recent changes this MCP session made to a project (newest last), as recorded for undo_last_change. Only changes made through these tools since the MCP server started are recorded.',
    { projectId },
    { readOnly: true },
    async ({ projectId: id }) => {
      const list = journal.list(id);
      return {
        changes: list.map((e, i) => ({
          step: list.length - i,
          tool: e.tool,
          at: e.at,
        })),
        note: list.length ? 'step 1 = the most recent; undo_last_change reverts from the top.' : 'No recorded changes.',
      };
    },
  );

  tool(
    'undo_last_change',
    "Revert the most recent change(s) THIS MCP session made to a project (any tool: moves, styles, scaling, creates, deletes). Restores changed fields, deletes what was created and re-creates what was deleted (re-created items get new ids). Fields someone changed again since are left alone and reported as conflicts. `steps` undoes several calls, newest first. Use dryRun to see what would happen.",
    {
      projectId,
      steps: z.number().int().min(1).max(25).optional().describe('How many recorded changes to undo (default 1).'),
      dryRun: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, steps, dryRun }) => {
      const n = steps ?? 1;
      const entries = journal.list(id);
      if (!entries.length) throw new UserError('Nothing to undo: no changes recorded for this project in this MCP session.');
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < n; i += 1) {
        const entry = dryRun ? entries[entries.length - 1 - i] : journal.pop(id);
        if (!entry) break;
        const current = (await graph(id)).schema;
        const plan = planUndo(entry.before, entry.after, current);
        const summary = {
          tool: entry.tool,
          at: entry.at,
          revertFields: plan.patches.length + plan.columnPatches.length,
          deleteCreated: plan.deletes.length + plan.columnDeletes.length,
          recreate: Object.values(plan.restore).reduce((a, l) => a + l.length, 0),
          ...(plan.conflicts.length ? { conflicts: plan.conflicts.slice(0, 20) } : {}),
        };
        if (dryRun) {
          results.push({ ...summary, dryRun: true });
          continue;
        }
        // 1) Field reverts + deletes of created things: one atomic batch.
        const batch = new Batch();
        for (const p of plan.patches) batch.set(p.section, p.id, p.patch);
        for (const d of plan.deletes) batch.delete(d.section, d.id);
        await batch.send(api, id);
        for (const cid of plan.columnDeletes) await api.delete(`/columns/${cid}`);
        for (const c of plan.columnPatches) await api.patch(`/columns/${c.id}`, c.patch);
        // 2) Re-create deleted things.
        const warnings = await restore(id, entry.before, plan.restore);
        results.push({ ...summary, ...(warnings.length ? { warnings } : {}) });
      }
      return { undone: results.length, results, remaining: journal.list(id).length };
    },
  );

  /** Recreate deleted content: whole tables/elements/diagrams via import, the rest granularly. */
  const restore = async (
    id: string,
    before: SchemaModel,
    r: ReturnType<typeof planUndo>['restore'],
  ): Promise<string[]> => {
    const warnings: string[] = [];
    const restoredDiagrams = new Set(r.diagrams.map((d) => d.id));
    const file = emptyFile(
      {
        tables: r.tables,
        elements: r.elements,
        sequenceDiagrams: r.diagrams,
        lifelines: before.lifelines.filter((l) => restoredDiagrams.has(l.diagramId)),
        sequenceMessages: before.sequenceMessages.filter((m) => restoredDiagrams.has(m.diagramId)),
      },
      await imagesFor(r.elements),
    );
    const colMap = new Map<string, string>();
    if (r.tables.length || r.elements.length || r.diagrams.length) {
      const mutations = await importFile(id, file, true);
      const created = mutations.flatMap((m) => (m.kind === 'table.created' ? [m.table] : []));
      for (const old of r.tables) {
        const fresh = created.find((t) => t.name === old.name);
        for (const c of old.columns) {
          const nc = fresh?.columns.find((x) => x.name === c.name);
          if (nc) colMap.set(c.id, nc.id);
        }
      }
    }
    // Columns removed from tables that still exist.
    for (const { tableId, column: c } of r.columns) {
      const nc = await api.post<{ id: string }>(`/tables/${tableId}/columns`, {
        name: c.name,
        dataType: c.dataType,
        isPrimaryKey: c.isPrimaryKey,
        isNullable: c.isNullable,
        isUnique: c.isUnique,
        isAutoIncrement: c.isAutoIncrement,
        ...(c.isUnsigned ? { isUnsigned: true } : {}),
        ...(c.defaultValue !== undefined ? { defaultValue: c.defaultValue } : {}),
      });
      colMap.set(c.id, nc.id);
    }
    // Relationships: endpoints map to re-created columns or still-existing ones.
    const now = (await graph(id)).schema;
    const live = new Set(now.tables.flatMap((t) => t.columns.map((c) => c.id)));
    const relsToRestore: RelationshipModel[] = [
      ...r.relationships,
      // Relationships that went with a deleted table were not listed separately.
      ...before.relationships.filter(
        (x) =>
          !r.relationships.some((y) => y.id === x.id) &&
          !now.relationships.some((y) => y.id === x.id) &&
          (colMap.has(x.sourceColumnId) || colMap.has(x.targetColumnId)),
      ),
    ];
    for (const rel of relsToRestore) {
      const src = colMap.get(rel.sourceColumnId) ?? (live.has(rel.sourceColumnId) ? rel.sourceColumnId : undefined);
      const dst = colMap.get(rel.targetColumnId) ?? (live.has(rel.targetColumnId) ? rel.targetColumnId : undefined);
      if (!src || !dst) {
        warnings.push(`relationship ${rel.id}: an endpoint column is gone; not restored.`);
        continue;
      }
      try {
        await api.post(`/projects/${id}/relationships`, {
          sourceColumnId: src,
          targetColumnId: dst,
          type: rel.type,
          ...(rel.onDelete ? { onDelete: rel.onDelete } : {}),
          ...(rel.onUpdate ? { onUpdate: rel.onUpdate } : {}),
        });
      } catch (err) {
        warnings.push(`relationship ${rel.id}: ${(err as Error).message}`);
      }
    }
    // Participants / messages removed from diagrams that still exist.
    const laneMap = new Map<string, string>();
    for (const l of r.lifelines.filter((x) => !restoredDiagrams.has(x.diagramId))) {
      if (!now.sequenceDiagrams.some((d) => d.id === l.diagramId)) continue;
      const nl = await api.post<{ id: string }>(`/projects/${id}/lifelines`, {
        diagramId: l.diagramId,
        label: l.label,
        x: l.x,
        width: l.width,
        ...(l.color ? { color: l.color } : {}),
        ...(l.lineColor ? { lineColor: l.lineColor } : {}),
        ...(l.morphId ? { morphId: l.morphId } : {}),
      });
      laneMap.set(l.id, nl.id);
    }
    const laneIds = new Set(now.lifelines.map((l) => l.id));
    for (const m of r.messages.filter((x) => !restoredDiagrams.has(x.diagramId))) {
      const from = laneMap.get(m.fromLifelineId) ?? (laneIds.has(m.fromLifelineId) ? m.fromLifelineId : undefined);
      const to = laneMap.get(m.toLifelineId) ?? (laneIds.has(m.toLifelineId) ? m.toLifelineId : undefined);
      if (!from || !to) {
        warnings.push(`message "${m.label ?? m.id}": a participant is gone; not restored.`);
        continue;
      }
      await api.post(`/projects/${id}/messages`, {
        diagramId: m.diagramId,
        fromLifelineId: from,
        toLifelineId: to,
        y: m.y,
        ...(m.label !== undefined ? { label: m.label } : {}),
        style: m.style,
        ...(m.arrowhead ? { arrowhead: m.arrowhead } : {}),
        ...(m.color ? { color: m.color } : {}),
        ...(m.wrap !== undefined ? { wrap: m.wrap } : {}),
        ...(m.morphId ? { morphId: m.morphId } : {}),
      });
    }
    return warnings;
  };

  // ---- Finding things ------------------------------------------------------------------

  type Found = {
    id: string;
    kind: string;
    type?: string;
    label: string;
    rect?: Rect;
    slide?: string;
    group?: string;
    colors?: Record<string, string>;
    diagram?: string;
  };

  const everything = (schema: SchemaModel): Found[] => {
    const items = new Map<string, LayoutItem>(collectItems(schema, { lines: 'all' }).map((i) => [i.key, i]));
    const out: Found[] = [];
    for (const t of schema.tables) {
      out.push({
        id: t.id,
        kind: 'table',
        label: t.name,
        rect: round(tableRect(t)),
        ...(t.slideId ? { slide: t.slideId } : {}),
        ...(t.groupId ? { group: t.groupId } : {}),
        ...(t.color ? { colors: { header: t.color } } : {}),
      });
    }
    for (const e of schema.elements) {
      const it = items.get(`element:${e.id}`);
      const isSlide = e.type === 'frame' && !!e.slide;
      out.push({
        id: e.id,
        kind: isSlide ? 'slide' : 'element',
        type: e.type,
        label: isSlide
          ? `slide ${(e.slide?.order ?? 0) + 1} of "${presentationOf(e as never)}"`
          : (e.text ?? e.runs?.map((r) => r.text).join('') ?? '').replace(/\s+/g, ' ').slice(0, 80) || e.type,
        rect: round(it?.rect ?? { x: e.x, y: e.y, w: e.width, h: e.height }),
        ...(e.slideId ? { slide: e.slideId } : {}),
        ...(e.groupId ? { group: e.groupId } : {}),
        colors: {
          stroke: e.strokeColor,
          ...(e.fillStyle !== 'none' && e.backgroundColor ? { fill: e.backgroundColor } : {}),
        },
      });
    }
    for (const d of schema.sequenceDiagrams) {
      const it = items.get(`diagram:${d.id}`);
      out.push({
        id: d.id,
        kind: 'diagram',
        label: d.title ?? 'sequence diagram',
        ...(it ? { rect: round(it.rect) } : {}),
        ...(d.slideId ? { slide: d.slideId } : {}),
        ...(d.groupId ? { group: d.groupId } : {}),
      });
    }
    for (const l of schema.lifelines) {
      out.push({ id: l.id, kind: 'participant', label: l.label, diagram: l.diagramId, rect: { x: Math.round(l.x - l.width / 2), y: 0, w: l.width, h: 0 } });
    }
    for (const m of schema.sequenceMessages) {
      out.push({ id: m.id, kind: 'message', label: m.label ?? '', diagram: m.diagramId, type: m.style });
    }
    const colName = new Map<string, string>();
    for (const t of schema.tables) for (const c of t.columns) colName.set(c.id, `${t.name}.${c.name}`);
    for (const r of schema.relationships) {
      out.push({ id: r.id, kind: 'relationship', type: r.type, label: `${colName.get(r.sourceColumnId)} -> ${colName.get(r.targetColumnId)}` });
    }
    return out;
  };

  const KINDS = ['table', 'element', 'slide', 'diagram', 'participant', 'message', 'relationship'] as const;

  tool(
    'find_items',
    'Search a project and get ids WITH positions/sizes (get_project_summary has no coordinates). Filter by text (matches names, labels, text content, column names), kind, element type, slide, group, color, or a world region (items intersecting it). Returns at most `limit` rows (default 60).',
    {
      projectId,
      text: z.string().optional().describe('Case-insensitive substring.'),
      kinds: z.array(z.enum(KINDS)).optional(),
      types: z.array(z.string()).optional().describe('Element types: rectangle, ellipse, diamond, text, code, image, arrow, line, freedraw, frame.'),
      slide: z.string().optional().describe('Slide id or 1-based number (with presentation): items owned by that slide.'),
      presentation: z.string().optional(),
      group: z.string().optional().describe('Group id.'),
      color: z.string().optional().describe('Palette name or #hex: items using that stroke / fill / header color.'),
      region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    { readOnly: true },
    async ({ projectId: id, text, kinds, types, slide, presentation, group, color, region, limit }) => {
      const { schema } = await graph(id);
      let rows = everything(schema);
      if (kinds?.length) rows = rows.filter((r) => (kinds as string[]).includes(r.kind));
      if (types?.length) rows = rows.filter((r) => r.type && types.includes(r.type));
      if (slide) {
        const frame = resolveSlide(schema, slide, presentation);
        rows = rows.filter((r) => r.slide === frame.id);
      }
      if (group) rows = rows.filter((r) => r.group === group);
      if (color) {
        const hex = (colorArg(color, 'the color') ?? '').toLowerCase();
        rows = rows.filter((r) => Object.values(r.colors ?? {}).some((c) => c.toLowerCase() === hex));
      }
      if (region) {
        rows = rows.filter(
          (r) => r.rect && r.rect.h > 0 && r.rect.x < region.x + region.w && r.rect.x + r.rect.w > region.x && r.rect.y < region.y + region.h && r.rect.y + r.rect.h > region.y,
        );
      }
      if (text) {
        const q = text.toLowerCase();
        const colHit = new Set(
          schema.tables.filter((t) => t.columns.some((c) => c.name.toLowerCase().includes(q))).map((t) => t.id),
        );
        rows = rows.filter((r) => r.label.toLowerCase().includes(q) || colHit.has(r.id));
      }
      const max = limit ?? 60;
      return { total: rows.length, items: rows.slice(0, max), ...(rows.length > max ? { truncated: rows.length - max } : {}) };
    },
  );

  tool(
    'get_items_detail',
    'Full current properties of specific items by id (tables also by name): every style field, text, points, bindings, slide/group membership, plus the estimated on-canvas box. Use it to verify a bulk edit without exporting the whole project. Long text is truncated to 2000 chars.',
    { projectId, items: z.array(z.string()).min(1).max(100) },
    { readOnly: true },
    async ({ projectId: id, items }) => {
      const { schema } = await graph(id);
      const boxes = new Map(collectItems(schema, { lines: 'all' }).map((i) => [i.key, round(i.rect)]));
      const clip = (s: string | undefined): string | undefined =>
        s && s.length > 2000 ? `${s.slice(0, 2000)}... (${s.length} chars)` : s;
      const out: unknown[] = [];
      const missing: string[] = [];
      for (const ref of items) {
        const e = schema.elements.find((x) => x.id === ref);
        if (e) {
          out.push({ kind: 'element', ...e, text: clip(e.text), box: boxes.get(`element:${e.id}`) });
          continue;
        }
        const d = schema.sequenceDiagrams.find((x) => x.id === ref);
        if (d) {
          out.push({
            kind: 'diagram',
            ...d,
            box: boxes.get(`diagram:${d.id}`),
            participants: schema.lifelines.filter((l) => l.diagramId === d.id).map((l) => ({ id: l.id, label: l.label, x: l.x })),
            messages: schema.sequenceMessages.filter((m) => m.diagramId === d.id).sort((a, b) => a.y - b.y).map((m) => ({ id: m.id, label: m.label, y: m.y, style: m.style })),
          });
          continue;
        }
        const l = schema.lifelines.find((x) => x.id === ref);
        if (l) {
          out.push({ kind: 'participant', ...l });
          continue;
        }
        const m = schema.sequenceMessages.find((x) => x.id === ref);
        if (m) {
          out.push({ kind: 'message', ...m });
          continue;
        }
        const r = schema.relationships.find((x) => x.id === ref);
        if (r) {
          out.push({ kind: 'relationship', ...r });
          continue;
        }
        try {
          const t = findTable(schema, ref);
          out.push({
            kind: 'table',
            ...t,
            columns: t.columns.map((c) => ({ ...c, dataType: formatDataType(c.dataType) })),
            box: boxes.get(`table:${t.id}`),
          });
        } catch {
          missing.push(ref);
        }
      }
      return { items: out, ...(missing.length ? { notFound: missing } : {}) };
    },
  );

  // ---- Groups ----------------------------------------------------------------------------

  const sectionOf = (schema: SchemaModel, ref: string): { section: BatchSection; id: string } => {
    if (schema.elements.some((e) => e.id === ref)) return { section: 'elements', id: ref };
    if (schema.sequenceDiagrams.some((d) => d.id === ref)) return { section: 'diagrams', id: ref };
    return { section: 'tables', id: findTable(schema, ref).id };
  };

  tool(
    'group_items',
    "Group tables, drawing elements and sequence diagrams so they select and drag together in the editor (like Ctrl+G). Returns the group id; move_items / align_items / distribute_items / arrange_grid / delete_items accept it to act on the whole group. Items already in a group are moved into the new one.",
    { projectId, items: z.array(z.string()).min(2).describe('Element / diagram ids and table names or ids.') },
    { idempotent: true },
    async ({ projectId: id, items }) => {
      const { schema } = await graph(id);
      const groupId = randomUUID();
      const batch = new Batch();
      for (const ref of items) {
        const s = sectionOf(schema, ref);
        batch.set(s.section, s.id, { groupId });
      }
      await batch.send(api, id);
      return { groupId, grouped: items.length };
    },
  );

  tool(
    'ungroup_items',
    'Remove items from their group (or dissolve a whole group by its id). Ctrl+Shift+G in the editor.',
    {
      projectId,
      items: z.array(z.string()).optional().describe('Items to take out of their group.'),
      group: z.string().optional().describe('Group id to dissolve.'),
    },
    { idempotent: true },
    async ({ projectId: id, items, group }) => {
      if (!items?.length && !group) throw new UserError('Give `items` or `group`.');
      const { schema } = await graph(id);
      const batch = new Batch();
      for (const ref of items ?? []) {
        const s = sectionOf(schema, ref);
        batch.set(s.section, s.id, { groupId: null });
      }
      if (group) {
        for (const t of schema.tables.filter((x) => x.groupId === group)) batch.set('tables', t.id, { groupId: null });
        for (const e of schema.elements.filter((x) => x.groupId === group)) batch.set('elements', e.id, { groupId: null });
        for (const d of schema.sequenceDiagrams.filter((x) => x.groupId === group)) batch.set('diagrams', d.id, { groupId: null });
      }
      const n = await batch.send(api, id);
      return { ungrouped: n };
    },
  );

  // ---- Connectors ------------------------------------------------------------------------

  tool(
    'connect_items',
    'Draw many arrows/lines between shapes, text, images, code blocks and tables in one call. Each connection is bound to both ends (it follows them when they move) and starts/ends on the facing edges. Optional per-connection label, color, dashed, plain line, or arrowheads on both ends.',
    {
      projectId,
      connections: z
        .array(
          z.object({
            from: z.string().describe('Element id or table name/id.'),
            to: z.string(),
            label: z.string().max(200).optional(),
            color: z.string().optional().describe('Palette name or #hex.'),
            dashed: z.boolean().optional(),
            line: z.boolean().optional().describe('No arrowhead.'),
            both: z.boolean().optional().describe('Arrowheads on both ends.'),
          }),
        )
        .min(1)
        .max(200),
      strokeWidth: z.number().min(1).max(12).optional(),
    },
    {},
    async ({ projectId: id, connections, strokeWidth }) => {
      const { schema } = await graph(id);
      const end = (ref: string): { rect: Rect; binding: { targetKind: 'table' | 'element'; targetId: string } } => {
        const e = schema.elements.find((x) => x.id === ref);
        if (e) return { rect: elementRect(e), binding: { targetKind: 'element', targetId: e.id } };
        const t = findTable(schema, ref);
        return { rect: tableRect(t), binding: { targetKind: 'table', targetId: t.id } };
      };
      // Resolve everything first so a bad reference fails before anything is drawn.
      const planned = connections.map((c) => ({ c, a: end(c.from), b: end(c.to) }));
      const created: string[] = [];
      for (const { c, a, b } of planned) {
        const start = edgePoint(a.rect, b.rect);
        const stop = edgePoint(b.rect, a.rect);
        const dx = Math.round(stop.x - start.x);
        const dy = Math.round(stop.y - start.y);
        const el = await api.post<CanvasElementModel>(`/projects/${id}/elements`, {
          type: c.line ? 'line' : 'arrow',
          x: Math.round(start.x),
          y: Math.round(start.y),
          width: Math.abs(dx),
          height: Math.abs(dy),
          angle: 0,
          strokeColor: c.color ? (colorArg(c.color, 'the connector') ?? '#1e1e1e') : '#1e1e1e',
          fillStyle: 'none',
          strokeWidth: strokeWidth ?? 2,
          strokeStyle: c.dashed ? 'dashed' : 'solid',
          opacity: 100,
          points: [
            { x: 0, y: 0 },
            { x: dx, y: dy },
          ],
          startBinding: a.binding,
          endBinding: b.binding,
          ...(c.line ? { endArrowhead: 'none' } : {}),
          ...(c.both && !c.line ? { startArrowhead: 'arrow' } : {}),
          ...(c.label ? { text: c.label, fontSize: 16 } : {}),
        });
        created.push(el.id);
      }
      return { created: created.length, ids: created };
    },
  );

  // ---- Duplicate -------------------------------------------------------------------------

  /** Export-file subset holding these items (tables w/ columns, elements, whole diagrams). */
  const subsetFile = async (
    schema: SchemaModel,
    sel: { tables: Set<string>; elements: Set<string>; diagrams: Set<string> },
  ): Promise<ProjectExportFile> => {
    const tables = schema.tables.filter((t) => sel.tables.has(t.id));
    const cols = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
    const elements = schema.elements.filter((e) => sel.elements.has(e.id));
    return emptyFile(
      {
        tables,
        relationships: schema.relationships.filter((r) => cols.has(r.sourceColumnId) && cols.has(r.targetColumnId)),
        elements,
        sequenceDiagrams: schema.sequenceDiagrams.filter((d) => sel.diagrams.has(d.id)),
        lifelines: schema.lifelines.filter((l) => sel.diagrams.has(l.diagramId)),
        sequenceMessages: schema.sequenceMessages.filter((m) => sel.diagrams.has(m.diagramId)),
      },
      await imagesFor(elements),
    );
  };

  const shiftFile = (file: ProjectExportFile, dx: number, dy: number): void => {
    const s = file.schema;
    s.tables = s.tables.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    s.elements = s.elements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
    s.relationships = s.relationships.map((r) => (r.waypoints ? { ...r, waypoints: r.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })) } : r));
    s.sequenceDiagrams = s.sequenceDiagrams.map((d) => ({ ...d, originY: d.originY + dy }));
    s.lifelines = s.lifelines.map((l) => ({ ...l, x: l.x + dx }));
    s.sequenceMessages = s.sequenceMessages.map((m) => ({ ...m, y: m.y + dy }));
  };

  /** Give every copied object a fresh solo morph tag (so copies never pair with originals). */
  const resoloFile = (file: ProjectExportFile): void => {
    const s = file.schema;
    s.elements = s.elements.map((e) => (e.type !== 'frame' ? { ...e, morphId: soloMorphId() } : e));
    s.sequenceDiagrams = s.sequenceDiagrams.map((d) => ({ ...d, morphId: soloMorphId() }));
    s.lifelines = s.lifelines.map((l) => ({ ...l, morphId: soloMorphId() }));
    s.sequenceMessages = s.sequenceMessages.map((m) => ({ ...m, morphId: soloMorphId() }));
  };

  const createdIds = (mutations: SchemaMutation[]): Record<string, string[]> => {
    const out: Record<string, string[]> = { tables: [], elements: [], diagrams: [] };
    for (const m of mutations) {
      if (m.kind === 'table.created') out.tables.push(m.table.id);
      else if (m.kind === 'element.created') out.elements.push(m.element.id);
      else if (m.kind === 'sequenceDiagram.created') out.diagrams.push(m.diagram.id);
    }
    return out;
  };

  tool(
    'duplicate_items',
    "Copy tables, drawing elements, sequence diagrams (or a group id) in one call, offset by dx/dy (default 40,40) or with the copy's top-left at x/y. Relationships between copied tables and arrows bound to copied or existing items come along; copies stay on the same slide. Copied tables get `tableSuffix` appended to their names (default \"_copy\") since table names should be unique. Copies get fresh morph tags unless keepMorph.",
    {
      projectId,
      items: z.array(z.string()).min(1),
      dx: z.number().optional(),
      dy: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      tableSuffix: z.string().max(40).optional(),
      includeConnectors: z.boolean().optional().describe('Also copy arrows whose both ends are copied (default true).'),
      keepMorph: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, items, dx, dy, x, y, tableSuffix, includeConnectors, keepMorph }) => {
      const { schema } = await graph(id);
      const sel = { tables: new Set<string>(), elements: new Set<string>(), diagrams: new Set<string>() };
      for (const ref of items) {
        const inGroup = [
          ...schema.tables.filter((t) => t.groupId === ref).map((t) => ['tables', t.id] as const),
          ...schema.elements.filter((e) => e.groupId === ref).map((e) => ['elements', e.id] as const),
          ...schema.sequenceDiagrams.filter((d) => d.groupId === ref).map((d) => ['diagrams', d.id] as const),
        ];
        if (inGroup.length) {
          for (const [k, v] of inGroup) sel[k].add(v);
          continue;
        }
        const s = sectionOf(schema, ref);
        const el = schema.elements.find((e) => e.id === s.id);
        if (el?.type === 'frame' && el.slide) throw new UserError(`"${ref}" is a slide; use duplicate_slide.`);
        sel[s.section as 'tables' | 'elements' | 'diagrams'].add(s.id);
      }
      if (includeConnectors !== false) {
        const has = (b: CanvasElementModel['startBinding']): boolean =>
          !!b && (b.targetKind === 'table' ? sel.tables.has(b.targetId) : sel.elements.has(b.targetId));
        for (const e of schema.elements) if (has(e.startBinding) && has(e.endBinding)) sel.elements.add(e.id);
      }
      const file = await subsetFile(schema, sel);
      const box = unionOf(
        collectItems(file.schema as SchemaModel, { lines: 'all' }).map((i) => i.rect),
      ) as Rect | null;
      let ox = dx ?? 40;
      let oy = dy ?? 40;
      if (box && x !== undefined) ox = x - box.x;
      if (box && y !== undefined) oy = y - box.y;
      shiftFile(file, Math.round(ox), Math.round(oy));
      const suffix = tableSuffix ?? '_copy';
      const names = new Set(schema.tables.map((t) => t.name.toLowerCase()));
      file.schema.tables = file.schema.tables.map((t) => {
        let name = `${t.name}${suffix}`;
        for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${t.name}${suffix}${n}`;
        names.add(name.toLowerCase());
        return { ...t, name };
      });
      if (!keepMorph) resoloFile(file);
      const mutations = await importFile(id, file, true);
      return { offset: { dx: Math.round(ox), dy: Math.round(oy) }, created: createdIds(mutations) };
    },
  );

  tool(
    'duplicate_slide',
    "Copy a slide and everything on it to a new slide right after it (same presentation, same spot). Objects keep their morph tags by default, so presenting from the original to the copy morphs every object to its new state - the quick way to build a step-by-step sequence: duplicate, then edit/move things on the copy. Set morph: false for an independent copy. Returns the new slide id.",
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: z.string().optional(),
      morph: z.boolean().optional().describe('Keep morph pairing with the original (default true).'),
      notes: z.string().optional().describe("Speaker notes for the copy (default: the original's)."),
    },
    {},
    async ({ projectId: id, slide, presentation, morph, notes }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const sel = {
        tables: new Set(schema.tables.filter((t) => t.slideId === frame.id).map((t) => t.id)),
        elements: new Set([frame.id, ...schema.elements.filter((e) => e.slideId === frame.id).map((e) => e.id)]),
        diagrams: new Set(schema.sequenceDiagrams.filter((d) => d.slideId === frame.id).map((d) => d.id)),
      };
      const file = await subsetFile(schema, sel);
      // Tables on the copy keep their names (they are the same tables, one step later).
      if (morph === false) resoloFile(file);
      // The copy sorts right after the original; orders are renumbered below.
      file.schema.elements = file.schema.elements.map((e) =>
        e.id === frame.id && e.slide
          ? { ...e, slide: { ...e.slide, order: e.slide.order + 0.5, ...(notes !== undefined ? { notes } : {}) } }
          : e,
      );
      const mutations = await importFile(id, file, true);
      const newFrame = mutations.find(
        (m): m is Extract<SchemaMutation, { kind: 'element.created' }> => m.kind === 'element.created' && m.element.type === 'frame',
      )?.element;
      if (!newFrame) throw new UserError('The slide copy was not created.');
      // Renumber the presentation so the copy sits right after the original.
      const fresh = (await graph(id)).schema;
      const name = presentationOf(frame);
      const ordered = presentationSlides(slideFrames(fresh), name).filter((f) => f.id !== newFrame.id);
      const at = ordered.findIndex((f) => f.id === frame.id) + 1;
      ordered.splice(at, 0, slideFrames(fresh).find((f) => f.id === newFrame.id) as (typeof ordered)[number]);
      const batch = new Batch();
      ordered.forEach((f, i) => {
        if (f.slide.order !== i) batch.set('elements', f.id, { slide: { ...f.slide, order: i } });
      });
      await batch.send(api, id);
      const created = createdIds(mutations);
      return {
        slide: newFrame.id,
        number: at + 1,
        presentation: name,
        copied: { tables: created.tables.length, elements: created.elements.length - 1, diagrams: created.diagrams.length },
      };
    },
  );

  // ---- Preview ---------------------------------------------------------------------------

  tool(
    'render_preview',
    "Render a PNG picture of the project so you can SEE the layout: one slide, a world region, the area around given items, or the whole canvas. It is an approximation of the editor (same sizes and colors; simplified routing and fonts), good for spotting overlaps, crowding, contrast and alignment. showIds draws each item's id (table name) at its corner so you can map what you see to ids. Returns the image plus the region drawn.",
    {
      projectId,
      slide: z.string().optional().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: z.string().optional(),
      items: z.array(z.string()).optional().describe('Zoom to the bounds of these ids / table names.'),
      region: z.object({ x: z.number(), y: z.number(), w: z.number().min(10), h: z.number().min(10) }).optional(),
      width: z.number().int().min(200).max(2400).optional().describe('Image width in px (default 1280).'),
      showIds: z.boolean().optional(),
      format: z.enum(['png', 'svg']).optional().describe('svg returns the SVG markup as text instead.'),
    },
    { readOnly: true },
    async ({ projectId: id, slide, presentation, items, region, width, showIds, format }) => {
      const { schema } = await graph(id);
      let area: Rect | undefined = region;
      let slideId: string | undefined;
      if (slide) slideId = resolveSlide(schema, slide, presentation).id;
      if (items?.length) {
        const all = collectItems(schema, { lines: 'all' });
        const keys = new Set<string>();
        for (const ref of items) {
          const hit = all.filter((i) => i.id === ref || (i.kind === 'table' && i.label === `table "${ref}"`) || i.groupId === ref);
          if (!hit.length) {
            const t = findTable(schema, ref);
            keys.add(`table:${t.id}`);
          }
          hit.forEach((h) => keys.add(h.key));
        }
        const b = unionOf(all.filter((i) => keys.has(i.key)).map((i) => i.rect));
        if (b) area = { x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 };
      }
      // Embed only the images that are drawn.
      const imgIds = new Set(schema.elements.filter((e) => e.type === 'image' && e.fileId && (!slideId || e.slideId === slideId)).map((e) => e.fileId as string));
      const images = new Map<string, string>();
      for (const fid of imgIds) {
        try {
          const { mimeType, data } = await api.getBytes(`/images/${fid}`);
          images.set(fid, `data:${mimeType};base64,${data.toString('base64')}`);
        } catch {
          // placeholder box
        }
      }
      const { svg, region: drawnRegion, drawn, hiddenSlides } = renderSvg(schema, { region: area, slideId, images, showIds });
      const meta = {
        region: round(drawnRegion),
        itemsDrawn: drawn,
        ...(slideId ? { slide: slideId } : {}),
        ...(hiddenSlides ? { note: `Only the first slide of each presentation is drawn on the canvas (${hiddenSlides} stacked slide(s) hidden); pass \`slide\` to see one.` } : {}),
      };
      if (format === 'svg') return { ...meta, svg };
      const png = new Resvg(svg, {
        fitTo: { mode: 'width', value: width ?? Math.min(1280, Math.max(400, Math.round(drawnRegion.w))) },
        font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
      })
        .render()
        .asPng();
      return {
        __rich: [
          { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: JSON.stringify(meta) },
        ],
      } satisfies RichResult;
    },
  );

  // ---- Schema from SQL ---------------------------------------------------------------------

  const specArg = z
    .object({
      tables: z.array(z.any()).optional(),
      relationships: z.array(z.any()).optional(),
    })
    .optional()
    .describe('Desired tables/relationships in apply_diagram_spec format (instead of sql).');

  const desiredSpec = (sql: string | undefined, spec: unknown): { spec: DiagramSpec; notes: Record<string, unknown> } => {
    if ((sql === undefined) === (spec === undefined)) throw new UserError('Give exactly one of `sql` or `spec`.');
    if (sql !== undefined) {
      const parsed = parseSqlDdl(sql);
      if (!parsed.spec.tables.length) throw new UserError('No CREATE TABLE statements found in the SQL.');
      return {
        spec: parsed.spec,
        notes: {
          ...(parsed.skipped.length ? { skippedStatements: [...new Set(parsed.skipped)] } : {}),
          ...(parsed.warnings.length ? { warnings: parsed.warnings } : {}),
        },
      };
    }
    return { spec: spec as DiagramSpec, notes: {} };
  };

  tool(
    'diff_schema',
    "Compare desired database structure - SQL DDL (CREATE TABLE / ALTER TABLE ADD ..., from PostgreSQL, MySQL, SQLite or SQL Server) or a spec - with the project's tables: tables, columns, column changes (type, key, null, unique, auto-increment, default) and relationships to add or drop. Changes nothing; apply with apply_schema_changes.",
    { projectId, sql: z.string().max(500000).optional(), spec: specArg },
    { readOnly: true },
    async ({ projectId: id, sql, spec }) => {
      const { schema } = await graph(id);
      const want = desiredSpec(sql, spec);
      const diff = diffSchema(schema, want.spec);
      return { ...describeDiff(diff), ...want.notes };
    },
  );

  tool(
    'apply_schema_changes',
    "Bring the project's tables in line with SQL DDL or a spec: creates missing tables (laid out automatically) and relationships, adds missing columns, updates changed columns. Nothing is dropped unless `drop: true` (then tables, columns and relationships missing from the SQL are deleted - needs confirm). Importing a whole SQL dump into an empty project is just this with the dump. Use diff_schema (or dryRun) first.",
    {
      projectId,
      sql: z.string().max(500000).optional(),
      spec: specArg,
      drop: z.boolean().optional().describe('Also delete what the SQL does not have (default false).'),
      confirm: confirm.optional().describe('Required with drop: true.'),
      near: z.string().optional().describe('Place new tables beside this existing table.'),
      dryRun: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, sql, spec, drop, confirm: ok, near, dryRun }) => {
      const { schema } = await graph(id);
      const want = desiredSpec(sql, spec);
      const diff = diffSchema(schema, want.spec);
      if (dryRun) return { dryRun: true, ...describeDiff(diff), ...want.notes };
      if (drop && ok !== true) throw new UserError('drop: true deletes data; pass confirm: true as well.');
      const done: Record<string, number> = {};

      // 1) Columns on existing tables (added before relationships may point at them).
      for (const a of diff.addColumns) {
        await api.post(`/tables/${a.tableId}/columns`, {
          name: a.column.name,
          dataType: parseDataType(a.column.type),
          ...(isUnsignedType(a.column.type) ? { isUnsigned: true } : {}),
          isPrimaryKey: !!a.column.primaryKey,
          isNullable: a.column.primaryKey ? false : (a.column.nullable ?? true),
          isUnique: !!a.column.unique,
          isAutoIncrement: !!a.column.autoIncrement,
          ...(a.column.default !== undefined ? { defaultValue: a.column.default } : {}),
        });
      }
      done.columnsAdded = diff.addColumns.length;
      for (const c of diff.changeColumns) await api.patch(`/columns/${c.columnId}`, c.patch);
      done.columnsChanged = diff.changeColumns.length;

      // 2) New tables + every relationship touching them (applySpec wires refs to existing tables).
      const newNames = new Set(diff.addTables.map((t) => t.name.toLowerCase()));
      const tableOfRef = (ref: string): string => ref.slice(0, ref.lastIndexOf('.')).trim().toLowerCase();
      const viaSpec = diff.addRelationships.filter((r) => newNames.has(tableOfRef(r.from)) || newNames.has(tableOfRef(r.to)));
      const rest = diff.addRelationships.filter((r) => !viaSpec.includes(r));
      let warnings: string[] = [];
      if (diff.addTables.length) {
        const res = await applySpec(
          api,
          id,
          { tables: diff.addTables.map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c, references: undefined })) })), relationships: viaSpec },
          { near },
        );
        warnings = res.warnings;
        done.tablesAdded = res.tables.length;
      }
      // 3) Relationships between tables that already existed.
      if (rest.length) {
        const now = (await graph(id)).schema;
        const col = (ref: string): string | undefined => {
          const i = ref.lastIndexOf('.');
          const t = now.tables.find((x) => x.name.toLowerCase() === ref.slice(0, i).trim().toLowerCase());
          return t?.columns.find((c) => c.name.toLowerCase() === ref.slice(i + 1).trim().toLowerCase())?.id;
        };
        for (const r of rest) {
          const src = col(r.from);
          const dst = col(r.to);
          if (!src || !dst) {
            warnings.push(`relationship ${r.from} -> ${r.to}: column not found; skipped.`);
            continue;
          }
          await api.post(`/projects/${id}/relationships`, {
            sourceColumnId: src,
            targetColumnId: dst,
            type: r.type ?? 'ONE_TO_MANY',
            ...(r.onDelete ? { onDelete: r.onDelete } : {}),
            ...(r.onUpdate ? { onUpdate: r.onUpdate } : {}),
          });
        }
      }
      done.relationshipsAdded = diff.addRelationships.length;

      // 4) Drops (atomic for tables + relationships; columns one by one).
      if (drop) {
        const batch = new Batch();
        for (const t of diff.dropTables) batch.delete('tables', t.id);
        for (const r of diff.dropRelationships) batch.delete('relationships', r.id);
        await batch.send(api, id);
        for (const c of diff.dropColumns) await api.delete(`/columns/${c.columnId}`);
        done.tablesDropped = diff.dropTables.length;
        done.columnsDropped = diff.dropColumns.length;
        done.relationshipsDropped = diff.dropRelationships.length;
      } else if (diff.dropTables.length || diff.dropColumns.length || diff.dropRelationships.length) {
        done.notInSqlKept = diff.dropTables.length + diff.dropColumns.length + diff.dropRelationships.length;
      }
      return { ...done, ...(warnings.length ? { warnings } : {}), ...want.notes };
    },
  );
}

