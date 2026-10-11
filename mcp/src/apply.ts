// Applies a declarative DiagramSpec to a project as one atomic import, then wires
// any relationships that point at tables already in the project.

import {
  buildSpecFile,
  findFreeSpot,
  schemaRects,
  sequenceDiagramRect,
  tableRect,
  unionRects,
  type DiagramSpec,
  type ImportIntoProjectResponse,
  type ProjectGraphResponse,
  type RelationshipModel,
  type Rect,
  type SchemaModel,
  type SchemaMutation,
  type SpecRelationship,
} from '@dbdesigner/shared';
import type { DbDesignerApi } from './api';
import { UserError, findColumn, findTable } from './model';

export type Placement = 'auto' | { x: number; y: number };

export interface ApplyOptions {
  placement?: Placement;
  /** Prefer a spot beside this existing table (by name or id). */
  near?: string;
}

export interface ApplyResult {
  tables: Array<{ name: string; id: string; columns: Array<{ name: string; id: string }> }>;
  relationships: number;
  sequenceDiagrams: Array<{ id: string; participants: Array<{ name: string; id: string }> }>;
  placedAt: { x: number; y: number };
  warnings: string[];
}

function refTable(ref: string): string {
  const i = ref.lastIndexOf('.');
  return (i > 0 ? ref.slice(0, i) : ref).trim().toLowerCase();
}

/** Footprint of a freshly built spec file (tables + sequence diagrams). */
function specBounds(schema: SchemaModel): Rect | null {
  const rects: Rect[] = schema.tables.map(tableRect);
  for (const d of schema.sequenceDiagrams) {
    const r = sequenceDiagramRect(d, schema.lifelines, schema.sequenceMessages);
    if (r) rects.push(r);
  }
  return unionRects(rects);
}

export async function applySpec(
  api: DbDesignerApi,
  projectId: string,
  spec: DiagramSpec,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const graph = await api.get<ProjectGraphResponse>(`/projects/${projectId}`);
  const existing = graph.schema;
  const warnings: string[] = [];

  const specTables = new Set((spec.tables ?? []).map((t) => t.name.trim().toLowerCase()));
  const clashes = [...specTables].filter((n) =>
    existing.tables.some((t) => t.name.trim().toLowerCase() === n),
  );
  if (clashes.length) {
    throw new UserError(
      `Table(s) already exist in this project: ${clashes.join(', ')}. ` +
        'Use add_column/update_table to change them, or pick different names.',
    );
  }

  // References that leave the spec (to tables already in the project) are wired
  // after the import; everything inside the spec is resolved by buildSpecFile.
  const deferred: SpecRelationship[] = [];
  const inner: DiagramSpec = {
    ...spec,
    tables: (spec.tables ?? []).map((t) => ({
      ...t,
      columns: t.columns.map((c) => {
        if (c.references && !specTables.has(refTable(c.references))) {
          deferred.push({ from: c.references, to: `${t.name}.${c.name}`, type: 'ONE_TO_MANY' });
          return { ...c, references: undefined };
        }
        return c;
      }),
    })),
    relationships: (spec.relationships ?? []).filter((r) => {
      if (specTables.has(refTable(r.from)) && specTables.has(refTable(r.to))) return true;
      deferred.push(r);
      return false;
    }),
  };

  // Decide where it goes: measure at the origin, then find a free spot for that box.
  const measured = buildSpecFile(inner, { origin: { x: 0, y: 0 } }).file.schema;
  const bounds = specBounds(measured) ?? { x: 0, y: 0, w: 280, h: 140 };
  let origin: { x: number; y: number };
  if (options.placement && options.placement !== 'auto') {
    origin = options.placement;
  } else {
    const near = options.near ? tableRect(findTable(existing, options.near)) : undefined;
    origin = findFreeSpot(schemaRects(existing), bounds.w, bounds.h, { near });
  }
  origin = { x: Math.round(origin.x), y: Math.round(origin.y) };

  const built = buildSpecFile(inner, { origin });
  warnings.push(...built.warnings);

  const created: SchemaMutation[] = [];
  const hasContent =
    built.file.schema.tables.length > 0 || built.file.schema.sequenceDiagrams.length > 0;
  if (hasContent) {
    const response = await api.post<ImportIntoProjectResponse>(
      `/projects/${projectId}/import-content`,
      { file: built.file },
    );
    created.push(...response.mutations);
  }

  const createdTables = created.flatMap((m) => (m.kind === 'table.created' ? [m.table] : []));
  let relationships = created.filter((m) => m.kind === 'relationship.created').length;

  // Deferred relationships: resolve against existing + newly created tables.
  if (deferred.length) {
    const merged: SchemaModel = { ...existing, tables: [...existing.tables, ...createdTables] };
    for (const rel of deferred) {
      try {
        const source = findColumn(merged, rel.from);
        const target = findColumn(merged, rel.to);
        await api.post<RelationshipModel>(`/projects/${projectId}/relationships`, {
          sourceColumnId: source.column.id,
          targetColumnId: target.column.id,
          type: rel.type ?? 'ONE_TO_MANY',
          ...(rel.onDelete ? { onDelete: rel.onDelete } : {}),
          ...(rel.onUpdate ? { onUpdate: rel.onUpdate } : {}),
        });
        relationships++;
      } catch (err) {
        warnings.push(`Relationship ${rel.from} -> ${rel.to} skipped: ${(err as Error).message}`);
      }
    }
  }

  const lifelines = created.flatMap((m) => (m.kind === 'lifeline.created' ? [m.lifeline] : []));
  return {
    tables: createdTables.map((t) => ({
      name: t.name,
      id: t.id,
      columns: t.columns.map((c) => ({ name: c.name, id: c.id })),
    })),
    relationships,
    sequenceDiagrams: created.flatMap((m) =>
      m.kind === 'sequenceDiagram.created'
        ? [
            {
              id: m.diagram.id,
              participants: lifelines
                .filter((l) => l.diagramId === m.diagram.id)
                .sort((a, b) => a.x - b.x)
                .map((l) => ({ name: l.label, id: l.id })),
            },
          ]
        : [],
    ),
    placedAt: origin,
    warnings,
  };
}
