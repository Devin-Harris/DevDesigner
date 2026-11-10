// MCP tool, resource and prompt registrations. Every tool is a thin composition of
// backend REST calls (so validation, permissions and realtime broadcast are the
// server's) plus the pure helpers in model.ts / shared. Outputs are compact JSON.

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  RELATIONSHIP_TYPES,
  PROJECT_TYPES,
  edgePoint,
  elementRect,
  estimateTextSize,
  findFreeSpot,
  fitWithin,
  generateSql,
  layoutGraph,
  morphIdForTag,
  soloMorphId,
  estimateTableHeight,
  estimateTableWidth,
  isUnsignedType,
  parseDataType,
  presentationOf,
  schemaRects,
  shiftPresentation,
  stackSlideFrames,
  tableRect,
  validateSchema,
  SEQUENCE_DEFAULTS,
  type CanvasElementModel,
  type ColumnModel,
  type LifelineModel,
  type ProjectExportFile,
  type ProjectGraphResponse,
  type ProjectSummary,
  type RelationshipModel,
  type SequenceMessageModel,
  type TableModel,
} from '@devdesigner/shared';
import { ApiError, type DevDesignerApi } from './api';
import { applySpec } from './apply';
import { colorArg, describePalette, tableColorArg } from './colors';
import { loadImage } from './images';
import { Batch } from './batch';
import { isRich, registerAgentTools, type RichResult } from './agent-tools';
import { Journal, schemaChanged } from './journal';
import { registerLayoutTools } from './layout-tools';
import { registerTableTools } from './table-tools';
import { applyLayoutDiff, registerPresentationTools } from './presentation-tools';
import { registerDesignTools } from './design-tools';
import {
  UserError,
  findColumn,
  findColumnIn,
  findDiagram,
  findLifeline,
  findTable,
  findTarget,
  summarizeProject,
} from './model';

// --- Shared input schemas ------------------------------------------------------

const projectId = z.string().describe('Project id (from list_projects).');
const confirm = z
  .literal(true)
  .describe('Must be true. Destructive: confirm the user actually wants this deleted.');
const relType = z.enum(RELATIONSHIP_TYPES as unknown as [string, ...string[]]);

const columnFields = {
  type: z
    .string()
    .optional()
    .describe("SQL type, e.g. 'INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'ENUM(\\'a\\',\\'b\\')'. Default VARCHAR(255)."),
  primaryKey: z.boolean().optional(),
  nullable: z.boolean().optional().describe('Default true (false for primary keys).'),
  unique: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  default: z.string().optional().describe('Default value; keywords like CURRENT_TIMESTAMP are kept verbatim.'),
  note: z.string().optional(),
};

const specColumn = z.object({
  name: z.string(),
  ...columnFields,
  references: z
    .string()
    .optional()
    .describe("Foreign-key shorthand: 'table.column' this column points at. Table may be new (in this spec) or already in the project."),
});
const specTable = z.object({
  name: z.string(),
  color: z
    .string()
    .optional()
    .describe(
      'Header color: a palette name (blue, green, violet, amber, sky, pink, teal, orange, red, slate, or a *-soft tint such as blue-soft; see list_colors) (#hex only if the user asked for an exact color). Use ONE color per domain/area so related tables read together. Unset: tables connected by relationships automatically share a color per group.',
    ),
  note: z.string().optional(),
  columns: z.array(specColumn),
});
const specRelationship = z.object({
  from: z.string().describe("'table.column' on the referenced (\"one\", usually primary key) side."),
  to: z.string().describe("'table.column' on the referencing (\"many\", foreign key) side."),
  type: relType.optional().describe('Default ONE_TO_MANY.'),
  onDelete: z.string().optional().describe("e.g. 'CASCADE', 'SET NULL', 'RESTRICT'."),
  onUpdate: z.string().optional(),
});
const specMessage = z.object({
  from: z.string().describe('Participant name.'),
  to: z.string().describe('Participant name (same as from = self call).'),
  label: z.string().optional(),
  style: z.enum(['solid', 'dashed', 'break']).optional().describe('solid = call, dashed = return/async, break = divider label.'),
  color: z.string().optional().describe('Arrow color (palette name (swatch; #hex only if the user asked for an exact color)). Leave unset unless it carries meaning (e.g. red for the error path).'),
  morph: z
    .string()
    .max(60)
    .optional()
    .describe('Morph tag: on a presentation, the same tag on the next slide animates into this message even if it is reworded or moved. Leave unset - matching by wording works for most messages.'),
});
const specParticipant = z.union([
  z.string(),
  z.object({
    name: z.string(),
    color: z
      .string()
      .optional()
      .describe('Header color (palette name (swatch; #hex only if the user asked for an exact color)). One color per system boundary, e.g. clients blue, services violet, data stores slate.'),
    lineColor: z.string().optional().describe('Color of the dashed line under the header.'),
    strokeColor: z.string().optional().describe('Header border (palette name). Unset: no border.'),
    textColor: z.string().optional().describe('Header label color (palette name). Unset: automatic - theme text on swatches.'),
    morph: z
      .string()
      .max(60)
      .optional()
      .describe('Morph tag: pairs this participant with the same tag on the next slide even if it is renamed.'),
  }),
]);
const specSequence = z.object({
  title: z.string().optional().describe('What the diagram shows (drawn at its top-left). Always give one.'),
  participants: z
    .array(specParticipant)
    .describe('Left-to-right order: names, or {name, color, lineColor, strokeColor, textColor, morph} objects.'),
  messages: z.array(specMessage).describe('Top-to-bottom order.'),
  background: z
    .string()
    .optional()
    .describe('Diagram box background (palette name (swatch; #hex only if the user asked for an exact color)); prefer a soft tint or white. Text color adapts.'),
  morph: z.string().max(60).optional().describe('Morph tag pairing this whole diagram with the same tag on the next slide.'),
});
const diagramSpec = z.object({
  tables: z.array(specTable).optional(),
  relationships: z.array(specRelationship).optional(),
  sequenceDiagrams: z.array(specSequence).optional(),
});

