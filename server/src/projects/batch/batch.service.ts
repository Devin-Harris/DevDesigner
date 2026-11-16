import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClassConstructor } from 'class-transformer';
import { DataSource, In, type EntityManager, type EntityTarget, type ObjectLiteral } from 'typeorm';
import {
  diffModel,
  type BatchUpdateResponse,
  type RealtimeMutation,
  type SchemaMutation,
  type SchemaPatchMutation,
} from '@devdesigner/shared';
import { AccessService, mergeRefs } from '../../collaboration/access/access.service';
import { validated } from '../common/validators';
import { RealtimePublisher } from '../../platform/realtime/realtime.publisher';
import { TableEntity } from '../schema/tables/table.entity';
import { toTableModel } from '../schema/tables/table.mapper';
import { UpdateTableDto } from '../schema/tables/dto/update-table.dto';
import { applyTablePatch } from '../schema/tables/tables.service';
import { ColumnEntity } from '../schema/columns/column.entity';
import { toColumnModel } from '../schema/columns/column.mapper';
import { UpdateColumnDto } from '../schema/columns/dto/update-column.dto';
import { applyColumnPatch } from '../schema/columns/columns.service';
import { IndexEntity } from '../schema/indexes/index.entity';
import { toIndexModel } from '../schema/indexes/index.mapper';
import { UpdateIndexDto } from '../schema/indexes/dto/update-index.dto';
import { applyIndexPatch } from '../schema/indexes/indexes.service';
import { ElementEntity } from '../canvas/elements/element.entity';
import { toElementModel } from '../canvas/elements/element.mapper';
import { UpdateElementDto } from '../canvas/elements/dto/update-element.dto';
import { applyElementPatch, elementRefs } from '../canvas/elements/elements.service';
import { SequenceDiagramEntity } from '../canvas/sequence/sequence-diagram.entity';
import { LifelineEntity } from '../canvas/sequence/lifeline.entity';
import { SequenceMessageEntity } from '../canvas/sequence/sequence-message.entity';
import {
  toLifelineModel,
  toSequenceDiagramModel,
  toSequenceMessageModel,
} from '../canvas/sequence/sequence.mapper';
import { UpdateSequenceDiagramDto } from '../canvas/sequence/dto/update-sequence-diagram.dto';
import { UpdateLifelineDto } from '../canvas/sequence/dto/update-lifeline.dto';
import { UpdateSequenceMessageDto } from '../canvas/sequence/dto/update-sequence-message.dto';
import {
  applyDiagramPatch,
  applyLifelinePatch,
  applyMessagePatch,
} from '../canvas/sequence/sequence.service';
import { RelationshipEntity } from '../schema/relationships/relationship.entity';
import { toRelationshipModel } from '../schema/relationships/relationship.mapper';
import { UpdateRelationshipDto } from '../schema/relationships/dto/update-relationship.dto';
import { applyRelationshipPatch } from '../schema/relationships/relationships.service';

/** Upper bound on entries per batch (keeps one transaction reasonably small). */
const MAX_BATCH = 2000;

const SECTIONS = ['tables', 'columns', 'indexes', 'elements', 'diagrams', 'lifelines', 'messages', 'relationships'];
const DELETE_SECTIONS = ['tables', 'columns', 'indexes', 'elements', 'relationships', 'diagrams', 'lifelines', 'messages'] as const;

type Entry = { id: string } & Record<string, unknown>;

/** Validate one entry's patch against the granular DTO class (same rules as the single routes). */
function patchOf<T extends object>(cls: ClassConstructor<T>, section: string, entry: Entry, extra: string[] = []): T {
  const { id: _id, ...rest } = entry;
  for (const key of extra) delete rest[key];
  return validated(cls, `${section}[${entry.id}]`, rest);
}

function entriesOf(body: Record<string, unknown>, section: string): Entry[] {
  const raw = body[section];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new BadRequestException(`${section} must be an array.`);
  return raw.map((e, i) => {
    if (!e || typeof e !== 'object' || typeof (e as Entry).id !== 'string') {
      throw new BadRequestException(`${section}[${i}] needs a string id.`);
    }
    return e as Entry;
  });
}

function numberField(entry: Entry, key: string, section: string): number | undefined {
  const v = entry[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new BadRequestException(`${section}[${entry.id}].${key} must be a number.`);
  }
  return v;
}

function idList(raw: unknown, name: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
    throw new BadRequestException(`deletes.${name} must be an array of ids.`);
  }
  return [...new Set(raw as string[])];
}

