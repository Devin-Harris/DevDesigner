import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, type EntityManager, type EntityTarget, type ObjectLiteral } from 'typeorm';
import type { BatchUpdateResponse, CloneItemsDto, SchemaMutation } from '@dbdesigner/shared';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { TableEntity } from '../tables/table.entity';
import { ColumnEntity } from '../columns/column.entity';
import { IndexEntity } from '../indexes/index.entity';
import { toTableModel } from '../tables/table.mapper';
import { ElementEntity } from '../elements/element.entity';
import { toElementModel } from '../elements/element.mapper';
import { SequenceDiagramEntity } from '../sequence/sequence-diagram.entity';
import { LifelineEntity } from '../sequence/lifeline.entity';
import { SequenceMessageEntity } from '../sequence/sequence-message.entity';
import {
  toLifelineModel,
  toSequenceDiagramModel,
  toSequenceMessageModel,
} from '../sequence/sequence.mapper';
import { RelationshipEntity } from '../relationships/relationship.entity';
import { toRelationshipModel } from '../relationships/relationship.mapper';

/** Upper bound on copied rows per request (children included). */
const MAX_CLONE = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function arr<T>(raw: unknown, name: string): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new BadRequestException(`${name} must be an array.`);
  return raw as T[];
}

function num(raw: unknown, name: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new BadRequestException(`${name} must be a number.`);
  }
  return raw;
}

