// Pure helpers over the shared schema model: name resolution and the compact
// summaries returned to the model. No network, no MCP types, so they unit-test.

import { colorName, isSoloTag, morphTagOf } from '@dbdesigner/shared';
import type {
  CanvasElementModel,
  ColumnModel,
  DataType,
  LifelineModel,
  ProjectGraphResponse,
  SchemaModel,
  SequenceDiagramModel,
  TableModel,
} from '@dbdesigner/shared';

/** A failure the model can act on (bad name, ambiguous reference...). Shown verbatim. */
export class UserError extends Error {}

/** "VARCHAR(255)", "DECIMAL(10,2)", "ENUM('a','b')" -> display string. */
export function formatDataType(type: DataType): string {
  if (type.length) return `${type.name}(${type.length})`;
  if (type.args?.length) return `${type.name}(${type.args.join(',')})`;
  return type.name;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Resolve a table by id or (case-insensitive) name. */
export function findTable(schema: SchemaModel, ref: string): TableModel {
  const byId = schema.tables.find((t) => t.id === ref);
  if (byId) return byId;
  const matches = schema.tables.filter((t) => norm(t.name) === norm(ref));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new UserError(
      `Table name "${ref}" is ambiguous (${matches.length} tables); use one of these ids: ` +
        matches.map((t) => t.id).join(', '),
    );
  }
  const names = schema.tables.map((t) => t.name).slice(0, 30);
  throw new UserError(
    `No table "${ref}" in this project.` +
      (names.length ? ` Existing tables: ${names.join(', ')}.` : ' The project has no tables yet.'),
  );
}

/** Resolve a column within a table by id or name. */
export function findColumnIn(table: TableModel, ref: string): ColumnModel {
  const hit =
    table.columns.find((c) => c.id === ref) ?? table.columns.find((c) => norm(c.name) === norm(ref));
  if (!hit) {
    throw new UserError(
      `No column "${ref}" in table "${table.name}". Columns: ${table.columns.map((c) => c.name).join(', ') || '(none)'}.`,
    );
  }
  return hit;
}

/** Resolve "table.column" (or a bare column id) anywhere in the project. */
export function findColumn(
  schema: SchemaModel,
  ref: string,
): { table: TableModel; column: ColumnModel } {
  for (const table of schema.tables) {
    const byId = table.columns.find((c) => c.id === ref);
    if (byId) return { table, column: byId };
  }
  const dot = ref.lastIndexOf('.');
  if (dot <= 0 || dot === ref.length - 1) {
    throw new UserError(`"${ref}" must look like "table.column" (or be a column id).`);
  }
  const table = findTable(schema, ref.slice(0, dot));
  return { table, column: findColumnIn(table, ref.slice(dot + 1)) };
}

export function findDiagram(schema: SchemaModel, id: string): SequenceDiagramModel {
  const hit = schema.sequenceDiagrams.find((d) => d.id === id);
  if (!hit) {
    throw new UserError(
      `No sequence diagram "${id}". Existing: ${schema.sequenceDiagrams.map((d) => d.id).join(', ') || '(none)'}.`,
    );
  }
  return hit;
}

/** Resolve a participant of a diagram by id or label. */
export function findLifeline(schema: SchemaModel, diagramId: string, ref: string): LifelineModel {
  const own = schema.lifelines.filter((l) => l.diagramId === diagramId);
  const hit = own.find((l) => l.id === ref) ?? own.find((l) => norm(l.label) === norm(ref));
  if (!hit) {
    throw new UserError(
      `No participant "${ref}" in diagram ${diagramId}. Participants: ${own.map((l) => l.label).join(', ') || '(none)'}.`,
    );
  }
  return hit;
}

/** Resolve a table (by name/id) or drawing element (by id) for arrow binding / moving. */
export function findTarget(
  schema: SchemaModel,
  ref: string,
):
  | { kind: 'table'; table: TableModel }
  | { kind: 'element'; element: CanvasElementModel } {
  const element = schema.elements.find((e) => e.id === ref);
  if (element) return { kind: 'element', element };
  return { kind: 'table', table: findTable(schema, ref) };
}