const sameValue = (a: unknown, b: unknown): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

/**
 * A loaded row plus a copy of its column values from before the patch, so the write
 * touches only the columns that changed and the broadcast can carry only the model
 * fields that changed.
 */
interface Tracked<E> {
  row: E;
  before: E;
}

function track<E extends object>(rows: Map<string, E>): Map<string, Tracked<E>> {
  return new Map([...rows].map(([id, row]) => [id, { row, before: { ...row } }]));
}

/**
 * Write the changed columns of each row with one UPDATE (no load-and-save re-select).
 * Rows whose patch changed nothing are not written at all.
 */
async function persistChanged<E extends ObjectLiteral & { id: string }>(
  m: EntityManager,
  target: EntityTarget<E>,
  rows: Iterable<Tracked<E>>,
): Promise<void> {
  for (const { row, before } of rows) {
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      if (!sameValue(before[key], row[key])) changed[key] = row[key];
    }
    if (Object.keys(changed).length) await m.update(target, { id: row.id } as never, changed as never);
  }
}

/**
 * PATCH /projects/:projectId/batch - many edits (and deletes) in ONE transaction, so an
 * agent or a multi-select operation lands atomically instead of as N round trips that
 * can half-fail. Uses the same patch helpers and DTO validation as the granular
 * routes, then broadcasts realtime mutations after commit.
 *
 * Sections: tables, columns, indexes, elements, diagrams, lifelines, messages,
 * relationships (each `[{ id, ...patch }]`), plus `deletes` with the same keys.
 *
 * Broadcast shape: with REALTIME_PATCH_MUTATIONS (the default)
 * each patched row is sent as `*.patched` with only the model fields that
 * changed (perf P3.1 / S3), and rows whose patch changed nothing are not sent.
 * With it off, full `*.updated` models are broadcast.
 */
