// Presentation tools. A slide is a `frame` element with a `slide` config; slides of
// one presentation are stacked at the same spot and own their content via
// `slideId`. New slides/presentations are built as export files (one atomic
// import); everything else composes the plain element/table/diagram endpoints.

import { z } from 'zod';
import {
  MORPH_BY_OPTIONS,
  SLIDE_ANIMATION_EFFECTS,
  SLIDE_ANIMATION_KINDS,
  SLIDE_ANIMATION_TRIGGERS,
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
  inkOn,
  isSoloTag,
  matchDiagrams,
  matchLifelines,
  matchMessages,
  matchMorphItems,
  parseGrid,
  morphIdForTag,
  newAnimation,
  normalizeAnimations,
  morphTagOf,
  normalizeTransition,
  presentationNames,
  presentationOf,
  presentationSlides,
  presentationLayouts,
  layoutNameOf,
  layoutOf,
  masterOf,
  slideMorphKey,
  soloMorphId,
  schemaRects,
  sequenceDiagramRect,
  slideAnimations,
  stackSlideFrames,
  tableRect,
  type CanvasElementModel,
  type MorphItem,
  type ImportIntoProjectResponse,
  type ProjectGraphResponse,
  type SchemaModel,
  type SchemaMutation,
  type SlideAnimation,
  type SlideAnimationEffect,
  type SlideAnimationKind,
  type SlideAnimationTrigger,
  type SlideConfig,
  type SlideDirection,
  type SlideItem,
  type SlideSpec,
} from '@devdesigner/shared';
import type { DevDesignerApi } from './api';
import { Batch } from './batch';
import { loadImage } from './images';
import { collectItems, keyOf, placement, type FramePlacement } from './layout';
import { planLayoutMorphTags } from './layout-morph';
import type { DesignHelpers } from './design-tools';
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

const animationSchema = z.object({
  target: z
    .string()
    .describe('Id of an element, table or sequence diagram on the slide (from get_slide).'),
  kind: z
    .enum(SLIDE_ANIMATION_KINDS as unknown as [string, ...string[]])
    .optional()
    .describe("'enter' (default: hidden until it plays), 'exit' (visible until it plays) or 'emphasis'."),
  effect: z
    .enum(SLIDE_ANIMATION_EFFECTS as unknown as [string, ...string[]])
    .optional()
    .describe("'fade' (default), 'appear', 'fly', 'wipe', 'zoom'; emphasis only offers 'pulse'."),
  trigger: z
    .enum(SLIDE_ANIMATION_TRIGGERS as unknown as [string, ...string[]])
    .optional()
    .describe("'click' (default: waits for the presenter), 'with' (together with the entry above) or 'after' (when it ends)."),
  duration: z.number().min(0).max(10000).optional().describe('Milliseconds (default 500).'),
  delay: z.number().min(0).max(30000).optional().describe('Milliseconds after the trigger (default 0).'),
  direction: z
    .enum(SLIDE_DIRECTIONS as unknown as [string, ...string[]])
    .optional()
    .describe("For fly / wipe: the side it comes from (exits: goes to). Default left."),
});

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
  .describe('Palette name (e.g. "ink", "blue", "amber-soft"; see list_colors; #hex only if the user asked for an exact color).');
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
    filePath: z.string().optional().describe('Path of an image file (.png/.jpg/.jpeg/.gif/.webp/.svg) on the MCP server machine; reads a local file, and its bytes must be a real image.'),
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
    shape: z.enum(['rectangle', 'ellipse', 'diamond', 'triangle']),
    text: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    backgroundColor: z.string().optional().describe('Fill: palette name (soft tints read best; #hex only if the user asked for an exact color).'),
    strokeColor: z.string().optional().describe('Outline: palette name (swatch; #hex only if the user asked for an exact color).'),
    ...morph,
    ...at,
  }),
  z.object({
    type: z.literal('code'),
    code: z.string(),
    language: z
      .enum(['plaintext', 'typescript', 'sql', 'json', 'python', 'csharp', 'java', 'html', 'css', 'scss', 'bash'])
      .optional(),
    fileName: z
      .string()
      .max(120)
      .optional()
      .describe('Optional file name (e.g. "user.service.ts") shown in a title bar, as if the code lived in that file.'),
    fontSize: z.number().optional(),
    backgroundColor: z
      .string()
      .optional()
      .describe(
        'Card surface: palette name (e.g. "ink", "charcoal" for a dark editor look, "slate-soft"; #hex only if the user asked for an exact color). Default: light grey. Token colors switch to a light palette on dark surfaces.',
      ),
    diffCode: z
      .string()
      .max(50000)
      .optional()
      .describe(
        'Makes this a code DIFF card: `code` is the ORIGINAL (before) version and `diffCode` the CHANGED (after) version, both as full plain source (no +/- prefixes, no unified-diff headers). Lines are compared automatically; removed lines show red, added green, changed words emphasised.',
      ),
    diffView: z
      .enum(['split', 'inline'])
      .optional()
      .describe('How a diff shows (only with `diffCode`): "split" = before | after side by side (default), "inline" = one column with removed and added lines interleaved.'),
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
          .describe('Header color: palette name (swatch; #hex only if the user asked for an exact color). One color per domain; unset = connected tables share one automatically.'),
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
          color: z.string().optional().describe('Header color: palette name (swatch; #hex only if the user asked for an exact color).'),
          lineColor: z.string().optional(),
          strokeColor: z.string().optional(),
          textColor: z.string().optional(),
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
        color: z.string().optional().describe('Arrow color: palette name (swatch; #hex only if the user asked for an exact color) (leave unset unless meaningful).'),
        morph: z.string().max(60).optional().describe('Pairs with the same tag on the next slide even if reworded.'),
      }),
    ),
    background: z.string().optional().describe('Diagram background: palette name (swatch; #hex only if the user asked for an exact color).'),
    morph: z.string().max(60).optional().describe('Pairs this whole diagram with the same tag on the next slide.'),
    ...at,
  }),
]);

