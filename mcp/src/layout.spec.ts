import type { CanvasElementModel, SchemaModel, SequenceDiagramModel, TableModel } from '@devdesigner/shared';
import {
  arrangeStack,
  buildUnits,
  collectItems,
  compactUnits,
  findOffSlide,
  findOutOfBounds,
  placement,
  findOverlaps,
  findTextOverflow,
  findUnattached,
  gravityDeltas,
  keyOf,
  planScale,
  slideFramesOf,
  squeezeDeltas,
  stackOrder,
  stackToZ,
} from './layout';

function el(id: string, over: Partial<CanvasElementModel> = {}): CanvasElementModel {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: '#1e1e1e',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    zIndex: 0,
    ...over,
  };
}

function table(id: string, x: number, y: number, over: Partial<TableModel> = {}): TableModel {
  return {
    id,
    name: id,
    x,
    y,
    columns: [
      {
        id: `${id}-c`,
        name: 'id',
        dataType: { name: 'INT' },
        isPrimaryKey: true,
        isNullable: false,
        isUnique: false,
        isAutoIncrement: false,
      },
    ],
    ...over,
  };
}

function schemaOf(parts: Partial<SchemaModel>): SchemaModel {
  return {
    tables: [],
    relationships: [],
    notes: [],
    elements: [],
    sequenceDiagrams: [],
    lifelines: [],
    sequenceMessages: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...parts,
  };
}

describe('findOverlaps', () => {
  it('reports partial overlaps but not nesting', () => {
    const schema = schemaOf({
      elements: [
        el('a', { x: 0, y: 0, width: 200, height: 100 }),
        el('b', { x: 150, y: 50, width: 200, height: 100 }),
        el('label', { type: 'text', x: 10, y: 10, width: 50, height: 20 }),
      ],
    });
    const hits = findOverlaps(collectItems(schema));
    expect(hits).toHaveLength(1);
    expect([hits[0].a.id, hits[0].b.id].sort()).toEqual(['a', 'b']);
    expect(hits[0].intersection).toEqual({ x: 150, y: 50, w: 50, h: 50 });
    expect(findOverlaps(collectItems(schema), { includeNested: true })).toHaveLength(2);
  });

  it('never compares items of different slides', () => {
    const schema = schemaOf({
      elements: [el('a', { slideId: 's1' }), el('b', { slideId: 's2' }), el('c', { slideId: 's1', x: 50 })],
    });
    const hits = findOverlaps(collectItems(schema));
    expect(hits.map((h) => [h.a.id, h.b.id])).toEqual([['a', 'c']]);
  });

  it('honours table scale in the footprint', () => {
    const big = table('big', 0, 0, { scale: 2 });
    const next = table('next', 400, 0);
    expect(findOverlaps(collectItems(schemaOf({ tables: [table('big', 0, 0), next] })))).toHaveLength(0);
    expect(findOverlaps(collectItems(schemaOf({ tables: [big, next] })))).toHaveLength(1);
  });
});

describe('slide bounds', () => {
  const frame = el('f', { type: 'frame', x: 1000, y: 1000, width: 1280, height: 720, slide: { order: 0 } });

  it('reports overflow per side', () => {
    const schema = schemaOf({
      elements: [
        frame,
        el('in', { x: 1100, y: 1100, slideId: 'f' }),
        el('out', { x: 2200, y: 1650, width: 200, height: 100, slideId: 'f' }),
      ],
    });
    const rows = findOutOfBounds(collectItems(schema), slideFramesOf(schema));
    expect(rows).toHaveLength(1);
    expect(rows[0].item.id).toBe('out');
    expect(rows[0].overflow).toEqual({ left: 0, top: 0, right: 120, bottom: 30 });
    expect(rows[0].fullyOutside).toBe(false);
  });

  it('treats items wholly outside the frame as staging, not overflow', () => {
    const schema = schemaOf({
      elements: [frame, el('staged', { x: 1000, y: 600, width: 200, height: 100, slideId: 'f' })],
    });
    const items = collectItems(schema);
    expect(findOutOfBounds(items, slideFramesOf(schema))).toHaveLength(0);
    expect(findOffSlide(items, slideFramesOf(schema)).map((i) => i.id)).toEqual(['staged']);
    expect(placement(items[0].rect, slideFramesOf(schema)[0].rect)).toBe('offslide');
  });

  it('finds free items sitting on a slide', () => {
    const schema = schemaOf({
      elements: [frame, el('loose', { x: 1100, y: 1100 }), el('away', { x: 0, y: 0 })],
    });
    const rows = findUnattached(collectItems(schema), slideFramesOf(schema));
    expect(rows.map((r) => r.item.id)).toEqual(['loose']);
  });
});