@Injectable()
export class BatchService {
  private readonly patchMutations: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
    config: ConfigService,
  ) {
    this.patchMutations = config.get<string>('REALTIME_PATCH_MUTATIONS', 'true') === 'true';
  }

  /** The route guard has checked write access to `projectId`. */
  async apply(projectId: string, body: unknown): Promise<BatchUpdateResponse> {
    if (!body || typeof body !== 'object') throw new BadRequestException('Body must be an object.');
    const b = body as Record<string, unknown>;
    const unknown = Object.keys(b).filter((k) => k !== 'deletes' && !SECTIONS.includes(k));
    if (unknown.length) throw new BadRequestException(`Unknown batch section(s): ${unknown.join(', ')}.`);

    const tables = entriesOf(b, 'tables');
    const columns = entriesOf(b, 'columns');
    const indexes = entriesOf(b, 'indexes');
    const elements = entriesOf(b, 'elements');
    const diagrams = entriesOf(b, 'diagrams');
    const lifelines = entriesOf(b, 'lifelines');
    const messages = entriesOf(b, 'messages');
    const relationships = entriesOf(b, 'relationships');
    const del = (b.deletes ?? {}) as Record<string, unknown>;
    if (typeof del !== 'object') throw new BadRequestException('deletes must be an object.');
    const unknownDeletes = Object.keys(del).filter((k) => !(DELETE_SECTIONS as readonly string[]).includes(k));
    if (unknownDeletes.length) throw new BadRequestException(`Unknown delete section(s): ${unknownDeletes.join(', ')}.`);
    const deletes = Object.fromEntries(DELETE_SECTIONS.map((k) => [k, idList(del[k], k)])) as Record<
      (typeof DELETE_SECTIONS)[number],
      string[]
    >;
    const total =
      tables.length + columns.length + indexes.length + elements.length + diagrams.length + lifelines.length +
      messages.length + relationships.length + Object.values(deletes).reduce((a, l) => a + l.length, 0);
    if (total === 0) return { mutations: [] };
    if (total > MAX_BATCH) throw new BadRequestException(`At most ${MAX_BATCH} entries per batch.`);

    // Validate every patch up front, before touching the database.
    const tablePatches = tables.map((e) => ({
      id: e.id,
      x: numberField(e, 'x', 'tables'),
      y: numberField(e, 'y', 'tables'),
      dto: patchOf(UpdateTableDto, 'tables', e, ['x', 'y']),
    }));
    const columnPatches = columns.map((e) => ({ id: e.id, dto: patchOf(UpdateColumnDto, 'columns', e) }));
    const indexPatches = indexes.map((e) => ({ id: e.id, dto: patchOf(UpdateIndexDto, 'indexes', e) }));
    const elementPatches = elements.map((e) => ({ id: e.id, dto: patchOf(UpdateElementDto, 'elements', e) }));
    const diagramPatches = diagrams.map((e) => ({ id: e.id, dto: patchOf(UpdateSequenceDiagramDto, 'diagrams', e) }));
    const lifelinePatches = lifelines.map((e) => ({
      id: e.id,
      x: numberField(e, 'x', 'lifelines'),
      dto: patchOf(UpdateLifelineDto, 'lifelines', e, ['x']),
    }));
    const messagePatches = messages.map((e) => ({
      id: e.id,
      y: numberField(e, 'y', 'messages'),
      dto: patchOf(UpdateSequenceMessageDto, 'messages', e, ['y']),
    }));
    const relationshipPatches = relationships.map((e) => {
      if ('sourceColumnId' in e || 'targetColumnId' in e) {
        throw new BadRequestException(`relationships[${e.id}]: re-pointing endpoints is not supported in a batch.`);
      }
      return { id: e.id, dto: patchOf(UpdateRelationshipDto, 'relationships', e) };
    });

    // Every reference a patch sets must point into this project (security L-7).
    await this.access.assertRefsInProject(
      mergeRefs(
        { element: [...tablePatches, ...diagramPatches].map((p) => p.dto.slideId) },
        ...elementPatches.map((p) => elementRefs(p.dto)),
        { lifeline: messagePatches.flatMap((p) => [p.dto.fromLifelineId, p.dto.toLifelineId]) },
        { column: indexPatches.flatMap((p) => p.dto.columnIds ?? []) },
      ),
      projectId,
    );

    const patchMode = this.patchMutations;
    const mutations = await this.dataSource.transaction(async (m) => {
      const out: RealtimeMutation[] = [];
      const load = async <T extends ObjectLiteral & { id: string }>(
        target: EntityTarget<T>,
        ids: string[],
        what: string,
      ): Promise<Map<string, T>> => {
        if (ids.length === 0) return new Map();
        const rows = await m.getRepository(target).find({
          where: { id: In(ids), projectId } as never,
        });
        return found(rows, ids, what);
      };
      /** Columns and indexes belong to the project through their table. */
      const loadViaTable = async <T extends ObjectLiteral & { id: string }>(
        target: EntityTarget<T>,
        ids: string[],
        what: string,
      ): Promise<Map<string, T>> => {
        if (ids.length === 0) return new Map();
        const rows = await m
          .getRepository(target)
          .createQueryBuilder('row')
          .innerJoin(TableEntity, 't', 't.id = row.tableId')
          .where('row.id IN (:...ids)', { ids })
          .andWhere('t.projectId = :projectId', { projectId })
          .getMany();
        return found(rows, ids, what);
      };

      // ---- Updates ----
      const tableRows = track(await load(TableEntity, tablePatches.map((p) => p.id), 'table(s)'));
      for (const p of tablePatches) {
        const t = tableRows.get(p.id)!.row;
        applyTablePatch(t, p.dto);
        if (p.x !== undefined) t.x = p.x;
        if (p.y !== undefined) t.y = p.y;
      }
      await persistChanged(m, TableEntity, tableRows.values());

      const columnRows = track(await loadViaTable(ColumnEntity, columnPatches.map((p) => p.id), 'column(s)'));
      for (const p of columnPatches) applyColumnPatch(columnRows.get(p.id)!.row, p.dto);
      await persistChanged(m, ColumnEntity, columnRows.values());

      const indexRows = track(await loadViaTable(IndexEntity, indexPatches.map((p) => p.id), 'index(es)'));
      for (const p of indexPatches) applyIndexPatch(indexRows.get(p.id)!.row, p.dto);
      await persistChanged(m, IndexEntity, indexRows.values());

      const elementRows = track(await load(ElementEntity, elementPatches.map((p) => p.id), 'element(s)'));
      for (const p of elementPatches) applyElementPatch(elementRows.get(p.id)!.row, p.dto);
      await persistChanged(m, ElementEntity, elementRows.values());

      const diagramRows = track(await load(SequenceDiagramEntity, diagramPatches.map((p) => p.id), 'sequence diagram(s)'));
      for (const p of diagramPatches) applyDiagramPatch(diagramRows.get(p.id)!.row, p.dto);
      await persistChanged(m, SequenceDiagramEntity, diagramRows.values());

      const lifelineRows = track(await load(LifelineEntity, lifelinePatches.map((p) => p.id), 'participant(s)'));
      for (const p of lifelinePatches) {
        const l = lifelineRows.get(p.id)!.row;
        applyLifelinePatch(l, p.dto);
        if (p.x !== undefined) l.x = p.x;
      }
      await persistChanged(m, LifelineEntity, lifelineRows.values());

      const messageRows = track(await load(SequenceMessageEntity, messagePatches.map((p) => p.id), 'message(s)'));
      for (const p of messagePatches) {
        const msg = messageRows.get(p.id)!.row;
        applyMessagePatch(msg, p.dto);
        if (p.y !== undefined) msg.y = p.y;
      }
      await persistChanged(m, SequenceMessageEntity, messageRows.values());

      const relRows = track(await load(RelationshipEntity, relationshipPatches.map((p) => p.id), 'relationship(s)'));
      for (const p of relationshipPatches) applyRelationshipPatch(relRows.get(p.id)!.row, p.dto);
      await persistChanged(m, RelationshipEntity, relRows.values());

      if (patchMode) {
        out.push(...patchMutations({ tableRows, columnRows, indexRows, elementRows, diagramRows, lifelineRows, messageRows, relRows }));
      } else {
        // Full models (tables reloaded so columns/indexes ride along).
        if (tableRows.size) {
          const full = await m.getRepository(TableEntity).find({
            where: { id: In([...tableRows.keys()]) },
            relations: { columns: true, indexes: true },
          });
          for (const t of full) out.push({ kind: 'table.updated', table: toTableModel(t) });
        }
        for (const { row } of columnRows.values()) {
          out.push({ kind: 'column.updated', tableId: row.tableId, column: toColumnModel(row) });
        }
        for (const { row } of indexRows.values()) {
          out.push({ kind: 'index.updated', tableId: row.tableId, index: toIndexModel(row) });
        }
        for (const { row } of elementRows.values()) out.push({ kind: 'element.updated', element: toElementModel(row) });
        for (const { row } of diagramRows.values()) {
          out.push({ kind: 'sequenceDiagram.updated', diagram: toSequenceDiagramModel(row) });
        }
        for (const { row } of lifelineRows.values()) out.push({ kind: 'lifeline.updated', lifeline: toLifelineModel(row) });
        for (const { row } of messageRows.values()) {
          out.push({ kind: 'message.updated', message: toSequenceMessageModel(row) });
        }
        for (const { row } of relRows.values()) {
          out.push({ kind: 'relationship.updated', relationship: toRelationshipModel(row) });
        }
      }

      // ---- Deletes (children first so nothing dangles mid-way) ----
      await load(SequenceMessageEntity, deletes.messages, 'message(s)');
      await load(LifelineEntity, deletes.lifelines, 'participant(s)');
      await load(RelationshipEntity, deletes.relationships, 'relationship(s)');
      const deletedIndexes = await loadViaTable(IndexEntity, deletes.indexes, 'index(es)');
      const deletedColumns = await loadViaTable(ColumnEntity, deletes.columns, 'column(s)');
      await load(ElementEntity, deletes.elements, 'element(s)');
      await load(SequenceDiagramEntity, deletes.diagrams, 'sequence diagram(s)');
      await load(TableEntity, deletes.tables, 'table(s)');

      if (deletes.messages.length) {
        await m.delete(SequenceMessageEntity, { id: In(deletes.messages), projectId });
        for (const messageId of deletes.messages) out.push({ kind: 'message.deleted', messageId });
      }
      if (deletes.lifelines.length) {
        await m.delete(SequenceMessageEntity, { projectId, fromLifelineId: In(deletes.lifelines) });
        await m.delete(SequenceMessageEntity, { projectId, toLifelineId: In(deletes.lifelines) });
        await m.delete(LifelineEntity, { id: In(deletes.lifelines), projectId });
        for (const lifelineId of deletes.lifelines) out.push({ kind: 'lifeline.deleted', lifelineId });
      }
      if (deletes.relationships.length) {
        await m.delete(RelationshipEntity, { id: In(deletes.relationships), projectId });
        for (const relationshipId of deletes.relationships) out.push({ kind: 'relationship.deleted', relationshipId });
      }
      if (deletedIndexes.size) {
        await m.delete(IndexEntity, { id: In([...deletedIndexes.keys()]) });
        for (const row of deletedIndexes.values()) out.push({ kind: 'index.deleted', tableId: row.tableId, indexId: row.id });
      }
      if (deletedColumns.size) {
        // Relationships on these columns cascade via FK (as DELETE /columns/:id does).
        await m.delete(ColumnEntity, { id: In([...deletedColumns.keys()]) });
        for (const row of deletedColumns.values()) {
          out.push({ kind: 'column.deleted', tableId: row.tableId, columnId: row.id });
        }
      }
      if (deletes.elements.length) {
        await m.delete(ElementEntity, { id: In(deletes.elements), projectId });
        for (const elementId of deletes.elements) out.push({ kind: 'element.deleted', elementId });
      }
      if (deletes.diagrams.length) {
        await m.delete(SequenceMessageEntity, { projectId, diagramId: In(deletes.diagrams) });
        await m.delete(LifelineEntity, { projectId, diagramId: In(deletes.diagrams) });
        await m.delete(SequenceDiagramEntity, { id: In(deletes.diagrams), projectId });
        for (const diagramId of deletes.diagrams) out.push({ kind: 'sequenceDiagram.deleted', diagramId });
      }
      if (deletes.tables.length) {
        // Columns (and relationships referencing them) cascade via FK.
        await m.delete(TableEntity, { id: In(deletes.tables), projectId });
        for (const tableId of deletes.tables) out.push({ kind: 'table.deleted', tableId });
      }
      return out;
    });

    this.realtime.emitMany(projectId, mutations);
    // Patch kinds are only present when REALTIME_PATCH_MUTATIONS is on (see SchemaPatchMutation).
    return { mutations: mutations as SchemaMutation[] };
  }
}

