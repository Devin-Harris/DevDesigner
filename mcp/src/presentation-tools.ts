// Presentation tools. A slide is a `frame` element with a `slide` config; slides of
// one presentation are stacked at the same spot and own their content via
// `slideId`. New slides/presentations are built as export files (one atomic
// import); everything else composes the plain element/table/diagram endpoints.

import { z } from 'zod';
import {
  MORPH_BY_OPTIONS,
  SLIDE_DIRECTIONS,
  SLIDE_EASINGS,
  SLIDE_HEIGHT,
  SLIDE_PADDING,
  SLIDE_TRANSITION_TYPES,
  SLIDE_WIDTH,
  buildPresentationFile,
  buildSlideContent,
  contentFile,
  findFreeSpot,
  isSoloTag,
  matchDiagrams,
  matchLifelines,
  matchMessages,
  matchMorphItems,
  morphIdForTag,
  morphTagOf,
  normalizeTransition,
  presentationNames,
  presentationOf,
  presentationSlides,
  soloMorphId,
  schemaRects,
  sequenceDiagramRect,
  stackSlideFrames,
  tableRect,
  type CanvasElementModel,
  type MorphItem,
  type ImportIntoProjectResponse,
  type ProjectGraphResponse,
  type SchemaModel,
  type SchemaMutation,
  type SlideConfig,
  type SlideItem,
  type SlideSpec,
} from '@dbdesigner/shared';
import type { DbDesignerApi } from './api';
import { loadImage } from './images';
import { UserError } from './model';

export type ToolFn = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  hints: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean },
  run: (args: z.infer<z.ZodObject<S>>) => Promise<object | string>,
) => void;

// --- Schemas ---------------------------------------------------------------------

const projectId = z.string().describe('Project id (from list_projects).');
const confirm = z.literal(true).describe('Must be true. Destructive: confirm the user wants this deleted.');

const transitionSchema = z.object({
  type: z.enum(SLIDE_TRANSITION_TYPES as unknown as [string, ...string[]]),
  direction: z
    .enum(SLIDE_DIRECTIONS as unknown as [string, ...string[]])
    .optional()
    .describe("For type 'slide': the way it travels (default left)."),
  duration: z.number().min(0).max(10000).optional().describe('Milliseconds (default 600).'),
  easing: z.enum(SLIDE_EASINGS as unknown as [string, ...string[]]).optional(),
  morphBy: z
    .enum(MORPH_BY_OPTIONS as unknown as [string, ...string[]])
    .optional()
    .describe(
      "Morph only - what changed text animates by (like PowerPoint's Effect Options): 'character' (default; letters and words glide), 'word' (whole words glide, leftovers fade) or 'object' (text moves as one piece and cross-fades). Words tagged with the same `runs[].morph` always glide.",
    ),
});

const morph = {
  morph: z
    .string()
    .max(60)
    .optional()
    .describe(
      'OPT-IN morph link: items on different slides with the same tag are the same object for morph transitions (they glide, resize and restyle into each other). Omit it for almost everything - untagged items get a unique id and never morph. Only share a tag for the few objects that really persist between slides (e.g. one box that moves). Use short names like "api-box".',
    ),
};
const color = z
  .string()
  .optional()
  .describe('Palette name (e.g. "ink", "blue", "amber-soft"; see list_colors) or #hex.');
