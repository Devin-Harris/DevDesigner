import type { CanvasElementModel, ColumnModel, RelationshipModel, TableModel } from '@devdesigner/shared';
import { tokenizeCode } from './code-highlight.helper';
import { ConnectorRouteCache, computeConnectors } from './connectors.helper';
import { ShapeViewCache, buildShapeViews } from './render';

const el = (id: string, over: Partial<CanvasElementModel> = {}): CanvasElementModel =>
   ({
      id,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: 0,
      strokeColor: '#000000',
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 100,
      zIndex: 0,
      ...over,
   }) as CanvasElementModel;

describe('buildShapeViews memo (P2.2)', () => {
   const none = new Set<string>();

   it('reuses the view of an unchanged element and rebuilds only what changed', () => {
      const memo = { cache: new ShapeViewCache(), generation: 0 };
      const a = el('a');
      const b = el('b', { x: 200 });
      const [va1, vb1] = buildShapeViews([a, b], [], none, undefined, undefined, null, memo);
      const moved = { ...b, x: 300 };
      const [va2, vb2] = buildShapeViews([a, moved], [], none, undefined, undefined, null, memo);
      expect(va2).toBe(va1);
      expect(vb2).not.toBe(vb1);
      expect(vb2.rect?.x).toBe(300);
   });

   it('treats an equal copy of an element (themed / placeholder copies) as unchanged', () => {
      const memo = { cache: new ShapeViewCache(), generation: 0 };
      const a = el('a', { runs: [{ text: 'x' }] } as Partial<CanvasElementModel>);
      const [v1] = buildShapeViews([a], [], none, undefined, undefined, null, memo);
      const [v2] = buildShapeViews([{ ...a, runs: [...a.runs!] }], [], none, undefined, undefined, null, memo);
      expect(v2).toBe(v1);
   });

   it('rebuilds on selection, theme or font-generation changes', () => {
      const memo = { cache: new ShapeViewCache(), generation: 0 };
      const a = el('a');
      const [v1] = buildShapeViews([a], [], none, undefined, undefined, null, memo);
      const [v2] = buildShapeViews([a], [], new Set(['a']), undefined, undefined, null, memo);
      expect(v2).not.toBe(v1);
      expect(v2.selected).toBe(true);
      const theme = { canvasBg: '#000000', text: '#ffffff', surface: '#111111' };
      const [v3] = buildShapeViews([a], [], new Set(['a']), theme, undefined, null, memo);
      expect(v3).not.toBe(v2);
      memo.generation = 1;
      const [v4] = buildShapeViews([a], [], new Set(['a']), theme, undefined, null, memo);
      expect(v4).not.toBe(v3);
   });

   it('re-resolves a bound arrow when its target moves', () => {
      const memo = { cache: new ShapeViewCache(), generation: 0 };
      const target = el('t', { x: 400 });
      const arrow = el('ar', {
         type: 'arrow',
         points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
         ],
         endBinding: { targetKind: 'element', targetId: 't' },
      } as Partial<CanvasElementModel>);
      const first = buildShapeViews([arrow, target], [], none, undefined, undefined, null, memo);
      const again = buildShapeViews([arrow, target], [], none, undefined, undefined, null, memo);
      expect(again[0]).toBe(first[0]);
      const moved = buildShapeViews([arrow, { ...target, y: 300 }], [], none, undefined, undefined, null, memo);
      expect(moved[0]).not.toBe(first[0]);
   });

   it('keeps a clipped view stable and never writes the clip onto the shared view', () => {
      const memo = { cache: new ShapeViewCache(), generation: 0 };
      const frame = el('f', {
         type: 'frame',
         width: 500,
         height: 500,
         clipContent: true,
      } as Partial<CanvasElementModel>);
      const inside = el('in', { x: 10, y: 10 });
      const first = buildShapeViews([frame, inside], [], none, undefined, undefined, null, memo);
      const again = buildShapeViews([frame, inside], [], none, undefined, undefined, null, memo);
      const v1 = first.find((v) => v.id === 'in')!;
      expect(v1.frameClip).toEqual({ x: 0, y: 0, width: 500, height: 500 });
      expect(again.find((v) => v.id === 'in')).toBe(v1);
      const unclipped = buildShapeViews([inside], [], none, undefined, undefined, null, memo);
      expect(unclipped[0].frameClip).toBeUndefined();
   });

   it('matches the unmemoized output', () => {
      const els = [el('a'), el('b', { type: 'ellipse', x: 50 }), el('c', { type: 'text', text: 'hi' })];
      const memo = { cache: new ShapeViewCache(), generation: 0 };
      buildShapeViews(els, [], none, undefined, undefined, null, memo);
      expect(buildShapeViews(els, [], none, undefined, undefined, null, memo)).toEqual(buildShapeViews(els, [], none));
   });
});

describe('tokenizeCode cache (P2.2)', () => {
   it('returns the same token lines for the same code and language', () => {
      const a = tokenizeCode('const x = 1;', 'typescript');
      expect(tokenizeCode('const x = 1;', 'typescript')).toBe(a);
      expect(tokenizeCode('const x = 1;', 'python')).not.toBe(a);
   });
});

describe('computeConnectors route memo (P2.3)', () => {
   const col = (id: string): ColumnModel =>
      ({
         id,
         name: id,
         dataType: { name: 'INT' },
         isPrimaryKey: false,
         isNullable: true,
         isUnique: false,
      }) as ColumnModel;
   const tbl = (id: string, x: number, y: number): TableModel =>
      ({ id, name: id, x, y, columns: [col(id + '.c')] }) as TableModel;
   const rel = (id: string, s: string, t: string): RelationshipModel =>
      ({ id, sourceColumnId: s + '.c', targetColumnId: t + '.c', type: 'ONE_TO_MANY' }) as RelationshipModel;

   it('matches the uncached routes and reuses those nothing moved around', () => {
      const tables = [tbl('a', 0, 0), tbl('b', 600, 0), tbl('c', 0, 2000), tbl('d', 600, 2000)];
      const rels = [rel('ab', 'a', 'b'), rel('cd', 'c', 'd')];
      const cache = new ConnectorRouteCache();
      const first = computeConnectors(tables, rels, new Set(), [], cache);
      expect(first.map((c) => c.d)).toEqual(computeConnectors(tables, rels, new Set()).map((c) => c.d));
      const ab = cache.entries.get('ab');
      const cd = cache.entries.get('cd');

      const moved = [tables[0], tables[1], tables[2], tbl('d', 700, 2100)];
      const second = computeConnectors(moved, rels, new Set(), [], cache);
      expect(cache.entries.get('ab')).toBe(ab);
      expect(cache.entries.get('cd')).not.toBe(cd);
      expect(second.map((c) => c.d)).toEqual(computeConnectors(moved, rels, new Set()).map((c) => c.d));
   });
});