const slideSpec = z.object({
  title: z.string().optional().describe('Big heading at the top of the slide.'),
  notes: z.string().optional().describe('Speaker notes.'),
  hidden: z.boolean().optional().describe('Skipped when presenting.'),
  template: z
    .string()
    .optional()
    .describe(
      'add_slides only: an existing slide id to copy the look from - its background, title styling/position and decorative shapes (accent bars etc.); the content is still yours.',
    ),
  layout: z
    .string()
    .optional()
    .describe(
      'A layout of the presentation (name or id, see list_layouts; a new presentation has its design\'s layouts, e.g. "Title", "Title and content", "Two content", "Section header"). Its repeated items show under the slide and its placeholders become text boxes on it, filled from `fill` (the slide `title` fills the title placeholder). Prefer a layout for every slide: it keeps the deck consistent with its design.',
    ),
  fill: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .describe(
      'With `layout`: text per placeholder role from list_layouts (untyped placeholders are "text"), e.g. {"title": "Q3", "body": "..."}; an array fills several placeholders of one role in reading order. Unfilled placeholders stay empty (hidden when presenting).',
    ),
  background: z
    .string()
    .optional()
    .describe(
      'Slide background: palette name (e.g. "ink", "blue-soft"; #hex only if the user asked for an exact color), set on the slide itself (never draw a rectangle for this). On a dark background, text/outlines without an explicit color default to white. Change later with set_slide_background.',
    ),
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

export type Frame = CanvasElementModel & { slide: SlideConfig };

export function slideFrames(schema: SchemaModel): Frame[] {
  return schema.elements.filter((e): e is Frame => e.type === 'frame' && e.slide !== undefined);
}

export function resolvePresentation(schema: SchemaModel, name: string | undefined): string {
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
export function resolveSlide(schema: SchemaModel, ref: string, presentation?: string): Frame {
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
/**
 * Put a new slide on a layout: link it, then give it a copy of each placeholder,
 * filled from `fill` by role (arrays fill same-role placeholders in reading order).
 */
async function applyLayout(
  api: DevDesignerApi,
  id: string,
  schema: SchemaModel,
  frame: CanvasElementModel,
  layout: CanvasElementModel,
  fill: Record<string, string | string[]>,
): Promise<void> {
  await api.patch(`/elements/${frame.id}`, { slide: { ...frame.slide, layoutId: layout.id } });
  const slots = schema.elements
    .filter((e) => e.slideId === layout.id && !!e.placeholder)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const used = new Map<string, number>();
  for (const slot of slots) {
    const role = slot.placeholder!.role ?? 'text';
    const n = used.get(role) ?? 0;
    used.set(role, n + 1);
    const given = fill[role];
    const text = (Array.isArray(given) ? given[n] : n === 0 ? given : undefined) ?? '';
    const {
      id: _id,
      zIndex: _z,
      groupId: _g,
      morphId: _m,
      step: _s,
      runs: _r,
      slideId: _sl,
      slide: _sc,
      ...look
    } = slot;
    await api.post(`/projects/${id}/elements`, {
      ...look,
      x: slot.x - layout.x + frame.x,
      y: slot.y - layout.y + frame.y,
      text,
      slideId: frame.id,
      placeholder: { ...slot.placeholder, of: slot.id },
    });
  }
}

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
 * ownership, slide frame size) as one atomic batch. Used to move slides back onto
 * their presentation's spot. Returns how many items were written.
 */
export async function applyLayoutDiff(
  api: DevDesignerApi,
  projectId: string,
  before: SchemaModel,
  after: SchemaModel,
): Promise<number> {
  const batch = new Batch();
  const was = <T extends { id: string }>(list: readonly T[]): Map<string, T> =>
    new Map(list.map((x) => [x.id, x]));
  const els = was(before.elements);
  for (const e of after.elements) {
    const b = els.get(e.id);
    if (!b) continue;
    if ((e.slideId ?? null) !== (b.slideId ?? null)) batch.set('elements', e.id, { slideId: e.slideId ?? null });
    if (e.width !== b.width || e.height !== b.height) batch.set('elements', e.id, { width: e.width, height: e.height });
    if (e.x !== b.x || e.y !== b.y) batch.set('elements', e.id, { x: e.x, y: e.y });
  }
  const tables = was(before.tables);
  for (const t of after.tables) {
    const b = tables.get(t.id);
    if (!b) continue;
    if ((t.slideId ?? null) !== (b.slideId ?? null)) batch.set('tables', t.id, { slideId: t.slideId ?? null });
    if (t.x !== b.x || t.y !== b.y) batch.set('tables', t.id, { x: t.x, y: t.y });
  }
  const diagrams = was(before.sequenceDiagrams);
  for (const d of after.sequenceDiagrams) {
    const b = diagrams.get(d.id);
    if (!b) continue;
    if ((d.slideId ?? null) !== (b.slideId ?? null)) batch.set('diagrams', d.id, { slideId: d.slideId ?? null });
    if (d.originY !== b.originY) batch.set('diagrams', d.id, { originY: d.originY });
  }
  const lifelines = was(before.lifelines);
  for (const l of after.lifelines) {
    const b = lifelines.get(l.id);
    if (b && l.x !== b.x) batch.set('lifelines', l.id, { x: l.x });
  }
  const messages = was(before.sequenceMessages);
  for (const m of after.sequenceMessages) {
    const b = messages.get(m.id);
    if (b && m.y !== b.y) batch.set('messages', m.id, { y: m.y });
  }
  const rels = was(before.relationships);
  for (const r of after.relationships) {
    const b = rels.get(r.id);
    if (b && JSON.stringify(r.waypoints ?? []) !== JSON.stringify(b.waypoints ?? [])) {
      batch.set('relationships', r.id, { waypoints: r.waypoints ?? [] });
    }
  }
  return batch.send(api, projectId);
}

export function registerPresentationTools(tool: ToolFn, api: DevDesignerApi, designs: DesignHelpers): void {
  const graph = (id: string): Promise<ProjectGraphResponse> =>
    api.get<ProjectGraphResponse>(`/projects/${id}`);

  const importFile = async (id: string, file: unknown): Promise<SchemaMutation[]> =>
    (await api.post<ImportIntoProjectResponse>(`/projects/${id}/import-content`, { file, joinPresentations: true })).mutations;

  /** Where slides actually are, read back from storage (not echoed from the request). */
  const receipts = (schema: SchemaModel, ids: readonly string[]) => {
    const frames = slideFrames(schema);
    return ids.map((sid) => {
      const f = frames.find((x) => x.id === sid);
      if (!f) return { id: sid, missing: true };
      const pres = presentationOf(f);
      return {
        id: sid,
        presentation: pres,
        number: presentationSlides(frames, pres).findIndex((x) => x.id === sid) + 1,
        items: schema.elements.filter((e) => e.slideId === sid).length,
      };
    });
  };

  /** Topmost text element a slide owns (its title, by convention). */
  const titleOf = (schema: SchemaModel, frameId: string): CanvasElementModel | undefined =>
    schema.elements.filter((e) => e.slideId === frameId && e.type === 'text').sort((a, b) => a.y - b.y)[0];

  const DECOR_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'line', 'arrow', 'freedraw']);

  /** Give templated slides the template's title styling and its decorative (text-less) shapes. */
  const applyTemplates = async (
    pid: string,
    schema: SchemaModel,
    list: ReadonlyArray<{ frame: CanvasElementModel; template: Frame; titled: boolean }>,
  ): Promise<void> => {
    const batch = new Batch();
    const decor: CanvasElementModel[] = [];
    for (const { frame, template, titled } of list) {
      const dx = frame.x - template.x;
      const dy = frame.y - template.y;
      const tTitle = titleOf(schema, template.id);
      const nTitle = titled ? titleOf(schema, frame.id) : undefined;
      if (tTitle && nTitle) {
        const style: Record<string, unknown> = { x: tTitle.x + dx, y: tTitle.y + dy, width: tTitle.width };
        for (const k of ['fontSize', 'fontFamily', 'strokeColor', 'bold', 'italic', 'textAlign', 'lineHeight', 'wrap'] as const) {
          if (tTitle[k] !== undefined) style[k] = tTitle[k];
        }
        batch.set('elements', nTitle.id, style);
      }
      for (const e of schema.elements) {
        if (e.slideId !== template.id || !DECOR_TYPES.has(e.type) || e.text?.trim() || e.startBinding || e.endBinding) continue;
        decor.push({ ...e, id: `tpl_${decor.length}`, x: e.x + dx, y: e.y + dy, slideId: frame.id, morphId: undefined, groupId: undefined });
      }
    }
    await batch.send(api, pid);
    if (decor.length) {
      const file = contentFile({
        elements: decor,
        tables: [],
        relationships: [],
        sequenceDiagrams: [],
        lifelines: [],
        sequenceMessages: [],
        images: [],
        warnings: [],
      });
      await api.post<ImportIntoProjectResponse>(`/projects/${pid}/import-content`, {
        file,
        joinPresentations: true,
        linkExisting: true,
      });
    }
  };

  /** Write the new slide order (0..n-1) for slides given in presentation order. */
  const applyOrder = async (pid: string, orderedIds: string[], schema: SchemaModel): Promise<void> => {
    const batch = new Batch();
    for (const [i, frameId] of orderedIds.entries()) {
      const f = schema.elements.find((e) => e.id === frameId);
      const slide = f?.slide;
      if (slide && slide.order !== i) batch.set('elements', frameId, { slide: { ...slide, order: i } });
    }
    await batch.send(api, pid);
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
    'Create a NEW presentation (16:9 slides, stacked in one spot on the canvas) from a declarative description. It gets a design (default: Default; see list_designs): the design\'s theme styles every slide and its layouts are available - give each slide a `layout` and fill its placeholders. Each slide has a title, notes, an optional transition, and content items (heading/text/bullets/shape/code/image - incl. inline SVG you draw, plus `schema` and `sequence` blocks that draw real ER / sequence diagrams on the slide) laid out in flow. Colors on slides: use theme tokens only ($heading, $text, $muted, $surface, $background, $accent1-4) - items without a color already use them; palette names / hex ignore the theme. Morph granularity: set `transition.morphBy` to object, word or character (default) and tag individual words with `runs[].morph`. Every slide enters with a 300ms morph by default. Objects get unique morph ids, so nothing animates between slides unless you give the same `morph` tag to the few items that should (e.g. one box that moves or grows). Use add_slides to extend it later.',
    {
      projectId,
      name: z.string().optional().describe('Default: first free "Presentation N".'),
      slides: z.array(slideSpec).min(1),
      design: z.string().optional().describe('Design name or id (list_designs). Default: the Default design.'),
      defaultTransition: transitionSchema
        .optional()
        .describe('Used for every slide without its own transition. Default: morph, 300ms - leave it unset.'),
      x: z.number().optional().describe('World X for the slide area; give both x and y to skip auto-placement.'),
      y: z.number().optional(),
    },
    {},
    async ({ projectId: id, name, slides, design, defaultTransition, x, y }) => {
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
      // Slides on a layout put their title in its title placeholder, not a flow heading.
      const specs = slides.map(({ template: _t, layout, fill: _f, ...sl }) => (layout ? { ...sl, title: undefined } : sl));
      const built = buildPresentationFile((await resolveImages(specs)) as SlideSpec[], {
        presentation,
        frame: { x: Math.round(spot.x), y: Math.round(spot.y), width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
        defaultTransition: defaultTransition as never,
      });
      const mutations = await importFile(id, built.file);
      const frames = mutations
        .flatMap((m) => (m.kind === 'element.created' && m.element.type === 'frame' ? [m.element] : []))
        .sort((a, b) => (a.slide?.order ?? 0) - (b.slide?.order ?? 0));
      // The design's theme on every slide and its layouts in the deck.
      const applied = await designs.applyDesign(id, presentation, design);
      const warnings = [...built.warnings];
      if (slides.some((sl) => sl.layout)) {
        const fresh = (await graph(id)).schema;
        const frameList = slideFrames(fresh);
        const all = presentationLayouts(frameList, presentation);
        for (const [i, f] of frames.entries()) {
          const ref = slides[i]?.layout;
          if (!ref) continue;
          const hit = all.find((l) => l.id === ref || layoutNameOf(l, frameList).toLowerCase() === ref.toLowerCase());
          if (!hit) {
            warnings.push(
              `Slide ${i + 1}: no layout "${ref}". Layouts: ${all.map((l) => layoutNameOf(l, frameList)).join(', ') || 'none'}.`,
            );
            continue;
          }
          const fill = { ...(slides[i].fill ?? {}) } as Record<string, string | string[]>;
          if (slides[i].title && fill['title'] === undefined) fill['title'] = slides[i].title as string;
          const now = (await graph(id)).schema;
          await applyLayout(api, id, now, now.elements.find((e) => e.id === f.id) ?? f, hit, fill);
        }
      }
      return {
        presentation,
        design: applied.design,
        theme: applied.theme,
        slides: frames.map((f, i) => ({ id: f.id, number: i + 1, title: slides[i]?.title ?? null })),
        placedAt: { x: Math.round(spot.x), y: Math.round(spot.y) },
        warnings,
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
      // Templates resolve up front so a bad id fails before anything is written.
      const templates = slides.map((sl) => (sl.template ? resolveSlide(schema, sl.template) : null));
      const frameList = slideFrames(schema);
      const layouts = slides.map((sl) => {
        if (!sl.layout) return null;
        const all = presentationLayouts(frameList, name);
        const hit = all.find((l) => l.id === sl.layout || layoutNameOf(l, frameList) === sl.layout);
        if (!hit) {
          throw new UserError(
            `No layout "${sl.layout}" in "${name}". Layouts: ${all.map((l) => layoutNameOf(l, frameList)).join(', ') || 'none'}.`,
          );
        }
        return hit;
      });
      const specs = slides.map(({ template: _t, layout: _l, fill: _f, ...sl }, i) => {
        const t = templates[i];
        return t && sl.background === undefined && t.fillStyle !== 'none' && t.backgroundColor
          ? { ...sl, background: t.backgroundColor }
          : sl;
      });
      const built = buildPresentationFile((await resolveImages(specs)) as SlideSpec[], {
        presentation: name,
        frame: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
        defaultTransition: defaultTransition as never,
      });
      const mutations = await importFile(id, built.file);
      const created = mutations
        .flatMap((m) => (m.kind === 'element.created' && m.element.type === 'frame' ? [m.element] : []))
        .sort((a, b) => (a.slide?.order ?? 0) - (b.slide?.order ?? 0));
      let fresh = (await graph(id)).schema;
      if (after) {
        const createdIds = new Set(created.map((f) => f.id));
        const rest = presentationSlides(slideFrames(fresh), name).filter((f) => !createdIds.has(f.id));
        const at = rest.findIndex((f) => f.id === after.id) + 1;
        const ordered = [...rest.slice(0, at), ...created, ...rest.slice(at)].map((f) => f.id);
        await applyOrder(id, ordered, fresh);
      }
      const templated = created.flatMap((f, i) => {
        const t = templates[i];
        return t ? [{ frame: f, template: t, titled: !!slides[i].title }] : [];
      });
      if (templated.length) await applyTemplates(id, fresh, templated);
      for (const [i, f] of created.entries()) {
        const layout = layouts[i];
        if (layout) await applyLayout(api, id, fresh, f, layout, (slides[i].fill ?? {}) as Record<string, string | string[]>);
      }
      if (after || templated.length || layouts.some(Boolean)) fresh = (await graph(id)).schema;
      return { presentation: name, added: receipts(fresh, created.map((f) => f.id)), warnings: built.warnings };
    },
  );

  tool(
    'move_slides',
    "Move slides (with everything on them) into another presentation, or to a new spot in their own. They land on the target presentation's stacked spot and size; a target name that does not exist yet creates that presentation. Returns where each slide ended up.",
    {
      projectId,
      slideIds: z.array(z.string()).min(1).describe('Slide ids, in the order they should appear.'),
      toPresentation: z.string().describe('Target presentation name.'),
      afterSlide: z
        .string()
        .optional()
        .describe('Slide id or 1-based number in the target to insert after; "0" = at the start; default append.'),
    },
    {},
    async ({ projectId: id, slideIds, toPresentation, afterSlide }) => {
      const { schema } = await graph(id);
      const moving = slideIds.map((ref) => resolveSlide(schema, ref));
      const movingIds = new Set(moving.map((f) => f.id));
      const frames = slideFrames(schema);
      const target =
        presentationNames(frames).find((n) => n.toLowerCase() === toPresentation.trim().toLowerCase()) ??
        toPresentation.trim();
      if (!target) throw new UserError('Give a `toPresentation` name.');
      const rest = presentationSlides(frames, target).filter((f) => !movingIds.has(f.id));
      let at = rest.length;
      if (afterSlide !== undefined) {
        const ref = afterSlide.trim();
        if (ref === '0') at = 0;
        else {
          const a = /^\d+$/.test(ref) ? rest[Number(ref) - 1] : rest.find((f) => f.id === ref);
          if (!a) throw new UserError(`No slide "${afterSlide}" in "${target}" (other than the ones being moved).`);
          at = rest.indexOf(a) + 1;
        }
      }
      const ordered = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      // Target spot: a slide that stays put, else the first moved slide's own.
      const anchor = rest[0] ?? moving[0];
      const after = JSON.parse(JSON.stringify(schema)) as SchemaModel;
      // Map each slide onto the anchor: positions keep their place relative to the slide
      // (proportionally, when the anchor is a different size); sizes stay as they are.
      const shift = new Map(
        moving.map((f) => {
          const sx = f.width ? anchor.width / f.width : 1;
          const sy = f.height ? anchor.height / f.height : 1;
          return [f.id, { X: (x: number) => anchor.x + (x - f.x) * sx, Y: (y: number) => anchor.y + (y - f.y) * sy }];
        }),
      );
      for (const e of after.elements) {
        if (shift.has(e.id)) {
          e.x = anchor.x;
          e.y = anchor.y;
          e.width = anchor.width;
          e.height = anchor.height;
          continue;
        }
        const d = e.slideId ? shift.get(e.slideId) : undefined;
        if (!d) continue;
        e.x = d.X(e.x);
        e.y = d.Y(e.y);
      }
      for (const t of after.tables) {
        const d = t.slideId ? shift.get(t.slideId) : undefined;
        if (d) {
          t.x = d.X(t.x);
          t.y = d.Y(t.y);
        }
      }
      for (const dg of after.sequenceDiagrams) {
        const d = dg.slideId ? shift.get(dg.slideId) : undefined;
        if (!d) continue;
        const oy = dg.originY;
        dg.originY = d.Y(oy);
        for (const l of after.lifelines) if (l.diagramId === dg.id) l.x = d.X(l.x);
        // Message y is kept relative to the diagram origin (only the origin moves proportionally).
        for (const m of after.sequenceMessages) if (m.diagramId === dg.id) m.y += dg.originY - oy;
      }
      const contentWrites = await applyLayoutDiff(api, id, schema, after);
      const batch = new Batch();
      ordered.forEach((f, i) => {
        if (movingIds.has(f.id) || f.slide.order !== i) {
          batch.set('elements', f.id, { slide: { ...f.slide, presentation: target, order: i } });
        }
      });
      await batch.send(api, id);
      // Close the gaps the moved slides left in their old presentations.
      const fresh = (await graph(id)).schema;
      for (const src of new Set(moving.map((f) => presentationOf(f)).filter((n) => n !== target))) {
        await applyOrder(id, presentationSlides(slideFrames(fresh), src).map((f) => f.id), fresh);
      }
      return { moved: receipts((await graph(id)).schema, moving.map((f) => f.id)), contentWrites };
    },
  );

  tool(
    'update_element',
    'Edit fields of ONE element by id in one call: text, runs (rich text), x/y/width/height (world coords), fontSize, lineHeight, wrap, language, fileName, code diff (diffText/diffView), morph tag. For colors/fill/stroke (or many elements at once) use style_elements. Returns each changed field before and after, read back from storage.\n\nCode diffs: on a code block, `text` is the ORIGINAL (before) code and `diffText` the CHANGED (after) code, both full plain source - never a unified diff with +/- prefixes. To show a diff, pass diffText (and optionally diffView "split" | "inline"; split is the default when turning one on). diffView "off" hides the diff but keeps diffText; diffText null removes it. The card is resized to fit the diff unless you pass width/height.',
    {
      projectId,
      id: z.string(),
      text: z.string().max(50000).optional(),
      runs: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe('Rich-text runs ({text, bold?, italic?, color?, ...}); their texts must concatenate to the text.'),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().min(1).optional(),
      height: z.number().min(1).optional(),
      fontSize: z.number().min(6).max(400).optional(),
      lineHeight: z.number().min(0.5).max(4).optional(),
      wrap: z.boolean().optional(),
      language: z.string().optional().describe('Code blocks only.'),
      fileName: z.string().max(120).optional().describe('Code blocks only.'),
      diffText: z
        .string()
        .max(50000)
        .nullable()
        .optional()
        .describe(
          'Code blocks only: the CHANGED (after) version of the code, full plain source; `text` stays the ORIGINAL (before). null removes the diff.',
        ),
      diffView: z
        .enum(['split', 'inline', 'off'])
        .optional()
        .describe('Code blocks only: "split" (before | after side by side), "inline" (one column), or "off" (show only the original; the diff is kept).'),
      morph: z.string().optional().describe('Morph tag.'),
    },
    { idempotent: true },
    async ({ projectId: pid, id: elId, morph, ...fields }) => {
      const { schema } = await graph(pid);
      const el = schema.elements.find((e) => e.id === elId);
      if (!el) throw new UserError(`No element "${elId}". Use get_slide for ids.`);
      const patch: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      if ((patch.diffText !== undefined || patch.diffView !== undefined) && el.type !== 'code') {
        throw new UserError(`diffText/diffView only apply to code blocks; "${elId}" is a ${el.type}.`);
      }
      if (el.type === 'code') Object.assign(patch, codeDiffPatch(el, patch));
      if (morph !== undefined) patch.morphId = morphIdForTag(morph) ?? soloMorphId();
      if (!Object.keys(patch).length) throw new UserError('Nothing to change.');
      // New plain text replaces rich runs that no longer match it.
      if (patch.text !== undefined && patch.runs === undefined && el.runs?.length) patch.runs = null;
      if (Array.isArray(patch.runs)) {
        const joined = (patch.runs as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
        if (joined !== (patch.text ?? el.text ?? '')) throw new UserError('`runs` texts must concatenate to the text.');
      }
      // The PATCH answers with the stored element, so no second graph read is needed.
      const stored = await api.patch<CanvasElementModel>(`/elements/${elId}`, patch);
      const pick = (o: unknown) =>
        Object.fromEntries(Object.keys(patch).map((k) => [k, (o as Record<string, unknown>)[k] ?? null]));
      return { id: elId, before: pick(el), after: stored ? pick(stored) : null };
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
        defaultInk: inkOn(frame.fillStyle !== 'none' ? frame.backgroundColor : undefined),
      });
      // Owned by the slide from the start (one atomic import, no follow-up PATCH per item):
      // linkExisting lets the file's slideId point at the existing frame.
      const owned = {
        ...built,
        elements: built.elements.map((e) => ({ ...e, slideId: frame.id })),
        tables: built.tables.map((t) => ({ ...t, slideId: frame.id })),
        sequenceDiagrams: built.sequenceDiagrams.map((d) => ({ ...d, slideId: frame.id })),
      };
      const mutations = (
        await api.post<ImportIntoProjectResponse>(`/projects/${id}/import-content`, {
          file: contentFile(owned),
          joinPresentations: true,
          linkExisting: true,
        })
      ).mutations;
      return { slide: frame.id, added: mutations.length, warnings: built.warnings };
    },
  );

  tool(
    'list_layouts',
    "List a presentation's slide layouts: name, id, its placeholders (role, prompt, morph tag) and its repeated items (shapes/text drawn under every slide using it, with slide-local position and morph tag). Use a layout's name with add_slides `layout` and fill its placeholders with `fill`. Tag layout items with set_morph_tag or tag_layout_morphs.",
    { projectId, presentation: z.string().optional() },
    { readOnly: true },
    async ({ projectId: id, presentation }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const frames = slideFrames(schema);
      const tag = (m: string | undefined): { morphTag?: string } => {
        const t = morphTagOf(m);
        return t && !isSoloTag(m) ? { morphTag: t } : {};
      };
      return {
        presentation: name,
        layouts: presentationLayouts(frames, name).map((l) => ({
          id: l.id,
          name: layoutNameOf(l, frames),
          slidesUsing: presentationSlides(frames, name).filter((f) => f.slide.layoutId === l.id).length,
          placeholders: schema.elements
            .filter((e) => e.slideId === l.id && !!e.placeholder)
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((e) => ({ id: e.id, role: e.placeholder!.role ?? 'text', prompt: e.text ?? '', ...tag(e.morphId) })),
          items: schema.elements
            .filter((e) => e.slideId === l.id && !e.placeholder && e.type !== 'frame')
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((e) => ({
              id: e.id,
              type: e.type,
              ...(e.text ? { text: e.text.slice(0, 60) } : {}),
              x: Math.round(e.x - l.x),
              y: Math.round(e.y - l.y),
              width: Math.round(e.width),
              height: Math.round(e.height),
              ...tag(e.morphId),
            })),
        })),
      };
    },
  );

  tool(
    'tag_layout_morphs',
    "Give a presentation's layouts shared morph tags so moving between slides on DIFFERENT layouts animates sensibly: placeholders of the same role get one tag across layouts (every layout's title -> \"layout-title\", the 2nd body -> \"layout-body-2\", ...), and look-alike repeated items (same type, colors and shape - e.g. the accent bar, a footer logo, matching boxes) get one tag per kind. Items found on only one layout are left alone. A tag on a layout placeholder applies to every slide's copy of it, so by default this also drops the slides' own isolating tags from those copies (not tags someone named on purpose). Run with dryRun first to see the plan, then check with preview_morph.",
    {
      projectId,
      presentation: z.string().optional(),
      dryRun: z.boolean().optional().describe('Only report what would be tagged.'),
      overwrite: z
        .boolean()
        .optional()
        .describe('Also replace tags already named on layout items (default: keep them).'),
      placeholders: z.boolean().optional().describe('Tag placeholders by role (default true).'),
      items: z.boolean().optional().describe('Tag look-alike repeated items (default true).'),
      inheritOnSlides: z
        .boolean()
        .optional()
        .describe("Clear isolating (solo) tags on slides' placeholder copies so they use the layout tag (default true)."),
    },
    { idempotent: true },
    async ({ projectId: id, presentation, dryRun, overwrite, placeholders = true, items = true, inheritOnSlides = true }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const frames = slideFrames(schema);
      const layouts = presentationLayouts(frames, name);
      const plan = planLayoutMorphTags(schema.elements, layouts, { placeholders, items });
      const named = (e: CanvasElementModel): boolean => !!morphTagOf(e.morphId) && !isSoloTag(e.morphId);
      const byId = new Map(schema.elements.map((e) => [e.id, e] as const));
      const batch = new Batch();
      const tagged: Array<{ layout: string; item: string; tag: string }> = [];
      const kept: Array<{ item: string; tag: string }> = [];
      const layoutName = new Map(layouts.map((l) => [l.id, layoutNameOf(l, frames)] as const));
      for (const { elementId, tag } of plan) {
        const e = byId.get(elementId)!;
        if (named(e) && !overwrite) {
          if (morphTagOf(e.morphId) !== tag) kept.push({ item: describe(e), tag: morphTagOf(e.morphId)! });
          continue;
        }
        if (e.morphId === morphIdForTag(tag)) continue;
        batch.set('elements', e.id, { morphId: morphIdForTag(tag) });
        tagged.push({ layout: layoutName.get(e.slideId!) ?? e.slideId!, item: describe(e), tag });
      }
      // Slide copies of layout placeholders: drop isolating tags so the layout's tag applies.
      let inherited = 0;
      if (inheritOnSlides && placeholders) {
        const layoutIds = new Set(layouts.map((l) => l.id));
        for (const e of schema.elements) {
          const slot = e.placeholder?.of ? byId.get(e.placeholder.of) : undefined;
          if (!slot || !slot.slideId || !layoutIds.has(slot.slideId) || !e.morphId || named(e)) continue;
          const slotTagged = plan.some((p) => p.elementId === slot.id) || named(slot);
          if (!slotTagged || morphTagOf(e.morphId) === null) continue;
          batch.set('elements', e.id, { morphId: null });
          inherited += 1;
        }
      }
      if (!dryRun) await batch.send(api, id);
      return {
        presentation: name,
        ...(dryRun ? { dryRun: true } : {}),
        tagged,
        ...(kept.length ? { keptExistingTags: kept, note: 'Pass overwrite: true to replace these.' } : {}),
        slidePlaceholderCopiesNowInheriting: inherited,
      };
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
    'set_slide_animations',
    "Replace a slide's object animations (like PowerPoint's animation pane). `animations` is the PLAY ORDER: each entry animates one element / table / sequence diagram id from get_slide. An 'enter' object is hidden until its entry plays. trigger 'click' waits for the presenter to advance, 'with' starts together with the previous entry, 'after' when the previous ends; leading with/after entries play by themselves when the slide appears. Keep it sparse: reveal list items or steps one click at a time, not everything. Pass [] to clear.",
    {
      projectId,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      presentation: z.string().optional(),
      animations: z.array(animationSchema).max(200),
    },
    { idempotent: true },
    async ({ projectId: id, slide, presentation, animations }) => {
      const { schema } = await graph(id);
      const frame = resolveSlide(schema, slide, presentation);
      const own = ownedBy(schema, frame.id);
      const valid = new Set<string>([
        ...own.elements.filter((e) => e.type !== 'frame').map((e) => e.id),
        ...own.tableIds,
        ...own.diagramIds,
      ]);
      for (const a of animations) {
        if (!valid.has(a.target)) {
          throw new UserError(
            `"${a.target}" is not an element, table or sequence diagram on this slide (see get_slide).`,
          );
        }
      }
      const list: SlideAnimation[] = normalizeAnimations(
        animations.map((a) =>
          newAnimation(a.target, {
            ...(a.kind ? { kind: a.kind as SlideAnimationKind } : {}),
            ...(a.effect ? { effect: a.effect as SlideAnimationEffect } : {}),
            ...(a.trigger ? { trigger: a.trigger as SlideAnimationTrigger } : {}),
            ...(a.duration !== undefined ? { duration: a.duration } : {}),
            ...(a.delay !== undefined ? { delay: a.delay } : {}),
            ...(a.direction ? { direction: a.direction as SlideDirection } : {}),
          }),
        ),
      );
      // One atomic batch: the explicit list replaces any old per-element build steps.
      const batch = new Batch().set('elements', frame.id, { slide: { ...frame.slide, animations: list } });
      for (const e of own.elements) {
        if (e.step) batch.set('elements', e.id, { step: null });
      }
      await batch.send(api, id);
      return { slide: frame.id, animations: list.length };
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
      const batch = new Batch();
      for (const f of slides.slice(1)) batch.set('elements', f.id, { slide: { ...f.slide, transition: t } });
      await batch.send(api, id);
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
      await applyOrder(id, orderedSlideIds, schema);
      return { presentation: name, reordered: own.length };
    },
  );

  const deleteSlideFrames = async (id: string, schema: SchemaModel, frames: Frame[]): Promise<number> => {
    // One atomic batch: the slides and everything they own go together.
    const batch = new Batch();
    for (const frame of frames) {
      const own = ownedBy(schema, frame.id);
      for (const e of own.elements) batch.delete('elements', e.id);
      for (const t of own.tableIds) batch.delete('tables', t);
      for (const d of own.diagramIds) batch.delete('diagrams', d);
      batch.delete('elements', frame.id);
    }
    return batch.send(api, id);
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
    "List what is on one slide: elements (id, type, text, slide-local position/size, morph tag), tables, sequence diagrams and the slide's animations. Use the element ids with set_morph_tag and set_slide_animations.",
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
      const rects = new Map(collectItems(schema, { lines: 'all' }).map((i) => [i.key, i.rect]));
      const frameRect = { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
      /** `partial` / `offslide` (staged outside the frame for morph); omitted when inside. */
      const where = (key: string): { placement?: FramePlacement } => {
        const r = rects.get(key);
        const p = r ? placement(r, frameRect) : 'inside';
        return p === 'inside' ? {} : { placement: p };
      };
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
          ...where(keyOf('element', e.id)),
          ...(morphTagOf(e.morphId) && !isSoloTag(e.morphId)
            ? { morphTag: morphTagOf(e.morphId) }
            : {}),
        })),
        animations: slideAnimations(frame.slide, own.elements).map((a) => ({
          target: a.target,
          kind: a.kind,
          effect: a.effect,
          trigger: a.trigger,
          duration: a.duration,
          delay: a.delay,
          ...(a.direction ? { direction: a.direction } : {}),
        })),
        tables: schema.tables
          .filter((t) => own.tableIds.includes(t.id))
          .map((t) => ({ id: t.id, name: t.name, ...where(keyOf('table', t.id)) })),
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
    "Morph is meant to be minimal: link only the few objects that truly persist between slides. This tags drawing elements (by id, on the same or different slides) so a morph transition treats them as THE SAME object (they glide, resize and restyle into each other). A tagged element only pairs with its own tag. An empty tag isolates the elements instead (a unique id: they never morph). Tables and diagrams can't be tagged (they pair by name). Layout items and placeholders (ids from list_layouts) can be tagged too: a layout placeholder's tag applies to every slide's copy of it unless the copy has its own tag (an empty tag on a copy overrides it so it doesn't morph). Check the effect with preview_morph.",
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
      const batch = new Batch();
      for (const eid of elementIds) batch.set('elements', eid, { morphId: morphId ?? soloMorphId() });
      await batch.send(api, id);
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
      const batch = new Batch();
      let isolated = 0;
      for (const e of schema.elements) {
        if (e.type === 'frame' || !e.slideId || !slideIds.has(e.slideId)) continue;
        const plainLineage = !!e.morphId && morphTagOf(e.morphId) === null;
        if (e.morphId && !(resetCopies && plainLineage)) continue;
        batch.set('elements', e.id, { morphId: soloMorphId() });
        isolated += 1;
      }
      await batch.send(api, id);
      return { presentation: name, isolated };
    },
  );

  tool(
    'preview_morph',
    "Show how each transition between consecutive slides will pair objects for morph: which elements glide into which (and why), which just fade out/in, and for sequence diagrams which participants and messages pair (by tag, name or wording) and which text morphs. Use it after building a deck, then fix poor pairings with set_morph_tag. Every transition type except 'none' morphs shared objects ('morph' = Auto: the rest cross-fades).",
    { projectId, presentation: z.string().optional() },
    { readOnly: true },
    async ({ projectId: id, presentation }) => {
      const { schema } = await graph(id);
      const name = resolvePresentation(schema, presentation);
      const slides = presentationSlides(slideFrames(schema), name);
      const frames = slideFrames(schema);
      const byId = new Map(schema.elements.map((e) => [e.id, e] as const));
      const itemsOf = (frame: Frame): Array<{ item: MorphItem; label: string }> => {
        const own = ownedBy(schema, frame.id);
        // What the slide shows: its own content (empty placeholders are hidden) plus the
        // repeated items of its layout and master.
        const fromLayout = [layoutOf(frame, frames), masterOf(frame, frames)].flatMap((l) =>
          l ? schema.elements.filter((e) => e.slideId === l.id && !e.placeholder && e.type !== 'frame' && !e.overrides) : [],
        );
        const shown = [
          ...own.elements.filter((e) => !(e.placeholder && !(e.text ?? '').trim())).map((e) => ({ e, layout: false })),
          ...fromLayout.map((e) => ({ e, layout: true })),
        ];
        const out: Array<{ item: MorphItem; label: string }> = shown.map(({ e, layout }) => ({
          item: {
            key: slideMorphKey(e, (pid) => byId.get(pid)),
            keyIn: e.morphIn ?? undefined,
            keyOut: e.morphOut ?? undefined,
            ...(layout ? { source: 'layout' as const } : {}),
            kind: 'element',
            type: e.type,
            text: e.type === 'grid' ? parseGrid(e.text).cells.flat().filter((c) => c.trim()).join(' ') : (e.text ?? ''),
            runTags: [...new Set((e.runs ?? []).flatMap((r) => (r.morph ? [r.morph] : [])))],
            cx: e.x + e.width / 2 - frame.x,
            cy: e.y + e.height / 2 - frame.y,
            w: e.width,
            h: e.height,
          },
          label: layout ? `${describe(e)} (layout)` : describe(e),
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
          ...(kind === 'none' ? { note: "Transition type is 'none' (a cut, no morph); set another type with update_slide to use these pairings." } : {}),
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
          ...(kind !== 'none'
            ? { textAnimatedBy: slides[i].slide.transition?.morphBy ?? 'character' }
            : {}),
          ...sequencePairings(schema, slides[i - 1], slides[i]),
        });
      }
      return { presentation: name, slides: slides.length, transitions };
    },
  );

}

/**
 * Normalise a code block's diff edit: turning a diff on needs a changed side, giving a
 * changed side without a view shows it split, removing it turns the view off, and the
 * card grows to fit the diff unless a size was given (rough monospace estimate).
 */
export function codeDiffPatch(el: CanvasElementModel, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const touched = patch.diffText !== undefined || patch.diffView !== undefined;
  if (!touched) return out;
  if (typeof patch.diffText === 'string' && /^(?:---|\+\+\+|@@) /m.test(patch.diffText)) {
    throw new UserError(
      'diffText looks like a unified diff (---/+++/@@ lines). Pass the full CHANGED source code instead; the original goes in `text`.',
    );
  }
  const diffText = patch.diffText === undefined ? el.diffText : (patch.diffText as string | null);
  let view = (patch.diffView as string | undefined) ?? undefined;
  if (patch.diffText === null) view = 'off';
  else if (view === undefined && typeof patch.diffText === 'string' && (el.diffView ?? 'off') === 'off') view = 'split';
  if (view && view !== 'off' && diffText == null) {
    throw new UserError('To show a diff, also pass diffText (the changed version of the code).');
  }
  if (view !== undefined) out.diffView = view;
  if (patch.width === undefined && patch.height === undefined && view !== 'off' && diffText != null) {
    const size = el.fontSize ?? 14;
    const before = String(patch.text ?? el.text ?? '').split('\n');
    const after = diffText.split('\n');
    const longest = Math.max(1, ...before.map((l) => l.length), ...after.map((l) => l.length));
    const inline = (view ?? el.diffView) === 'inline';
    const shared = after.filter((l) => before.includes(l)).length;
    const rows = inline ? before.length + after.length - shared : Math.max(before.length, after.length);
    const pane = Math.ceil(longest * size * 0.62 + 32 + 3 * size * 0.62);
    const width = inline ? pane : 2 * pane;
    const height = Math.round(size * 2.5) + Math.ceil(rows * size * 1.5) + 24;
    if (width > el.width) out.width = width;
    if (height > el.height) out.height = height;
  }
  return out;
}