function found<T extends { id: string }>(rows: T[], ids: string[], what: string): Map<string, T> {
  const map = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) throw new NotFoundException(`No ${what} in this project: ${missing.join(', ')}.`);
  return map;
}

/** `*.patched` mutations carrying only the model fields each row's patch changed. */
function patchMutations(rows: {
  tableRows: Map<string, Tracked<TableEntity>>;
  columnRows: Map<string, Tracked<ColumnEntity>>;
  indexRows: Map<string, Tracked<IndexEntity>>;
  elementRows: Map<string, Tracked<ElementEntity>>;
  diagramRows: Map<string, Tracked<SequenceDiagramEntity>>;
  lifelineRows: Map<string, Tracked<LifelineEntity>>;
  messageRows: Map<string, Tracked<SequenceMessageEntity>>;
  relRows: Map<string, Tracked<RelationshipEntity>>;
}): SchemaPatchMutation[] {
  const out: SchemaPatchMutation[] = [];
  const each = <E, M extends object>(
    map: Map<string, Tracked<E>>,
    model: (row: E) => M,
    make: (row: E, change: NonNullable<ReturnType<typeof diffModel<M>>>) => SchemaPatchMutation,
  ) => {
    for (const { row, before } of map.values()) {
      const change = diffModel(model(before), model(row));
      if (change) out.push(make(row, change));
    }
  };
  const tableScalars = (t: TableEntity) => {
    const { columns: _c, indexes: _i, ...rest } = toTableModel({ ...t, columns: [], indexes: [] } as TableEntity);
    return rest;
  };
  each(rows.tableRows, tableScalars, (r, c) => ({ kind: 'table.patched', tableId: r.id, ...c }));
  each(rows.columnRows, toColumnModel, (r, c) => ({ kind: 'column.patched', tableId: r.tableId, columnId: r.id, ...c }));
  each(rows.indexRows, toIndexModel, (r, c) => ({ kind: 'index.patched', tableId: r.tableId, indexId: r.id, ...c }));
  each(rows.elementRows, toElementModel, (r, c) => ({ kind: 'element.patched', elementId: r.id, ...c }));
  each(rows.diagramRows, toSequenceDiagramModel, (r, c) => ({ kind: 'sequenceDiagram.patched', diagramId: r.id, ...c }));
  each(rows.lifelineRows, toLifelineModel, (r, c) => ({ kind: 'lifeline.patched', lifelineId: r.id, ...c }));
  each(rows.messageRows, toSequenceMessageModel, (r, c) => ({ kind: 'message.patched', messageId: r.id, ...c }));
  each(rows.relRows, toRelationshipModel, (r, c) => ({ kind: 'relationship.patched', relationshipId: r.id, ...c }));
  return out;
}
