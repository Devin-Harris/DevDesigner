import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, type EntityManager, type EntityTarget, type ObjectLiteral } from 'typeorm';
import type { BatchUpdateResponse, CloneItemsDto, SchemaMutation } from '@devdesigner/shared';
import { AccessService, mergeRefs } from '../../collaboration/access/access.service';
import { validated } from '../common/validators';
import { RealtimePublisher } from '../../platform/realtime/realtime.publisher';
import { UpdateTableDto } from '../schema/tables/dto/update-table.dto';
import { UpdateElementDto } from '../canvas/elements/dto/update-element.dto';
import { elementRefs } from '../canvas/elements/elements.service';
import { UpdateSequenceDiagramDto } from '../canvas/sequence/dto/update-sequence-diagram.dto';
import { TableEntity } from '../schema/tables/table.entity';
import { ColumnEntity } from '../schema/columns/column.entity';
import { IndexEntity } from '../schema/indexes/index.entity';
import { toTableModel } from '../schema/tables/table.mapper';
import { ElementEntity } from '../canvas/elements/element.entity';
import { focusColumn, toElementModel } from '../canvas/elements/element.mapper';
import { SequenceDiagramEntity } from '../canvas/sequence/sequence-diagram.entity';
import { LifelineEntity } from '../canvas/sequence/lifeline.entity';
import { SequenceMessageEntity } from '../canvas/sequence/sequence-message.entity';
import {
  toLifelineModel,
  toSequenceDiagramModel,
  toSequenceMessageModel,
} from '../canvas/sequence/sequence.mapper';
import { RelationshipEntity } from '../schema/relationships/relationship.entity';
import { toRelationshipModel } from '../schema/relationships/relationship.mapper';
import { QuotaService } from '../../platform/quotas/quota.service';

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

/** Refuse keys an entry may not carry, and a missing / non-string sourceId. */
function entryShape(entry: unknown, name: string, allowed: readonly string[]): Record<string, unknown> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException(`${name} must be an object.`);
  const e = entry as Record<string, unknown>;
  const extra = Object.keys(e).find((k) => !allowed.includes(k));
  if (extra) throw new BadRequestException(`${name}.${extra} is not allowed.`);
  if (typeof e.sourceId !== 'string') throw new BadRequestException(`${name}.sourceId must be a string.`);
  return e;
}

const TABLE_KEYS = ['sourceId', 'id', 'slideId', 'columns', 'indexes'] as const;
const DIAGRAM_KEYS = ['sourceId', 'id', 'slideId', 'lifelines', 'messages'] as const;
const RELATIONSHIP_KEYS = ['sourceId', 'id'] as const;
const ELEMENT_KEYS = ['sourceId', 'id', 'slideId', 'slide', 'morphId', 'zIndex', 'text', 'startBinding', 'endBinding'] as const;

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
    private readonly quota: QuotaService,
  ) {}

  /** The route guard has checked write access to `projectId`. */
  async clone(projectId: string, body: unknown): Promise<BatchUpdateResponse> {
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

    // Entries carry fields that are copied onto the new rows: validate them with the
    // same DTO rules as the granular routes and the batch endpoint (security M-4).
    tables.forEach((t, i) => {
      const e = entryShape(t, `tables[${i}]`, TABLE_KEYS);
      validated(UpdateTableDto, `tables[${i}]`, { slideId: e.slideId });
    });
    diagrams.forEach((d, i) => {
      const e = entryShape(d, `diagrams[${i}]`, DIAGRAM_KEYS);
      validated(UpdateSequenceDiagramDto, `diagrams[${i}]`, { slideId: e.slideId });
    });
    relationships.forEach((r, i) => entryShape(r, `relationships[${i}]`, RELATIONSHIP_KEYS));
    elements.forEach((el, i) => {
      const { sourceId: _s, id: _id, ...rest } = entryShape(el, `elements[${i}]`, ELEMENT_KEYS);
      validated(UpdateElementDto, `elements[${i}]`, rest);
    });

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

    // References may point at rows of this project or at copies made by this request
    // (a copied slide's content points at the copied frame), never anywhere else (L-7).
    const fresh = new Set(newIds);
    const keep = (id: string | null | undefined): string | null | undefined => (id && fresh.has(id) ? null : id);
    const refs = mergeRefs(
      { element: [...tables, ...diagrams].map((x) => keep(x.slideId)) },
      ...elements.map((e) => {
        const r = elementRefs({ slideId: keep(e.slideId), startBinding: e.startBinding, endBinding: e.endBinding });
        for (const kind of Object.keys(r) as Array<keyof typeof r>) r[kind] = (r[kind] ?? []).map(keep);
        return r;
      }),
    );
    await this.access.assertRefsInProject(refs, projectId);
    await this.quota.assertProjectRoom(projectId, { tables: tables.length, elements: elements.length });

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
          startBindingFocus: focusColumn(e.startBinding),
          endBindingFocus: focusColumn(e.endBinding),
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

    this.realtime.emitMany(projectId, mutations);
    return { mutations };
  }
}

async function save<T extends ObjectLiteral>(m: EntityManager, target: EntityTarget<T>, rows: T[]): Promise<void> {
  if (rows.length) await m.getRepository(target).save(rows);
}
