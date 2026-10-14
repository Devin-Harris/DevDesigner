import { randomUUID } from 'node:crypto';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type {
  CanvasElementModel,
  ElementBinding,
  IndexModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '@dbdesigner/shared';
import { ColumnEntity } from '../columns/column.entity';
import { fromDataType } from '../columns/column.mapper';
import { ElementEntity } from '../elements/element.entity';
import { IndexEntity } from '../indexes/index.entity';
import { ProjectImageEntity } from '../images/project-image.entity';
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

/** A world-space point the imported content's top-left corner is moved to. */
export interface ImportAnchor {
  x: number;
  y: number;
}

/**
 * Translation that moves the content's top-left corner (smallest x / y across
 * every positioned item) onto `anchor`, preserving the content's own layout.
 * Zero when there is nothing to position.
 */
export function offsetToAnchor(
  schema: SchemaModel,
  anchor: ImportAnchor,
): { dx: number; dy: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of schema.tables) {
    xs.push(t.x);
    ys.push(t.y);
  }
  for (const e of schema.elements) {
    xs.push(e.x);
    ys.push(e.y);
  }
  for (const l of schema.lifelines) xs.push(l.x);
  for (const m of schema.sequenceMessages) ys.push(m.y);
  for (const d of schema.sequenceDiagrams) ys.push(d.originY);
  for (const r of schema.relationships) {
    for (const p of r.waypoints ?? []) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length === 0 || ys.length === 0) return { dx: 0, dy: 0 };
  return { dx: anchor.x - Math.min(...xs), dy: anchor.y - Math.min(...ys) };
}

/** A validated image file from an import, ready to insert (id is the file's own id). */
export interface ImportedImage {
  id: string;
  mimeType: string;
  data: Buffer;
}

export interface WriteOptions {
  /** Image files referenced by image elements' `fileId`. Elements whose file is missing are dropped. */
  images?: ImportedImage[];
  /** Translation applied to every world coordinate (default none). */
  dx?: number;
  dy?: number;
  /** Merging into a project that already has elements: stack the new ones above them. */
  stackAboveExisting?: boolean;
  /**
   * Ids already in the target project that unresolved references may keep pointing at
   * (slide ownership, arrow bindings), instead of being dropped. Used when content is
   * duplicated inside the same project.
   */
  linkExisting?: { elementIds: ReadonlySet<string>; tableIds: ReadonlySet<string> };
}

/** The content written by `writeSchemaInto`, as models carrying the NEW ids. */
export type WrittenSchema = Omit<SchemaModel, 'viewport' | 'home' | 'notes'>;

/**
 * Insert a validated schema into `projectId` (a brand-new project or an existing
 * one). EVERY id is regenerated (so a file can be imported repeatedly, or onto the
 * server it came from, with no collisions) and every cross-reference is rewritten
 * through the id maps. References that no longer resolve (a relationship to a
 * missing column, a binding to a missing shape) are dropped rather than failing
 * the whole import.
 *
 * Must be called inside a transaction so a failure leaves nothing half-written.
 */
