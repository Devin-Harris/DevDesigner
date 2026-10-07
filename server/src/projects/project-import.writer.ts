import { randomUUID } from 'node:crypto';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ElementBinding } from '@dbdesigner/shared';
import { ColumnEntity } from '../columns/column.entity';
import { fromDataType } from '../columns/column.mapper';
import { ElementEntity } from '../elements/element.entity';
import { IndexEntity } from '../indexes/index.entity';
import { RelationshipEntity } from '../relationships/relationship.entity';
import { LifelineEntity } from '../sequence/lifeline.entity';
import { SequenceDiagramEntity } from '../sequence/sequence-diagram.entity';
import { SequenceMessageEntity } from '../sequence/sequence-message.entity';
import { TableEntity } from '../tables/table.entity';
import { Project } from './project.entity';
import type { ParsedProjectImport } from './project-import.parser';

// Keeps each multi-row INSERT under SQLite's bound-variable limit even for wide rows.
const CHUNK = 25;

async function insertAll<T extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<T>,
  rows: QueryDeepPartialEntity<T>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await manager.insert(target, rows.slice(i, i + CHUNK));
  }
}

/** Old id -> freshly minted id. Lookups of unknown ids return undefined. */
class IdMap {
  private readonly ids = new Map<string, string>();
  mint(oldId: string): string {
    const id = randomUUID();
    this.ids.set(oldId, id);
    return id;
  }
  get(oldId: string | undefined): string | undefined {
    return oldId === undefined ? undefined : this.ids.get(oldId);
  }
}

/**
 * Insert a validated project file as a brand-new project. EVERY id is regenerated
 * (so an export can be imported repeatedly, or onto the server it came from, with
 * no collisions) and every cross-reference is rewritten through the id maps.
 * References that no longer resolve (a relationship to a missing column, a
 * binding to a missing shape) are dropped rather than failing the whole import.
 *
 * Must be called inside a transaction so a failure leaves no partial project.
 */
