// Layout, styling and stacking tools: slide backgrounds, swatch colors on any element,
// scaling (tables especially), z-order, compaction, and overlap / out-of-bounds checks.
// All of them read the project graph, plan with the pure helpers in layout.ts, and
// write through the granular REST endpoints (so realtime + permissions stay the server's).

import { z } from 'zod';
import {
  gridSummary,
  CODE_LANGUAGES,
  FILL_STYLES,
  MAX_TABLE_SCALE,
  MIN_TABLE_SCALE,
  STROKE_STYLES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
  contrastRatio,
  estimateTextSize,
  presentationSlides,
  readableTextOn,
  type CanvasElementModel,
  type PointModel,
  type ProjectGraphResponse,
  type SchemaModel,
} from '@dbdesigner/shared';
import type { DbDesignerApi } from './api';
import { Batch } from './batch';
import { colorArg } from './colors';
import {
  SEQUENCE_BOX_PAD,
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
  keyOf,
  planScale,
  slideFramesOf,
  stackOrder,
  stackToZ,
  unionOf,
  type ArrangeOp,
  type LayoutItem,
  type ScalePlan,
} from './layout';
import { UserError, findTable } from './model';
import { resolvePresentation, resolveSlide, slideFrames, type ToolFn } from './presentation-tools';

type Rect = { x: number; y: number; w: number; h: number };

/** Slide layouts: named regions on a 1280x720 slide (scaled for other frame sizes). */
export const SLIDE_LAYOUTS = {
  title: { title: { x: 64, y: 230, w: 1152, h: 140 }, subtitle: { x: 64, y: 390, w: 1152, h: 90 } },
  section: { title: { x: 64, y: 280, w: 1152, h: 160 } },
  'title-content': { title: { x: 64, y: 40, w: 1152, h: 96 }, body: { x: 64, y: 160, w: 1152, h: 512 } },
  'two-column': {
    title: { x: 64, y: 40, w: 1152, h: 96 },
    left: { x: 64, y: 160, w: 560, h: 512 },
    right: { x: 656, y: 160, w: 560, h: 512 },
  },
  'three-column': {
    title: { x: 64, y: 40, w: 1152, h: 96 },
    col1: { x: 64, y: 160, w: 357, h: 512 },
    col2: { x: 461, y: 160, w: 358, h: 512 },
    col3: { x: 859, y: 160, w: 357, h: 512 },
  },
  'content-sidebar': {
    title: { x: 64, y: 40, w: 1152, h: 96 },
    main: { x: 64, y: 160, w: 744, h: 512 },
    side: { x: 840, y: 160, w: 376, h: 512 },
  },
  'title-diagram-caption': {
    title: { x: 64, y: 40, w: 1152, h: 96 },
    diagram: { x: 64, y: 152, w: 1152, h: 440 },
    caption: { x: 64, y: 608, w: 1152, h: 72 },
  },
  full: { body: { x: 48, y: 48, w: 1184, h: 624 } },
} as const;

const projectId = z.string().describe('Project id (from list_projects).');
const slideRef = z
  .string()
  .optional()
  .describe('Slide id, or 1-based number (with `presentation`). Omit to work on the free canvas.');
const presentationRef = z.string().optional().describe('Presentation name; needed with a slide number when several exist.');

const enumOf = (values: readonly string[]): z.ZodEnum<{ [k: string]: string }> =>
  z.enum(values as unknown as [string, ...string[]]) as never;

const CAP = 40;
function capped<T>(rows: T[]): { items: T[]; truncated?: number } {
  return rows.length > CAP ? { items: rows.slice(0, CAP), truncated: rows.length - CAP } : { items: rows };
}

const brief = (i: LayoutItem): { id: string; kind: string; label: string } => ({
  id: i.id,
  kind: i.kind,
  label: i.label,
});
const box = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
});