export async function writeSchemaInto(
  manager: EntityManager,
  projectId: string,
  schema: SchemaModel,
  options: WriteOptions = {},
): Promise<WrittenSchema> {
  const dx = options.dx ?? 0;
  const dy = options.dy ?? 0;

  const tableIds = new IdMap();
  const columnIds = new IdMap();
  const elementIds = new IdMap();
  const diagramIds = new IdMap();
  const lifelineIds = new IdMap();
  const messageIds = new IdMap();
  const groupIds = new IdMap();
  const morphIds = new IdMap();
  const group = (old: string | undefined): string | null => {
    if (old === undefined) return null;
    return groupIds.get(old) ?? groupIds.mint(old);
  };

  // Element ids are minted first: tables, diagrams and elements point at their slide frame.
  for (const e of schema.elements) elementIds.mint(e.id);
  // Diagram ids too: a slide's animations point at its tables, diagrams and elements.
  for (const d of schema.sequenceDiagrams) diagramIds.mint(d.id);
  const linked = options.linkExisting;
  const slideOf = (old: string | undefined): string | null =>
    old === undefined
      ? null
      : (elementIds.get(old) ?? (linked?.elementIds.has(old) ? old : null));

  // Tables, their columns and indexes.
  const tableModels: TableModel[] = [];
  const tableRows: QueryDeepPartialEntity<TableEntity>[] = [];
  const columnRows: QueryDeepPartialEntity<ColumnEntity>[] = [];
  const indexRows: QueryDeepPartialEntity<IndexEntity>[] = [];
  for (const t of schema.tables) tableIds.mint(t.id);
  for (const t of schema.tables) {
    const tableId = tableIds.get(t.id)!;
    const groupId = group(t.groupId);
    const columns = t.columns.map((c) => ({ ...c, id: columnIds.mint(c.id) }));
    const indexes: IndexModel[] = [];
    for (const ix of t.indexes ?? []) {
      const covered = ix.columnIds
        .map((id) => columnIds.get(id))
        .filter((id): id is string => id !== undefined);
      if (covered.length === 0) continue;
      indexes.push({ id: randomUUID(), name: ix.name, columnIds: covered, isUnique: ix.isUnique });
    }
    tableModels.push({
      ...t,
      id: tableId,
      x: t.x + dx,
      y: t.y + dy,
      columns,
      indexes: indexes.length ? indexes : undefined,
      groupId: groupId ?? undefined,
      slideId: slideOf(t.slideId) ?? undefined,
    });
    tableRows.push({
      id: tableId,
      projectId,
      name: t.name,
      x: t.x + dx,
      y: t.y + dy,
      color: t.color ?? null,
      note: t.note ?? null,
      width: t.width ?? null,
      scale: t.scale && t.scale > 0 && t.scale !== 1 ? Math.min(8, t.scale) : null,
      groupId,
      slideId: slideOf(t.slideId),
      morphId: t.morphId?.startsWith('tag:') ? t.morphId : null,
    });
    columns.forEach((c, orderIndex) => {
      columnRows.push({
        id: c.id,
        tableId,
        name: c.name,
        ...fromDataType(c.dataType),
        isPrimaryKey: c.isPrimaryKey,
        isNullable: c.isNullable,
        isUnique: c.isUnique,
        isAutoIncrement: c.isAutoIncrement,
        isUnsigned: c.isUnsigned ?? false,
        defaultValue: c.defaultValue ?? null,
        note: c.note ?? null,
        orderIndex,
      });
    });
    indexes.forEach((ix, orderIndex) => {
      indexRows.push({
        id: ix.id,
        tableId,
        name: ix.name,
        columnIdsJson: JSON.stringify(ix.columnIds),
        isUnique: ix.isUnique,
        orderIndex,
      });
    });
  }
  await insertAll(manager, TableEntity, tableRows);
  await insertAll(manager, ColumnEntity, columnRows);
  await insertAll(manager, IndexEntity, indexRows);

  // Relationships (both endpoint columns must have survived).
  const relationshipModels: RelationshipModel[] = [];
  const relationshipRows: QueryDeepPartialEntity<RelationshipEntity>[] = [];
  for (const r of schema.relationships) {
    const sourceColumnId = columnIds.get(r.sourceColumnId);
    const targetColumnId = columnIds.get(r.targetColumnId);
    if (!sourceColumnId || !targetColumnId) continue;
    const waypoints = r.waypoints?.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    const id = randomUUID();
    relationshipModels.push({ ...r, id, sourceColumnId, targetColumnId, waypoints });
    relationshipRows.push({
      id,
      projectId,
      sourceColumnId,
      targetColumnId,
      type: r.type,
      onDelete: r.onDelete ?? null,
      onUpdate: r.onUpdate ?? null,
      waypointsJson: waypoints?.length ? JSON.stringify(waypoints) : null,
      sourceSide: r.sourceSide ?? null,
      targetSide: r.targetSide ?? null,
      autoRoute: r.autoRoute ?? null,
    });
  }
  await insertAll(manager, RelationshipEntity, relationshipRows);

  // Image files get fresh ids; image elements are re-pointed at them, or dropped
  // when their file isn't in the import.
  const imageIds = new IdMap();
  const imported = options.images ?? [];
  for (const img of imported) imageIds.mint(img.id);
  await insertAll(
    manager,
    ProjectImageEntity,
    imported.map((img) => ({
      id: imageIds.get(img.id)!,
      projectId,
      mimeType: img.mimeType,
      data: img.data,
    })),
  );
  const sourceElements = schema.elements.filter(
    (e) => e.type !== 'image' || (e.fileId !== undefined && imageIds.get(e.fileId) !== undefined),
  );
  // Free-form elements. Mint all ids first: bindings can point at later elements.
  for (const e of sourceElements) {
    if (elementIds.get(e.id) === undefined) elementIds.mint(e.id);
  }
  // Message ids too: an arrow may be anchored to a message label.
  for (const m of schema.sequenceMessages) messageIds.mint(m.id);
  let zShift = 0;
  if (options.stackAboveExisting && sourceElements.length) {
    const top = await manager
      .createQueryBuilder(ElementEntity, 'e')
      .select('MAX(e.zIndex)', 'max')
      .where('e.projectId = :projectId', { projectId })
      .getRawOne<{ max: number | null }>();
    const lowest = Math.min(...sourceElements.map((e) => e.zIndex));
    zShift = (top?.max ?? -1) + 1 - lowest;
  }
  // New slides go after the project's existing ones rather than interleaving.
  let slideShift = 0;
  if (options.stackAboveExisting && sourceElements.some((e) => e.slide)) {
    const existing = await manager.find(ElementEntity, {
      where: { projectId, type: 'frame' },
      select: { id: true, slideJson: true },
    });
    let top = -1;
    for (const row of existing) {
      try {
        const o = row.slideJson ? (JSON.parse(row.slideJson) as { order?: number }) : null;
        if (typeof o?.order === 'number') top = Math.max(top, o.order);
      } catch {
        /* ignore a corrupt value */
      }
    }
    const lowest = Math.min(...sourceElements.filter((e) => e.slide).map((e) => e.slide!.order));
    slideShift = top + 1 - lowest;
  }
  const resolveBinding = (b: ElementBinding | undefined): ElementBinding | undefined => {
    if (!b) return undefined;
    const map =
      b.targetKind === 'table' ? tableIds : b.targetKind === 'message' ? messageIds : elementIds;
    const id = map.get(b.targetId);
    if (id) return { targetKind: b.targetKind, targetId: id };
    const keep =
      b.targetKind === 'table'
        ? linked?.tableIds.has(b.targetId)
        : b.targetKind === 'element' && linked?.elementIds.has(b.targetId);
    return keep ? { targetKind: b.targetKind, targetId: b.targetId } : undefined;
  };
  const elementModels: CanvasElementModel[] = sourceElements.map((e) => ({
    ...e,
    id: elementIds.get(e.id)!,
    fileId: e.type === 'image' ? imageIds.get(e.fileId) : undefined,
    x: e.x + dx,
    y: e.y + dy,
    zIndex: e.zIndex + zShift,
    startBinding: resolveBinding(e.startBinding),
    endBinding: resolveBinding(e.endBinding),
    groupId: group(e.groupId) ?? undefined,
    slideId: slideOf(e.slideId) ?? undefined,
    slide:
      e.type === 'frame' && e.slide
        ? {
            ...e.slide,
            order: e.slide.order + slideShift,
            // Animations follow their objects to the new ids; ones whose object is gone drop.
            animations: e.slide.animations
              ?.map((a) => {
                const target =
                  elementIds.get(a.target) ?? tableIds.get(a.target) ?? diagramIds.get(a.target);
                return target ? { ...a, target } : null;
              })
              .filter((a): a is NonNullable<typeof a> => a !== null),
          }
        : undefined,
    // Lineage ids are remapped as a set so copies still match each other after import.
    // Named morph tags ("tag:...") are kept as written so slides added by a later import
    // still pair with earlier ones.
    morphId: e.morphId
      ? e.morphId.startsWith('tag:')
        ? e.morphId
        : (morphIds.get(e.morphId) ?? morphIds.mint(e.morphId))
      : undefined,
  }));
  await insertAll(
    manager,
    ElementEntity,
    elementModels.map((e) => ({
      id: e.id,
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
      aboveTables: e.aboveTables ?? null,
      italic: e.italic ?? null,
      lineHeight: e.lineHeight ?? null,
      wrap: e.wrap ?? null,
      runsJson: e.runs?.length ? JSON.stringify(e.runs) : null,
      textAlign: e.textAlign ?? null,
      verticalAlign: e.verticalAlign ?? null,
      startBindingKind: e.startBinding?.targetKind ?? null,
      startBindingId: e.startBinding?.targetId ?? null,
      endBindingKind: e.endBinding?.targetKind ?? null,
      endBindingId: e.endBinding?.targetId ?? null,
      startArrowhead: e.startArrowhead ?? null,
      endArrowhead: e.endArrowhead ?? null,
      curvature: e.curvature ?? null,
      fileId: e.fileId ?? null,
      language: e.type === 'code' ? (e.language ?? 'typescript') : null,
      fileName: e.type === 'code' ? (e.fileName?.trim() || null) : null,
      expandedHeight: e.type === 'code' ? (e.expandedHeight ?? null) : null,
      groupId: e.groupId ?? null,
      slideJson: e.slide ? JSON.stringify(e.slide) : null,
      morphId: e.morphId ?? null,
      step: e.step ?? null,
      slideId: e.slideId ?? null,
    })),
  );

  // Sequence diagrams -> lifelines -> messages (children of a missing parent are dropped).
  const diagramModels: SequenceDiagramModel[] = schema.sequenceDiagrams.map((d) => ({
    ...d,
    id: diagramIds.get(d.id)!,
    originY: d.originY + dy,
    groupId: group(d.groupId) ?? undefined,
    slideId: slideOf(d.slideId) ?? undefined,
  }));
  await insertAll(
    manager,
    SequenceDiagramEntity,
    diagramModels.map((d) => ({
      id: d.id,
      projectId,
      lifelineSpacing: d.lifelineSpacing,
      rowSpacing: d.rowSpacing,
      headerHeight: d.headerHeight,
      originY: d.originY,
      zIndex: d.zIndex,
      groupId: d.groupId ?? null,
      slideId: d.slideId ?? null,
      backgroundColor: d.backgroundColor ?? null,
      title: d.title ?? null,
      morphId: d.morphId ?? null,
    })),
  );

  const lifelineModels: LifelineModel[] = [];
  for (const l of schema.lifelines) {
    const diagramId = diagramIds.get(l.diagramId);
    if (!diagramId) continue;
    lifelineModels.push({ ...l, id: lifelineIds.mint(l.id), diagramId, x: l.x + dx });
  }
  await insertAll(
    manager,
    LifelineEntity,
    lifelineModels.map((l) => ({
      id: l.id,
      projectId,
      diagramId: l.diagramId,
      label: l.label,
      color: l.color ?? null,
      lineColor: l.lineColor ?? null,
      morphId: l.morphId ?? null,
      x: l.x,
      width: l.width,
      orderIndex: l.order,
    })),
  );

  const messageModels: SequenceMessageModel[] = [];
  for (const m of schema.sequenceMessages) {
    const diagramId = diagramIds.get(m.diagramId);
    const fromLifelineId = lifelineIds.get(m.fromLifelineId);
    const toLifelineId = lifelineIds.get(m.toLifelineId);
    if (!diagramId || !fromLifelineId || !toLifelineId) continue;
    // A message needs two different participants (a break has no arrow, so it may share).
    if (m.style !== 'break' && fromLifelineId === toLifelineId) continue;
    messageModels.push({
      ...m,
      id: messageIds.get(m.id)!,
      diagramId,
      fromLifelineId,
      toLifelineId,
      y: m.y + dy,
    });
  }
  await insertAll(
    manager,
    SequenceMessageEntity,
    messageModels.map((m) => ({
      id: m.id,
      projectId,
      diagramId: m.diagramId,
      fromLifelineId: m.fromLifelineId,
      toLifelineId: m.toLifelineId,
      label: m.label ?? null,
      y: m.y,
      style: m.style,
      direction: m.direction,
      arrowhead: m.arrowhead,
      color: m.color ?? null,
      wrap: m.wrap ?? null,
      morphId: m.morphId ?? null,
    })),
  );

  return {
    tables: tableModels,
    relationships: relationshipModels,
    elements: elementModels,
    sequenceDiagrams: diagramModels,
    lifelines: lifelineModels,
    sequenceMessages: messageModels,
  };
}

/** Insert a validated project file as a brand-new project. */
export async function writeImportedProject(
  manager: EntityManager,
  parsed: ParsedProjectImport,
  ownerId: string | null,
  images: ImportedImage[] = [],
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
      homeX: schema.home?.x ?? null,
      homeY: schema.home?.y ?? null,
      homeZoom: schema.home?.zoom ?? null,
    }),
  );
  await writeSchemaInto(manager, project.id, schema, { images });
  return project;
}