describe('findTextOverflow', () => {
  it('flags a label that cannot fit its shape', () => {
    const schema = schemaOf({
      elements: [
        el('tight', { x: 0, y: 0, width: 80, height: 30, text: 'a long label that needs several lines', fontSize: 18 }),
        el('roomy', { x: 300, y: 0, width: 400, height: 120, text: 'short', fontSize: 18 }),
      ],
    });
    expect(findTextOverflow(schema).map((r) => r.item.id)).toEqual(['tight']);
  });
});

describe('compaction', () => {
  it('squeezes empty gutters but keeps alignment', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 500, y: 0, w: 100, h: 50 },
      { x: 500, y: 200, w: 100, h: 50 },
    ];
    expect(squeezeDeltas(rects, 'x', 40)).toEqual([0, -360, -360]);
    expect(squeezeDeltas(rects, 'y', 40)).toEqual([0, 0, -110]);
  });

  it('does not widen small gaps', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 50 },
    ];
    expect(squeezeDeltas(rects, 'x', 40)).toEqual([0, 0]);
  });

  it('gravity packs toward the top-left without overlapping', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 100 },
      { x: 400, y: 20, w: 100, h: 100 },
      { x: 400, y: 400, w: 100, h: 100 },
    ];
    const dx = gravityDeltas(rects, 'x', 20);
    expect(dx).toEqual([0, -280, -400]);
  });

  it('moves overlapping items as one block', () => {
    const schema = schemaOf({
      elements: [
        el('box', { x: 400, y: 0, width: 200, height: 100 }),
        el('label', { type: 'text', x: 420, y: 20, width: 80, height: 20 }),
        el('anchor', { x: 0, y: 0, width: 100, height: 100 }),
      ],
    });
    const units = buildUnits(collectItems(schema));
    expect(units).toHaveLength(2);
    const moves = compactUnits(units, { mode: 'gutters', gap: 50, axis: 'x' });
    const boxUnit = units.findIndex((u) => u.keys.includes(keyOf('element', 'box')));
    expect(units[boxUnit].keys).toContain(keyOf('element', 'label'));
    expect(moves[boxUnit]).toEqual({ dx: -250, dy: 0 });
  });

  it('keeps grouped items together', () => {
    const schema = schemaOf({
      elements: [
        el('g1', { x: 0, y: 0, groupId: 'g' }),
        el('g2', { x: 600, y: 0, groupId: 'g' }),
      ],
    });
    expect(buildUnits(collectItems(schema))).toHaveLength(1);
  });
});