const runs = z
  .array(
    z.object({
      text: z.string(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      color,
      morph: z
        .string()
        .max(60)
        .optional()
        .describe(
          'Per-word morph tag: the same tag on another slide glides these words into those words, wherever they are and whatever the rest of the text does. Use for the one or two words that persist (e.g. a number that changes).',
        ),
    }),
  )
  .optional()
  .describe('Styled/tagged stretches of the text; they replace `text` (their texts are concatenated).');
const at = {
  x: z.number().optional().describe('Slide-local X (px from the slide\'s left). Omit to flow top-to-bottom.'),
  y: z.number().optional().describe('Slide-local Y (px from the slide\'s top).'),
};
const slideItem = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string(),
    fontSize: z.number().optional(),
    color,
    runs,
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number().optional(),
    width: z.number().optional(),
    color,
    runs,
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('image'),
    svg: z
      .string()
      .optional()
      .describe('Inline SVG markup (<svg viewBox=...>): icons, logos, simple illustrations you draw yourself.'),
    data: z.string().optional().describe('Base64 PNG/JPEG/GIF/WebP/SVG (needs mimeType unless a data: URL).'),
    mimeType: z.string().optional(),
    filePath: z.string().optional().describe('Path of an image file on the MCP server machine.'),
    url: z.string().optional().describe('http(s) URL of an image to download.'),
    width: z.number().optional().describe('Slide px; height follows the aspect ratio. Default: fits the space left.'),
    height: z.number().optional(),
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('bullets'),
    items: z.array(z.string()),
    fontSize: z.number().optional(),
    width: z.number().optional(),
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('shape'),
    shape: z.enum(['rectangle', 'ellipse', 'diamond']),
    text: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    backgroundColor: z.string().optional().describe('Fill: palette name (soft tints read best) or #hex.'),
    strokeColor: z.string().optional().describe('Outline: palette name or #hex.'),
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('code'),
    code: z.string(),
    language: z
      .enum(['plaintext', 'typescript', 'sql', 'json', 'python', 'csharp', 'java', 'html', 'css', 'bash'])
      .optional(),
    fileName: z
      .string()
      .max(120)
      .optional()
      .describe('Optional file name (e.g. "user.service.ts") shown in a title bar, as if the code lived in that file.'),
    fontSize: z.number().optional(),
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('schema'),
    tables: z.array(
      z.object({
        name: z.string(),
        color: z
          .string()
          .optional()
          .describe('Header color: palette name or #hex. One color per domain; unset = connected tables share one automatically.'),
        columns: z.array(
          z.object({
            name: z.string(),
            type: z.string().optional(),
            primaryKey: z.boolean().optional(),
            nullable: z.boolean().optional(),
            unique: z.boolean().optional(),
            references: z.string().optional().describe("'table.column' (within this schema block)."),
          }),
        ),
      }),
    ),
    relationships: z
      .array(z.object({ from: z.string(), to: z.string(), type: z.enum(['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY']).optional() }))
      .optional(),
    ...at,
  }),
  z.object({
    type: z.literal('sequence'),
    title: z.string().optional(),
    participants: z.array(
      z.union([
        z.string(),
        z.object({
          name: z.string(),
          color: z.string().optional().describe('Header color: palette name or #hex.'),
          lineColor: z.string().optional(),
          morph: z.string().max(60).optional().describe('Pairs with the same tag on the next slide even if renamed.'),
        }),
      ]),
    ),
    messages: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        style: z.enum(['solid', 'dashed', 'break']).optional(),
        color: z.string().optional().describe('Arrow color: palette name or #hex (leave unset unless meaningful).'),
        morph: z.string().max(60).optional().describe('Pairs with the same tag on the next slide even if reworded.'),
      }),
    ),
    background: z.string().optional().describe('Diagram background: palette name or #hex.'),
    morph: z.string().max(60).optional().describe('Pairs this whole diagram with the same tag on the next slide.'),
    ...at,
  }),
]);

const slideSpec = z.object({
  title: z.string().optional().describe('Big heading at the top of the slide.'),
  notes: z.string().optional().describe('Speaker notes.'),
  hidden: z.boolean().optional().describe('Skipped when presenting.'),
  transition: transitionSchema
    .optional()
    .describe(
      "How this slide is entered (ignored on the first slide). Leave it out: slides default to a 300ms morph, which is almost always right. Only override for a deliberate change (e.g. {type:'none'}).",
    ),
  content: z
    .array(slideItem)
    .optional()
    .describe(
      'Items placed in flow top-to-bottom on a 1280x720 slide. Keep each slide to what fits: ~5 bullets, or one diagram.',
    ),
});

// --- Helpers ---------------------------------------------------------------------

type RawItem = Record<string, unknown> & { type: string };

/**
 * Turn image items given as svg/data/filePath/url into the builder's
 * `{ image: { mimeType, data } }` form (loading files / downloading URLs).
 */
async function resolveImages<T extends { content?: unknown[] }>(slides: readonly T[]): Promise<T[]> {
  const out: T[] = [];
  for (const slide of slides) {
    if (!slide.content?.some((i) => (i as RawItem).type === 'image')) {
      out.push(slide);
      continue;
    }
    const content: unknown[] = [];
    for (const raw of slide.content) {
      const item = raw as RawItem;
      if (item.type !== 'image') {
        content.push(item);
        continue;
      }
      const { svg, data, mimeType, filePath, url, ...rest } = item as RawItem & {
        svg?: string;
        data?: string;
        mimeType?: string;
        filePath?: string;
        url?: string;
      };
      const loaded = await loadImage({ svg, data, mimeType, filePath, url });
      content.push({ ...rest, image: { mimeType: loaded.mimeType, data: loaded.data } });
    }
    out.push({ ...slide, content });
  }
  return out;
}

type Frame = CanvasElementModel & { slide: SlideConfig };

function slideFrames(schema: SchemaModel): Frame[] {
  return schema.elements.filter((e): e is Frame => e.type === 'frame' && e.slide !== undefined);
}