// --- Plumbing --------------------------------------------------------------------

type Json = object;

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

function failure(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  const message =
    err instanceof UserError || err instanceof ApiError
      ? err.message
      : `Unexpected error: ${(err as Error)?.message ?? String(err)}`;
  return { isError: true, content: [{ type: 'text', text: message }] };
}

interface Hints {
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
}

/** Tools whose writes are not recorded for undo (undo itself; new projects). */
const UNJOURNALED = new Set(['undo_last_change', 'create_project']);

export function registerTools(server: McpServer, api: DevDesignerApi): void {
  const journal = new Journal();
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    hints: Hints,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<Json | string | RichResult>,
  ): void {
    server.registerTool(
      name,
      {
        description,
        inputSchema: shape,
        annotations: {
          readOnlyHint: hints.readOnly ?? false,
          destructiveHint: hints.destructive ?? false,
          idempotentHint: hints.idempotent ?? false,
          openWorldHint: false,
        },
      },
      (async (args: unknown) => {
        // Record before/after of every write for undo_last_change (per project).
        const pid = (args as { projectId?: unknown })?.projectId;
        const track = !hints.readOnly && typeof pid === 'string' && !UNJOURNALED.has(name);
        let before: ProjectGraphResponse['schema'] | undefined;
        const started = Date.now();
        let ok = true;
        try {
          if (track) before = (await graph(pid as string)).schema;
          const result = await run(args as z.infer<z.ZodObject<S>>);
          return isRich(result) ? { content: result.__rich } : text(result);
        } catch (err) {
          ok = false;
          return failure(err);
        } finally {
          // stderr only: stdout is the stdio MCP transport.
          process.stderr.write(`${JSON.stringify({ tool: name, ms: Date.now() - started, ok })}\n`);
          if (track && before) {
            try {
              const after = (await graph(pid as string)).schema;
              if (schemaChanged(before, after)) {
                journal.push(pid as string, { tool: name, at: new Date().toISOString(), before, after });
              }
            } catch {
              // journaling is best-effort
            }
          }
        }
      }) as never,
    );
  }

  const graph = (id: string): Promise<ProjectGraphResponse> =>
    api.get<ProjectGraphResponse>(`/projects/${id}`);

  // ---- Projects ---------------------------------------------------------------

  tool(
    'list_projects',
    'List the projects this token can access (id, name, type, timestamps).',
    { archived: z.boolean().optional().describe('List archived projects instead.') },
    { readOnly: true },
    async ({ archived }) => {
      const rows = await api.get<ProjectSummary[]>(`/projects${archived ? '?archived=true' : ''}`);
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        description: p.description,
        updatedAt: p.updatedAt,
      }));
    },
  );

  tool(
    'create_project',
    'Create an empty project. type: ERD (database schema, default), FLOW (flow/sequence), SCRATCH (free drawing).',
    {
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(PROJECT_TYPES as unknown as [string, ...string[]]).optional(),
    },
    {},
    async (args) => {
      const p = await api.post<ProjectSummary>('/projects', args);
      return { id: p.id, name: p.name, type: p.type };
    },
  );

  tool(
    'get_project_summary',
    'Compact overview of a project: tables with columns (names, types, flags, ids), relationships ("table.column" form), sequence diagrams with participants/messages, and a short list of drawing elements. Call this before editing an existing project.',
    { projectId },
    { readOnly: true },
    async ({ projectId: id }) => summarizeProject(await graph(id)),
  );

  tool(
    'export_project_json',
    'Export the whole project as the app\'s portable JSON file format (large; prefer get_project_summary unless you need a backup or to copy a project).',
    { projectId },
    { readOnly: true },
    async ({ projectId: id }) => api.get<ProjectExportFile>(`/projects/${id}/export-file`),
  );

  tool(
    'import_project_json',
    'Import a project JSON file (as produced by export_project_json or the app\'s Export). With projectId, merges its content into that project (placed below existing content); without it, creates a new project.',
    {
      file: z.record(z.string(), z.unknown()).describe('The parsed project export file.'),
      projectId: projectId.optional(),
    },
    {},
    async ({ file: rawFile, projectId: id }) => {
      // Slides of a presentation must share one spot; a hand-made file often lays them
      // out side by side, which makes the slide panels jump. Stack them before import.
      const file = rawFile as unknown as ProjectExportFile;
      let restackedSlides = 0;
      if (file && typeof file === 'object' && file.schema && Array.isArray(file.schema.elements)) {
        const stacked = stackSlideFrames(file.schema);
        file.schema = stacked.schema;
        restackedSlides = stacked.moved;
      }
      if (id) {
        const current = await graph(id);
        const rects = schemaRects(current.schema);
        const bottom = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : 0;
        const left = rects.length ? Math.min(...rects.map((r) => r.x)) : 0;
        const res = await api.post<{ mutations: unknown[] }>(`/projects/${id}/import-content`, {
          file,
          anchor: { x: left, y: bottom + 120 },
        });
        return { merged: true, itemsAdded: res.mutations.length, restackedSlides };
      }
      const p = await api.post<ProjectSummary>('/projects/import', file);
      return { merged: false, id: p.id, name: p.name, restackedSlides };
    },
  );

  tool(
    'generate_sql',
    'Generate SQL DDL (CREATE TABLE ... with keys and foreign keys) for the project\'s schema diagram. Currently MySQL.',
    { projectId },
    { readOnly: true },
    async ({ projectId: id }) => generateSql((await graph(id)).schema, { dialect: 'mysql' }),
  );

  // ---- Bulk -------------------------------------------------------------------

  tool(
    'apply_diagram_spec',
    'Create a whole diagram from a declarative description in ONE atomic call, with automatic layout (placed in free space; nothing is moved). Describe tables (columns with types and FK `references`), extra relationships, and/or sequence diagrams (participants + messages) by NAME - no ids or coordinates. Prefer this over many add_* calls. Relationships may point at tables already in the project. Fails without changes if a table name already exists.',
    {
      projectId,
      spec: diagramSpec,
      near: z.string().optional().describe('Existing table name to place the new content beside.'),
      x: z.number().optional().describe('Explicit top-left X (world px); give both x and y to skip auto-placement.'),
      y: z.number().optional(),
    },
    {},
    async ({ projectId: id, spec, near, x, y }) => {
      const hasXY = typeof x === 'number' && typeof y === 'number';
      return applySpec(api, id, spec as never, {
        near,
        placement: hasXY ? { x, y } : 'auto',
      }) as unknown as Json;
    },
  );

  // ---- Schema diagram ---------------------------------------------------------

  tool(
    'add_table',
    'Add one table (optionally with columns) at an auto-chosen free position. Columns may use `references: "table.column"` to create foreign-key relationships.',
    {
      projectId,
      name: z.string(),
      columns: z.array(specColumn).optional(),
      color: specTable.shape.color,
      note: z.string().optional(),
      near: z.string().optional().describe('Existing table name to place this one beside.'),
    },
    {},
    async ({ projectId: id, name, columns, color, note, near }) =>
      applySpec(
        api,
        id,
        { tables: [{ name, columns: (columns ?? []) as never, color: tableColorArg(color, 'the table header'), note }] },
        { near },
      ) as unknown as Json,
  );

  tool(
    'update_table',
    'Rename a table or change its header color (palette name (swatch; #hex only if the user asked for an exact color); empty string removes it) / note.',
    {
      projectId,
      table: z.string().describe('Table name or id.'),
      name: z.string().optional(),
      color: z.string().optional().describe('Palette name (swatch; #hex only if the user asked for an exact color); empty string removes the color.'),
      note: z.string().optional(),
    },
    { idempotent: true },
    async ({ projectId: id, table, name, color, note }) => {
      const t = findTable((await graph(id)).schema, table);
      const updated = await api.patch<TableModel>(`/tables/${t.id}`, {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color: tableColorArg(color, 'the table header') } : {}),
        ...(note !== undefined ? { note } : {}),
      });
      return { id: updated.id, name: updated.name };
    },
  );

  tool(
    'delete_table',
    'Permanently delete a table, its columns, and relationships that touch them.',
    { projectId, table: z.string().describe('Table name or id.'), confirm },
    { destructive: true },
    async ({ projectId: id, table }) => {
      const t = findTable((await graph(id)).schema, table);
      await api.delete(`/tables/${t.id}`);
      return { deleted: t.name };
    },
  );

  tool(
    'add_column',
    'Add a column to an existing table; optionally a foreign key via `references: "table.column"`.',
    {
      projectId,
      table: z.string().describe('Table name or id.'),
      name: z.string(),
      ...columnFields,
      references: z.string().optional().describe("'table.column' this column references."),
    },
    {},
    async ({ projectId: id, table, name, references, ...rest }) => {
      const schema = (await graph(id)).schema;
      const t = findTable(schema, table);
      if (t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new UserError(`Table "${t.name}" already has a column "${name}".`);
      }
      const target = references ? findColumn(schema, references) : null;
      const column = await api.post<ColumnModel>(`/tables/${t.id}/columns`, {
        name,
        dataType: parseDataType(rest.type),
        ...(isUnsignedType(rest.type) ? { isUnsigned: true } : {}),
        ...(rest.primaryKey !== undefined ? { isPrimaryKey: rest.primaryKey } : {}),
        ...(rest.nullable !== undefined ? { isNullable: rest.nullable } : {}),
        ...(rest.unique !== undefined ? { isUnique: rest.unique } : {}),
        ...(rest.autoIncrement !== undefined ? { isAutoIncrement: rest.autoIncrement } : {}),
        ...(rest.default !== undefined ? { defaultValue: rest.default } : {}),
      });
      let relationshipId: string | undefined;
      if (target) {
        const rel = await api.post<RelationshipModel>(`/projects/${id}/relationships`, {
          sourceColumnId: target.column.id,
          targetColumnId: column.id,
          type: 'ONE_TO_MANY',
        });
        relationshipId = rel.id;
      }
      return { table: t.name, column: { id: column.id, name: column.name }, relationshipId: relationshipId ?? null };
    },
  );

  tool(
    'update_column',
    'Change a column: rename, retype, or toggle key/null/unique/auto-increment/default/note.',
    {
      projectId,
      table: z.string().describe('Table name or id.'),
      column: z.string().describe('Column name or id.'),
      newName: z.string().optional(),
      ...columnFields,
    },
    { idempotent: true },
    async ({ projectId: id, table, column, newName, ...rest }) => {
      const t = findTable((await graph(id)).schema, table);
      const c = findColumnIn(t, column);
      const updated = await api.patch<ColumnModel>(`/columns/${c.id}`, {
        ...(newName !== undefined ? { name: newName } : {}),
        ...(rest.type !== undefined
          ? { dataType: parseDataType(rest.type), isUnsigned: isUnsignedType(rest.type) }
          : {}),
        ...(rest.primaryKey !== undefined ? { isPrimaryKey: rest.primaryKey } : {}),
        ...(rest.nullable !== undefined ? { isNullable: rest.nullable } : {}),
        ...(rest.unique !== undefined ? { isUnique: rest.unique } : {}),
        ...(rest.autoIncrement !== undefined ? { isAutoIncrement: rest.autoIncrement } : {}),
        ...(rest.default !== undefined ? { defaultValue: rest.default } : {}),
        ...(rest.note !== undefined ? { note: rest.note } : {}),
      });
      return { table: t.name, column: { id: updated.id, name: updated.name } };
    },
  );

  tool(
    'delete_column',
    'Permanently delete a column (and relationships/indexes using it).',
    { projectId, table: z.string(), column: z.string(), confirm },
    { destructive: true },
    async ({ projectId: id, table, column }) => {
      const t = findTable((await graph(id)).schema, table);
      const c = findColumnIn(t, column);
      await api.delete(`/columns/${c.id}`);
      return { deleted: `${t.name}.${c.name}` };
    },
  );

  tool(
    'add_relationship',
    "Connect two columns. `from` is the referenced (\"one\"/primary-key) side and `to` the referencing (\"many\"/foreign-key) side, both as 'table.column'. Type defaults to ONE_TO_MANY.",
    {
      projectId,
      from: z.string(),
      to: z.string(),
      type: relType.optional(),
      onDelete: z.string().optional(),
      onUpdate: z.string().optional(),
    },
    {},
    async ({ projectId: id, from, to, type, onDelete, onUpdate }) => {
      const schema = (await graph(id)).schema;
      const source = findColumn(schema, from);
      const target = findColumn(schema, to);
      const rel = await api.post<RelationshipModel>(`/projects/${id}/relationships`, {
        sourceColumnId: source.column.id,
        targetColumnId: target.column.id,
        type: type ?? 'ONE_TO_MANY',
        ...(onDelete ? { onDelete } : {}),
        ...(onUpdate ? { onUpdate } : {}),
      });
      return {
        id: rel.id,
        from: `${source.table.name}.${source.column.name}`,
        to: `${target.table.name}.${target.column.name}`,
        type: rel.type,
      };
    },
  );

  tool(
    'delete_relationship',
    "Delete a relationship, identified by its id or by its endpoints ('table.column' from/to).",
    {
      projectId,
      relationshipId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      confirm,
    },
    { destructive: true },
    async ({ projectId: id, relationshipId, from, to }) => {
      const schema = (await graph(id)).schema;
      let relId = relationshipId;
      if (!relId) {
        if (!from || !to) {
          throw new UserError('Provide relationshipId, or both from and to.');
        }
        const a = findColumn(schema, from).column.id;
        const b = findColumn(schema, to).column.id;
        const hit = schema.relationships.find(
          (r) => r.sourceColumnId === a && r.targetColumnId === b,
        );
        if (!hit) throw new UserError(`No relationship from ${from} to ${to}.`);
        relId = hit.id;
      }
      await api.delete(`/relationships/${relId}`);
      return { deleted: relId };
    },
  );

  // ---- Sequence diagrams --------------------------------------------------------

  tool(
    'create_sequence_diagram',
    'Create a sequence diagram from participants (left to right) and messages (top to bottom, by participant name). Placed in free space. Returns the diagram id for later add_message calls.',
    { projectId, ...specSequence.shape },
    {},
    async ({ projectId: id, title, participants, messages, background, morph }) =>
      applySpec(api, id, {
        sequenceDiagrams: [{ title, participants, messages, background, morph }],
      }) as unknown as Json,
  );

  tool(
    'set_sequence_diagram_title',
    "Set or clear (empty string) a sequence diagram's title, drawn at its top-left.",
    { projectId, diagramId: z.string(), title: z.string() },
    { idempotent: true },
    async ({ projectId: id, diagramId, title }) => {
      findDiagram((await graph(id)).schema, diagramId);
      await api.patch(`/projects/${id}/sequence-diagrams/${diagramId}`, { title });
      return { diagramId, title };
    },
  );

  tool(
    'add_participant',
    'Add a participant (lifeline) to the right of the existing ones in a sequence diagram.',
    {
      projectId,
      diagramId: z.string(),
      name: z.string(),
      color: z.string().optional().describe('Header color: palette name (swatch; #hex only if the user asked for an exact color).'),
      lineColor: z.string().optional(),
      strokeColor: z.string().optional().describe('Header border (palette name). Unset: no border.'),
      textColor: z.string().optional().describe('Header label color (palette name). Unset: automatic - theme text on swatches.'),
      morph: z.string().max(60).optional().describe('Morph tag (see create_presentation).'),
    },
    {},
    async ({ projectId: id, diagramId, name, color, lineColor, strokeColor, textColor, morph }) => {
      const schema = (await graph(id)).schema;
      const diagram = findDiagram(schema, diagramId);
      const own = schema.lifelines.filter((l) => l.diagramId === diagramId);
      const x = own.length
        ? Math.max(...own.map((l) => l.x)) + diagram.lifelineSpacing
        : Math.round(findFreeSpot(schemaRects(schema), 120, 200).x + SEQUENCE_DEFAULTS.lifelineWidth / 2);
      const created = await api.post<LifelineModel>(`/projects/${id}/lifelines`, {
        diagramId,
        label: name,
        x,
        order: own.length,
        ...(color ? { color: colorArg(color, 'the participant header') } : {}),
        ...(lineColor ? { lineColor: colorArg(lineColor, 'the participant line') } : {}),
        ...(strokeColor ? { strokeColor: colorArg(strokeColor, 'the participant stroke') } : {}),
        ...(textColor ? { textColor: colorArg(textColor, 'the participant text') } : {}),
        ...(morph?.trim() ? { morphId: morphIdForTag(morph) ?? undefined } : {}),
      });
      return { id: created.id, name: created.label };
    },
  );

  tool(
    'update_participant',
    "Rename a participant of a sequence diagram or change its header color, header stroke/text color, line color or morph tag. Empty strings clear a color/tag.",
    {
      projectId,
      diagramId: z.string(),
      participant: z.string().describe('Participant name or id.'),
      name: z.string().optional(),
      color: z.string().optional().describe('Header color: palette name (swatch; #hex only if the user asked for an exact color); empty string clears.'),
      lineColor: z.string().optional(),
      strokeColor: z.string().optional().describe('Header border (palette name). Unset: no border.'),
      textColor: z.string().optional().describe('Header label color (palette name). Unset: automatic - theme text on swatches.'),
      morph: z
        .string()
        .max(60)
        .optional()
        .describe('Morph tag pairing this participant with the same tag on the next slide even if renamed. Empty string clears (automatic matching by name).'),
      isolate: z.boolean().optional().describe('Give it a unique tag so it never morphs into a participant of the next slide.'),
    },
    { idempotent: true },
    async ({ projectId: id, diagramId, participant, name, color, lineColor, strokeColor, textColor, morph, isolate }) => {
      const schema = (await graph(id)).schema;
      const l = findLifeline(schema, diagramId, participant);
      const tag = isolate ? soloMorphId() : morph !== undefined ? (morphIdForTag(morph) ?? '') : undefined;
      await api.patch(`/projects/${id}/lifelines/${l.id}`, {
        ...(name !== undefined ? { label: name } : {}),
        ...(color !== undefined ? { color: colorArg(color, 'the participant header') } : {}),
        ...(lineColor !== undefined ? { lineColor: colorArg(lineColor, 'the participant line') } : {}),
        ...(strokeColor !== undefined ? { strokeColor: colorArg(strokeColor, 'the participant stroke') } : {}),
        ...(textColor !== undefined ? { textColor: colorArg(textColor, 'the participant text') } : {}),
        ...(tag !== undefined ? { morphId: tag } : {}),
      });
      return { id: l.id, name: name ?? l.label };
    },
  );

  tool(
    'update_sequence_diagram',
    "Change a sequence diagram's title, background color or morph tag.",
    {
      projectId,
      diagramId: z.string(),
      title: z.string().optional().describe('Empty string clears it.'),
      background: z.string().optional().describe('Palette name (swatch; #hex only if the user asked for an exact color) (prefer soft tints / white); empty string clears.'),
      morph: z.string().max(60).optional().describe('Morph tag pairing this diagram with the same tag on the next slide. Empty string clears.'),
      isolate: z.boolean().optional().describe('Give it a unique tag so it never morphs into a diagram of the next slide.'),
    },
    { idempotent: true },
    async ({ projectId: id, diagramId, title, background, morph, isolate }) => {
      findDiagram((await graph(id)).schema, diagramId);
      const tag = isolate ? soloMorphId() : morph !== undefined ? (morphIdForTag(morph) ?? '') : undefined;
      await api.patch(`/projects/${id}/sequence-diagrams/${diagramId}`, {
        ...(title !== undefined ? { title } : {}),
        ...(background !== undefined ? { backgroundColor: colorArg(background, 'the diagram background') } : {}),
        ...(tag !== undefined ? { morphId: tag } : {}),
      });
      return { diagramId, updated: true };
    },
  );

  tool(
    'add_message',
    'Append a message row to a sequence diagram between two participants (by name or id).',
    {
      projectId,
      diagramId: z.string(),
      from: z.string(),
      to: z.string(),
      label: z.string().optional(),
      style: z.enum(['solid', 'dashed', 'break']).optional(),
      color: z.string().optional().describe('Arrow color: palette name (swatch; #hex only if the user asked for an exact color).'),
      wrap: z.boolean().optional().describe('Auto-wrap the label to the message width (default on).'),
      morph: z.string().max(60).optional().describe('Morph tag (see create_presentation).'),
    },
    {},
    async ({ projectId: id, diagramId, from, to, label, style, color, wrap, morph }) => {
      const schema = (await graph(id)).schema;
      const diagram = findDiagram(schema, diagramId);
      const a = findLifeline(schema, diagramId, from);
      const b = findLifeline(schema, diagramId, to);
      if (a.id === b.id && style !== 'break') {
        throw new UserError(
          `A message must go between two different participants (both are "${a.label}"). Use style 'break' for a label-only divider.`,
        );
      }
      const ys = schema.sequenceMessages.filter((m) => m.diagramId === diagramId).map((m) => m.y);
      const y = ys.length
        ? Math.max(...ys) + diagram.rowSpacing
        : diagram.originY + diagram.headerHeight + diagram.rowSpacing;
      const m = await api.post<SequenceMessageModel>(`/projects/${id}/messages`, {
        diagramId,
        fromLifelineId: a.id,
        toLifelineId: b.id,
        y,
        ...(label !== undefined ? { label } : {}),
        ...(style ? { style, arrowhead: style === 'dashed' ? 'open' : 'arrow' } : {}),
        ...(color ? { color: colorArg(color, 'the message arrow') } : {}),
        ...(wrap !== undefined ? { wrap } : {}),
        ...(morph?.trim() ? { morphId: morphIdForTag(morph) ?? undefined } : {}),
      });
      return { id: m.id, from: a.label, to: b.label, label: m.label ?? '' };
    },
  );

  tool(
    'update_message',
    'Edit a message: change its label, style, or endpoints (participant names or ids).',
    {
      projectId,
      messageId: z.string(),
      label: z.string().optional(),
      style: z.enum(['solid', 'dashed', 'break']).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      color: z.string().optional().describe('Arrow color: palette name (swatch; #hex only if the user asked for an exact color); empty string clears.'),
      wrap: z.boolean().optional().describe('Auto-wrap the label to the message width (default on).'),
      morph: z
        .string()
        .max(60)
        .optional()
        .describe('Morph tag pairing this message with the same tag on the next slide even if reworded or re-routed. Empty string clears (automatic matching).'),
      isolate: z.boolean().optional().describe('Give it a unique tag so it never morphs into a message of the next slide.'),
    },
    { idempotent: true },
    async ({ projectId: id, messageId, label, style, from, to, color, wrap, morph, isolate }) => {
      const schema = (await graph(id)).schema;
      const msg = schema.sequenceMessages.find((m) => m.id === messageId);
      if (!msg) throw new UserError(`No message "${messageId}".`);
      const newFrom = from ? findLifeline(schema, msg.diagramId, from).id : msg.fromLifelineId;
      const newTo = to ? findLifeline(schema, msg.diagramId, to).id : msg.toLifelineId;
      if (newFrom === newTo && (style ?? msg.style) !== 'break') {
        throw new UserError('A message must go between two different participants.');
      }
      const updated = await api.patch<SequenceMessageModel>(`/projects/${id}/messages/${messageId}`, {
        ...(label !== undefined ? { label } : {}),
        ...(style ? { style, arrowhead: style === 'dashed' ? 'open' : 'arrow' } : {}),
        ...(from ? { fromLifelineId: findLifeline(schema, msg.diagramId, from).id } : {}),
        ...(to ? { toLifelineId: findLifeline(schema, msg.diagramId, to).id } : {}),
        ...(color !== undefined ? { color: colorArg(color, 'the message arrow') } : {}),
        ...(wrap !== undefined ? { wrap } : {}),
        ...(isolate
          ? { morphId: soloMorphId() }
          : morph !== undefined
            ? { morphId: morphIdForTag(morph) ?? '' }
            : {}),
      });
      return { id: updated.id, label: updated.label ?? '', style: updated.style };
    },
  );

  tool(
    'reorder_messages',
    'Set the top-to-bottom order of a diagram\'s messages. Give ALL its message ids in the new order.',
    { projectId, diagramId: z.string(), orderedMessageIds: z.array(z.string()) },
    { idempotent: true },
    async ({ projectId: id, diagramId, orderedMessageIds }) => {
      const schema = (await graph(id)).schema;
      findDiagram(schema, diagramId);
      const own = schema.sequenceMessages.filter((m) => m.diagramId === diagramId);
      const same =
        own.length === orderedMessageIds.length &&
        orderedMessageIds.every((mid) => own.some((m) => m.id === mid));
      if (!same) {
        throw new UserError(
          `orderedMessageIds must list exactly this diagram's messages: ${own.map((m) => m.id).join(', ')}.`,
        );
      }
      const slots = own.map((m) => m.y).sort((a, b) => a - b);
      const batch = new Batch();
      for (const [i, mid] of orderedMessageIds.entries()) batch.set('messages', mid, { y: slots[i] });
      await batch.send(api, id);
      return { reordered: orderedMessageIds.length };
    },
  );

  // ---- Drawing layer ------------------------------------------------------------

  const baseStyle = {
    angle: 0,
    strokeColor: '#1e1e1e',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
  } as const;

  const placeBox = (
    schema: ProjectGraphResponse['schema'],
    w: number,
    h: number,
    near: string | undefined,
    x: number | undefined,
    y: number | undefined,
  ): { x: number; y: number } => {
    if (typeof x === 'number' && typeof y === 'number') return { x, y };
    let nearRect;
    if (near) {
      const target = findTarget(schema, near);
      nearRect = target.kind === 'table' ? tableRect(target.table) : elementRect(target.element);
    }
    return findFreeSpot(schemaRects(schema), w, h, { near: nearRect, gap: 40 });
  };

  tool(
    'add_shape',
    'Add a rectangle, ellipse or diamond (optionally labelled) to the canvas. Position is auto-chosen free space unless x/y or near is given. Returns its id for add_arrow.',
    {
      projectId,
      shape: z.enum(['rectangle', 'ellipse', 'diamond']),
      text: z.string().optional().describe('Label centered in the shape.'),
      width: z.number().optional().describe('Default 180.'),
      height: z.number().optional().describe('Default 90.'),
      x: z.number().optional(),
      y: z.number().optional(),
      near: z.string().optional().describe('Table name or element id to place beside.'),
      strokeColor: z.string().optional().describe('Outline color: palette name (swatch; #hex only if the user asked for an exact color).'),
      backgroundColor: z.string().optional().describe('Solid fill: palette name (soft tints read best; #hex only if the user asked for an exact color).'),
    },
    {},
    async ({ projectId: id, shape, text: label, width, height, x, y, near, strokeColor, backgroundColor }) => {
      const w = width ?? 180;
      const h = height ?? 90;
      const schema = (await graph(id)).schema;
      const pos = placeBox(schema, w, h, near, x, y);
      const el = await api.post<CanvasElementModel>(`/projects/${id}/elements`, {
        ...baseStyle,
        type: shape,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: w,
        height: h,
        ...(strokeColor ? { strokeColor: colorArg(strokeColor, 'the outline') } : {}),
        ...(backgroundColor
          ? { backgroundColor: colorArg(backgroundColor, 'the fill'), fillStyle: 'solid' }
          : {}),
        ...(label
          ? { text: label, fontSize: 18, fontFamily: 'normal', textAlign: 'center', verticalAlign: 'middle' }
          : {}),
      });
      return { id: el.id, type: el.type, x: el.x, y: el.y, width: el.width, height: el.height };
    },
  );

  tool(
    'add_text',
    'Add a free text block to the canvas (use \\n for line breaks).',
    {
      projectId,
      text: z.string(),
      fontSize: z.number().optional().describe('Default 20.'),
      color: z.string().optional().describe('Text color: palette name (swatch; #hex only if the user asked for an exact color).'),
      x: z.number().optional(),
      y: z.number().optional(),
      near: z.string().optional(),
    },
    {},
    async ({ projectId: id, text: content, fontSize, color, x, y, near }) => {
      const size = fontSize ?? 20;
      const box = estimateTextSize(content, size);
      const schema = (await graph(id)).schema;
      const pos = placeBox(schema, box.width, box.height, near, x, y);
      const el = await api.post<CanvasElementModel>(`/projects/${id}/elements`, {
        ...baseStyle,
        type: 'text',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: box.width,
        height: box.height,
        text: content,
        fontSize: size,
        fontFamily: 'normal',
        textAlign: 'left',
        ...(color ? { strokeColor: colorArg(color, 'the text') } : {}),
      });
      return { id: el.id, x: el.x, y: el.y };
    },
  );

  tool(
    'add_arrow',
    'Draw an arrow (or plain line) between two things. `from`/`to` are table names or drawing-element ids; the arrow is bound so it follows them when moved. Alternatively give explicit coordinates x1,y1 -> x2,y2.',
    {
      projectId,
      from: z.string().optional(),
      to: z.string().optional(),
      x1: z.number().optional(),
      y1: z.number().optional(),
      x2: z.number().optional(),
      y2: z.number().optional(),
      line: z.boolean().optional().describe('Plain line without an arrowhead.'),
      strokeColor: z.string().optional().describe('Palette name (swatch; #hex only if the user asked for an exact color).'),
      dashed: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, from, to, x1, y1, x2, y2, line, strokeColor, dashed }) => {
      const schema = (await graph(id)).schema;
      type End = {
        rect?: ReturnType<typeof tableRect>;
        point?: { x: number; y: number };
        binding?: { targetKind: 'table' | 'element'; targetId: string };
      };
      const resolve = (ref: string | undefined, px?: number, py?: number): End => {
        if (ref) {
          const t = findTarget(schema, ref);
          return t.kind === 'table'
            ? { rect: tableRect(t.table), binding: { targetKind: 'table', targetId: t.table.id } }
            : { rect: elementRect(t.element), binding: { targetKind: 'element', targetId: t.element.id } };
        }
        if (typeof px === 'number' && typeof py === 'number') return { point: { x: px, y: py } };
        throw new UserError('Give from/to references or explicit x1,y1,x2,y2 coordinates.');
      };
      const a = resolve(from, x1, y1);
      const b = resolve(to, x2, y2);
      const center = (e: End) =>
        e.point ?? { x: e.rect!.x + e.rect!.w / 2, y: e.rect!.y + e.rect!.h / 2 };
      const aRect = a.rect ?? { x: center(a).x, y: center(a).y, w: 0, h: 0 };
      const bRect = b.rect ?? { x: center(b).x, y: center(b).y, w: 0, h: 0 };
      const start = a.rect ? edgePoint(aRect, bRect) : a.point!;
      const end = b.rect ? edgePoint(bRect, aRect) : b.point!;
      const dx = Math.round(end.x - start.x);
      const dy = Math.round(end.y - start.y);
      const el = await api.post<CanvasElementModel>(`/projects/${id}/elements`, {
        ...baseStyle,
        type: line ? 'line' : 'arrow',
        x: Math.round(start.x),
        y: Math.round(start.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: [
          { x: 0, y: 0 },
          { x: dx, y: dy },
        ],
        ...(strokeColor ? { strokeColor: colorArg(strokeColor, 'the arrow') } : {}),
        ...(dashed ? { strokeStyle: 'dashed' } : {}),
        ...(a.binding ? { startBinding: a.binding } : {}),
        ...(b.binding ? { endBinding: b.binding } : {}),
        ...(line ? { endArrowhead: 'none' } : {}),
      });
      return { id: el.id, type: el.type };
    },
  );

  tool(
    'move_element',
    'Move ONE drawing element (by id) or table (by name or id) so its top-left is at x,y. To move several things use move_items; to line them up use align_items / distribute_items / arrange_grid.',
    { projectId, target: z.string(), x: z.number(), y: z.number() },
    { idempotent: true },
    async ({ projectId: id, target, x, y }) => {
      const current = (await graph(id)).schema;
      const t = findTarget(current, target);
      if (t.kind === 'element' && t.element.type === 'frame' && t.element.slide) {
        // Slides are locked together: moving one frame moves the whole presentation.
        const name = presentationOf(t.element);
        const after = shiftPresentation(current, name, x - t.element.x, y - t.element.y);
        const writes = await applyLayoutDiff(api, id, current, after);
        return { movedPresentation: name, x, y, writes };
      }
      if (t.kind === 'table') {
        await api.patch(`/tables/${t.table.id}/position`, { x, y });
        return { moved: t.table.name, x, y };
      }
      await api.patch(`/elements/${t.element.id}/position`, { x, y });
      return { moved: t.element.id, x, y };
    },
  );

  tool(
    'delete_element',
    'Permanently delete a drawing element (shape, text, arrow...) by id. Use delete_table for tables.',
    { projectId, elementId: z.string(), confirm },
    { destructive: true },
    async ({ projectId: id, elementId }) => {
      const schema = (await graph(id)).schema;
      if (!schema.elements.some((e) => e.id === elementId)) {
        throw new UserError(`No drawing element "${elementId}" in this project.`);
      }
      await api.delete(`/elements/${elementId}`);
      return { deleted: elementId };
    },
  );

  tool(
    'add_image',
    "Add an image or an SVG drawing to the canvas (it is uploaded to the project, so it persists and exports). Give exactly one source: `svg` (inline <svg> markup you write - ideal for icons, logos and simple illustrations; include a viewBox), `data` (base64 PNG/JPEG/GIF/WebP/SVG with `mimeType`), `filePath` (a file on the machine running this MCP server) or `url` (http/https download). Max 5 MB. Scripts, event handlers and external references in SVG are rejected. Position is auto-chosen free space unless x/y or near is given. To put an image on a presentation slide use add_to_slide / create_presentation with an image item instead.",
    {
      projectId,
      svg: z.string().optional().describe('Inline SVG markup, e.g. <svg viewBox="0 0 24 24"><path d="..."/></svg>.'),
      data: z.string().optional().describe('Base64 file contents (a data: URL also works).'),
      mimeType: z.string().optional().describe('image/png, image/jpeg, image/gif, image/webp or image/svg+xml (needed with plain base64 data).'),
      filePath: z.string().optional().describe('Absolute path of an image file (.png/.jpg/.jpeg/.gif/.webp/.svg) on the MCP server machine; reads a local file, and its bytes must be a real image.'),
      url: z.string().optional().describe('http(s) URL of an image to download.'),
      width: z.number().min(8).max(4000).optional().describe('Canvas width in px; height follows the aspect ratio unless given too. Default: natural size, at most 480x400.'),
      height: z.number().min(8).max(4000).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      near: z.string().optional().describe('Table name or element id to place beside.'),
    },
    {},
    async ({ projectId: id, svg, data, mimeType, filePath, url, width, height, x, y, near }) => {
      const img = await loadImage({ svg, data, mimeType, filePath, url });
      const natural = img.size ?? { width: 320, height: 240 };
      let w: number;
      let h: number;
      if (width && height) {
        w = width;
        h = height;
      } else if (width || height) {
        const scale = width ? width / natural.width : (height as number) / natural.height;
        w = Math.round(natural.width * scale);
        h = Math.round(natural.height * scale);
      } else {
        const fitted = fitWithin(natural, 480, 400);
        w = fitted.width;
        h = fitted.height;
      }
      const file = await api.post<{ id: string }>(`/projects/${id}/images`, {
        mimeType: img.mimeType,
        data: img.data,
      });
      const schema = (await graph(id)).schema;
      const pos = placeBox(schema, w, h, near, x, y);
      const el = await api.post<CanvasElementModel>(`/projects/${id}/elements`, {
        ...baseStyle,
        type: 'image',
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: w,
        height: h,
        fileId: file.id,
      });
      return { id: el.id, fileId: file.id, x: el.x, y: el.y, width: el.width, height: el.height, mimeType: img.mimeType };
    },
  );

  tool(
    'list_colors',
    'The named color palette (strong header colors, soft tints, neutrals) and which role each tone suits: table headers, participant headers, message arrows, diagram backgrounds, shape fills. Every color argument accepts these names; prefer them - a #hex only when the user asked for an exact color.',
    {},
    { readOnly: true },
    async () => describePalette(),
  );

  // ---- Helpers --------------------------------------------------------------------

  tool(
    'auto_layout',
    'Re-arrange ALL tables of the schema diagram into a clean layered layout (related tables adjacent, no overlaps), keeping the top-left corner where it is. Only table positions change. Use after bulk edits or on a messy diagram - it will move tables the user placed by hand.',
    { projectId },
    { idempotent: true },
    async ({ projectId: id }) => {
      const { schema } = await graph(id);
      if (schema.tables.length === 0) return { moved: 0 };
      const tableOf = new Map<string, string>();
      for (const t of schema.tables) for (const c of t.columns) tableOf.set(c.id, t.id);
      const edges: Array<[string, string]> = [];
      for (const r of schema.relationships) {
        const a = tableOf.get(r.sourceColumnId);
        const b = tableOf.get(r.targetColumnId);
        if (a && b) edges.push([a, b]);
      }
      const pos = layoutGraph(
        schema.tables.map((t) => ({
          key: t.id,
          w: estimateTableWidth(t.name, t.columns, t.width),
          h: estimateTableHeight(t.columns.length),
        })),
        edges,
      );
      const ox = Math.min(...schema.tables.map((t) => t.x));
      const oy = Math.min(...schema.tables.map((t) => t.y));
      for (const t of schema.tables) {
        const p = pos.get(t.id)!;
        await api.patch(`/tables/${t.id}/position`, {
          x: Math.round(ox + p.x),
          y: Math.round(oy + p.y),
        });
      }
      return { moved: schema.tables.length };
    },
  );

  tool(
    'validate_project',
    'Check the schema for problems: dangling or duplicate relationships, duplicate table/column names, tables without columns or a primary key, mismatched foreign-key types, invalid identifiers. Returns issues by severity.',
    { projectId },
    { readOnly: true },
    async ({ projectId: id }) => {
      const { schema } = await graph(id);
      const label = new Map<string, string>();
      for (const t of schema.tables) {
        label.set(t.id, t.name);
        for (const c of t.columns) label.set(c.id, `${t.name}.${c.name}`);
      }
      const issues = validateSchema(schema).map((i) => ({
        severity: i.severity,
        message: i.message,
        target: label.get(i.targetId) ?? i.targetId,
      }));
      return {
        ok: !issues.some((i) => i.severity === 'error'),
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
        issues,
      };
    },
  );

  registerPresentationTools(tool, api);
  registerDesignTools(tool, api);
  registerLayoutTools(tool, api);
  registerTableTools(tool, api);
  registerAgentTools(tool, api, journal);
}

