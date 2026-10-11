import { slideSequence, presentationSlides } from '../slides';
import { isSoloTag } from './presentation';
import {
  buildPresentationFile,
  normalizeTransition,
  shiftPresentation,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  stackSlideFrames,
} from './presentation';

const frame = { x: 100, y: 200, width: SLIDE_WIDTH, height: SLIDE_HEIGHT };

describe('buildPresentationFile', () => {
  const built = buildPresentationFile(
    [
      { title: 'Intro', notes: 'say hi', content: [{ type: 'bullets', items: ['one', 'two'] }] },
      {
        title: 'Schema',
        transition: { type: 'morph' },
        content: [
          {
            type: 'schema',
            tables: [
              { name: 'users', columns: [{ name: 'id', type: 'INT', primaryKey: true }] },
              { name: 'posts', columns: [{ name: 'user_id', type: 'INT', references: 'users.id' }] },
            ],
          },
        ],
      },
      { content: [{ type: 'sequence', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'hi' }] }], hidden: true },
    ],
    { presentation: 'Demo', frame, defaultTransition: { type: 'fade', duration: 400 } },
  );
  const { schema } = built.file;

  it('creates ordered, stacked slide frames of one presentation', () => {
    const frames = schema.elements.filter((e) => e.type === 'frame');
    expect(frames).toHaveLength(3);
    expect(slideSequence(frames).map((f) => f.id)).toEqual(built.frameIds);
    expect(presentationSlides(frames, 'Demo')).toHaveLength(3);
    expect(new Set(frames.map((f) => `${f.x},${f.y},${f.width},${f.height}`)).size).toBe(1);
    expect(frames[2].slide?.hidden).toBe(true);
    expect(frames[0].slide?.notes).toBe('say hi');
  });

  it('applies the default transition unless a slide overrides it', () => {
    const frames = schema.elements.filter((e) => e.type === 'frame');
    expect(frames[0].slide?.transition).toMatchObject({ type: 'fade', duration: 400 });
    expect(frames[1].slide?.transition).toMatchObject({ type: 'morph', duration: 600 });
  });

  it('owns content through slideId and keeps ids unique', () => {
    const frameIds = new Set(built.frameIds);
    const owned = schema.elements.filter((e) => e.type !== 'frame');
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((e) => e.slideId && frameIds.has(e.slideId))).toBe(true);
    expect(schema.tables.every((t) => t.slideId && frameIds.has(t.slideId))).toBe(true);
    expect(schema.sequenceDiagrams.every((d) => d.slideId && frameIds.has(d.slideId))).toBe(true);
    const ids = [
      ...schema.elements.map((e) => e.id),
      ...schema.tables.map((t) => t.id),
      ...schema.tables.flatMap((t) => t.columns.map((c) => c.id)),
      ...schema.lifelines.map((l) => l.id),
      ...schema.sequenceMessages.map((m) => m.id),
      ...schema.relationships.map((r) => r.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps content inside the slide frame', () => {
    const inside = schema.elements
      .filter((e) => e.type !== 'frame')
      .every((e) => e.x >= frame.x && e.y >= frame.y && e.x + e.width <= frame.x + frame.width);
    expect(inside).toBe(true);
    expect(built.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify(built.file))).toEqual(built.file);
  });

  it('warns when content overflows the slide', () => {
    const big = buildPresentationFile(
      [{ content: Array.from({ length: 12 }, () => ({ type: 'heading' as const, text: 'Heading' })) }],
      { presentation: 'P', frame },
    );
    expect(big.warnings.some((w) => /past the slide edge/.test(w))).toBe(true);
  });
});

describe('default transition', () => {
  it('gives every slide a 300ms morph unless it says otherwise', () => {
    const built = buildPresentationFile(
      [{ title: 'A' }, { title: 'B' }, { title: 'C', transition: { type: 'none' } }],
      { presentation: 'P', frame },
    );
    const t = built.file.schema.elements
      .filter((e) => e.type === 'frame')
      .map((e) => e.slide?.transition);
    expect(t[0]).toMatchObject({ type: 'morph', duration: 300, easing: 'ease-in-out' });
    expect(t[1]).toMatchObject({ type: 'morph', duration: 300 });
    expect(t[2]).toMatchObject({ type: 'none' });
  });
});