describe('planScale', () => {
  it('scales a table group about its top-left and scales distances', () => {
    const schema = schemaOf({ tables: [table('a', 100, 100), table('b', 500, 100)] });
    const plan = planScale(
      schema,
      { tableIds: new Set(['a', 'b']), elementIds: new Set(), diagramIds: new Set() },
      { factor: 0.5 },
    );
    expect(plan.applied).toBe(0.5);
    expect(plan.tables.find((t) => t.id === 'a')).toMatchObject({ scale: 0.5, x: 100, y: 100 });
    expect(plan.tables.find((t) => t.id === 'b')).toMatchObject({ scale: 0.5, x: 300, y: 100 });
  });

  it('clamps to the editor range and says so', () => {
    const schema = schemaOf({ tables: [table('a', 0, 0, { scale: 0.5 })] });
    const plan = planScale(
      schema,
      { tableIds: new Set(['a']), elementIds: new Set(), diagramIds: new Set() },
      { factor: 0.1 },
    );
    expect(plan.applied).toBe(0.8);
    expect(plan.tables[0].scale).toBe(0.4);
    expect(plan.notes[0]).toMatch(/applied factor 0.8/);
  });

  it('sets an exact table scale without moving anything', () => {
    const schema = schemaOf({ tables: [table('a', 10, 20), table('b', 600, 20)] });
    const plan = planScale(
      schema,
      { tableIds: new Set(['a', 'b']), elementIds: new Set(), diagramIds: new Set() },
      { absoluteScale: 0.75 },
    );
    expect(plan.tables.map((t) => [t.scale, t.x, t.y])).toEqual([
      [0.75, 10, 20],
      [0.75, 600, 20],
    ]);
  });

  it('scales element size, font and line vertices', () => {
    const schema = schemaOf({
      elements: [
        el('t', { type: 'text', x: 0, y: 0, width: 200, height: 40, fontSize: 20, text: 'hi' }),
        el('l', { type: 'line', x: 100, y: 100, width: 100, height: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }),
      ],
    });
    const plan = planScale(
      schema,
      { tableIds: new Set(), elementIds: new Set(['t', 'l']), diagramIds: new Set() },
      { factor: 2 },
    );
    const t = plan.elements.find((e) => e.id === 't');
    expect(t?.patch).toMatchObject({ width: 400, height: 80, fontSize: 40 });
    const l = plan.elements.find((e) => e.id === 'l');
    expect(l?.position?.points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
  });
});

describe('stacking', () => {
  const diagram = (id: string, zIndex: number): SequenceDiagramModel => ({
    id,
    lifelineSpacing: 200,
    rowSpacing: 60,
    headerHeight: 40,
    originY: 0,
    zIndex,
  });

  it('merges diagrams between elements by fractional zIndex', () => {
    const schema = schemaOf({
      elements: [el('a', { zIndex: 0 }), el('b', { zIndex: 1 }), el('c', { zIndex: 2 })],
      sequenceDiagrams: [diagram('d', 1.5)],
    });
    expect(stackOrder(schema).map((s) => s.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('front / back / above', () => {
    const schema = schemaOf({
      elements: [el('a', { zIndex: 0 }), el('b', { zIndex: 1 }), el('c', { zIndex: 2 })],
    });
    const stack = stackOrder(schema);
    const sel = new Set([keyOf('element', 'a')]);
    expect(arrangeStack(stack, sel, 'front').map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(arrangeStack(stack, new Set([keyOf('element', 'c')]), 'back').map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(
      arrangeStack(stack, sel, 'above', { reference: keyOf('element', 'b') }).map((s) => s.id),
    ).toEqual(['b', 'a', 'c']);
  });

  it('forward hops past the next overlapping item, not just the next one', () => {
    const schema = schemaOf({
      elements: [
        el('low', { zIndex: 0, x: 0, y: 0 }),
        el('far', { zIndex: 1, x: 1000, y: 1000 }),
        el('near', { zIndex: 2, x: 20, y: 10 }),
      ],
    });
    const stack = stackOrder(schema);
    const next = arrangeStack(stack, new Set([keyOf('element', 'low')]), 'forward');
    expect(next.map((s) => s.id)).toEqual(['far', 'near', 'low']);
  });

  it('writes element indices and diagram fractions', () => {
    const schema = schemaOf({
      elements: [el('a', { zIndex: 0 }), el('b', { zIndex: 1 })],
      sequenceDiagrams: [diagram('d', -1)],
    });
    const stack = stackOrder(schema);
    const sel = new Set([keyOf('diagram', 'd')]);
    const next = arrangeStack(stack, sel, 'front');
    const { elementOrder, diagramZ } = stackToZ(next, sel, 'front');
    expect(elementOrder).toEqual(['a', 'b']);
    expect(diagramZ.get('d')).toBe(1.5);
  });
});
