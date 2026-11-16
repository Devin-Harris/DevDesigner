// Change journal for undo: every mutating tool call records the project's schema
// before and after (in this MCP process's memory, per project). Undo diffs the two
// and reverts what that call changed - field by field, skipping any field someone
// has changed again since (reported as a conflict) - in one atomic batch, plus a
// re-import for things the call deleted.

import type {
  CanvasElementModel,
  ColumnModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '@devdesigner/shared';
import type { BatchSection as AnyBatchSection } from './batch';

/** Row sections the journal diffs (columns are tracked separately, per table). */
type BatchSection = Exclude<AnyBatchSection, 'columns' | 'indexes'>;

export interface JournalEntry {
  tool: string;
  at: string;
  before: SchemaModel;
  after: SchemaModel;
}

const MAX_ENTRIES = 25;

export class Journal {
  private readonly stacks = new Map<string, JournalEntry[]>();

  push(projectId: string, entry: JournalEntry): void {
    const stack = this.stacks.get(projectId) ?? [];
    stack.push(entry);
    if (stack.length > MAX_ENTRIES) stack.shift();
    this.stacks.set(projectId, stack);
  }

  list(projectId: string): readonly JournalEntry[] {
    return this.stacks.get(projectId) ?? [];
  }

  pop(projectId: string): JournalEntry | undefined {
    return this.stacks.get(projectId)?.pop();
  }
}

/** Patchable fields per entity, and the value that clears an absent field. */
const FIELDS: Record<BatchSection, Record<string, unknown>> = {
  tables: { x: 0, y: 0, name: '', color: null, note: null, width: 0, scale: 1, groupId: null, slideId: null },
  elements: {
    x: 0, y: 0, width: 0, height: 0, angle: 0, strokeColor: '#1e1e1e', backgroundColor: null, fillStyle: 'none',
    strokeWidth: 2, strokeStyle: 'solid', opacity: 100, zIndex: 0, cornerRadius: null, points: [], text: null,
    fontSize: null, fontFamily: null, bold: null, italic: null, lineHeight: null, wrap: null, runs: null,
    textAlign: null, verticalAlign: null, startBinding: null, endBinding: null, startArrowhead: null,
    endArrowhead: null, curvature: null, language: null, fileName: '', expandedHeight: null, slide: null,
    morphId: null, step: null, groupId: null, slideId: null,
  },
  diagrams: {
    lifelineSpacing: 160, rowSpacing: 48, headerHeight: 40, originY: 0, zIndex: -1, groupId: null, slideId: null,
    backgroundColor: null, borderColor: null, title: '', morphId: '',
  },
  lifelines: { x: 0, label: '', color: null, lineColor: null, strokeColor: null, textColor: null, morphId: '', width: 120 },
  messages: {
    y: 0, fromLifelineId: '', toLifelineId: '', label: '', style: 'solid', direction: null, arrowhead: null,
    color: null, wrap: null, morphId: '',
  },
  relationships: { type: 'ONE_TO_MANY', onDelete: null, onUpdate: null, waypoints: [] },
};

const COLUMN_FIELDS: Record<string, unknown> = {
  name: '', dataType: null, isPrimaryKey: false, isNullable: true, isUnique: false, isAutoIncrement: false,
  defaultValue: null, note: null,
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Keyed = { id: string } & object;

function listOf(s: SchemaModel, section: BatchSection): Keyed[] {
  switch (section) {
    case 'tables': return s.tables;
    case 'elements': return s.elements;
    case 'diagrams': return s.sequenceDiagrams;
    case 'lifelines': return s.lifelines;
    case 'messages': return s.sequenceMessages;
    case 'relationships': return s.relationships;
  }
}

export interface UndoPlan {
  /** Field reverts per section: id -> patch. */
  patches: Array<{ section: BatchSection; id: string; patch: Record<string, unknown> }>;
  /** Items the change created (still present): delete them. */
  deletes: Array<{ section: BatchSection; id: string }>;
  /** Columns the change added to tables that already existed. */
  columnDeletes: string[];
  /** Column field reverts. */
  columnPatches: Array<{ id: string; patch: Record<string, unknown> }>;
  /** Things the change deleted, to recreate (they come back with new ids). */
  restore: {
    tables: TableModel[];
    elements: CanvasElementModel[];
    diagrams: SequenceDiagramModel[];
    lifelines: LifelineModel[];
    messages: SequenceMessageModel[];
    relationships: RelationshipModel[];
    columns: Array<{ tableId: string; column: ColumnModel }>;
  };
  conflicts: string[];
}

/**
 * What it takes to turn `current` back into `before` for exactly what changed between
 * `before` and `after`. Fields changed again since `after` are left alone (conflicts).
 */
export function planUndo(before: SchemaModel, after: SchemaModel, current: SchemaModel): UndoPlan {
  const plan: UndoPlan = {
    patches: [],
    deletes: [],
    columnDeletes: [],
    columnPatches: [],
    restore: { tables: [], elements: [], diagrams: [], lifelines: [], messages: [], relationships: [], columns: [] },
    conflicts: [],
  };
  const sections: BatchSection[] = ['tables', 'elements', 'diagrams', 'lifelines', 'messages', 'relationships'];
  for (const section of sections) {
    const b = new Map(listOf(before, section).map((x) => [x.id, x as Record<string, unknown>]));
    const a = new Map(listOf(after, section).map((x) => [x.id, x as Record<string, unknown>]));
    const c = new Map(listOf(current, section).map((x) => [x.id, x as Record<string, unknown>]));
    for (const [id, was] of b) {
      const now = a.get(id);
      if (!now) {
        if (!c.has(id)) {
          const r = plan.restore;
          if (section === 'tables') r.tables.push(was as unknown as TableModel);
          else if (section === 'elements') r.elements.push(was as unknown as CanvasElementModel);
          else if (section === 'diagrams') r.diagrams.push(was as unknown as SequenceDiagramModel);
          else if (section === 'lifelines') r.lifelines.push(was as unknown as LifelineModel);
          else if (section === 'messages') r.messages.push(was as unknown as SequenceMessageModel);
          else r.relationships.push(was as unknown as RelationshipModel);
        }
        continue;
      }
      const cur = c.get(id);
      const changed = Object.keys(FIELDS[section]).filter((f) => !same(was[f], now[f]));
      if (!changed.length) continue;
      if (!cur) {
        plan.conflicts.push(`${section} ${id} was deleted since; not restored.`);
        continue;
      }
      const patch: Record<string, unknown> = {};
      for (const field of changed) {
        const cleared = FIELDS[section][field];
        if (!same(cur[field], now[field])) {
          plan.conflicts.push(`${section} ${id}.${field} changed again since; left as is.`);
          continue;
        }
        patch[field] = was[field] === undefined ? cleared : was[field];
      }
      if (Object.keys(patch).length) plan.patches.push({ section, id, patch });
    }
    for (const id of a.keys()) {
      if (!b.has(id) && c.has(id)) plan.deletes.push({ section, id });
    }
  }

  // Columns of tables that exist on both sides (new/removed tables carry their columns).
  const bt = new Map(before.tables.map((t) => [t.id, t]));
  const at = new Map(after.tables.map((t) => [t.id, t]));
  const ct = new Map(current.tables.map((t) => [t.id, t]));
  for (const [tid, tAfter] of at) {
    const tBefore = bt.get(tid);
    const tNow = ct.get(tid);
    if (!tBefore || !tNow) continue;
    const bc = new Map(tBefore.columns.map((x) => [x.id, x]));
    const cc = new Map(tNow.columns.map((x) => [x.id, x]));
    for (const col of tAfter.columns) {
      const was = bc.get(col.id);
      const cur = cc.get(col.id);
      if (!was) {
        if (cur) plan.columnDeletes.push(col.id);
        continue;
      }
      if (!cur) continue;
      const patch: Record<string, unknown> = {};
      for (const [field, cleared] of Object.entries(COLUMN_FIELDS)) {
        const w = (was as unknown as Record<string, unknown>)[field];
        const n = (col as unknown as Record<string, unknown>)[field];
        if (same(w, n)) continue;
        if (!same((cur as unknown as Record<string, unknown>)[field], n)) {
          plan.conflicts.push(`column ${tAfter.name}.${col.name}.${field} changed again since; left as is.`);
          continue;
        }
        patch[field] = w === undefined ? cleared : w;
      }
      if (Object.keys(patch).length) plan.columnPatches.push({ id: col.id, patch });
    }
    for (const col of tBefore.columns) {
      if (!tAfter.columns.some((x) => x.id === col.id) && !tNow.columns.some((x) => x.id === col.id)) {
        plan.restore.columns.push({ tableId: tid, column: col });
      }
    }
  }
  return plan;
}

/** True when two schemas differ in anything the journal tracks. */
export function schemaChanged(a: SchemaModel, b: SchemaModel): boolean {
  return (
    !same(a.tables, b.tables) ||
    !same(a.elements, b.elements) ||
    !same(a.sequenceDiagrams, b.sequenceDiagrams) ||
    !same(a.lifelines, b.lifelines) ||
    !same(a.sequenceMessages, b.sequenceMessages) ||
    !same(a.relationships, b.relationships)
  );
}