describe('morph tags', () => {
  it('stamps tag lineage ids on tagged items so slides pair by tag', () => {
    const built = buildPresentationFile(
      [
        { content: [{ type: 'shape', shape: 'rectangle', text: 'API', morph: 'api' }] },
        { content: [{ type: 'shape', shape: 'ellipse', text: 'Gateway', morph: ' api ' }, { type: 'text', text: 'plain' }] },
      ],
      { presentation: 'P', frame },
    );
    const els = built.file.schema.elements.filter((e) => e.type !== 'frame');
    expect(els.filter((e) => e.morphId === 'tag:api')).toHaveLength(2);
    // Untagged items get a unique solo tag, so they never morph into look-alikes.
    const solo = els.filter((e) => e.morphId !== 'tag:api');
    expect(solo.length).toBeGreaterThan(0);
    expect(solo.every((e) => isSoloTag(e.morphId))).toBe(true);
  });

  it('gives every untagged object its own morph id', () => {
    const built = buildPresentationFile(
      [
        { title: 'Same', content: [{ type: 'bullets', items: ['x'] }] },
        { title: 'Same', content: [{ type: 'bullets', items: ['x'] }] },
      ],
      { presentation: 'P', frame },
    );
    const ids = built.file.schema.elements.filter((e) => e.type !== 'frame').map((e) => e.morphId);
    expect(ids.every((id) => !!id && isSoloTag(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeTransition', () => {
  it('defaults direction for slide and clamps duration', () => {
    expect(normalizeTransition({ type: 'slide' })).toEqual({
      type: 'slide',
      direction: 'left',
      duration: 600,
      easing: 'ease-in-out',
    });
    expect(normalizeTransition({ type: 'fade', duration: 99999 }).duration).toBe(10000);
  });
});

describe('stackSlideFrames', () => {
  // Build a presentation, then scatter its slides on a grid like a hand-made file.
  const built = buildPresentationFile(
    [
      { title: 'One', content: [{ type: 'bullets', items: ['a'] }] },
      {
        title: 'Two',
        content: [
          { type: 'schema', tables: [{ name: 't', columns: [{ name: 'id', type: 'INT', primaryKey: true }] }] },
          { type: 'sequence', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'x' }] },
        ],
      },
      { title: 'Three' },
    ],
    { presentation: 'Grid', frame },
  );
  const scattered = JSON.parse(JSON.stringify(built.file.schema)) as typeof built.file.schema;
  const offsets = new Map(built.frameIds.map((id, i) => [id, { dx: i * 1400, dy: i * 820 }]));
  for (const e of scattered.elements) {
    const o = offsets.get(e.type === 'frame' ? e.id : (e.slideId as string))!;
    e.x += o.dx;
    e.y += o.dy;
  }
  for (const t of scattered.tables) {
    const o = offsets.get(t.slideId as string)!;
    t.x += o.dx;
    t.y += o.dy;
  }
  for (const d of scattered.sequenceDiagrams) {
    const o = offsets.get(d.slideId as string)!;
    d.originY += o.dy;
    for (const l of scattered.lifelines) if (l.diagramId === d.id) l.x += o.dx;
    for (const m of scattered.sequenceMessages) if (m.diagramId === d.id) m.y += o.dy;
  }

  it('moves every slide onto the first slide spot with its contents', () => {
    const { schema, moved } = stackSlideFrames(scattered);
    expect(moved).toBe(2);
    const frames = schema.elements.filter((e) => e.type === 'frame');
    expect(new Set(frames.map((f) => f.x + ',' + f.y)).size).toBe(1);
    // Content is back exactly where the builder put it.
    const original = built.file.schema;
    const byId = new Map(schema.elements.map((e) => [e.id, e]));
    for (const e of original.elements) {
      expect(byId.get(e.id)).toMatchObject({ x: e.x, y: e.y });
    }
    expect(schema.tables[0]).toMatchObject({ x: original.tables[0].x, y: original.tables[0].y });
    expect(schema.sequenceDiagrams[0].originY).toBe(original.sequenceDiagrams[0].originY);
    expect(schema.lifelines.map((l) => l.x)).toEqual(original.lifelines.map((l) => l.x));
    expect(schema.sequenceMessages.map((m) => m.y)).toEqual(original.sequenceMessages.map((m) => m.y));
  });

  it('does not mutate its input and is idempotent', () => {
    const before = JSON.stringify(scattered);
    const once = stackSlideFrames(scattered);
    expect(JSON.stringify(scattered)).toBe(before);
    expect(stackSlideFrames(once.schema).moved).toBe(0);
  });

  it('claims unowned content inside a slide frame so it moves along', () => {
    const copy = JSON.parse(JSON.stringify(scattered)) as typeof scattered;
    const target = copy.elements.find((e) => e.text === 'Three')!;
    delete target.slideId;
    const { schema, claimed } = stackSlideFrames(copy);
    expect(claimed).toBe(1);
    const original = built.file.schema.elements.find((e) => e.text === 'Three')!;
    expect(schema.elements.find((e) => e.id === target.id)).toMatchObject({ x: original.x, y: original.y });
  });

  it('shifts a whole presentation together', () => {
    const base = stackSlideFrames(scattered).schema;
    const shifted = shiftPresentation(base, 'Grid', 50, -20);
    const f0 = base.elements.find((e) => e.type === 'frame')!;
    const g0 = shifted.elements.find((e) => e.id === f0.id)!;
    expect([g0.x - f0.x, g0.y - f0.y]).toEqual([50, -20]);
    const t0 = base.tables[0];
    expect(shifted.tables[0].x - t0.x).toBe(50);
  });
});

describe('images, colors and per-word tags on slides', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"></svg>';
  const data = Buffer.from(svg).toString('base64');

  it('places an image item at its aspect ratio and embeds the file', () => {
    const built = buildPresentationFile(
      [{ content: [{ type: 'image', image: { mimeType: 'image/svg+xml', data }, width: 400 }] }],
      { presentation: 'P', frame },
    );
    const img = built.file.schema.elements.find((e) => e.type === 'image')!;
    expect(img.width).toBe(400);
    expect(img.height).toBe(200);
    expect(built.file.images).toEqual([{ id: img.fileId, mimeType: 'image/svg+xml', data }]);
    expect(isSoloTag(img.morphId)).toBe(true);
  });

  it('resolves palette names for colors and warns about unknown ones', () => {
    const built = buildPresentationFile(
      [
        {
          content: [
            { type: 'shape', shape: 'rectangle', backgroundColor: 'blue-soft', strokeColor: 'blue' },
            { type: 'text', text: 'hi', color: 'chartreuse' },
          ],
        },
      ],
      { presentation: 'P', frame },
    );
    const shape = built.file.schema.elements.find((e) => e.type === 'rectangle')!;
    expect(shape.backgroundColor).toBe('#dbeafe');
    expect(shape.strokeColor).toBe('#2f6bff');
    expect(built.warnings.some((w) => /chartreuse/.test(w))).toBe(true);
  });

  it('builds text from runs with per-word morph tags', () => {
    const built = buildPresentationFile(
      [
        {
          content: [
            {
              type: 'text',
              text: 'ignored',
              runs: [{ text: 'Revenue: ' }, { text: '$4M', bold: true, morph: 'total', color: 'green' }],
            },
          ],
        },
      ],
      { presentation: 'P', frame },
    );
    const el = built.file.schema.elements.find((e) => e.type === 'text')!;
    expect(el.text).toBe('Revenue: $4M');
    expect(el.runs).toEqual([
      { text: 'Revenue: ' },
      { text: '$4M', bold: true, color: '#12b76a', morph: 'total' },
    ]);
  });

  it('keeps morphBy only on morph transitions', () => {
    expect(normalizeTransition({ type: 'morph', morphBy: 'word' })).toMatchObject({ morphBy: 'word' });
    expect(normalizeTransition({ type: 'fade', morphBy: 'word' })).not.toHaveProperty('morphBy');
  });

  it('carries participant colors, message colors and morph tags into sequence blocks', () => {
    const built = buildPresentationFile(
      [
        {
          content: [
            {
              type: 'sequence',
              participants: [{ name: 'Web', color: 'blue', morph: 'web' }, 'API'],
              messages: [{ from: 'Web', to: 'API', label: 'GET', color: 'red', morph: 'req' }],
              background: 'slate-soft',
              morph: 'flow',
            },
          ],
        },
      ],
      { presentation: 'P', frame },
    );
    const s = built.file.schema;
    expect(s.lifelines[0]).toMatchObject({ label: 'Web', color: '#2f6bff', morphId: 'tag:web' });
    expect(s.sequenceMessages[0]).toMatchObject({ color: '#e5484d', morphId: 'tag:req' });
    expect(s.sequenceDiagrams[0]).toMatchObject({ backgroundColor: '#f1f5f9', morphId: 'tag:flow' });
  });
});
