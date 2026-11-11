// Planning POST /projects/:id/clone: copies of existing rows under the ids the
// client chose, offset by (dx, dy). Pure, so the guide sandboxes answer the clone
// route exactly like the server.

import type { CloneItemsDto } from '../dto';
import type {
  CanvasElementModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '../models';
import { cloneJson, randomId } from './ids';
import type { ProjectContent } from './remap';


/**
 * The rows a clone request adds, in parent-before-child order. Sources that do not
 * exist are skipped. Children without an id in the request's maps get a fresh one.
 */
export function planClone(
  schema: Pick<SchemaModel, keyof ProjectContent>,
  req: CloneItemsDto,
  newId: () => string = randomId,
): ProjectContent {
  const dx = Number(req.dx) || 0;
  const dy = Number(req.dy) || 0;
  const colMap = new Map<string, string>();
  const tables: TableModel[] = [];
  for (const t of req.tables ?? []) {
    const src = schema.tables.find((x) => x.id === t.sourceId);
    if (!src) continue;
    const cols = t.columns ?? {};
    const idxs = t.indexes ?? {};
    Object.entries(cols).forEach(([a, c]) => colMap.set(a, c));
    const copy: TableModel = cloneJson(src);
    copy.id = t.id;
    copy.x += dx;
    copy.y += dy;
    delete copy.groupId;
    if (t.slideId) copy.slideId = t.slideId;
    else delete copy.slideId;
    copy.columns = copy.columns.map((c) => ({ ...c, id: cols[c.id] ?? newId() }));
    copy.indexes = (copy.indexes ?? []).map((ix) => ({
      ...ix,
      id: idxs[ix.id] ?? newId(),
      columnIds: ix.columnIds.map((c) => cols[c] ?? c),
    }));
    tables.push(copy);
  }

  const relationships: RelationshipModel[] = [];
  for (const r of req.relationships ?? []) {
    const src = schema.relationships.find((x) => x.id === r.sourceId);
    if (!src) continue;
    const copy: RelationshipModel = cloneJson(src);
    copy.id = r.id;
    copy.sourceColumnId = colMap.get(src.sourceColumnId) ?? src.sourceColumnId;
    copy.targetColumnId = colMap.get(src.targetColumnId) ?? src.targetColumnId;
    copy.waypoints = copy.waypoints?.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    relationships.push(copy);
  }

  const sequenceDiagrams: SequenceDiagramModel[] = [];
  const lifelines: LifelineModel[] = [];
  const sequenceMessages: SequenceMessageModel[] = [];
  for (const d of req.diagrams ?? []) {
    const src = schema.sequenceDiagrams.find((x) => x.id === d.sourceId);
    if (!src) continue;
    const lls = d.lifelines ?? {};
    const msgs = d.messages ?? {};
    const copy: SequenceDiagramModel = { ...cloneJson(src), id: d.id, originY: src.originY + dy };
    delete copy.groupId;
    if (d.slideId) copy.slideId = d.slideId;
    else delete copy.slideId;
    sequenceDiagrams.push(copy);
    for (const l of schema.lifelines.filter((x) => x.diagramId === src.id)) {
      lifelines.push({ ...cloneJson(l), id: lls[l.id] ?? newId(), diagramId: copy.id, x: l.x + dx });
    }
    for (const m of schema.sequenceMessages.filter((x) => x.diagramId === src.id)) {
      sequenceMessages.push({
        ...cloneJson(m),
        id: msgs[m.id] ?? newId(),
        diagramId: copy.id,
        fromLifelineId: lls[m.fromLifelineId] ?? m.fromLifelineId,
        toLifelineId: lls[m.toLifelineId] ?? m.toLifelineId,
        y: m.y + dy,
      });
    }
  }

  const elements: CanvasElementModel[] = [];
  for (const e of req.elements ?? []) {
    const src = schema.elements.find((x) => x.id === e.sourceId);
    if (!src) continue;
    const copy: CanvasElementModel = { ...cloneJson(src), id: e.id, x: src.x + dx, y: src.y + dy };
    delete copy.groupId;
    // The entry's fields override the source's; null clears one, undefined keeps it.
    const overrides: Partial<Record<keyof CanvasElementModel, unknown>> = {
      slideId: e.slideId,
      slide: e.slide,
      morphId: e.morphId,
      zIndex: e.zIndex,
      text: e.text,
      startBinding: e.startBinding,
      endBinding: e.endBinding,
    };
    const out = copy as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) continue;
      if (v === null || (k === 'morphId' && typeof v === 'string' && !v.trim())) delete out[k];
      else out[k] = v;
    }
    elements.push(copy);
  }

  return { tables, relationships, elements, sequenceDiagrams, lifelines, sequenceMessages };
}