export async function writeImportedProject(
  manager: EntityManager,
  parsed: ParsedProjectImport,
  ownerId: string | null,
): Promise<Project> {
  const { schema } = parsed;
  const project = await manager.save(
    manager.create(Project, {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      ownerId,
      archived: false,
      viewportX: schema.viewport.x,
      viewportY: schema.viewport.y,
      zoom: schema.viewport.zoom,
    }),
  );
  const projectId = project.id;

  const tableIds = new IdMap();
  const columnIds = new IdMap();
  const elementIds = new IdMap();
  const diagramIds = new IdMap();
  const lifelineIds = new IdMap();
  const groupIds = new IdMap();
  const group = (old: string | undefined): string | null => {
    if (old === undefined) return null;
    return groupIds.get(old) ?? groupIds.mint(old);
  };

  // Tables, their columns and indexes.
  const tableRows: QueryDeepPartialEntity<TableEntity>[] = [];
  const columnRows: QueryDeepPartialEntity<ColumnEntity>[] = [];
  for (const t of schema.tables) {
    const tableId = tableIds.mint(t.id);
    tableRows.push({
      id: tableId,
      projectId,
      name: t.name,
      x: t.x,
      y: t.y,
      color: t.color ?? null,
      note: t.note ?? null,
      width: t.width ?? null,
      groupId: group(t.groupId),
    });
    t.columns.forEach((c, orderIndex) => {
      columnRows.push({
        id: columnIds.mint(c.id),
        tableId,
        name: c.name,
        ...fromDataType(c.dataType),
        isPrimaryKey: c.isPrimaryKey,
        isNullable: c.isNullable,
        isUnique: c.isUnique,
        isAutoIncrement: c.isAutoIncrement,
        defaultValue: c.defaultValue ?? null,
        note: c.note ?? null,
        orderIndex,
      });
    });
  }
  await insertAll(manager, TableEntity, tableRows);
  await insertAll(manager, ColumnEntity, columnRows);

  const indexRows: QueryDeepPartialEntity<IndexEntity>[] = [];
  for (const t of schema.tables) {
    (t.indexes ?? []).forEach((ix, orderIndex) => {
      const covered = ix.columnIds
        .map((id) => columnIds.get(id))
        .filter((id): id is string => id !== undefined);
      if (covered.length === 0) return;
      indexRows.push({
        tableId: tableIds.get(t.id),
        name: ix.name,
        columnIdsJson: JSON.stringify(covered),
        isUnique: ix.isUnique,
        orderIndex,
      });
    });
  }
  await insertAll(manager, IndexEntity, indexRows);

  // Relationships (both endpoint columns must have survived).
  const relationshipRows: QueryDeepPartialEntity<RelationshipEntity>[] = [];
  for (const r of schema.relationships) {
    const sourceColumnId = columnIds.get(r.sourceColumnId);
    const targetColumnId = columnIds.get(r.targetColumnId);
    if (!sourceColumnId || !targetColumnId) continue;
    relationshipRows.push({
      projectId,
      sourceColumnId,
      targetColumnId,
      type: r.type,
      onDelete: r.onDelete ?? null,
      onUpdate: r.onUpdate ?? null,
      waypointsJson: r.waypoints?.length ? JSON.stringify(r.waypoints) : null,
    });
  }
  await insertAll(manager, RelationshipEntity, relationshipRows);

  // Free-form elements. Mint all ids first: bindings can point at later elements.
  for (const e of schema.elements) elementIds.mint(e.id);
  const resolveBinding = (b: ElementBinding | undefined) => {
    if (!b) return { kind: null, id: null };
    const id = b.targetKind === 'table' ? tableIds.get(b.targetId) : elementIds.get(b.targetId);
    return id ? { kind: b.targetKind, id } : { kind: null, id: null };
  };
  const elementRows: QueryDeepPartialEntity<ElementEntity>[] = schema.elements.map((e) => {
    const start = resolveBinding(e.startBinding);
    const end = resolveBinding(e.endBinding);
    return {
      id: elementIds.get(e.id),
      projectId,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      angle: e.angle,
      strokeColor: e.strokeColor,
      backgroundColor: e.backgroundColor ?? null,
      fillStyle: e.fillStyle,
      strokeWidth: e.strokeWidth,
      strokeStyle: e.strokeStyle,
      opacity: e.opacity,
      zIndex: e.zIndex,
      cornerRadius: e.cornerRadius ?? null,
      pointsJson: e.points?.length ? JSON.stringify(e.points) : null,
      text: e.text ?? null,
      fontSize: e.fontSize ?? null,
      fontFamily: e.fontFamily ?? null,
      bold: e.bold ?? null,
      italic: e.italic ?? null,
      textAlign: e.textAlign ?? null,
      verticalAlign: e.verticalAlign ?? null,
      startBindingKind: start.kind,
      startBindingId: start.id,
      endBindingKind: end.kind,
      endBindingId: end.id,
      startArrowhead: e.startArrowhead ?? null,
      endArrowhead: e.endArrowhead ?? null,
      groupId: group(e.groupId),
    };
  });
  await insertAll(manager, ElementEntity, elementRows);

  // Sequence diagrams -> lifelines -> messages (children of a missing parent are dropped).
  const diagramRows: QueryDeepPartialEntity<SequenceDiagramEntity>[] = schema.sequenceDiagrams.map(
    (d) => ({
      id: diagramIds.mint(d.id),
      projectId,
      lifelineSpacing: d.lifelineSpacing,
      rowSpacing: d.rowSpacing,
      headerHeight: d.headerHeight,
      originY: d.originY,
      groupId: group(d.groupId),
    }),
  );
  await insertAll(manager, SequenceDiagramEntity, diagramRows);

  const lifelineRows: QueryDeepPartialEntity<LifelineEntity>[] = [];
  for (const l of schema.lifelines) {
    const diagramId = diagramIds.get(l.diagramId);
    if (!diagramId) continue;
    lifelineRows.push({
      id: lifelineIds.mint(l.id),
      projectId,
      diagramId,
      label: l.label,
      color: l.color ?? null,
      x: l.x,
      width: l.width,
      orderIndex: l.order,
    });
  }
  await insertAll(manager, LifelineEntity, lifelineRows);

  const messageRows: QueryDeepPartialEntity<SequenceMessageEntity>[] = [];
  for (const m of schema.sequenceMessages) {
    const diagramId = diagramIds.get(m.diagramId);
    const fromLifelineId = lifelineIds.get(m.fromLifelineId);
    const toLifelineId = lifelineIds.get(m.toLifelineId);
    if (!diagramId || !fromLifelineId || !toLifelineId) continue;
    messageRows.push({
      projectId,
      diagramId,
      fromLifelineId,
      toLifelineId,
      label: m.label ?? null,
      y: m.y,
      style: m.style,
      direction: m.direction,
      arrowhead: m.arrowhead,
    });
  }
  await insertAll(manager, SequenceMessageEntity, messageRows);

  return project;
}
