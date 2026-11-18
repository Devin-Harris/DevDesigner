import type {
   CanvasElementModel,
   LifelineModel,
   RelationshipModel,
   SchemaModel,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
} from '@devdesigner/shared';
import { elementBox, tableBox, sequenceBounds } from '../../../editor';
import type { Box } from '../../../editor';

/** Where an item differs: only on this computer, only on the server, or in both with changes. */
export type DiffSide = 'mine' | 'server' | 'changed';

/** One canvas item (table, shape, sequence diagram, relationship) that differs. */
export interface DiffEntry {
   key: string;
   kind: 'table' | 'relationship' | 'element' | 'diagram';
   side: DiffSide;
   label: string;
   /** What differs, in words ("column email added", "moved", "text changed"). */
   details: string[];
   /** Where to highlight it in each version (absent where it does not exist). */
   mineBox?: Box;
   serverBox?: Box;
}

/** Fields that legitimately differ between two copies of the same project (per-server ids). */
const IGNORED_FIELDS = new Set(['fileId', 'updatedAt', 'createdAt']);

const POSITION_FIELDS = new Set(['x', 'y', 'points']);
const SIZE_FIELDS = new Set(['width', 'height', 'scale', 'expandedHeight']);

/**
 * Compare this computer's version of a project with the server's, item by item.
 * Columns and indexes roll up to their table, lifelines and messages to their diagram,
 * so every entry is something visible on the canvas with a box to highlight.
 */
export function diffSchemas(mine: SchemaModel, server: SchemaModel): DiffEntry[] {
   const out: DiffEntry[] = [];

   // --- Tables (with their columns and indexes) ---
   for (const [id, a, b] of pairs(mine.tables, server.tables)) {
      const details = a && b ? tableChanges(a, b) : [];
      if (a && b && !details.length) continue;
      out.push({
         key: `table:${id}`,
         kind: 'table',
         side: sideOf(a, b),
         label: `Table ${(b ?? a)!.name}`,
         details: a && b ? details : [a ? 'only on this computer' : 'only on the server'],
         mineBox: a ? tableBox(a) : undefined,
         serverBox: b ? tableBox(b) : undefined,
      });
   }

   // --- Relationships: highlighted across the two tables they connect ---
   const relBox = (schema: SchemaModel, r: RelationshipModel): Box | undefined => {
      const owner = (columnId: string) => schema.tables.find((t) => t.columns.some((c) => c.id === columnId));
      const boxes = [owner(r.sourceColumnId), owner(r.targetColumnId)]
         .filter((t): t is TableModel => !!t)
         .map(tableBox);
      return boxes.length ? union(boxes) : undefined;
   };
   for (const [id, a, b] of pairs(mine.relationships, server.relationships)) {
      const changed = a && b ? fieldChanges(a, b) : [];
      if (a && b && !changed.length) continue;
      out.push({
         key: `relationship:${id}`,
         kind: 'relationship',
         side: sideOf(a, b),
         label: `Relationship ${relationshipName(server, mine, (b ?? a)!)}`,
         details: a && b ? describe(changed) : [a ? 'only on this computer' : 'only on the server'],
         mineBox: a ? relBox(mine, a) : undefined,
         serverBox: b ? relBox(server, b) : undefined,
      });
   }

   // --- Canvas elements ---
   for (const [id, a, b] of pairs(mine.elements, server.elements)) {
      const changed = a && b ? fieldChanges(a, b) : [];
      if (a && b && !changed.length) continue;
      const e = (b ?? a)!;
      out.push({
         key: `element:${id}`,
         kind: 'element',
         side: sideOf(a, b),
         label: elementLabel(e),
         details: a && b ? describe(changed) : [a ? 'only on this computer' : 'only on the server'],
         mineBox: a ? elementBox(a) : undefined,
         serverBox: b ? elementBox(b) : undefined,
      });
   }

   // --- Sequence diagrams (with their lifelines and messages) ---
   for (const [id, a, b] of pairs(mine.sequenceDiagrams, server.sequenceDiagrams)) {
      const details = a && b ? diagramChanges(mine, server, a, b) : [];
      if (a && b && !details.length) continue;
      const d = (b ?? a)!;
      out.push({
         key: `diagram:${id}`,
         kind: 'diagram',
         side: sideOf(a, b),
         label: `Sequence diagram ${d.title?.trim() || ''}`.trim(),
         details: a && b ? details : [a ? 'only on this computer' : 'only on the server'],
         mineBox: a ? diagramBox(mine, a) : undefined,
         serverBox: b ? diagramBox(server, b) : undefined,
      });
   }
   return out;
}