// --- Resources & prompts ---------------------------------------------------------

export function registerResourcesAndPrompts(server: McpServer, api: DevDesignerApi): void {
  server.registerResource(
    'projects',
    'devdesigner://projects',
    { description: 'All projects this token can access.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await api.get('/projects'), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'project-json',
    new ResourceTemplate('devdesigner://project/{projectId}/json', { list: undefined }),
    { description: 'A project in the portable export JSON format.', mimeType: 'application/json' },
    async (uri, vars) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await api.get(`/projects/${String(vars.projectId)}/export-file`), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'project-ddl',
    new ResourceTemplate('devdesigner://project/{projectId}/ddl', { list: undefined }),
    { description: "The project's schema as SQL DDL (MySQL).", mimeType: 'text/plain' },
    async (uri, vars) => {
      const g = await api.get<ProjectGraphResponse>(`/projects/${String(vars.projectId)}`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/plain', text: generateSql(g.schema, { dialect: 'mysql' }) },
        ],
      };
    },
  );

  server.registerPrompt(
    'design_database',
    {
      description: 'Design a database schema for a described application and draw it in a project.',
      argsSchema: {
        description: z.string().describe('What the application does / what data it stores.'),
        projectId: z.string().optional().describe('Existing project to draw into; omit to create one.'),
      },
    },
    ({ description, projectId: id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Design a normalized relational database schema for: ${description}\n\n` +
              (id
                ? `Use project ${id} (call get_project_summary first and reuse existing tables).`
                : 'Create a project with create_project first.') +
              '\nThen draw the whole schema with ONE apply_diagram_spec call: sensible primary keys, ' +
              'foreign keys via `references`, appropriate types and constraints. Finish with validate_project ' +
              'and briefly explain the design.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'document_schema',
    {
      description: 'Write documentation for an existing schema diagram.',
      argsSchema: { projectId: z.string() },
    },
    ({ projectId: id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Call get_project_summary for project ${id} and write clear documentation: one section per ` +
              'table (purpose, columns, keys) and a description of how the tables relate. Mention any ' +
              'issues reported by validate_project.',
          },
        },
      ],
    }),
  );
}
