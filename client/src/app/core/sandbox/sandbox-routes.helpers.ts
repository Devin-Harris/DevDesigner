import type {
   ColumnModel,
   IndexModel,
   LifelineModel,
   SchemaModel,
   SequenceDiagramModel,
   SequenceMessageModel,
} from '@devdesigner/shared';
import { assertKnown, type Dict, patch, SandboxError, tablePatch, uuid } from './sandbox.helpers';
import { deleteDiagram, deleteTable } from './sandbox-schema.helpers';

export type SandboxEntityKind = 'element' | 'table' | 'column' | 'index' | 'relationship';

/** /elements|tables|columns|indexes|relationships/:id[/…] against one sandbox schema. */
export function entityRoute(
   s: SchemaModel,
   method: string,
   kind: SandboxEntityKind,
   id: string,
   rest: string[],
   b: Dict
): unknown {
   switch (kind) {
      case 'element': {
         const i = s.elements.findIndex((e) => e.id === id);
         if (method === 'DELETE') {
            s.elements.splice(i, 1);
            return null;
         }
         s.elements[i] = patch(s.elements[i], b);
         return rest[0] === 'position' ? null : s.elements[i];
      }
      case 'table': {
         const i = s.tables.findIndex((t) => t.id === id);
         const t = s.tables[i];
         if (rest[0] === 'columns') {
            if (rest[1] === 'reorder') {
               const order = (b['orderedColumnIds'] as string[]) ?? [];
               t.columns = order.map((cid) => t.columns.find((c) => c.id === cid)!).filter(Boolean);
               return null;
            }
            const c = patch(
               {
                  id: uuid(),
                  isPrimaryKey: false,
                  isNullable: true,
                  isUnique: false,
                  isAutoIncrement: false,
               } as ColumnModel,
               b,
               ['id']
            );
            t.columns.push(c);
            return c;
         }
         if (rest[0] === 'indexes') {
            t.indexes ??= [];
            if (rest[1] === 'reorder') {
               const order = (b['orderedIndexIds'] as string[]) ?? [];
               t.indexes = order.map((x) => t.indexes!.find((ix) => ix.id === x)!).filter(Boolean);
               return null;
            }
            assertKnown((b['columnIds'] as unknown[]) ?? [], t.columns, 'Column');
            const ix = patch({ id: uuid(), isUnique: false, columnIds: [] } as unknown as IndexModel, b, ['id']);
            t.indexes.push(ix);
            return ix;
         }
         if (method === 'DELETE') {
            deleteTable(s, id);
            return null;
         }
         s.tables[i] = tablePatch(t, b);
         return rest[0] === 'position' ? null : s.tables[i];
      }
      case 'column': {
         const t = s.tables.find((x) => x.columns.some((c) => c.id === id))!;
         if (method === 'DELETE') {
            t.columns = t.columns.filter((c) => c.id !== id);
            s.relationships = s.relationships.filter((r) => r.sourceColumnId !== id && r.targetColumnId !== id);
            return null;
         }
         const ci = t.columns.findIndex((c) => c.id === id);
         t.columns[ci] = patch(t.columns[ci], b);
         return t.columns[ci];
      }
      case 'index': {
         const t = s.tables.find((x) => (x.indexes ?? []).some((ix) => ix.id === id))!;
         if (method === 'DELETE') {
            t.indexes = t.indexes!.filter((ix) => ix.id !== id);
            return null;
         }
         const ii = t.indexes!.findIndex((ix) => ix.id === id);
         t.indexes![ii] = patch(t.indexes![ii], b);
         return t.indexes![ii];
      }
      case 'relationship': {
         const ri = s.relationships.findIndex((r) => r.id === id);
         if (method === 'DELETE') {
            s.relationships.splice(ri, 1);
            return null;
         }
         s.relationships[ri] = patch(s.relationships[ri], b);
         return s.relationships[ri];
      }
   }
}

export function diagramRoute(s: SchemaModel, method: string, id: string | undefined, b: Dict): unknown {
   if (method === 'POST') {
      const d = patch(
         { id: uuid(), lifelineSpacing: 160, rowSpacing: 48, headerHeight: 42, zIndex: -1 } as SequenceDiagramModel,
         b,
         ['id']
      );
      s.sequenceDiagrams.push(d);
      return d;
   }
   const i = s.sequenceDiagrams.findIndex((d) => d.id === id);
   if (i < 0) throw new SandboxError(404, 'Diagram not found.');
   if (method === 'DELETE') {
      deleteDiagram(s, id!);
      return null;
   }
   s.sequenceDiagrams[i] = patch(s.sequenceDiagrams[i], b);
   return s.sequenceDiagrams[i];
}

export function lifelineRoute(
   s: SchemaModel,
   method: string,
   id: string | undefined,
   sub: string | undefined,
   b: Dict
): unknown {
   if (method === 'POST') {
      const l = patch({ id: uuid(), width: 120, order: 0 } as LifelineModel, b, ['id']);
      s.lifelines.push(l);
      return l;
   }
   const i = s.lifelines.findIndex((l) => l.id === id);
   if (i < 0) throw new SandboxError(404, 'Participant not found.');
   if (method === 'DELETE') {
      s.lifelines.splice(i, 1);
      s.sequenceMessages = s.sequenceMessages.filter((m) => m.fromLifelineId !== id && m.toLifelineId !== id);
      return null;
   }
   s.lifelines[i] = patch(s.lifelines[i], b);
   return sub === 'position' ? null : s.lifelines[i];
}

export function messageRoute(
   s: SchemaModel,
   method: string,
   id: string | undefined,
   sub: string | undefined,
   b: Dict
): unknown {
   if (method === 'POST') {
      if (b['style'] !== 'break' && b['fromLifelineId'] === b['toLifelineId']) {
         throw new SandboxError(400, 'A message must go between two different participants.');
      }
      assertKnown([b['fromLifelineId'], b['toLifelineId']], s.lifelines, 'Lifeline');
      const m = patch(
         { id: uuid(), style: 'solid', direction: 'forward', arrowhead: 'arrow' } as SequenceMessageModel,
         b,
         ['id']
      );
      s.sequenceMessages.push(m);
      return m;
   }
   const i = s.sequenceMessages.findIndex((m) => m.id === id);
   if (i < 0) throw new SandboxError(404, 'Message not found.');
   if (method === 'DELETE') {
      s.sequenceMessages.splice(i, 1);
      return null;
   }
   assertKnown([b['fromLifelineId'], b['toLifelineId']], s.lifelines, 'Lifeline');
   s.sequenceMessages[i] = patch(s.sequenceMessages[i], b);
   return sub === 'position' ? null : s.sequenceMessages[i];
}