/** The world box both versions fit in (with a margin), for drawing them at one scale. */
export function compareBounds(entries: readonly DiffEntry[], all: readonly (Box | undefined)[]): Box {
   const boxes = [...all, ...entries.flatMap((e) => [e.mineBox, e.serverBox])].filter((b): b is Box => !!b);
   const box = boxes.length ? union(boxes) : { x0: 0, y0: 0, x1: 800, y1: 600 };
   const pad = 60;
   return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

/** Every drawn item's box in a schema (to frame the whole drawing, not just the changes). */
export function contentBoxes(schema: SchemaModel): Box[] {
   return [
      ...schema.tables.map(tableBox),
      ...schema.elements.filter((e) => e.type !== 'frame' || !e.slide).map(elementBox),
      ...schema.sequenceDiagrams.map((d) => diagramBox(schema, d)).filter((b): b is Box => !!b),
   ];
}

// --- helpers ---

function pairs<T extends { id: string }>(
   mine: readonly T[],
   server: readonly T[]
): Array<[string, T | undefined, T | undefined]> {
   const a = new Map(mine.map((x) => [x.id, x]));
   const b = new Map(server.map((x) => [x.id, x]));
   return [...new Set([...a.keys(), ...b.keys()])].map((id) => [id, a.get(id), b.get(id)]);
}

function sideOf(a: unknown, b: unknown): DiffSide {
   return a && b ? 'changed' : a ? 'mine' : 'server';
}

function same(a: unknown, b: unknown): boolean {
   return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Top-level fields whose values differ (ignoring per-server ids). */
function fieldChanges(a: object, b: object, skip: readonly string[] = []): string[] {
   const ra = a as Record<string, unknown>;
   const rb = b as Record<string, unknown>;
   const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
   return [...keys].filter((k) => !IGNORED_FIELDS.has(k) && !skip.includes(k) && !same(ra[k], rb[k]));
}

/** Changed field names in words, folding position and size fields together. */
function describe(fields: readonly string[]): string[] {
   const out = new Set<string>();
   for (const f of fields) {
      if (POSITION_FIELDS.has(f)) out.add('moved');
      else if (SIZE_FIELDS.has(f)) out.add('resized');
      else if (f === 'text' || f === 'runs') out.add('text changed');
      else out.add(`${humanize(f)} changed`);
   }
   return [...out];
}

function tableChanges(a: TableModel, b: TableModel): string[] {
   const out = describe(fieldChanges(a, b, ['columns', 'indexes']));
   for (const [, ca, cb] of pairs(a.columns, b.columns)) {
      const name = (cb ?? ca)!.name;
      if (!ca) out.push(`column ${name} only on the server`);
      else if (!cb) out.push(`column ${name} only on this computer`);
      else if (fieldChanges(ca, cb).length) out.push(`column ${name} changed`);
   }
   if (
      !same(
         a.columns.map((c) => c.id),
         b.columns.map((c) => c.id)
      ) &&
      !out.some((d) => d.startsWith('column'))
   ) {
      out.push('columns reordered');
   }
   if (!same(a.indexes, b.indexes)) out.push('indexes changed');
   return out;
}

function diagramChanges(
   mine: SchemaModel,
   server: SchemaModel,
   a: SequenceDiagramModel,
   b: SequenceDiagramModel
): string[] {
   const out = describe(fieldChanges(a, b));
   const of = <T extends { diagramId: string; id: string }>(list: readonly T[], id: string) =>
      list.filter((x) => x.diagramId === id);
   const count = (
      label: string,
      x: readonly (LifelineModel | SequenceMessageModel)[],
      y: readonly (LifelineModel | SequenceMessageModel)[]
   ) => {
      let changed = 0;
      for (const [, p, q] of pairs(x, y)) if (!p || !q || fieldChanges(p, q).length) changed++;
      if (changed) out.push(`${changed} ${label}${changed === 1 ? '' : 's'} differ`);
   };
   count('participant', of(mine.lifelines, a.id), of(server.lifelines, b.id));
   count('message', of(mine.sequenceMessages, a.id), of(server.sequenceMessages, b.id));
   return out;
}

function diagramBox(schema: SchemaModel, d: SequenceDiagramModel): Box | undefined {
   return sequenceBounds(d, schema.lifelines, schema.sequenceMessages) ?? undefined;
}

function union(boxes: readonly Box[]): Box {
   return {
      x0: Math.min(...boxes.map((b) => b.x0)),
      y0: Math.min(...boxes.map((b) => b.y0)),
      x1: Math.max(...boxes.map((b) => b.x1)),
      y1: Math.max(...boxes.map((b) => b.y1)),
   };
}

function elementLabel(e: CanvasElementModel): string {
   const text = (e.text ?? '').replace(/\s+/g, ' ').trim();
   const kind = humanize(e.type);
   return text ? `${kind} "${text.length > 32 ? `${text.slice(0, 31)}…` : text}"` : kind;
}

function relationshipName(server: SchemaModel, mine: SchemaModel, r: RelationshipModel): string {
   const tableOf = (columnId: string) =>
      [...server.tables, ...mine.tables].find((t) => t.columns.some((c) => c.id === columnId))?.name ?? '?';
   return `${tableOf(r.sourceColumnId)} → ${tableOf(r.targetColumnId)}`;
}

function humanize(name: string): string {
   const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
   return words.charAt(0).toUpperCase() + words.slice(1);
}