function idMap(raw: unknown, name: string): Map<string, string> {
  if (!raw || typeof raw !== 'object') throw new BadRequestException(`${name} must be an object.`);
  return new Map(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
}

/**
 * POST /projects/:projectId/clone - copy tables (columns, indexes), relationships,
 * sequence diagrams (participants, messages) and elements in ONE transaction, under
 * ids the client generated, so a client can show the copies at once and an undo
 * step covers the lot. Sources must belong to the project; new ids must be unused.
 */
@Injectable()
export class CloneService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async clone(
    projectId: string,
    body: unknown,
    userId: string | null,
    shareToken: string | null,
    clientId: string | null,
  ): Promise<BatchUpdateResponse> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    if (!body || typeof body !== 'object') throw new BadRequestException('Body must be an object.');
    const b = body as Record<string, unknown>;
    const dx = num(b.dx, 'dx');
    const dy = num(b.dy, 'dy');
    const tables = arr<NonNullable<CloneItemsDto['tables']>[number]>(b.tables, 'tables');
    const relationships = arr<NonNullable<CloneItemsDto['relationships']>[number]>(
      b.relationships,
      'relationships',
    );
    const diagrams = arr<NonNullable<CloneItemsDto['diagrams']>[number]>(b.diagrams, 'diagrams');
    const elements = arr<NonNullable<CloneItemsDto['elements']>[number]>(b.elements, 'elements');

    // Every new id (rows and children) must be a well-formed, distinct uuid.
    const newIds: string[] = [];
    const tableMaps = tables.map((t, i) => {
      const columns = idMap(t.columns, `tables[${i}].columns`);
      const indexes = idMap(t.indexes ?? {}, `tables[${i}].indexes`);
      newIds.push(t.id, ...columns.values(), ...indexes.values());
      return { columns, indexes };
    });
    const diagramMaps = diagrams.map((d, i) => {
      const lifelines = idMap(d.lifelines, `diagrams[${i}].lifelines`);
      const messages = idMap(d.messages, `diagrams[${i}].messages`);
      newIds.push(d.id, ...lifelines.values(), ...messages.values());
      return { lifelines, messages };
    });
    newIds.push(...relationships.map((r) => r.id), ...elements.map((e) => e.id));
    if (newIds.length > MAX_CLONE) throw new BadRequestException(`At most ${MAX_CLONE} rows per clone.`);
    if (newIds.some((id) => typeof id !== 'string' || !UUID.test(id))) {
      throw new BadRequestException('Every new id must be a uuid.');
    }
    if (new Set(newIds).size !== newIds.length) throw new BadRequestException('New ids must be distinct.');

    const mutations = await this.dataSource.transaction(async (m) => {
      const out: SchemaMutation[] = [];
      const load = async <T extends ObjectLiteral & { id: string }>(
        target: EntityTarget<T>,
        ids: string[],
        what: string,
        scoped = true,
      ): Promise<Map<string, T>> => {
        if (!ids.length) return new Map();
        const rows = await m.getRepository(target).find({
          where: (scoped ? { id: In(ids), projectId } : { id: In(ids) }) as never,
        });
        const map = new Map(rows.map((r) => [r.id, r]));
        const missing = ids.filter((id) => !map.has(id));
        if (missing.length) throw new NotFoundException(`No ${what} in this project: ${missing.join(', ')}.`);
        return map;
      };
      const taken = async <T extends ObjectLiteral>(target: EntityTarget<T>, ids: string[]) => {
        if (ids.length && (await m.getRepository(target).exist({ where: { id: In(ids) } as never }))) {
          throw new ConflictException('A copy id is already in use.');
        }
      };

      // ---- Tables (+ columns, indexes) ----
      const srcTables = await load(TableEntity, tables.map((t) => t.sourceId), 'table(s)');
      await taken(TableEntity, tables.map((t) => t.id));
      const columnMap = new Map<string, string>();
      const tableIds: string[] = [];
      for (const [i, t] of tables.entries()) {
        const src = srcTables.get(t.sourceId)!;
        const { columns, indexes } = tableMaps[i];
        await save(m, TableEntity, [
          m.create(TableEntity, {
            ...src,
            id: t.id,
            x: src.x + dx,
            y: src.y + dy,
            groupId: null,
            slideId: t.slideId ?? null,
            columns: undefined,
            indexes: undefined,
          }),
        ]);
        tableIds.push(t.id);
        const cols = await m.getRepository(ColumnEntity).find({ where: { tableId: src.id } });
        await taken(ColumnEntity, [...columns.values()]);
        const colCopies = cols.map((c) => {
          const id = columns.get(c.id);
          if (!id) throw new BadRequestException(`tables[${i}].columns is missing ${c.id}.`);
          columnMap.set(c.id, id);
          return m.create(ColumnEntity, { ...c, id, tableId: t.id, table: undefined });
        });
        await save(m, ColumnEntity, colCopies);
        const idx = await m.getRepository(IndexEntity).find({ where: { tableId: src.id } });
        await taken(IndexEntity, [...indexes.values()]);
        const idxCopies = idx.map((x) => {
          const id = indexes.get(x.id);
          if (!id) throw new BadRequestException(`tables[${i}].indexes is missing ${x.id}.`);
          const colIds = (JSON.parse(x.columnIdsJson) as string[]).map((c) => columnMap.get(c) ?? c);
          return m.create(IndexEntity, {
            ...x,
            id,
            tableId: t.id,
            table: undefined,
            columnIdsJson: JSON.stringify(colIds),
          });
        });
        await save(m, IndexEntity, idxCopies);
      }

      // ---- Relationships between copied tables ----
      const srcRels = await load(RelationshipEntity, relationships.map((r) => r.sourceId), 'relationship(s)');
      await taken(RelationshipEntity, relationships.map((r) => r.id));
      const relCopies = relationships.map((r) => {
        const src = srcRels.get(r.sourceId)!;
        const sourceColumnId = columnMap.get(src.sourceColumnId);
        const targetColumnId = columnMap.get(src.targetColumnId);
        if (!sourceColumnId || !targetColumnId) {
          throw new BadRequestException(`relationships: ${r.sourceId} joins tables that are not copied.`);
        }
        const wp = src.waypointsJson
          ? (JSON.parse(src.waypointsJson) as { x: number; y: number }[]).map((p) => ({
              x: p.x + dx,
              y: p.y + dy,
            }))
          : null;
        return m.create(RelationshipEntity, {
          ...src,
          id: r.id,
          sourceColumnId,
          targetColumnId,
          sourceColumn: undefined,
          targetColumn: undefined,
          waypointsJson: wp ? JSON.stringify(wp) : null,
        });
      });
      await save(m, RelationshipEntity, relCopies);

      // ---- Sequence diagrams (+ participants, messages) ----
      const srcDiagrams = await load(SequenceDiagramEntity, diagrams.map((d) => d.sourceId), 'sequence diagram(s)');
      await taken(SequenceDiagramEntity, diagrams.map((d) => d.id));
      const diagramCopies: SequenceDiagramEntity[] = [];
      const lifelineCopies: LifelineEntity[] = [];
      const messageCopies: SequenceMessageEntity[] = [];
      for (const [i, d] of diagrams.entries()) {
        const src = srcDiagrams.get(d.sourceId)!;
        const { lifelines, messages } = diagramMaps[i];
        diagramCopies.push(
          m.create(SequenceDiagramEntity, {
            ...src,
            id: d.id,
            originY: src.originY + dy,
            groupId: null,
            slideId: d.slideId ?? null,
          }),
        );
        const ls = await m.getRepository(LifelineEntity).find({ where: { diagramId: src.id } });
        for (const l of ls) {
          const id = lifelines.get(l.id);
          if (!id) throw new BadRequestException(`diagrams[${i}].lifelines is missing ${l.id}.`);
          lifelineCopies.push(
            m.create(LifelineEntity, { ...l, id, diagramId: d.id, diagram: undefined, x: l.x + dx }),
          );
        }
        const ms = await m.getRepository(SequenceMessageEntity).find({ where: { diagramId: src.id } });
        for (const msg of ms) {
          const id = messages.get(msg.id);
          const from = lifelines.get(msg.fromLifelineId);
          const to = lifelines.get(msg.toLifelineId);
          if (!id || !from || !to) {
            throw new BadRequestException(`diagrams[${i}].messages is missing ${msg.id}.`);
          }
          messageCopies.push(
            m.create(SequenceMessageEntity, {
              ...msg,
              id,
              diagramId: d.id,
              diagram: undefined,
              fromLifelineId: from,
              toLifelineId: to,
              y: msg.y + dy,
            }),
          );
        }
      }
      await taken(LifelineEntity, lifelineCopies.map((l) => l.id));
      await taken(SequenceMessageEntity, messageCopies.map((x) => x.id));
      await save(m, SequenceDiagramEntity, diagramCopies);
      await save(m, LifelineEntity, lifelineCopies);
      await save(m, SequenceMessageEntity, messageCopies);

      // ---- Elements ----
      const srcElements = await load(ElementEntity, elements.map((e) => e.sourceId), 'element(s)');
      await taken(ElementEntity, elements.map((e) => e.id));
      const elementCopies = elements.map((e) => {
        const src = srcElements.get(e.sourceId)!;
        return m.create(ElementEntity, {
          ...src,
          id: e.id,
          x: src.x + dx,
          y: src.y + dy,
          zIndex: num(e.zIndex, 'elements.zIndex'),
          groupId: null,
          text: e.text ?? null,
          morphId: e.morphId ?? null,
          placeholderJson: src.placeholderJson,
          overrides: src.overrides,
          slideJson: src.type === 'frame' && e.slide ? JSON.stringify(e.slide) : null,
          slideId: src.type === 'frame' ? null : (e.slideId ?? null),
          startBindingKind: e.startBinding?.targetKind ?? null,
          startBindingId: e.startBinding?.targetId ?? null,
          endBindingKind: e.endBinding?.targetKind ?? null,
          endBindingId: e.endBinding?.targetId ?? null,
        });
      });
      await save(m, ElementEntity, elementCopies);

      // ---- Created models ----
      if (tableIds.length) {
        const full = await m.getRepository(TableEntity).find({
          where: { id: In(tableIds) },
          relations: { columns: true, indexes: true },
        });
        for (const t of full) out.push({ kind: 'table.created', table: toTableModel(t) });
      }
      for (const r of relCopies) out.push({ kind: 'relationship.created', relationship: toRelationshipModel(r) });
      for (const d of diagramCopies) {
        out.push({ kind: 'sequenceDiagram.created', diagram: toSequenceDiagramModel(d) });
      }
      for (const l of lifelineCopies) out.push({ kind: 'lifeline.created', lifeline: toLifelineModel(l) });
      for (const msg of messageCopies) {
        out.push({ kind: 'message.created', message: toSequenceMessageModel(msg) });
      }
      for (const e of elementCopies) out.push({ kind: 'element.created', element: toElementModel(e) });
      return out;
    });

    for (const mutation of mutations) this.realtime.emit(projectId, clientId, mutation);
    return { mutations };
  }
}

async function save<T extends ObjectLiteral>(m: EntityManager, target: EntityTarget<T>, rows: T[]): Promise<void> {
  if (rows.length) await m.getRepository(target).save(rows);
}