export function registerLayoutTools(tool: ToolFn, api: DbDesignerApi): void {
  const graph = (id: string): Promise<ProjectGraphResponse> => api.get<ProjectGraphResponse>(`/projects/${id}`);

  // ---- Write helpers -------------------------------------------------------------------

  /** Queue a sequence diagram shift: its participants' X, its rows' Y and its origin. */
  const shiftDiagram = (batch: Batch, schema: SchemaModel, diagramId: string, dx: number, dy: number): void => {
    const d = schema.sequenceDiagrams.find((x) => x.id === diagramId);
    if (!d) return;
    if (dx !== 0) {
      for (const l of schema.lifelines.filter((x) => x.diagramId === diagramId)) {
        batch.set('lifelines', l.id, { x: Math.round(l.x + dx) });
      }
    }
    if (dy !== 0) {
      for (const m of schema.sequenceMessages.filter((x) => x.diagramId === diagramId)) {
        batch.set('messages', m.id, { y: Math.round(m.y + dy) });
      }
      batch.set('diagrams', diagramId, { originY: Math.round(d.originY + dy) });
    }
  };

  /** Queue moves by per-key (dx, dy); keeps relationship bend points consistent. */
  const queueMoves = (
    batch: Batch,
    schema: SchemaModel,
    moves: ReadonlyMap<string, { dx: number; dy: number }>,
  ): void => {
    const tableMove = new Map<string, { dx: number; dy: number }>();
    for (const t of schema.tables) {
      const m = moves.get(keyOf('table', t.id));
      if (!m || (m.dx === 0 && m.dy === 0)) continue;
      batch.set('tables', t.id, { x: Math.round(t.x + m.dx), y: Math.round(t.y + m.dy) });
      tableMove.set(t.id, m);
    }
    for (const e of schema.elements) {
      const m = moves.get(keyOf('element', e.id));
      if (!m || (m.dx === 0 && m.dy === 0)) continue;
      batch.set('elements', e.id, { x: Math.round(e.x + m.dx), y: Math.round(e.y + m.dy) });
    }
    for (const d of schema.sequenceDiagrams) {
      const m = moves.get(keyOf('diagram', d.id));
      if (!m || (m.dx === 0 && m.dy === 0)) continue;
      shiftDiagram(batch, schema, d.id, m.dx, m.dy);
    }
    // Bend points are world coordinates: carry them along when both ends moved the same
    // way, otherwise drop them so the connector re-routes by itself.
    const tableOf = new Map<string, string>();
    for (const t of schema.tables) for (const c of t.columns) tableOf.set(c.id, t.id);
    for (const r of schema.relationships) {
      if (!r.waypoints?.length) continue;
      const a = tableMove.get(tableOf.get(r.sourceColumnId) ?? '');
      const b = tableMove.get(tableOf.get(r.targetColumnId) ?? '');
      if (!a && !b) continue;
      const waypoints: PointModel[] =
        a && b && a.dx === b.dx && a.dy === b.dy
          ? r.waypoints.map((w) => ({ x: w.x + a.dx, y: w.y + a.dy }))
          : [];
      batch.set('relationships', r.id, { waypoints });
    }
  };

  /** Move items by per-key (dx, dy) in one atomic batch. */
  const applyMoves = (
    pid: string,
    schema: SchemaModel,
    moves: ReadonlyMap<string, { dx: number; dy: number }>,
  ): Promise<number> => {
    const batch = new Batch();
    queueMoves(batch, schema, moves);
    return batch.send(api, pid);
  };

  /** Persist a ScalePlan (table scales, element sizes, positions, bend points) atomically. */
  const applyScalePlan = (pid: string, schema: SchemaModel, plan: ScalePlan): Promise<number> => {
    const batch = new Batch();
    queueScalePlan(batch, schema, plan);
    return batch.send(api, pid);
  };

  /** Queue a ScalePlan (table scales, element sizes, positions, bend points) on a batch. */
  function queueScalePlan(batch: Batch, schema: SchemaModel, plan: ScalePlan): void {
    for (const t of plan.tables) {
      const cur = schema.tables.find((x) => x.id === t.id);
      if (!cur) continue;
      batch.set('tables', t.id, { scale: t.scale });
      if (Math.round(cur.x) !== t.x || Math.round(cur.y) !== t.y) batch.set('tables', t.id, { x: t.x, y: t.y });
    }
    for (const e of plan.elements) {
      if (Object.keys(e.patch).length) batch.set('elements', e.id, e.patch);
      if (e.position) batch.set('elements', e.id, e.position);
    }
    for (const s of plan.diagramShifts) shiftDiagram(batch, schema, s.id, s.dx, s.dy);
    for (const w of plan.waypoints) batch.set('relationships', w.id, { waypoints: w.waypoints });
  }

  const summarizePlan = (plan: ScalePlan, writes: number | null): Record<string, unknown> => ({
    factor: plan.applied,
    ...(plan.applied !== plan.requested ? { requestedFactor: plan.requested } : {}),
    tables: plan.tables.map((t) => ({ name: t.name, scale: t.scale })),
    elementsResized: plan.elements.length,
    diagramsMoved: plan.diagramShifts.length,
    ...(writes !== null ? { writes } : {}),
    ...(plan.notes.length ? { notes: plan.notes } : {}),
  });

  // ---- Slide background ----------------------------------------------------------------

  tool(
    'set_slide_background',
    "Set a slide's background color on the slide itself (its frame fill) - never draw a rectangle behind the content. Give a palette name (swatch; #hex only if the user asked for an exact color); an empty string removes the fill. `allSlides` applies it to the whole presentation. Text and shape outlines that would be hard to read on the new color are reported (`lowContrast`) and, with `recolorText`, switched to white/near-black. Slides built later by add_slides take `background` per slide.",
    {
      projectId,
      color: z.string().describe('Palette name (e.g. "ink", "blue-soft", "white"; #hex only if the user asked for an exact color); empty string clears the fill.'),
      slide: slideRef,
      presentation: presentationRef,
      allSlides: z.boolean().optional().describe('Every slide of the presentation instead of one slide.'),
      recolorText: z
        .boolean()
        .optional()
        .describe('Also fix text / unfilled outlines with poor contrast against the new background (runs with their own colors are left alone).'),
    },
    { idempotent: true },
    async ({ projectId: id, color, slide, presentation, allSlides, recolorText }) => {
      const { schema } = await graph(id);
      const picked = colorArg(color, 'the slide background');
      const hex = picked === 'transparent' ? '' : picked;
      let frames: ReturnType<typeof slideFrames>;
      if (allSlides) {
        const name = resolvePresentation(schema, presentation);
        frames = presentationSlides(slideFrames(schema), name);
      } else {
        if (!slide) throw new UserError('Give `slide` (id or number), or allSlides: true.');
        frames = [resolveSlide(schema, slide, presentation)];
      }
      const results = [];
      const batch = new Batch();
      for (const frame of frames) {
        batch.set('elements', frame.id, hex ? { backgroundColor: hex, fillStyle: 'solid' } : { fillStyle: 'none' });
        const lowContrast: Array<{ id: string; label: string; color: string; ratio: number }> = [];
        let recolored = 0;
        if (hex) {
          const ink = readableTextOn(hex);
          for (const e of schema.elements.filter((x) => x.slideId === frame.id)) {
            const isText = e.type === 'text';
            const isOutlineOnly =
              (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') &&
              (e.fillStyle === 'none' || !e.backgroundColor);
            if (!isText && !isOutlineOnly) continue;
            const ratio = contrastRatio(e.strokeColor, hex);
            if (ratio >= 3) continue;
            lowContrast.push({
              id: e.id,
              label: e.type === 'grid' ? gridSummary(e.text, 40) : e.text ? `${e.type} "${e.text.slice(0, 30)}"` : e.type,
              color: e.strokeColor,
              ratio: Math.round(ratio * 10) / 10,
            });
            if (recolorText) {
              batch.set('elements', e.id, { strokeColor: ink });
              recolored += 1;
            }
          }
        }
        results.push({
          slide: frame.id,
          background: hex || null,
          ...(lowContrast.length ? { lowContrast } : {}),
          ...(recolorText ? { recolored } : {}),
        });
      }
      await batch.send(api, id);
      return {
        updated: results.length,
        slides: results,
        ...(results.some((r) => 'lowContrast' in r && !recolorText)
          ? { hint: 'Some text will be hard to read; re-run with recolorText: true or restyle with style_elements.' }
          : {}),
      };
    },
  );

  // ---- Styling -------------------------------------------------------------------------

  tool(
    'style_elements',
    "Restyle existing drawing elements - shapes, text, code blocks, images' frames, lines, slide frames - and/or table headers, using palette names (swatches; #hex only if the user asked for an exact color). Works on many ids at once. Fields: `strokeColor` is the outline AND the text color of text/labels; `backgroundColor` is the fill (for a code block: the card surface - dark swatches such as ink/charcoal flip the token colors to a light palette; '' or 'transparent' removes the fill / resets a code card to the theme default). Also fill style, stroke width/style, opacity, corner radius, font size, bold/italic, alignment, code language and file name, and size. Use list_colors for what suits what.",
    {
      projectId,
      elements: z.array(z.string()).optional().describe('Drawing element ids (from get_project_summary / get_slide).'),
      tables: z.array(z.string()).optional().describe('Table names or ids (only `headerColor` applies to tables).'),
      headerColor: z.string().optional().describe('Table header color: palette name (swatch; #hex only if the user asked for an exact color); empty string removes it.'),
      strokeColor: z.string().optional().describe('Outline / text color: palette name (swatch; #hex only if the user asked for an exact color).'),
      backgroundColor: z
        .string()
        .optional()
        .describe("Fill: palette name (swatch; #hex only if the user asked for an exact color). '' or 'transparent' = no fill (a code card goes back to the theme default)."),
      fillStyle: enumOf(FILL_STYLES).optional(),
      strokeWidth: z.number().min(0).max(40).optional(),
      strokeStyle: enumOf(STROKE_STYLES).optional(),
      opacity: z.number().min(0).max(100).optional(),
      cornerRadius: z.number().min(0).max(200).optional().describe('Rectangles only.'),
      fontSize: z.number().min(6).max(400).optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      textAlign: enumOf(TEXT_ALIGNS).optional(),
      verticalAlign: enumOf(VERTICAL_ALIGNS).optional(),
      language: enumOf(CODE_LANGUAGES).optional().describe('Code blocks only.'),
      fileName: z.string().max(120).optional().describe('Code blocks only: title-bar file name.'),
      text: z.string().max(50000).optional().describe('Replace the text (one element at a time).'),
      width: z.number().min(1).optional(),
      height: z.number().min(1).optional(),
      clearRunColors: z
        .boolean()
        .optional()
        .describe('Rich text only: drop per-word colors so `strokeColor` applies to the whole text.'),
    },
    { idempotent: true },
    async (args) => {
      const { projectId: id, elements, tables, headerColor, clearRunColors, ...style } = args;
      if (!elements?.length && !tables?.length) throw new UserError('Give `elements` and/or `tables`.');
      const { schema } = await graph(id);
      const patch: Record<string, unknown> = {};
      const fill = style.backgroundColor;
      if (fill !== undefined) {
        if (fill.trim() === '' || fill.trim().toLowerCase() === 'transparent') patch.fillStyle = 'none';
        else {
          patch.backgroundColor = colorArg(fill, 'the fill');
          if (style.fillStyle === undefined) patch.fillStyle = 'solid';
        }
      }
      if (style.strokeColor !== undefined) {
        const c = colorArg(style.strokeColor, 'the outline/text');
        if (c) patch.strokeColor = c;
      }
      for (const key of [
        'fillStyle',
        'strokeWidth',
        'strokeStyle',
        'opacity',
        'cornerRadius',
        'fontSize',
        'bold',
        'italic',
        'textAlign',
        'verticalAlign',
        'language',
        'fileName',
        'text',
        'width',
        'height',
      ] as const) {
        if (style[key] !== undefined) patch[key] = style[key];
      }
      if (patch.text !== undefined && (elements?.length ?? 0) > 1) {
        throw new UserError('`text` can only be set on one element at a time.');
      }
      const done: string[] = [];
      const batch = new Batch();
      const missing = (elements ?? []).filter((eid) => !schema.elements.some((e) => e.id === eid));
      if (missing.length) {
        throw new UserError(`No drawing element(s): ${missing.join(', ')}. Tables go in \`tables\`.`);
      }
      for (const eid of elements ?? []) {
        const el = schema.elements.find((e) => e.id === eid) as CanvasElementModel;
        const body: Record<string, unknown> = { ...patch };
        if (clearRunColors && el.runs?.length) {
          // `color: undefined` is dropped on serialisation, which clears the per-run color.
          body.runs = el.runs.map((r) => ({ ...r, color: undefined }));
        }
        if (body.text !== undefined && el.runs?.length) body.runs = null;
        if (body.text !== undefined && el.type === 'grid') {
          throw new UserError(`${eid} is a grid table: change its cells with edit_grid_table.`);
        }
        if (Object.keys(body).length === 0) continue;
        batch.set('elements', eid, body);
        done.push(eid);
      }
      const doneTables: string[] = [];
      if (headerColor !== undefined) {
        const c = colorArg(headerColor, 'the table header');
        for (const ref of tables ?? []) {
          const t = findTable(schema, ref);
          batch.set('tables', t.id, { color: c ?? '' });
          doneTables.push(t.name);
        }
      } else if (tables?.length) {
        throw new UserError('Tables only take `headerColor`.');
      }
      await batch.send(api, id);
      return { styledElements: done.length, ...(doneTables.length ? { styledTables: doneTables } : {}) };
    },
  );

  // ---- Scaling -------------------------------------------------------------------------

  /** What the slide owns and shows: items staged wholly off the frame are left where they are. */
  const ownedKeys = (schema: SchemaModel, frameId: string): LayoutItem[] => {
    const f = slideFramesOf(schema).find((s) => s.id === frameId);
    return collectItems(schema, { lines: 'free' }).filter(
      (i) => i.slideId === frameId && (!f || placement(i.rect, f.rect) !== 'offslide'),
    );
  };

  const selectionOf = (
    schema: SchemaModel,
    args: {
      tables?: string[];
      elements?: string[];
      diagrams?: string[];
      allTables?: boolean;
      slide?: string;
      presentation?: string;
    },
  ): { tableIds: Set<string>; elementIds: Set<string>; diagramIds: Set<string>; frame?: ReturnType<typeof resolveSlide> } => {
    const tableIds = new Set<string>();
    const elementIds = new Set<string>();
    const diagramIds = new Set<string>();
    if (args.allTables) schema.tables.forEach((t) => tableIds.add(t.id));
    for (const ref of args.tables ?? []) tableIds.add(findTable(schema, ref).id);
    for (const eid of args.elements ?? []) {
      if (!schema.elements.some((e) => e.id === eid)) throw new UserError(`No drawing element "${eid}".`);
      elementIds.add(eid);
    }
    for (const did of args.diagrams ?? []) {
      if (!schema.sequenceDiagrams.some((d) => d.id === did)) throw new UserError(`No sequence diagram "${did}".`);
      diagramIds.add(did);
    }
    let frame;
    if (args.slide) {
      frame = resolveSlide(schema, args.slide, args.presentation);
      for (const it of ownedKeys(schema, frame.id)) {
        (it.kind === 'table' ? tableIds : it.kind === 'element' ? elementIds : diagramIds).add(it.id);
      }
    }
    return { tableIds, elementIds, diagramIds, frame };
  };

  const scaleShape = {
    projectId,
    factor: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .describe('Multiply the current size (0.5 = half, 1.25 = a quarter bigger). A group scales about its top-left corner, distances included.'),
    scale: z
      .number()
      .min(MIN_TABLE_SCALE)
      .max(MAX_TABLE_SCALE)
      .optional()
      .describe(`Tables only: set the display scale to exactly this (${MIN_TABLE_SCALE}-${MAX_TABLE_SCALE}); positions stay. Give factor OR scale.`),
    reposition: z
      .boolean()
      .optional()
      .describe('With factor: scale the distances between items too (default true). false keeps every top-left where it is.'),
    dryRun: z.boolean().optional().describe('Plan only; change nothing.'),
  };

  const runScale = async (
    id: string,
    sel: { tableIds: Set<string>; elementIds: Set<string>; diagramIds: Set<string> },
    args: { factor?: number; scale?: number; reposition?: boolean; dryRun?: boolean },
  ): Promise<Record<string, unknown>> => {
    if ((args.factor === undefined) === (args.scale === undefined)) {
      throw new UserError('Give exactly one of `factor` or `scale`.');
    }
    if (sel.tableIds.size + sel.elementIds.size + sel.diagramIds.size === 0) {
      throw new UserError('Nothing selected: give tables / elements / diagrams, allTables, or a slide.');
    }
    const { schema } = await graph(id);
    const plan = planScale(schema, sel, {
      factor: args.factor,
      absoluteScale: args.scale,
      reposition: args.reposition,
    });
    if (args.dryRun) return { dryRun: true, ...summarizePlan(plan, null) };
    const writes = await applyScalePlan(id, schema, plan);
    return summarizePlan(plan, writes);
  };

  tool(
    'scale_tables',
    `Make ERD tables bigger or smaller (display scale ${MIN_TABLE_SCALE}-${MAX_TABLE_SCALE}x; text, rows and connectors scale with the table). Choose tables by name/id, \`allTables\`, or every table on a slide. With \`factor\` the group is scaled like a selection in the editor: spacing scales too, so the arrangement keeps its shape (use compact_layout afterwards to tighten). With \`scale\` each table gets that exact size and keeps its top-left. After shrinking tables for a slide, fit_to_bounds can fit the whole slide's content.`,
    {
      ...scaleShape,
      tables: z.array(z.string()).optional().describe('Table names or ids.'),
      allTables: z.boolean().optional().describe('Every table in the project (not just one slide).'),
      slide: slideRef,
      presentation: presentationRef,
    },
    {},
    async ({ projectId: id, tables, allTables, slide, presentation, factor, scale, reposition, dryRun }) => {
      const { schema } = await graph(id);
      const sel = selectionOf(schema, { tables, allTables, slide, presentation });
      // `scale_tables` only touches tables, even when a slide is named.
      return runScale(id, { tableIds: sel.tableIds, elementIds: new Set(), diagramIds: new Set() }, { factor, scale, reposition, dryRun });
    },
  );

  tool(
    'scale_items',
    'Scale any mix of tables, drawing elements (shapes, text, code blocks, images, lines) and everything on a slide up or down by `factor`, as one group about its top-left corner (sizes, font sizes, line vertices and spacing scale together). Sequence diagrams cannot be scaled; they are only repositioned. For tables alone prefer scale_tables.',
    {
      ...scaleShape,
      tables: z.array(z.string()).optional().describe('Table names or ids.'),
      elements: z.array(z.string()).optional().describe('Drawing element ids.'),
      diagrams: z.array(z.string()).optional().describe('Sequence diagram ids (repositioned only).'),
      allTables: z.boolean().optional(),
      slide: slideRef,
      presentation: presentationRef,
    },
    {},
    async ({ projectId: id, tables, elements, diagrams, allTables, slide, presentation, factor, scale, reposition, dryRun }) => {
      const { schema } = await graph(id);
      const sel = selectionOf(schema, { tables, elements, diagrams, allTables, slide, presentation });
      return runScale(id, sel, { factor, scale, reposition, dryRun });
    },
  );

  tool(
    'fit_to_bounds',
    "Make a slide's content fit inside its slide frame (with `padding`): scales everything the slide owns down about one corner when it is too big (tables clamp at the editor's minimum scale) and then slides it inside the frame. Content that already fits is only nudged inside; with `allowEnlarge` small content is scaled up to fill the slide. Run check_layout first to see what sticks out. Sequence diagrams on the slide are moved but not scaled.",
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: presentationRef,
      padding: z.number().min(0).max(300).optional().describe('Inner margin in px (default 48).'),
      allowEnlarge: z.boolean().optional().describe('Scale small content up to fill the slide (default false).'),
      dryRun: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, slide, presentation, padding, allowEnlarge, dryRun }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const owned = ownedKeys(schema, frame.id);
      if (owned.length === 0) return { slide: frame.id, message: 'The slide holds no content.' };
      const bounds = unionOf(owned.map((i) => i.rect)) as { x: number; y: number; w: number; h: number };
      const pad = padding ?? 48;
      const inner = { x: frame.x + pad, y: frame.y + pad, w: frame.width - pad * 2, h: frame.height - pad * 2 };
      const wanted = Math.min(inner.w / bounds.w, inner.h / bounds.h);
      const factor = allowEnlarge ? wanted : Math.min(1, wanted);
      const sel = {
        tableIds: new Set(owned.filter((i) => i.kind === 'table').map((i) => i.id)),
        elementIds: new Set(owned.filter((i) => i.kind === 'element').map((i) => i.id)),
        diagramIds: new Set(owned.filter((i) => i.kind === 'diagram').map((i) => i.id)),
      };
      const scalePlan = planScale(schema, sel, { factor });
      const w = bounds.w * scalePlan.applied;
      const h = bounds.h * scalePlan.applied;
      const clampPos = (pos: number, lo: number, size: number, room: number): number =>
        size >= room ? lo : Math.min(Math.max(pos, lo), lo + room - size);
      const dx = Math.round(clampPos(bounds.x, inner.x, w, inner.w) - bounds.x);
      const dy = Math.round(clampPos(bounds.y, inner.y, h, inner.h) - bounds.y);
      if (scalePlan.applied === 1 && dx === 0 && dy === 0) {
        return { slide: frame.id, message: 'Already fits inside the slide.' };
      }
      const plan = planScale(schema, sel, { factor, translate: { dx, dy } });
      const stillTooBig = bounds.w * plan.applied > inner.w + 1 || bounds.h * plan.applied > inner.h + 1;
      if (dryRun) {
        return {
          dryRun: true,
          ...summarizePlan(plan, null),
          ...(stillTooBig ? { warning: 'Content still exceeds the slide (tables cannot shrink further); remove or split content.' } : {}),
        };
      }
      const writes = await applyScalePlan(id, schema, plan);
      return {
        slide: frame.id,
        ...summarizePlan(plan, writes),
        shifted: { dx, dy },
        ...(stillTooBig
          ? { warning: 'Content still exceeds the slide (tables cannot shrink further); remove or split content.' }
          : {}),
      };
    },
  );

  // ---- Stacking ------------------------------------------------------------------------

  tool(
    'list_layers',
    'List drawing elements and sequence diagrams in stacking order, bottom to top (what is drawn on top of what). Tables have no layer: they always sit above shapes and below lines/arrows. Use ids with arrange_layers.',
    { projectId, slide: slideRef, presentation: presentationRef },
    { readOnly: true },
    async ({ projectId: id, slide, presentation }) => {
      const { schema } = await graph(id);
      const frame = slide ? resolveSlide(schema, slide, presentation) : undefined;
      const owner = new Map<string, string | undefined>();
      for (const e of schema.elements) owner.set(keyOf('element', e.id), e.slideId);
      for (const d of schema.sequenceDiagrams) owner.set(keyOf('diagram', d.id), d.slideId);
      const rows = stackOrder(schema)
        .map((s, index) => ({ s, index }))
        .filter(({ s }) => !frame || owner.get(s.key) === frame.id || s.id === frame.id);
      const list = rows.map(({ s, index }) => ({
        position: index + 1,
        id: s.id,
        kind: s.kind,
        label: s.label,
        ...(owner.get(s.key) ? { slide: owner.get(s.key) } : {}),
      }));
      return { order: 'bottom to top', total: list.length, layers: list };
    },
  );

  tool(
    'arrange_layers',
    "Change stacking: bring drawing elements and/or sequence diagrams to the front or back, one step forward/backward (past the next item they actually overlap, `steps` times), or directly above/below a reference item. Takes element ids and diagram ids; tables are not layered (always above shapes, below lines/arrows). Mirrors Ctrl+] / Ctrl+[ in the editor.",
    {
      projectId,
      items: z.array(z.string()).min(1).describe('Element and/or sequence diagram ids.'),
      op: enumOf(['front', 'back', 'forward', 'backward', 'above', 'below']).describe(
        "'front'/'back' = very top/bottom; 'forward'/'backward' = one step (see steps); 'above'/'below' = right next to `reference`.",
      ),
      reference: z.string().optional().describe("Element or diagram id for op 'above' / 'below'."),
      steps: z.number().int().min(1).max(50).optional().describe('Repeat forward/backward this many times (default 1).'),
    },
    { idempotent: true },
    async ({ projectId: id, items, op, reference, steps }) => {
      const { schema } = await graph(id);
      const stack = stackOrder(schema);
      const resolve = (ref: string): string => {
        const hit = stack.find((s) => s.id === ref);
        if (!hit) {
          if (schema.tables.some((t) => t.id === ref || t.name.toLowerCase() === ref.toLowerCase())) {
            throw new UserError(`"${ref}" is a table; tables have no stacking order (always above shapes, below lines/arrows).`);
          }
          throw new UserError(`No drawing element or sequence diagram "${ref}". See list_layers.`);
        }
        return hit.key;
      };
      const selected = new Set(items.map(resolve));
      const refKey = op === 'above' || op === 'below' ? (reference ? resolve(reference) : undefined) : undefined;
      if ((op === 'above' || op === 'below') && !refKey) throw new UserError(`op '${op}' needs \`reference\`.`);
      if (refKey && selected.has(refKey)) throw new UserError('`reference` must not be one of `items`.');
      const next = arrangeStack(stack, selected, op as ArrangeOp, { reference: refKey, steps });
      const { elementOrder, diagramZ } = stackToZ(next, selected, op as ArrangeOp);
      const before = stack.filter((s) => s.kind === 'element').map((s) => s.id);
      let writes = 0;
      if (elementOrder.some((eid, i) => eid !== before[i])) {
        await api.patch(`/projects/${id}/elements/reorder`, { orderedElementIds: elementOrder });
        writes += 1;
      }
      const batch = new Batch();
      for (const [did, z] of diagramZ) {
        const cur = schema.sequenceDiagrams.find((d) => d.id === did);
        if (cur && cur.zIndex !== z) batch.set('diagrams', did, { zIndex: z });
      }
      writes += await batch.send(api, id);
      return {
        arranged: items.length,
        op,
        writes,
        ...(writes === 0 ? { note: 'Already in that position (nothing overlapping to hop past, or already at the end).' } : {}),
      };
    },
  );

  // ---- Compaction ----------------------------------------------------------------------

  tool(
    'compact_layout',
    "Tighten a diagram by removing wasted space while keeping its arrangement. mode 'gutters' (default) closes empty bands between rows/columns down to `gap` - alignments and relative order are untouched, so it is safe to run on a layout you like. mode 'gravity' is more aggressive: every item slides toward the top-left until it rests `gap` from its neighbours, which can change how rows/columns line up. Overlapping or grouped items move as one block, and the content's top-left corner stays put. Scope: one slide (stays inside its frame), or - with no `slide` - the free canvas (slides and anything sitting on them are left alone). Use dryRun to preview the size saved.",
    {
      projectId,
      slide: slideRef,
      presentation: presentationRef,
      mode: enumOf(['gutters', 'gravity']).optional(),
      gap: z.number().min(0).max(400).optional().describe('Space to leave between neighbours in px (default 48 on the canvas, 32 on a slide).'),
      axis: enumOf(['both', 'x', 'y']).optional().describe("'x' = only horizontal, 'y' = only vertical (default both)."),
      dryRun: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, slide, presentation, mode, gap, axis, dryRun }) => {
      const { schema } = await graph(id);
      const frame = slide ? resolveSlide(schema, slide, presentation) : undefined;
      const frames = schema.elements.filter((e) => e.type === 'frame');
      let items = collectItems(schema, { lines: 'free' });
      let skippedOnFrames = 0;
      if (frame) {
        const owned = new Set(ownedKeys(schema, frame.id).map((i) => i.key));
        items = items.filter((i) => owned.has(i.key));
      } else {
        items = items.filter((i) => !i.slideId);
        const before = items.length;
        items = items.filter((i) => {
          const cx = i.rect.x + i.rect.w / 2;
          const cy = i.rect.y + i.rect.h / 2;
          return !frames.some((f) => cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height);
        });
        skippedOnFrames = before - items.length;
      }
      if (items.length < 2) return { moved: 0, message: 'Fewer than two items; nothing to compact.' };

      const units = buildUnits(items);
      const deltas = compactUnits(units, {
        mode: (mode ?? 'gutters') as 'gutters' | 'gravity',
        gap: gap ?? (frame ? 32 : 48),
        axis: (axis ?? 'both') as 'both' | 'x' | 'y',
      });
      const moves = new Map<string, { dx: number; dy: number }>();
      const rectOf = new Map(items.map((i) => [i.key, i.rect]));
      const after: LayoutItem[] = [];
      units.forEach((u, i) => {
        for (const key of u.keys) {
          moves.set(key, deltas[i]);
        }
      });
      for (const it of items) {
        const m = moves.get(it.key) ?? { dx: 0, dy: 0 };
        after.push({ ...it, rect: { ...it.rect, x: it.rect.x + m.dx, y: it.rect.y + m.dy } });
      }
      const changed = items.filter((it) => {
        const m = moves.get(it.key);
        return m && (m.dx !== 0 || m.dy !== 0);
      });
      const sizeBefore = unionOf([...rectOf.values()]) as { w: number; h: number };
      const sizeAfter = unionOf(after.map((i) => i.rect)) as { w: number; h: number };

      if (!frame) {
        // The canvas pass must not push free items into a frame (slide or page).
        const hit = after.find((a) => {
          const was = rectOf.get(a.key) as { x: number; y: number; w: number; h: number };
          return frames.some(
            (f) =>
              overlapsFrame(a.rect, f) && !overlapsFrame(was, f),
          );
        });
        if (hit) {
          return {
            moved: 0,
            message: `Compacting would push ${hit.label} into a frame; nothing changed. Try axis 'x' or 'y', a larger gap, or compact within a slide.`,
          };
        }
      }
      const overlapsBefore = findOverlaps(items).length;
      const overlapsAfter = findOverlaps(after).length;
      const summary = {
        scope: frame ? `slide ${frame.id}` : 'free canvas',
        mode: mode ?? 'gutters',
        itemsMoved: changed.length,
        size: {
          before: { w: Math.round(sizeBefore.w), h: Math.round(sizeBefore.h) },
          after: { w: Math.round(sizeAfter.w), h: Math.round(sizeAfter.h) },
        },
        ...(skippedOnFrames ? { skippedItemsInsideFrames: skippedOnFrames } : {}),
        ...(overlapsAfter > overlapsBefore ? { warning: `overlaps went from ${overlapsBefore} to ${overlapsAfter}` } : {}),
      };
      if (dryRun || changed.length === 0) {
        return { dryRun: !!dryRun, ...summary, ...(changed.length === 0 ? { message: 'Already compact.' } : {}) };
      }
      const writes = await applyMoves(id, schema, moves);
      return { ...summary, writes };
    },
  );

  // ---- Bulk move / align / distribute ---------------------------------------------------

  type Ref =
    | { kind: 'table' | 'element' | 'diagram'; id: string; key: string; label: string }
    | { kind: 'participant'; id: string; diagramId: string; x: number; label: string }
    | { kind: 'message'; id: string; diagramId: string; y: number; label: string };

  /** Resolve any id (element, diagram, participant, message) or table name/id. */
  const resolveRef = (schema: SchemaModel, ref: string): Ref => {
    const e = schema.elements.find((x) => x.id === ref);
    if (e) {
      if (e.type === 'frame' && e.slide) {
        throw new UserError(`"${ref}" is a slide frame; move a presentation with move_element on one of its slides.`);
      }
      return { kind: 'element', id: e.id, key: keyOf('element', e.id), label: e.id };
    }
    const d = schema.sequenceDiagrams.find((x) => x.id === ref);
    if (d) return { kind: 'diagram', id: d.id, key: keyOf('diagram', d.id), label: d.title || d.id };
    const l = schema.lifelines.find((x) => x.id === ref);
    if (l) return { kind: 'participant', id: l.id, diagramId: l.diagramId, x: l.x, label: l.label };
    const m = schema.sequenceMessages.find((x) => x.id === ref);
    if (m) return { kind: 'message', id: m.id, diagramId: m.diagramId, y: m.y, label: m.label ?? m.id };
    const t = findTable(schema, ref);
    return { kind: 'table', id: t.id, key: keyOf('table', t.id), label: t.name };
  };

  /** Members of a group id (tables, elements, diagrams sharing that groupId), or null. */
  const groupMembers = (schema: SchemaModel, ref: string): Ref[] | null => {
    const members: Ref[] = [
      ...schema.tables.filter((t) => t.groupId === ref).map((t) => ({ kind: 'table' as const, id: t.id, key: keyOf('table', t.id), label: t.name })),
      ...schema.elements.filter((e) => e.groupId === ref).map((e) => ({ kind: 'element' as const, id: e.id, key: keyOf('element', e.id), label: e.id })),
      ...schema.sequenceDiagrams.filter((d) => d.groupId === ref).map((d) => ({ kind: 'diagram' as const, id: d.id, key: keyOf('diagram', d.id), label: d.title || d.id })),
    ];
    return members.length ? members : null;
  };

  /** Resolve refs, expanding group ids (from group_items) to their members. */
  const resolveRefs = (schema: SchemaModel, refs: string[]): Ref[] =>
    refs.flatMap((r) => groupMembers(schema, r) ?? [resolveRef(schema, r)]);

  /** Rects of tables/elements/diagrams by key (lines included, so arrows can be aligned too). */
  const rectsOf = (schema: SchemaModel): Map<string, { x: number; y: number; w: number; h: number }> =>
    new Map(collectItems(schema, { lines: 'all' }).map((i) => [i.key, i.rect]));

  /**
   * Layout blocks: each table / element / diagram ref is one block; a group id is ONE
   * block (its members keep their arrangement). Participants/messages are rejected.
   */
  const blocksOf = (schema: SchemaModel, refs: string[], tool: string) => {
    const rects = rectsOf(schema);
    const seen = new Set<string>();
    const out: Array<{ keys: string[]; label: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    for (const r of refs) {
      const members = groupMembers(schema, r) ?? [resolveRef(schema, r)];
      const keys: string[] = [];
      const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const ref of members) {
        if (ref.kind === 'participant' || ref.kind === 'message') {
          throw new UserError(`${tool} works on tables, drawing elements, sequence diagrams and groups; "${r}" is a ${ref.kind} (use move_items).`);
        }
        if (seen.has(ref.key)) continue;
        seen.add(ref.key);
        const rect = rects.get(ref.key);
        if (!rect) continue;
        keys.push(ref.key);
        boxes.push(rect);
      }
      if (!keys.length) {
        if (members.length === 1 && !rects.get((members[0] as { key: string }).key)) {
          throw new UserError(`"${r}" has no size to lay out (an empty diagram or stroke?).`);
        }
        continue;
      }
      out.push({ keys, label: r, rect: unionOf(boxes) as { x: number; y: number; w: number; h: number } });
    }
    return out;
  };

  /** Move blocks plus participants (x) and messages (y) in one atomic batch. */
  const applyAllMoves = (
    pid: string,
    schema: SchemaModel,
    blocks: Map<string, { dx: number; dy: number }>,
    parts: Array<{ ref: Ref; d: number }>,
  ): Promise<number> => {
    const batch = new Batch();
    queueMoves(batch, schema, blocks);
    for (const { ref, d } of parts) {
      if (d === 0) continue;
      if (ref.kind === 'participant') batch.set('lifelines', ref.id, { x: Math.round(ref.x + d) });
      else if (ref.kind === 'message') batch.set('messages', ref.id, { y: Math.round(ref.y + d) });
    }
    return batch.send(api, pid);
  };

  tool(
    'move_items',
    "Move many things in ONE call - tables (name/id), drawing elements, sequence diagrams (the whole box), participants (horizontal only) and messages (vertical only), by id. Either give `items` plus a shared offset (`dx`/`dy`) or a group destination (`x`/`y` = new top-left of the selection's bounding box, spacing kept), or give `moves` with per-item absolute `x`/`y` or relative `dx`/`dy`. Relationship bend points follow when both tables move together. Prefer this over repeated move_element calls.",
    {
      projectId,
      items: z.array(z.string()).optional().describe('Ids / table names moved together by dx/dy or to x/y.'),
      dx: z.number().optional(),
      dy: z.number().optional(),
      x: z.number().optional().describe('With `items`: new left edge of the whole selection.'),
      y: z.number().optional().describe('With `items`: new top edge of the whole selection.'),
      moves: z
        .array(
          z.object({
            target: z.string().describe('Id or table name.'),
            x: z.number().optional().describe('Absolute left (participants: spine center x).'),
            y: z.number().optional().describe('Absolute top (messages: row y).'),
            dx: z.number().optional(),
            dy: z.number().optional(),
          }),
        )
        .optional()
        .describe('Per-item moves.'),
    },
    {},
    async ({ projectId: id, items, dx, dy, x, y, moves }) => {
      if (!items?.length && !moves?.length) throw new UserError('Give `items` (with dx/dy or x/y) and/or `moves`.');
      if (items?.length && dx === undefined && dy === undefined && x === undefined && y === undefined) {
        throw new UserError('With `items` give dx/dy or x/y.');
      }
      const { schema } = await graph(id);
      const rects = rectsOf(schema);
      const blocks = new Map<string, { dx: number; dy: number }>();
      const parts = new Map<string, { ref: Ref; d: number }>();
      const add = (ref: Ref, mx: number, my: number): void => {
        if (ref.kind === 'participant' || ref.kind === 'message') {
          const d = ref.kind === 'participant' ? mx : my;
          const cur = parts.get(ref.id);
          parts.set(ref.id, { ref, d: (cur?.d ?? 0) + d });
          return;
        }
        const cur = blocks.get(ref.key) ?? { dx: 0, dy: 0 };
        blocks.set(ref.key, { dx: cur.dx + mx, dy: cur.dy + my });
      };
      // Group move: offset, or translate the selection's bounding box to x/y.
      if (items?.length) {
        const refs = resolveRefs(schema, items);
        let gx = dx ?? 0;
        let gy = dy ?? 0;
        if (x !== undefined || y !== undefined) {
          const pts = refs.flatMap((r) => {
            if (r.kind === 'participant') return [{ x: r.x, y: Number.NaN, w: 0, h: 0 }];
            if (r.kind === 'message') return [{ x: Number.NaN, y: r.y, w: 0, h: 0 }];
            const rect = rects.get(r.key);
            return rect ? [rect] : [];
          });
          const minX = Math.min(...pts.map((p) => p.x).filter((v) => !Number.isNaN(v)));
          const minY = Math.min(...pts.map((p) => p.y).filter((v) => !Number.isNaN(v)));
          if (x !== undefined && Number.isFinite(minX)) gx = x - minX;
          if (y !== undefined && Number.isFinite(minY)) gy = y - minY;
        }
        for (const r of refs) add(r, gx, gy);
      }
      for (const mv of moves ?? []) {
        const ref = resolveRef(schema, mv.target);
        let mx = mv.dx ?? 0;
        let my = mv.dy ?? 0;
        if (ref.kind === 'participant') {
          if (mv.x !== undefined) mx = mv.x - ref.x;
        } else if (ref.kind === 'message') {
          if (mv.y !== undefined) my = mv.y - ref.y;
        } else {
          const t = ref.kind === 'table' ? schema.tables.find((v) => v.id === ref.id) : undefined;
          const el = ref.kind === 'element' ? schema.elements.find((v) => v.id === ref.id) : undefined;
          const rect = rects.get(ref.key);
          // Absolute positions are the item's own x/y (tables/elements), or the diagram box.
          const ox = t?.x ?? el?.x ?? (rect ? rect.x + SEQUENCE_BOX_PAD : 0);
          const oy = t?.y ?? el?.y ?? (rect ? rect.y + SEQUENCE_BOX_PAD : 0);
          if (mv.x !== undefined) mx = mv.x - ox;
          if (mv.y !== undefined) my = mv.y - oy;
        }
        add(ref, mx, my);
      }
      for (const { ref } of parts.values()) {
        if (blocks.has(keyOf('diagram', (ref as { diagramId: string }).diagramId))) {
          throw new UserError(`"${ref.label}" belongs to a diagram that is also being moved; move one or the other.`);
        }
      }
      const writes = await applyAllMoves(id, schema, blocks, [...parts.values()]);
      return { moved: blocks.size + parts.size, writes };
    },
  );

  tool(
    'align_items',
    "Line up tables, drawing elements and sequence diagrams along an edge or center, like the editor's align buttons. By default aligns to the selection's own extreme (left-most left edge, etc.); give `to` (an item id / table name) to align to that item, or `value` for an exact coordinate.",
    {
      projectId,
      items: z.array(z.string()).min(1).describe('Ids / table names / group ids (a group aligns as one block).'),
      align: enumOf(['left', 'center', 'right', 'top', 'middle', 'bottom']).describe("'center' = horizontal centers, 'middle' = vertical centers."),
      to: z.string().optional().describe('Reference item that stays put.'),
      value: z.number().optional().describe('Exact x (left/center/right) or y (top/middle/bottom) to align to.'),
    },
    { idempotent: true },
    async ({ projectId: id, items, align, to, value }) => {
      const { schema } = await graph(id);
      const sel = blocksOf(schema, items, 'align_items');
      const horizontal = align === 'left' || align === 'center' || align === 'right';
      const at = (r: { x: number; y: number; w: number; h: number }): number =>
        align === 'left' ? r.x
        : align === 'right' ? r.x + r.w
        : align === 'center' ? r.x + r.w / 2
        : align === 'top' ? r.y
        : align === 'bottom' ? r.y + r.h
        : r.y + r.h / 2;
      let target: number;
      if (value !== undefined) target = value;
      else if (to) target = at(blocksOf(schema, [to], 'align_items')[0].rect);
      else {
        const vals = sel.map((s) => at(s.rect));
        target = align === 'right' || align === 'bottom' ? Math.max(...vals)
          : align === 'left' || align === 'top' ? Math.min(...vals)
          : vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      const moves = new Map<string, { dx: number; dy: number }>();
      for (const s of sel) {
        const d = Math.round(target - at(s.rect));
        if (d !== 0) for (const k of s.keys) moves.set(k, horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d });
      }
      const writes = await applyMoves(id, schema, moves);
      return { aligned: sel.length, align, to: Math.round(target), moved: moves.size, writes };
    },
  );

  tool(
    'distribute_items',
    "Space tables, drawing elements and sequence diagrams out along one axis. With `gap` they are packed edge-to-edge `gap` px apart starting from the first; without it the first and last stay put and the gaps between are made equal (needs 3+ items). Order is by current position unless `keepOrder` uses the order given. Use arrange_grid for rows x columns.",
    {
      projectId,
      items: z.array(z.string()).min(2),
      axis: enumOf(['x', 'y']).describe("'x' = left to right, 'y' = top to bottom."),
      gap: z.number().min(0).max(2000).optional(),
      keepOrder: z.boolean().optional().describe('Use the order of `items` instead of sorting by position.'),
    },
    { idempotent: true },
    async ({ projectId: id, items, axis, gap, keepOrder }) => {
      const { schema } = await graph(id);
      const sel = blocksOf(schema, items, 'distribute_items');
      const pos = (r: { x: number; y: number }): number => (axis === 'x' ? r.x : r.y);
      const size = (r: { w: number; h: number }): number => (axis === 'x' ? r.w : r.h);
      if (!keepOrder) sel.sort((a, b) => pos(a.rect) - pos(b.rect));
      let spacing = gap;
      if (spacing === undefined) {
        if (sel.length < 3) throw new UserError('Give `gap`, or at least 3 items to spread between the outer two.');
        const first = sel[0].rect;
        const last = sel[sel.length - 1].rect;
        const span = pos(last) + size(last) - pos(first);
        spacing = (span - sel.reduce((a, s) => a + size(s.rect), 0)) / (sel.length - 1);
      }
      const moves = new Map<string, { dx: number; dy: number }>();
      let cursor = pos(sel[0].rect);
      for (const s of sel) {
        const d = Math.round(cursor - pos(s.rect));
        if (d !== 0) for (const k of s.keys) moves.set(k, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
        cursor += size(s.rect) + spacing;
      }
      const writes = await applyMoves(id, schema, moves);
      return { distributed: sel.length, axis, gap: Math.round(spacing), moved: moves.size, writes };
    },
  );

  tool(
    'arrange_grid',
    'Lay tables, drawing elements and sequence diagrams out in a grid, in the order given (row by row). Cells size to the largest item per column/row; items are placed at their cell\'s top-left (or centered with `center`). The grid starts at x/y, or at the selection\'s current top-left.',
    {
      projectId,
      items: z.array(z.string()).min(1),
      columns: z.number().int().min(1).max(50),
      gap: z.number().min(0).max(2000).optional().describe('Px between cells (default 48).'),
      rowGap: z.number().min(0).max(2000).optional().describe('Vertical gap if different from `gap`.'),
      x: z.number().optional(),
      y: z.number().optional(),
      center: z.boolean().optional().describe('Center each item in its cell.'),
    },
    { idempotent: true },
    async ({ projectId: id, items, columns, gap, rowGap, x, y, center }) => {
      const { schema } = await graph(id);
      const sel = blocksOf(schema, items, 'arrange_grid');
      const g = gap ?? 48;
      const rg = rowGap ?? g;
      const rows = Math.ceil(sel.length / columns);
      const colW = Array.from({ length: columns }, (_, c) =>
        Math.max(0, ...sel.filter((_, i) => i % columns === c).map((s) => s.rect.w)),
      );
      const rowH = Array.from({ length: rows }, (_, r) =>
        Math.max(0, ...sel.slice(r * columns, (r + 1) * columns).map((s) => s.rect.h)),
      );
      const bounds = unionOf(sel.map((s) => s.rect)) as { x: number; y: number };
      const ox = x ?? bounds.x;
      const oy = y ?? bounds.y;
      const moves = new Map<string, { dx: number; dy: number }>();
      sel.forEach((s, i) => {
        const c = i % columns;
        const r = Math.floor(i / columns);
        let cx = ox + colW.slice(0, c).reduce((a, b) => a + b + g, 0);
        let cy = oy + rowH.slice(0, r).reduce((a, b) => a + b + rg, 0);
        if (center) {
          cx += (colW[c] - s.rect.w) / 2;
          cy += (rowH[r] - s.rect.h) / 2;
        }
        const d = { dx: Math.round(cx - s.rect.x), dy: Math.round(cy - s.rect.y) };
        if (d.dx || d.dy) for (const k of s.keys) moves.set(k, d);
      });
      const writes = await applyMoves(id, schema, moves);
      return {
        arranged: sel.length,
        grid: `${rows}x${columns}`,
        size: {
          w: Math.round(colW.reduce((a, b) => a + b, 0) + g * (columns - 1)),
          h: Math.round(rowH.reduce((a, b) => a + b, 0) + rg * (rows - 1)),
        },
        moved: moves.size,
        writes,
      };
    },
  );

  // ---- Slide layouts ---------------------------------------------------------------------

  tool(
    'apply_slide_layout',
    `Arrange what is already on a slide into a standard slide layout in one call: give the layout and which items go in which region; each region's items are scaled down to fit (never up unless allowEnlarge) and placed in the region as a group (their arrangement inside the region is kept). Layouts and regions (1280x720 slide, 64px margins):\n${Object.entries(SLIDE_LAYOUTS)
      .map(([name, regions]) => `- ${name}: ${Object.keys(regions).join(', ')}`)
      .join('\n')}\nRegions you leave out are left alone. Use dryRun to get the region rectangles (world coordinates) without changing anything.`,
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: presentationRef,
      layout: enumOf(Object.keys(SLIDE_LAYOUTS)),
      regions: z
        .record(z.string(), z.array(z.string()))
        .optional()
        .describe('Region name -> item ids / table names / group ids, e.g. {"title": ["<textId>"], "left": ["users", "orders"]}.'),
      align: enumOf(['center', 'start']).optional().describe("Place each region's content centered (default) or at its top-left."),
      allowEnlarge: z.boolean().optional().describe('Scale small content up to fill its region (default false; titles usually should not).'),
      dryRun: z.boolean().optional(),
    },
    {},
    async ({ projectId: id, slide, presentation, layout, regions, align, allowEnlarge, dryRun }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const spec = SLIDE_LAYOUTS[layout as keyof typeof SLIDE_LAYOUTS] as Record<string, Rect>;
      const sx = frame.width / 1280;
      const sy = frame.height / 720;
      const world = Object.fromEntries(
        Object.entries(spec).map(([name, r]) => [
          name,
          { x: Math.round(frame.x + r.x * sx), y: Math.round(frame.y + r.y * sy), w: Math.round(r.w * sx), h: Math.round(r.h * sy) },
        ]),
      ) as Record<string, Rect>;
      if (dryRun || !regions || Object.keys(regions).length === 0) {
        return { slide: frame.id, layout, regions: world, ...(dryRun ? { dryRun: true } : { note: 'Give `regions` to place items.' }) };
      }
      const unknownRegion = Object.keys(regions).filter((r) => !world[r]);
      if (unknownRegion.length) {
        throw new UserError(`Layout "${layout}" has no region(s) ${unknownRegion.join(', ')}; it has ${Object.keys(world).join(', ')}.`);
      }
      const batch = new Batch();
      const placed: Record<string, unknown>[] = [];
      const used = new Set<string>();
      // Text boxes wider than their region re-wrap to the region width instead of
      // shrinking their font (the scale step below then only handles real overflow).
      const fitted: SchemaModel = { ...schema, elements: schema.elements.map((e) => ({ ...e })) };
      for (const [name, refs] of Object.entries(regions)) {
        const region = world[name];
        for (const ref of refs) {
          const e = fitted.elements.find((x) => x.id === ref);
          if (!e || e.type !== 'text' || e.width <= region.w) continue;
          const size = e.fontSize ?? 20;
          const text = e.runs?.length ? e.runs.map((r) => r.text).join('') : (e.text ?? '');
          const lines = text
            .split('\n')
            .reduce((n, para) => n + Math.max(1, Math.ceil(estimateTextSize(para, size).width / region.w)), 0);
          e.width = region.w;
          e.height = Math.max(e.height, Math.ceil(lines * size * (e.lineHeight ?? 1.25)) + 4);
          batch.set('elements', e.id, { width: e.width, height: e.height });
        }
      }
      for (const [name, refs] of Object.entries(regions)) {
        if (!refs.length) continue;
        const blocks = blocksOf(fitted, refs, 'apply_slide_layout');
        const keys = blocks.flatMap((b) => b.keys);
        const dup = keys.find((k) => used.has(k));
        if (dup) throw new UserError(`An item is listed in two regions (${dup}).`);
        keys.forEach((k) => used.add(k));
        const sel = {
          tableIds: new Set(keys.filter((k) => k.startsWith('table:')).map((k) => k.slice(6))),
          elementIds: new Set(keys.filter((k) => k.startsWith('element:')).map((k) => k.slice(8))),
          diagramIds: new Set(keys.filter((k) => k.startsWith('diagram:')).map((k) => k.slice(8))),
        };
        const bounds = unionOf(blocks.map((b) => b.rect)) as Rect;
        const region = world[name];
        const wanted = Math.min(region.w / Math.max(1, bounds.w), region.h / Math.max(1, bounds.h));
        const factor = allowEnlarge ? wanted : Math.min(1, wanted);
        const first = planScale(fitted, sel, { factor });
        const w = bounds.w * first.applied;
        const h = bounds.h * first.applied;
        const tx = align === 'start' ? region.x : region.x + Math.max(0, (region.w - w) / 2);
        const ty = align === 'start' ? region.y : region.y + Math.max(0, (region.h - h) / 2);
        const plan = planScale(fitted, sel, {
          factor,
          translate: { dx: Math.round(tx - bounds.x), dy: Math.round(ty - bounds.y) },
        });
        queueScalePlan(batch, fitted, plan);
        placed.push({
          region: name,
          items: keys.length,
          factor: Math.round(plan.applied * 100) / 100,
          ...(w > region.w + 1 || h > region.h + 1 ? { warning: 'still larger than the region (tables cannot shrink further)' } : {}),
        });
      }
      // Items moved onto the slide should belong to it.
      for (const k of used) {
        const [kind, iid] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        const owner =
          kind === 'table' ? schema.tables.find((t) => t.id === iid)?.slideId
          : kind === 'element' ? schema.elements.find((e) => e.id === iid)?.slideId
          : schema.sequenceDiagrams.find((d) => d.id === iid)?.slideId;
        if (owner !== frame.id) {
          batch.set(kind === 'table' ? 'tables' : kind === 'element' ? 'elements' : 'diagrams', iid, { slideId: frame.id });
        }
      }
      const writes = await batch.send(api, id);
      return { slide: frame.id, layout, placed, writes };
    },
  );

  // ---- Sequence diagram bulk edits ------------------------------------------------------

  tool(
    'respace_sequence_diagram',
    "Re-space a sequence diagram in one call - the 'scale' for sequence diagrams: participants evenly `participantSpacing` px apart (left-most stays put), messages evenly `rowSpacing` px apart in their current top-to-bottom order (first row right under the headers), and the diagram's defaults updated so later add_message calls follow. Optionally move the whole diagram to x/y.",
    {
      projectId,
      diagramId: z.string(),
      participantSpacing: z.number().min(40).max(2000).optional(),
      rowSpacing: z.number().min(16).max(800).optional(),
      x: z.number().optional().describe("New center x of the left-most participant's spine."),
      y: z.number().optional().describe('New top of the diagram (participant headers).'),
    },
    { idempotent: true },
    async ({ projectId: id, diagramId, participantSpacing, rowSpacing, x, y }) => {
      const { schema } = await graph(id);
      const d = schema.sequenceDiagrams.find((v) => v.id === diagramId);
      if (!d) throw new UserError(`No sequence diagram "${diagramId}".`);
      if (participantSpacing === undefined && rowSpacing === undefined && x === undefined && y === undefined) {
        throw new UserError('Give participantSpacing, rowSpacing, x or y.');
      }
      const lanes = schema.lifelines.filter((l) => l.diagramId === diagramId).sort((a, b) => a.x - b.x);
      const msgs = schema.sequenceMessages.filter((m) => m.diagramId === diagramId).sort((a, b) => a.y - b.y);
      const originY = y ?? d.originY;
      const batch = new Batch();
      const startX = x ?? lanes[0]?.x ?? 0;
      for (const [i, l] of lanes.entries()) {
        const nx = Math.round(participantSpacing !== undefined ? startX + i * participantSpacing : l.x + (startX - (lanes[0]?.x ?? 0)));
        if (nx !== Math.round(l.x)) batch.set('lifelines', l.id, { x: nx });
      }
      for (const [i, m] of msgs.entries()) {
        const ny = Math.round(
          rowSpacing !== undefined ? originY + d.headerHeight + rowSpacing * (i + 1) : m.y + (originY - d.originY),
        );
        if (ny !== Math.round(m.y)) batch.set('messages', m.id, { y: ny });
      }
      const patch: Record<string, number> = {};
      if (participantSpacing !== undefined) patch.lifelineSpacing = participantSpacing;
      if (rowSpacing !== undefined) patch.rowSpacing = rowSpacing;
      if (originY !== d.originY) patch.originY = originY;
      if (Object.keys(patch).length) batch.set('diagrams', diagramId, patch);
      const writes = await batch.send(api, id);
      return { diagramId, participants: lanes.length, messages: msgs.length, writes };
    },
  );

  tool(
    'update_messages',
    'Edit many sequence messages in one call (label, style, color, wrap) - e.g. restyle every reply as dashed. Use update_message to change endpoints or morph tags.',
    {
      projectId,
      updates: z
        .array(
          z.object({
            messageId: z.string(),
            label: z.string().optional(),
            style: z.enum(['solid', 'dashed', 'break']).optional(),
            color: z.string().optional().describe('Palette name (swatch; #hex only if the user asked for an exact color); empty string clears.'),
            wrap: z.boolean().optional(),
          }),
        )
        .min(1),
    },
    { idempotent: true },
    async ({ projectId: id, updates }) => {
      const { schema } = await graph(id);
      const missing = updates.filter((u) => !schema.sequenceMessages.some((m) => m.id === u.messageId));
      if (missing.length) throw new UserError(`No message(s): ${missing.map((u) => u.messageId).join(', ')}.`);
      for (const u of updates) {
        const m = schema.sequenceMessages.find((v) => v.id === u.messageId);
        if (u.style && u.style !== 'break' && m && m.fromLifelineId === m.toLifelineId) {
          throw new UserError(`Message ${u.messageId} has the same participant at both ends; it can only be a 'break'.`);
        }
      }
      const batch = new Batch();
      for (const u of updates) {
        batch.set('messages', u.messageId, {
          ...(u.label !== undefined ? { label: u.label } : {}),
          ...(u.style ? { style: u.style, arrowhead: u.style === 'dashed' ? 'open' : 'arrow' } : {}),
          ...(u.color !== undefined ? { color: colorArg(u.color, 'the message arrow') } : {}),
          ...(u.wrap !== undefined ? { wrap: u.wrap } : {}),
        });
      }
      await batch.send(api, id);
      return { updated: updates.length };
    },
  );

  // ---- Bulk delete ----------------------------------------------------------------------

  tool(
    'delete_items',
    'Permanently delete many things in one call: drawing elements, tables (name/id, their relationships go too), relationships, sequence diagrams, participants and messages, all by id. Slide frames are refused (use delete_slide). Atomic: one transaction, so either everything is deleted or nothing is.',
    {
      projectId,
      items: z.array(z.string()).min(1).describe('Ids (or table names).'),
      confirm: z.literal(true).describe('Must be true. Destructive: confirm the user actually wants these deleted.'),
    },
    { destructive: true },
    async ({ projectId: id, items }) => {
      const { schema } = await graph(id);
      const batch = new Batch();
      const labels: string[] = [];
      const section = { element: 'elements', table: 'tables', diagram: 'diagrams', participant: 'lifelines', message: 'messages' } as const;
      for (const ref of new Set(items)) {
        const rel = schema.relationships.find((r) => r.id === ref);
        if (rel) {
          batch.delete('relationships', rel.id);
          labels.push(`relationship ${rel.id}`);
          continue;
        }
        for (const r of groupMembers(schema, ref) ?? [resolveRef(schema, ref)]) {
          batch.delete(section[r.kind], r.id);
          labels.push(`${r.kind} ${r.label}`);
        }
      }
      // One transaction: everything goes, or (on any error) nothing does.
      await batch.send(api, id);
      return { deleted: labels.length, items: labels };
    },
  );

  // ---- Checks --------------------------------------------------------------------------

  tool(
    'check_layout',
    "Find layout problems without changing anything: (1) overlaps - items that partly cover each other (a label fully inside a box is intentional nesting and ignored; items on different slides are never compared); (2) outOfBounds - slide content sticking out past its slide frame, with how far per side (items wholly outside the frame are staging for morph entrances/exits: listed under offSlide, not counted as problems); (3) unattached - free items that sit on a slide but are not part of it; (4) textOverflow - shape labels / code cards whose text probably does not fit. Positions are estimates of the rendered size. Check one slide, or everything. Fix with fit_to_bounds, compact_layout, move_element or style_elements.",
    {
      projectId,
      slide: slideRef,
      presentation: presentationRef,
      checks: z
        .array(enumOf(['overlaps', 'outOfBounds', 'unattached', 'textOverflow']))
        .optional()
        .describe('Subset to run (default all).'),
      tolerance: z.number().min(0).max(50).optional().describe('Ignore overlaps / overflow up to this many px (default 2).'),
      includeNested: z.boolean().optional().describe('Also report items lying entirely inside another.'),
      includeLines: z.boolean().optional().describe('Also test free-standing lines/arrows (bound connectors are always skipped).'),
    },
    { readOnly: true },
    async ({ projectId: id, slide, presentation, checks, tolerance, includeNested, includeLines }) => {
      const { schema } = await graph(id);
      const frame = slide ? resolveSlide(schema, slide, presentation) : undefined;
      const want = new Set(checks?.length ? (checks as string[]) : ['overlaps', 'outOfBounds', 'unattached', 'textOverflow']);
      const frames = slideFramesOf(schema);
      let items = collectItems(schema, { lines: includeLines ? 'free' : 'none' });
      if (frame) items = items.filter((i) => i.slideId === frame.id);
      const where = (i: LayoutItem): string => i.slideId ?? 'canvas';
      const out: Record<string, unknown> = {};
      let problems = 0;

      if (want.has('overlaps')) {
        const rows = findOverlaps(items, { tolerance: tolerance ?? 2, includeNested });
        problems += rows.length;
        const c = capped(
          rows.map((o) => ({
            a: brief(o.a),
            b: brief(o.b),
            on: where(o.a),
            overlap: box(o.intersection),
            percentOfSmaller: Math.round(o.fractionOfSmaller * 100),
          })),
        );
        out.overlaps = { count: rows.length, ...c };
      }
      if (want.has('outOfBounds')) {
        const rows = findOutOfBounds(items, frames, tolerance ?? 1);
        problems += rows.length;
        const c = capped(
          rows.map((o) => ({
            item: brief(o.item),
            slide: o.frame.id,
            overflowPx: Object.fromEntries(Object.entries(o.overflow).filter(([, v]) => v > 0)),
            fullyOutside: o.fullyOutside,
          })),
        );
        out.outOfBounds = {
          count: rows.length,
          ...c,
          ...(rows.length ? { fix: 'fit_to_bounds (scales to fit) or move_element / scale_items for single items' } : {}),
        };
        // Wholly outside the frame = staged for a morph entrance/exit: listed, not a problem.
        const staged = findOffSlide(items, frames);
        if (staged.length) {
          out.offSlide = {
            count: staged.length,
            ...capped(staged.map((i) => ({ item: brief(i), slide: i.slideId }))),
            note: 'Staged outside the frame (never shown; morph slides them in/out). Layout tools leave them alone.',
          };
        }
      }
      if (want.has('unattached') && !frame) {
        const rows = findUnattached(items, frames);
        problems += rows.length;
        out.unattached = {
          count: rows.length,
          ...capped(rows.map((u) => ({ item: brief(u.item), sitsOnSlide: u.frame.id }))),
          ...(rows.length ? { note: 'They show on the canvas but not in the slide when presenting (restack_slides claims them).' } : {}),
        };
      }
      if (want.has('textOverflow')) {
        const rows = findTextOverflow(schema, frame ? (e) => e.slideId === frame.id : undefined);
        problems += rows.length;
        out.textOverflow = {
          count: rows.length,
          ...capped(rows.map((t) => ({ item: brief(t.item), problem: t.problem, suggestion: t.suggestion }))),
        };
      }
      return {
        ok: problems === 0,
        problems,
        scope: frame ? `slide ${frame.id}` : 'whole project',
        itemsChecked: items.length,
        ...out,
        note: `Sizes of tables, text and diagrams are estimates (sequence diagrams include a ${SEQUENCE_BOX_PAD}px box margin).`,
      };
    },
  );
}

function overlapsFrame(
  r: { x: number; y: number; w: number; h: number },
  f: { x: number; y: number; width: number; height: number },
): boolean {
  return r.x < f.x + f.width && r.x + r.w > f.x && r.y < f.y + f.height && r.y + r.h > f.y;
}