function resolvePresentation(schema: SchemaModel, name: string | undefined): string {
  const names = presentationNames(slideFrames(schema));
  if (names.length === 0) {
    throw new UserError('This project has no presentations yet. Use create_presentation.');
  }
  if (!name) {
    if (names.length === 1) return names[0];
    throw new UserError(`Several presentations exist; pass \`presentation\`: ${names.join(', ')}.`);
  }
  const hit = names.find((n) => n.toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new UserError(`No presentation "${name}". Existing: ${names.join(', ')}.`);
  return hit;
}

/** A slide by frame id, or by 1-based number within a presentation. */
function resolveSlide(schema: SchemaModel, ref: string, presentation?: string): Frame {
  const frames = slideFrames(schema);
  const byId = frames.find((f) => f.id === ref);
  if (byId) return byId;
  if (/^\d+$/.test(ref.trim())) {
    const name = resolvePresentation(schema, presentation);
    const list = presentationSlides(frames, name);
    const hit = list[Number(ref) - 1];
    if (!hit) throw new UserError(`Presentation "${name}" has ${list.length} slide(s); no slide ${ref}.`);
    return hit;
  }
  throw new UserError(`No slide "${ref}". Use a slide id from list_presentations, or its 1-based number.`);
}

/** Entities that belong to a slide through `slideId`. */
function ownedBy(schema: SchemaModel, frameId: string): {
  elements: CanvasElementModel[];
  tableIds: string[];
  diagramIds: string[];
} {
  return {
    elements: schema.elements.filter((e) => e.slideId === frameId),
    tableIds: schema.tables.filter((t) => t.slideId === frameId).map((t) => t.id),
    diagramIds: schema.sequenceDiagrams.filter((d) => d.slideId === frameId).map((d) => d.id),
  };
}

/** Bottom edge (slide-local Y) of everything a slide already holds. */
function contentBottom(schema: SchemaModel, frame: Frame): number {
  const own = ownedBy(schema, frame.id);
  const rects = [
    ...own.elements.map((e) => ({ y: e.y, h: e.height })),
    ...schema.tables.filter((t) => own.tableIds.includes(t.id)).map((t) => tableRect(t)),
    ...schema.sequenceDiagrams
      .filter((d) => own.diagramIds.includes(d.id))
      .flatMap((d) => {
        const r = sequenceDiagramRect(d, schema.lifelines, schema.sequenceMessages);
        return r ? [{ y: r.y, h: r.h }] : [];
      }),
  ];
  if (rects.length === 0) return SLIDE_PADDING;
  return Math.max(...rects.map((r) => r.y + r.h)) - frame.y + 24;
}

/**
 * Persist the differences between two versions of a schema (positions, slide
 * ownership, slide frame size) through the granular endpoints. Used to move slides
 * back onto their presentation's spot.
 */
export async function applyLayoutDiff(
  api: DbDesignerApi,
  projectId: string,
  before: SchemaModel,
  after: SchemaModel,
): Promise<number> {
  let changed = 0;
  const was = <T extends { id: string }>(list: readonly T[]): Map<string, T> =>
    new Map(list.map((x) => [x.id, x]));
  const els = was(before.elements);
  for (const e of after.elements) {
    const b = els.get(e.id);
    if (!b) continue;
    if ((e.slideId ?? null) !== (b.slideId ?? null)) {
      await api.patch(`/elements/${e.id}`, { slideId: e.slideId ?? null });
      changed += 1;
    }
    if (e.width !== b.width || e.height !== b.height) {
      await api.patch(`/elements/${e.id}`, { width: e.width, height: e.height });
      changed += 1;
    }
    if (e.x !== b.x || e.y !== b.y) {
      await api.patch(`/elements/${e.id}/position`, { x: e.x, y: e.y });
      changed += 1;
    }
  }
  const tables = was(before.tables);
  for (const t of after.tables) {
    const b = tables.get(t.id);
    if (!b) continue;
    if ((t.slideId ?? null) !== (b.slideId ?? null)) {
      await api.patch(`/tables/${t.id}`, { slideId: t.slideId ?? null });
      changed += 1;
    }
    if (t.x !== b.x || t.y !== b.y) {
      await api.patch(`/tables/${t.id}/position`, { x: t.x, y: t.y });
      changed += 1;
    }
  }
  const diagrams = was(before.sequenceDiagrams);
  for (const d of after.sequenceDiagrams) {
    const b = diagrams.get(d.id);
    if (!b) continue;
    const patch: Record<string, unknown> = {};
    if ((d.slideId ?? null) !== (b.slideId ?? null)) patch.slideId = d.slideId ?? null;
    if (d.originY !== b.originY) patch.originY = d.originY;
    if (Object.keys(patch).length) {
      await api.patch(`/projects/${projectId}/sequence-diagrams/${d.id}`, patch);
      changed += 1;
    }
  }
  const lifelines = was(before.lifelines);
  for (const l of after.lifelines) {
    const b = lifelines.get(l.id);
    if (b && l.x !== b.x) {
      await api.patch(`/projects/${projectId}/lifelines/${l.id}/position`, { x: l.x });
      changed += 1;
    }
  }
  const messages = was(before.sequenceMessages);
  for (const m of after.sequenceMessages) {
    const b = messages.get(m.id);
    if (b && m.y !== b.y) {
      await api.patch(`/projects/${projectId}/messages/${m.id}/position`, { y: m.y });
      changed += 1;
    }
  }
  const rels = was(before.relationships);
  for (const r of after.relationships) {
    const b = rels.get(r.id);
    if (b && JSON.stringify(r.waypoints ?? []) !== JSON.stringify(b.waypoints ?? [])) {
      await api.patch(`/relationships/${r.id}`, { waypoints: r.waypoints ?? [] });
      changed += 1;
    }
  }
  return changed;
}

export function registerPresentationTools(tool: ToolFn, api: DbDesignerApi): void {
  const graph = (id: string): Promise<ProjectGraphResponse> =>
    api.get<ProjectGraphResponse>(`/projects/${id}`);

  const importFile = async (id: string, file: unknown): Promise<SchemaMutation[]> =>
    (await api.post<ImportIntoProjectResponse>(`/projects/${id}/import-content`, { file })).mutations;

  /** Write the new slide order (0..n-1) for slides given in presentation order. */
  const applyOrder = async (orderedIds: string[], schema: SchemaModel): Promise<void> => {
    for (const [i, frameId] of orderedIds.entries()) {
      const f = schema.elements.find((e) => e.id === frameId);
      const slide = f?.slide;
      if (slide && slide.order !== i) {
        await api.patch(`/elements/${frameId}`, { slide: { ...slide, order: i } });
      }
    }
  };

  tool(
    'list_presentations',
    'List the project\'s presentations and their slides (id, 1-based number, hidden, notes, transition, headline, item counts). Presenting itself happens in the app (F5 / Slides panel).',
    { projectId },
    { readOnly: true },
    async ({ projectId: id }) => {
      const { schema } = await graph(id);
      const frames = slideFrames(schema);
      return presentationNames(frames).map((name) => ({
        name,
        stacked: new Set(
          presentationSlides(frames, name).map((f) => `${f.x},${f.y},${f.width},${f.height}`),
        ).size === 1,
        slides: presentationSlides(frames, name).map((f, i) => {
          const own = ownedBy(schema, f.id);
          const headline = own.elements.find((e) => e.type === 'text' && e.text)?.text;
          return {
            id: f.id,
            number: i + 1,
            hidden: f.slide.hidden ?? false,
            ...(f.slide.notes ? { notes: f.slide.notes } : {}),
            transition: f.slide.transition?.type ?? 'none',
            ...(headline ? { headline: headline.slice(0, 80) } : {}),
            items: own.elements.length + own.tableIds.length + own.diagramIds.length,
          };
        }),
      }));
    },
  );

  tool(
    'restack_slides',
    "Repair presentations whose slides are NOT on one spot (slides scattered around the canvas make the slide panels jump when you switch slides). Moves every slide of every presentation onto its first slide's position and size, taking the content each slide owns along, and claims loose content that lies inside a slide frame. Safe to run repeatedly; does nothing when slides are already stacked.",
    { projectId },
    { idempotent: true },
    async ({ projectId: id }) => {
      const { schema } = await graph(id);
      const result = stackSlideFrames(schema);
      if (result.moved === 0 && result.claimed === 0) {
        return { restackedSlides: 0, message: 'All slides are already stacked.' };
      }
      const writes = await applyLayoutDiff(api, id, schema, result.schema);
      return { restackedSlides: result.moved, claimedItems: result.claimed, writes };
    },
  );

  tool(
    'create_presentation',
    'Create a NEW presentation (16:9 slides, stacked in one spot on the canvas) from a declarative description, in one atomic call. Each slide has a title, notes, an optional transition, and content items (heading/text/bullets/shape/code/image - incl. inline SVG you draw, plus `schema` and `sequence` blocks that draw real ER / sequence diagrams on the slide) laid out in flow. Colors take palette names (list_colors). Morph granularity: set `transition.morphBy` to object, word or character (default) and tag individual words with `runs[].morph`. Every slide enters with a 300ms morph by default. Objects get unique morph ids, so nothing animates between slides unless you give the same `morph` tag to the few items that should (e.g. one box that moves or grows). Use add_slides to extend it later.',
    {
      projectId,
      name: z.string().optional().describe('Default: first free "Presentation N".'),
      slides: z.array(slideSpec).min(1),
      defaultTransition: transitionSchema
        .optional()
        .describe('Used for every slide without its own transition. Default: morph, 300ms - leave it unset.'),
      x: z.number().optional().describe('World X for the slide area; give both x and y to skip auto-placement.'),
      y: z.number().optional(),
    },
    {},
    async ({ projectId: id, name, slides, defaultTransition, x, y }) => {
      const { schema } = await graph(id);
      const taken = new Set(presentationNames(slideFrames(schema)).map((n) => n.toLowerCase()));
      let presentation = name?.trim();
      if (presentation) {
        if (taken.has(presentation.toLowerCase())) {
          throw new UserError(`Presentation "${presentation}" already exists; use add_slides to extend it.`);
        }
      } else {
        let n = 1;
        while (taken.has(`presentation ${n}`)) n += 1;
        presentation = `Presentation ${n}`;
      }
      const spot =
        typeof x === 'number' && typeof y === 'number'
          ? { x, y }
          : findFreeSpot(schemaRects(schema), SLIDE_WIDTH, SLIDE_HEIGHT, { gap: 160 });
      const built = buildPresentationFile((await resolveImages(slides)) as SlideSpec[], {
        presentation,
        frame: { x: Math.round(spot.x), y: Math.round(spot.y), width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
        defaultTransition: defaultTransition as never,
      });
      const mutations = await importFile(id, built.file);
      const frames = mutations
        .flatMap((m) => (m.kind === 'element.created' && m.element.type === 'frame' ? [m.element] : []))
        .sort((a, b) => (a.slide?.order ?? 0) - (b.slide?.order ?? 0));
      return {
        presentation,
        slides: frames.map((f, i) => ({ id: f.id, number: i + 1, title: slides[i]?.title ?? null })),
        placedAt: { x: Math.round(spot.x), y: Math.round(spot.y) },
        warnings: built.warnings,
      };
    },
  );

  tool(
    'add_slides',
    'Append slides to an existing presentation (or insert them after `afterSlide`). Same slide description as create_presentation; new slides take the presentation\'s frame position and size.',
    {
      projectId,
      presentation: z.string().optional().describe('Required when the project has several presentations.'),
      slides: z.array(slideSpec).min(1),
      afterSlide: z.string().optional().describe('Slide id or 1-based number to insert after; default append.'),
      defaultTransition: transitionSchema
        .optional()
        .describe('Default: morph, 300ms - leave it unset.'),
    },
    {},
    async ({ projectId: id, presentation, slides, afterSlide, defaultTransition }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const existing = presentationSlides(slideFrames(schema), name);
      const anchor = existing[0];
      const after = afterSlide ? resolveSlide(schema, afterSlide, name) : null;
      const built = buildPresentationFile((await resolveImages(slides)) as SlideSpec[], {
        presentation: name,
        frame: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
        defaultTransition: defaultTransition as never,
      });
      const mutations = await importFile(id, built.file);
      const created = mutations
        .flatMap((m) => (m.kind === 'element.created' && m.element.type === 'frame' ? [m.element] : []))
        .sort((a, b) => (a.slide?.order ?? 0) - (b.slide?.order ?? 0));
      if (after) {
        const fresh = (await graph(id)).schema;
        const createdIds = new Set(created.map((f) => f.id));
        const rest = presentationSlides(slideFrames(fresh), name).filter((f) => !createdIds.has(f.id));
        const at = rest.findIndex((f) => f.id === after.id) + 1;
        const ordered = [...rest.slice(0, at), ...created, ...rest.slice(at)].map((f) => f.id);
        await applyOrder(ordered, fresh);
      }
      return {
        presentation: name,
        added: created.map((f) => ({ id: f.id })),
        warnings: built.warnings,
      };
    },
  );

  tool(
    'add_to_slide',
    'Add content items to an existing slide, placed in flow below what the slide already holds.',
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: z.string().optional(),
      content: z.array(slideItem).min(1),
    },
    {},
    async ({ projectId: id, slide, presentation, content }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const resolved = (await resolveImages([{ content }]))[0].content as SlideItem[];
      const built = buildSlideContent(resolved, frame, {
        idPrefix: 'a_',
        startY: contentBottom(schema, frame),
        label: 'Slide',
      });
      const mutations = await importFile(id, contentFile(built));
      // Image elements are created by the import, so count them like any other element.
      for (const m of mutations) {
        if (m.kind === 'element.created') {
          await api.patch(`/elements/${m.element.id}`, { slideId: frame.id });
        } else if (m.kind === 'table.created') {
          await api.patch(`/tables/${m.table.id}`, { slideId: frame.id });
        } else if (m.kind === 'sequenceDiagram.created') {
          await api.patch(`/projects/${id}/sequence-diagrams/${m.diagram.id}`, { slideId: frame.id });
        }
      }
      return { slide: frame.id, added: mutations.length, warnings: built.warnings };
    },
  );

  tool(
    'update_slide',
    'Change a slide\'s speaker notes, hidden flag or entry transition.',
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: z.string().optional(),
      notes: z.string().optional().describe('Empty string clears the notes.'),
      hidden: z.boolean().optional(),
      transition: transitionSchema.optional(),
    },
    { idempotent: true },
    async ({ projectId: id, slide, presentation, notes, hidden, transition }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const next: SlideConfig = { ...frame.slide };
      if (notes !== undefined) {
        if (notes) next.notes = notes;
        else delete next.notes;
      }
      if (hidden !== undefined) next.hidden = hidden || undefined;
      if (transition) next.transition = normalizeTransition(transition as never);
      await api.patch(`/elements/${frame.id}`, { slide: next });
      return { slide: frame.id, updated: true };
    },
  );

  tool(
    'set_presentation_transition',
    'Apply one transition to every slide of a presentation (the first slide has no entry transition and is skipped).',
    { projectId, presentation: z.string().optional(), transition: transitionSchema },
    { idempotent: true },
    async ({ projectId: id, presentation, transition }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const slides = presentationSlides(slideFrames(schema), name);
      const t = normalizeTransition(transition as never);
      for (const f of slides.slice(1)) {
        await api.patch(`/elements/${f.id}`, { slide: { ...f.slide, transition: t } });
      }
      return { presentation: name, updated: Math.max(0, slides.length - 1) };
    },
  );

  tool(
    'reorder_slides',
    'Set the slide order of a presentation. Give ALL its slide ids in the new order.',
    { projectId, presentation: z.string().optional(), orderedSlideIds: z.array(z.string()) },
    { idempotent: true },
    async ({ projectId: id, presentation, orderedSlideIds }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const own = presentationSlides(slideFrames(schema), name);
      const same =
        own.length === orderedSlideIds.length && orderedSlideIds.every((s) => own.some((f) => f.id === s));
      if (!same) {
        throw new UserError(`orderedSlideIds must list exactly: ${own.map((f) => f.id).join(', ')}.`);
      }
      await applyOrder(orderedSlideIds, schema);
      return { presentation: name, reordered: own.length };
    },
  );

  const deleteSlideFrames = async (id: string, schema: SchemaModel, frames: Frame[]): Promise<number> => {
    let removed = 0;
    for (const frame of frames) {
      const own = ownedBy(schema, frame.id);
      for (const e of own.elements) await api.delete(`/elements/${e.id}`);
      for (const t of own.tableIds) await api.delete(`/tables/${t}`);
      for (const d of own.diagramIds) await api.delete(`/projects/${id}/sequence-diagrams/${d}`);
      await api.delete(`/elements/${frame.id}`);
      removed += own.elements.length + own.tableIds.length + own.diagramIds.length + 1;
    }
    return removed;
  };

  tool(
    'delete_slide',
    'Permanently delete a slide and everything on it (its text, shapes, tables, diagrams).',
    { projectId, slide: z.string(), presentation: z.string().optional(), confirm },
    { destructive: true },
    async ({ projectId: id, slide, presentation }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      return { deletedItems: await deleteSlideFrames(id, schema, [frame]) };
    },
  );

  tool(
    'delete_presentation',
    'Permanently delete a whole presentation: all its slides and everything on them.',
    { projectId, presentation: z.string(), confirm },
    { destructive: true },
    async ({ projectId: id, presentation }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const frames = slideFrames(schema).filter((f) => presentationOf(f) === name);
      return { presentation: name, deletedItems: await deleteSlideFrames(id, schema, frames) };
    },
  );

  // ---- Morph tags ---------------------------------------------------------------

  const describe = (e: CanvasElementModel): string =>
    e.text ? `${e.type} "${e.text.replace(/\s+/g, ' ').slice(0, 40)}"` : `${e.type} ${e.id.slice(0, 8)}`;

  tool(
    'get_slide',
    "List what is on one slide: elements (id, type, text, slide-local position/size, morph tag, build step), tables and sequence diagrams. Use the element ids with set_morph_tag.",
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: z.string().optional(),
    },
    { readOnly: true },
    async ({ projectId: id, slide, presentation }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const own = ownedBy(schema, frame.id);
      return {
        slide: frame.id,
        presentation: presentationOf(frame),
        elements: own.elements.map((e) => ({
          id: e.id,
          type: e.type,
          ...(e.text ? { text: e.text.slice(0, 80) } : {}),
          x: Math.round(e.x - frame.x),
          y: Math.round(e.y - frame.y),
          width: Math.round(e.width),
          height: Math.round(e.height),
          ...(morphTagOf(e.morphId) && !isSoloTag(e.morphId)
            ? { morphTag: morphTagOf(e.morphId) }
            : {}),
          ...(e.step ? { step: e.step } : {}),
        })),
        tables: schema.tables
          .filter((t) => own.tableIds.includes(t.id))
          .map((t) => ({ id: t.id, name: t.name })),
        sequenceDiagrams: own.diagramIds.map((did) => {
          const d = schema.sequenceDiagrams.find((x) => x.id === did)!;
          const label = new Map(schema.lifelines.map((l) => [l.id, l.label]));
          const tag = (m: string | undefined): { morphTag?: string } => {
            const t = morphTagOf(m);
            return t && !isSoloTag(m) ? { morphTag: t } : {};
          };
          return {
            id: d.id,
            ...(d.title ? { title: d.title } : {}),
            ...tag(d.morphId),
            participants: schema.lifelines
              .filter((l) => l.diagramId === d.id)
              .sort((a, b) => a.x - b.x)
              .map((l) => ({ id: l.id, name: l.label, ...tag(l.morphId) })),
            messages: schema.sequenceMessages
              .filter((m) => m.diagramId === d.id)
              .sort((a, b) => a.y - b.y)
              .map((m) => ({
                id: m.id,
                from: label.get(m.fromLifelineId) ?? '?',
                to: label.get(m.toLifelineId) ?? '?',
                label: m.label ?? '',
                ...tag(m.morphId),
              })),
          };
        }),
      };
    },
  );

  tool(
    'set_morph_tag',
    "Morph is meant to be minimal: link only the few objects that truly persist between slides. This tags drawing elements (by id, on the same or different slides) so a morph transition treats them as THE SAME object (they glide, resize and restyle into each other). A tagged element only pairs with its own tag. An empty tag isolates the elements instead (a unique id: they never morph). Tables and diagrams can't be tagged (they pair by name). Check the effect with preview_morph.",
    {
      projectId,
      elementIds: z.array(z.string()).min(1),
      tag: z
        .string()
        .max(80)
        .describe('Short name, e.g. "title" or "api-box". Empty string removes the tag.'),
    },
    { idempotent: true },
    async ({ projectId: id, elementIds, tag }) => {
      const { schema } = await graph(id);
      const morphId = morphIdForTag(tag);
      for (const eid of elementIds) {
        const el = schema.elements.find((e) => e.id === eid);
        if (!el) throw new UserError(`No drawing element "${eid}" in this project (tables can't be tagged).`);
      }
      for (const eid of elementIds) {
        await api.patch(`/elements/${eid}`, { morphId: morphId ?? soloMorphId() });
      }
      return {
        updated: elementIds.length,
        tag: morphId ? tag.trim() : null,
        ...(morphId ? {} : { note: 'Isolated: these elements will not morph.' }),
      };
    },
  );

  tool(
    'isolate_morphs',
    "Make objects stop morphing: give every drawing element on the presentation's slides that has NO morph tag its own unique one, so only deliberately shared tags (set_morph_tag / the `morph` field) morph. Use on decks made before this default, or after pasting content. Existing tags (and copied-slide lineage unless resetCopies) are left alone.",
    {
      projectId,
      presentation: z.string().optional(),
      resetCopies: z
        .boolean()
        .optional()
        .describe('Also isolate elements that share a plain lineage because their slide was duplicated.'),
    },
    { idempotent: true },
    async ({ projectId: id, presentation, resetCopies }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const slideIds = new Set(presentationSlides(slideFrames(schema), name).map((f) => f.id));
      let isolated = 0;
      for (const e of schema.elements) {
        if (e.type === 'frame' || !e.slideId || !slideIds.has(e.slideId)) continue;
        const plainLineage = !!e.morphId && morphTagOf(e.morphId) === null;
        if (e.morphId && !(resetCopies && plainLineage)) continue;
        await api.patch(`/elements/${e.id}`, { morphId: soloMorphId() });
        isolated += 1;
      }
      return { presentation: name, isolated };
    },
  );

  tool(
    'preview_morph',
    "Show how each transition between consecutive slides will pair objects for morph: which elements glide into which (and why), which just fade out/in, and for sequence diagrams which participants and messages pair (by tag, name or wording) and which text morphs. Use it after building a deck, then fix poor pairings with set_morph_tag. Tip: a slide only morphs if its transition type is 'morph'.",
    { projectId, presentation: z.string().optional() },
    { readOnly: true },
    async ({ projectId: id, presentation }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const slides = presentationSlides(slideFrames(schema), name);
      const itemsOf = (frame: Frame): Array<{ item: MorphItem; label: string }> => {
        const own = ownedBy(schema, frame.id);
        const out: Array<{ item: MorphItem; label: string }> = own.elements.map((e) => ({
          item: {
            key: e.morphId ?? e.id,
            kind: 'element',
            type: e.type,
            text: e.text ?? '',
            runTags: [...new Set((e.runs ?? []).flatMap((r) => (r.morph ? [r.morph] : [])))],
            cx: e.x + e.width / 2 - frame.x,
            cy: e.y + e.height / 2 - frame.y,
            w: e.width,
            h: e.height,
          },
          label: describe(e),
        }));
        for (const t of schema.tables.filter((x) => own.tableIds.includes(x.id))) {
          const r = tableRect(t);
          out.push({
            item: {
              key: t.id,
              kind: 'table',
              type: 'table',
              text: t.name,
              cx: r.x + r.w / 2 - frame.x,
              cy: r.y + r.h / 2 - frame.y,
              w: r.w,
              h: r.h,
            },
            label: `table "${t.name}"`,
          });
        }
        return out;
      };
      /** How the sequence diagrams of two consecutive slides pair up for the morph. */
      const sequencePairings = (
        s: SchemaModel,
        from: Frame,
        to: Frame,
      ): { sequenceDiagrams?: unknown[] } => {
        const pick = (frame: Frame): Array<{
          d: SchemaModel['sequenceDiagrams'][number];
          lls: SchemaModel['lifelines'];
          ms: SchemaModel['sequenceMessages'];
        }> =>
          s.sequenceDiagrams
            .filter((d) => d.slideId === frame.id)
            .map((d) => ({
              d,
              lls: s.lifelines.filter((l) => l.diagramId === d.id),
              ms: s.sequenceMessages
                .filter((m) => m.diagramId === d.id)
                .sort((p, q) => p.y - q.y),
            }));
        const A = pick(from);
        const B = pick(to);
        if (!A.length && !B.length) return {};
        const name = (p: (typeof A)[number]): string => p.d.title || p.lls.map((l) => l.label).join('/');
        const pairs = matchDiagrams(
          A.map((p) => ({ id: p.d.id, title: p.d.title, morphId: p.d.morphId, lifelines: p.lls })),
          B.map((p) => ({ id: p.d.id, title: p.d.title, morphId: p.d.morphId, lifelines: p.lls })),
        );
        const usedA = new Set(pairs.map(([i]) => i));
        const usedB = new Set(pairs.map(([, j]) => j));
        const diagrams: unknown[] = pairs.map(([i, j]) => {
          const a = A[i];
          const b = B[j];
          const lp = matchLifelines(a.lls, b.lls);
          const bOfA = new Map(lp.map(([x, y]) => [a.lls[x].id, b.lls[y].id] as const));
          const label = new Map([...a.lls, ...b.lls].map((l) => [l.id, l.label]));
          const mp = matchMessages(a.ms, b.ms, lp, a.lls, b.lls).filter(
            ([x, y]) =>
              bOfA.get(a.ms[x].fromLifelineId) === b.ms[y].fromLifelineId &&
              bOfA.get(a.ms[x].toLifelineId) === b.ms[y].toLifelineId,
          );
          const mA = new Set(mp.map(([x]) => x));
          const mB = new Set(mp.map(([, y]) => y));
          const lA = new Set(lp.map(([x]) => x));
          const lB = new Set(lp.map(([, y]) => y));
          const text = (m: SchemaModel['sequenceMessages'][number]): string =>
            `${label.get(m.fromLifelineId)}->${label.get(m.toLifelineId)}: ${m.label ?? ''}`;
          return {
            diagram: name(a),
            into: name(b),
            by: morphTagOf(a.d.morphId) ? `morph tag "${morphTagOf(a.d.morphId)}"` : 'shared participants',
            participants: {
              paired: lp.map(([x, y]) =>
                a.lls[x].label === b.lls[y].label ? a.lls[x].label : `${a.lls[x].label} -> ${b.lls[y].label}`,
              ),
              fadingOut: a.lls.filter((_, x) => !lA.has(x)).map((l) => l.label),
              fadingIn: b.lls.filter((_, y) => !lB.has(y)).map((l) => l.label),
            },
            messages: {
              paired: mp.map(([x, y]) => {
                const same = (a.ms[x].label ?? '') === (b.ms[y].label ?? '');
                return same ? text(a.ms[x]) : `${text(a.ms[x])}  =>  ${b.ms[y].label ?? ''} (text morphs)`;
              }),
              fadingOut: a.ms.filter((_, x) => !mA.has(x)).map(text),
              fadingIn: b.ms.filter((_, y) => !mB.has(y)).map(text),
            },
          };
        });
        for (const [i, p] of A.entries()) {
          if (!usedA.has(i)) diagrams.push({ diagram: name(p), fadingOut: true });
        }
        for (const [j, p] of B.entries()) {
          if (!usedB.has(j)) diagrams.push({ diagram: name(p), fadingIn: true });
        }
        return { sequenceDiagrams: diagrams };
      };
      const transitions = [];
      for (let i = 1; i < slides.length; i += 1) {
        const a = itemsOf(slides[i - 1]);
        const b = itemsOf(slides[i]);
        const pairs = matchMorphItems(a.map((x) => x.item), b.map((x) => x.item));
        const usedA = new Set(pairs.map(([p]) => p));
        const usedB = new Set(pairs.map(([, q]) => q));
        const kind = slides[i].slide.transition?.type ?? 'none';
        transitions.push({
          from: i,
          to: i + 1,
          transition: kind,
          ...(kind !== 'morph' ? { note: "Transition type is not 'morph'; set it with update_slide to use these pairings." } : {}),
          paired: pairs.map(([p, q]) => {
            const tag = morphTagOf(a[p].item.key);
            const shared = a[p].item.runTags?.find((t) => b[q].item.runTags?.includes(t));
            const how = tag && !isSoloTag(a[p].item.key)
              ? `morph tag "${tag}"`
              : a[p].item.key === b[q].item.key
                ? 'copied lineage'
                : shared
                  ? `tagged word "${shared}"`
                  : a[p].item.text.trim() && a[p].item.text.trim() === b[q].item.text.trim()
                    ? 'same text'
                    : 'similar content / position';
            return { from: a[p].label, to: b[q].label, by: how };
          }),
          fadingOut: a.filter((_, p) => !usedA.has(p)).map((x) => x.label),
          fadingIn: b.filter((_, q) => !usedB.has(q)).map((x) => x.label),
          ...(kind === 'morph'
            ? { textAnimatedBy: slides[i].slide.transition?.morphBy ?? 'character' }
            : {}),
          ...sequencePairings(schema, slides[i - 1], slides[i]),
        });
      }
      return { presentation: name, slides: slides.length, transitions };
    },
  );

}
