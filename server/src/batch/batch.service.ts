import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClassConstructor } from 'class-transformer';
import { DataSource, In, type EntityManager, type EntityTarget, type ObjectLiteral } from 'typeorm';
import type { BatchUpdateResponse, SchemaMutation } from '@devdesigner/shared';
import { AccessService, mergeRefs } from '../access/access.service';
import { validated } from '../common/validators';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { TableEntity } from '../tables/table.entity';
import { toTableModel } from '../tables/table.mapper';
import { UpdateTableDto } from '../tables/dto/update-table.dto';
import { applyTablePatch } from '../tables/tables.service';
import { ElementEntity } from '../elements/element.entity';
import { toElementModel } from '../elements/element.mapper';
import { UpdateElementDto } from '../elements/dto/update-element.dto';
import { applyElementPatch, elementRefs } from '../elements/elements.service';
import { SequenceDiagramEntity } from '../sequence/sequence-diagram.entity';
import { LifelineEntity } from '../sequence/lifeline.entity';
import { SequenceMessageEntity } from '../sequence/sequence-message.entity';
import {
  toLifelineModel,
  toSequenceDiagramModel,
  toSequenceMessageModel,
} from '../sequence/sequence.mapper';
import { UpdateSequenceDiagramDto } from '../sequence/dto/update-sequence-diagram.dto';
import { UpdateLifelineDto } from '../sequence/dto/update-lifeline.dto';
import { UpdateSequenceMessageDto } from '../sequence/dto/update-sequence-message.dto';
import {
  applyDiagramPatch,
  applyLifelinePatch,
  applyMessagePatch,
} from '../sequence/sequence.service';
import { RelationshipEntity } from '../relationships/relationship.entity';
import { toRelationshipModel } from '../relationships/relationship.mapper';
import { UpdateRelationshipDto } from '../relationships/dto/update-relationship.dto';
import { applyRelationshipPatch } from '../relationships/relationships.service';

/** Upper bound on entries per batch (keeps one transaction reasonably small). */
const MAX_BATCH = 2000;

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

/**
 * PATCH /projects/:projectId/batch - many edits (and deletes) in ONE transaction, so an
 * agent or a multi-select operation lands atomically instead of as N round trips that
 * can half-fail. Uses the same patch helpers and DTO validation as the granular
 * routes, then broadcasts ordinary realtime mutations after commit.
 */