/** A morph tag the user (or a tool) chose; unique "solo" tags are bookkeeping, not worth listing. */
function userTag(morphId: string | undefined): string | undefined {
  const tag = morphTagOf(morphId);
  return tag && !isSoloTag(morphId) ? tag : undefined;
}

/** Compact, model-friendly overview of a project (no coordinates noise, no full JSON). */
export function summarizeProject(graph: ProjectGraphResponse): Record<string, unknown> {
  const { project, schema } = graph;
  const colName = new Map<string, string>();
  for (const t of schema.tables) for (const c of t.columns) colName.set(c.id, `${t.name}.${c.name}`);

  const lifelineLabel = new Map(schema.lifelines.map((l) => [l.id, l.label]));
  const elements = schema.elements.slice(0, 60).map((e) => ({
    id: e.id,
    type: e.type,
    ...(e.text ? { text: e.text.length > 80 ? `${e.text.slice(0, 77)}...` : e.text } : {}),
    ...(e.type === 'image' && e.fileId ? { fileId: e.fileId } : {}),
    x: Math.round(e.x),
    y: Math.round(e.y),
    ...(e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw'
      ? {}
      : { width: Math.round(e.width), height: Math.round(e.height) }),
  }));

  return {
    project: {
      id: project.id,
      name: project.name,
      type: project.type,
      description: project.description,
      accessLevel: graph.accessLevel,
    },
    tables: schema.tables.map((t) => ({
      id: t.id,
      name: t.name,
      position: { x: Math.round(t.x), y: Math.round(t.y) },
      ...(t.color ? { color: colorName(t.color) } : {}),
      columns: t.columns.map((c) => ({
        id: c.id,
        name: c.name,
        type: formatDataType(c.dataType),
        flags: [
          c.isPrimaryKey && 'PK',
          !c.isNullable && !c.isPrimaryKey && 'NOT NULL',
          c.isUnique && 'UNIQUE',
          c.isAutoIncrement && 'AUTO_INCREMENT',
        ].filter(Boolean),
      })),
    })),
    relationships: schema.relationships.map((r) => ({
      id: r.id,
      from: colName.get(r.sourceColumnId) ?? r.sourceColumnId,
      to: colName.get(r.targetColumnId) ?? r.targetColumnId,
      type: r.type,
      ...(r.onDelete ? { onDelete: r.onDelete } : {}),
      ...(r.onUpdate ? { onUpdate: r.onUpdate } : {}),
    })),
    sequenceDiagrams: schema.sequenceDiagrams.map((d) => ({
      id: d.id,
      ...(d.title ? { title: d.title } : {}),
      ...(d.backgroundColor ? { background: colorName(d.backgroundColor) } : {}),
      ...(userTag(d.morphId) ? { morphTag: userTag(d.morphId) } : {}),
      participants: schema.lifelines
        .filter((l) => l.diagramId === d.id)
        .sort((a, b) => a.x - b.x)
        .map((l) => ({
          id: l.id,
          name: l.label,
          ...(l.color ? { color: colorName(l.color) } : {}),
          ...(userTag(l.morphId) ? { morphTag: userTag(l.morphId) } : {}),
        })),
      messages: schema.sequenceMessages
        .filter((m) => m.diagramId === d.id)
        .sort((a, b) => a.y - b.y)
        .map((m) => ({
          id: m.id,
          from: lifelineLabel.get(m.fromLifelineId) ?? '?',
          to: lifelineLabel.get(m.toLifelineId) ?? '?',
          label: m.label ?? '',
          style: m.style,
          ...(m.color ? { color: colorName(m.color) } : {}),
          ...(userTag(m.morphId) ? { morphTag: userTag(m.morphId) } : {}),
        })),
    })),
    drawingElements: elements,
    ...(schema.elements.length > elements.length
      ? { drawingElementsTruncated: schema.elements.length - elements.length }
      : {}),
  };
}