@Injectable()
export class BatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** The route guard has checked write access to `projectId`. */
  async apply(projectId: string, body: unknown): Promise<BatchUpdateResponse> {
    if (!body || typeof body !== 'object') throw new BadRequestException('Body must be an object.');
    const b = body as Record<string, unknown>;
    const known = ['tables', 'elements', 'diagrams', 'lifelines', 'messages', 'relationships', 'deletes'];
    const unknown = Object.keys(b).filter((k) => !known.includes(k));
    if (unknown.length) throw new BadRequestException(`Unknown batch section(s): ${unknown.join(', ')}.`);

    const tables = entriesOf(b, 'tables');
    const elements = entriesOf(b, 'elements');
    const diagrams = entriesOf(b, 'diagrams');
    const lifelines = entriesOf(b, 'lifelines');
    const messages = entriesOf(b, 'messages');
    const relationships = entriesOf(b, 'relationships');
    const del = (b.deletes ?? {}) as Record<string, unknown>;
    if (typeof del !== 'object') throw new BadRequestException('deletes must be an object.');
    const deletes = {
      tables: idList(del.tables, 'tables'),
      elements: idList(del.elements, 'elements'),
      relationships: idList(del.relationships, 'relationships'),
      diagrams: idList(del.diagrams, 'diagrams'),
      lifelines: idList(del.lifelines, 'lifelines'),
      messages: idList(del.messages, 'messages'),
    };
    const total =
      tables.length + elements.length + diagrams.length + lifelines.length + messages.length +
      relationships.length + Object.values(deletes).reduce((a, l) => a + l.length, 0);
    if (total === 0) return { mutations: [] };
    if (total > MAX_BATCH) throw new BadRequestException(`At most ${MAX_BATCH} entries per batch.`);

    // Validate every patch up front, before touching the database.
    const tablePatches = tables.map((e) => ({
      id: e.id,
      x: numberField(e, 'x', 'tables'),
      y: numberField(e, 'y', 'tables'),
      dto: patchOf(UpdateTableDto, 'tables', e, ['x', 'y']),
    }));
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
      ),
      projectId,
    );

    const mutations = await this.dataSource.transaction(async (m) => {
      const out: SchemaMutation[] = [];
      const load = async <T extends ObjectLiteral & { id: string }>(
        target: EntityTarget<T>,
        ids: string[],
        what: string,
      ): Promise<Map<string, T>> => {
        if (ids.length === 0) return new Map();
        const rows = await m.getRepository(target).find({
          where: { id: In(ids), projectId } as never,
        });
        const map = new Map(rows.map((r) => [r.id, r]));
        const missing = ids.filter((id) => !map.has(id));
        if (missing.length) throw new NotFoundException(`No ${what} in this project: ${missing.join(', ')}.`);
        return map;
      };

      // ---- Updates ----
      const tableRows = await load(TableEntity, tablePatches.map((p) => p.id), 'table(s)');
      for (const p of tablePatches) {
        const t = tableRows.get(p.id) as TableEntity;
        applyTablePatch(t, p.dto);
        if (p.x !== undefined) t.x = p.x;
        if (p.y !== undefined) t.y = p.y;
      }
      await save(m, TableEntity, [...tableRows.values()]);

      const elementRows = await load(ElementEntity, elementPatches.map((p) => p.id), 'element(s)');
      for (const p of elementPatches) applyElementPatch(elementRows.get(p.id) as ElementEntity, p.dto);
      await save(m, ElementEntity, [...elementRows.values()]);

      const diagramRows = await load(SequenceDiagramEntity, diagramPatches.map((p) => p.id), 'sequence diagram(s)');
      for (const p of diagramPatches) applyDiagramPatch(diagramRows.get(p.id) as SequenceDiagramEntity, p.dto);
      await save(m, SequenceDiagramEntity, [...diagramRows.values()]);

      const lifelineRows = await load(LifelineEntity, lifelinePatches.map((p) => p.id), 'participant(s)');
      for (const p of lifelinePatches) {
        const l = lifelineRows.get(p.id) as LifelineEntity;
        applyLifelinePatch(l, p.dto);
        if (p.x !== undefined) l.x = p.x;
      }
      await save(m, LifelineEntity, [...lifelineRows.values()]);

      const messageRows = await load(SequenceMessageEntity, messagePatches.map((p) => p.id), 'message(s)');
      for (const p of messagePatches) {
        const msg = messageRows.get(p.id) as SequenceMessageEntity;
        applyMessagePatch(msg, p.dto);
        if (p.y !== undefined) msg.y = p.y;
      }
      await save(m, SequenceMessageEntity, [...messageRows.values()]);

      const relRows = await load(RelationshipEntity, relationshipPatches.map((p) => p.id), 'relationship(s)');
      for (const p of relationshipPatches) {
        applyRelationshipPatch(relRows.get(p.id) as RelationshipEntity, p.dto);
      }
      await save(m, RelationshipEntity, [...relRows.values()]);

      // Updated models (tables reloaded so columns/indexes ride along).
      if (tableRows.size) {
        const full = await m.getRepository(TableEntity).find({
          where: { id: In([...tableRows.keys()]) },
          relations: { columns: true, indexes: true },
        });
        for (const t of full) out.push({ kind: 'table.updated', table: toTableModel(t) });
      }
      for (const e of elementRows.values()) out.push({ kind: 'element.updated', element: toElementModel(e) });
      for (const d of diagramRows.values()) {
        out.push({ kind: 'sequenceDiagram.updated', diagram: toSequenceDiagramModel(d) });
      }
      for (const l of lifelineRows.values()) out.push({ kind: 'lifeline.updated', lifeline: toLifelineModel(l) });
      for (const msg of messageRows.values()) {
        out.push({ kind: 'message.updated', message: toSequenceMessageModel(msg) });
      }
      for (const r of relRows.values()) {
        out.push({ kind: 'relationship.updated', relationship: toRelationshipModel(r) });
      }

      // ---- Deletes (children first so nothing dangles mid-way) ----
      const exists = async <T extends ObjectLiteral>(target: EntityTarget<T>, ids: string[], what: string) => {
        await load(target as EntityTarget<T & { id: string }>, ids, what);
      };
      await exists(SequenceMessageEntity, deletes.messages, 'message(s)');
      await exists(LifelineEntity, deletes.lifelines, 'participant(s)');
      await exists(RelationshipEntity, deletes.relationships, 'relationship(s)');
      await exists(ElementEntity, deletes.elements, 'element(s)');
      await exists(SequenceDiagramEntity, deletes.diagrams, 'sequence diagram(s)');
      await exists(TableEntity, deletes.tables, 'table(s)');

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
    return { mutations };
  }
}

async function save<T extends ObjectLiteral>(m: EntityManager, target: EntityTarget<T>, rows: T[]): Promise<void> {
  if (rows.length) await m.getRepository(target).save(rows);
}
