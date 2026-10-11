// Declarative presentations: describe slides (title, bullets, shapes, code, schema
// and sequence diagrams) and get back export-file parts with every item placed in
// flow inside a 16:9 slide frame. A slide is a `frame` element carrying a `slide`
// config; its contents point at it through `slideId`, and all slides of one
// presentation are stacked at the same spot (see slides/index.ts). Pure, so the
// MCP server and tests share it, and the result goes through project import.

import { PROJECT_EXPORT_FORMAT, PROJECT_EXPORT_VERSION } from '../dto';
import type { ProjectExportFile, ProjectExportImage } from '../dto';
import { MORPH_BY_OPTIONS } from '../enums';
import type {
  CodeLanguage,
  MorphBy,
  SlideDirection,
  SlideEasing,
  SlideTransitionType,
} from '../enums';
import { fitWithin, imageSize, base64ToBytes } from '../images';
import { LIGHT_TEXT, paletteNames, readableTextOn, resolveColor } from '../palette';
import type {
  CanvasElementModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  SlideConfig,
  SlideTransition,
  TableModel,
  TextRun,
} from '../models';
import { morphIdForTag, morphTagOf, presentationOf } from '../slides';
import {
  buildSpecFile,
  estimateTextSize,
  sequenceDiagramRect,
  tableRect,
  unionRects,
  type SpecMessage,
  type SpecParticipant,
  type SpecRelationship,
  type SpecTable,
} from './index';

/** Default slide size: the editor's 16:9 preset. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;
export const SLIDE_PADDING = 64;
const PAD = SLIDE_PADDING;
const GAP = 24;
/** Padding of a sequence diagram's box around its content (mirrors the client renderer). */
const SEQUENCE_BOX_PAD = 26;

export interface SlideFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A styled stretch of a text item; `morph` tags just these words for morph transitions. */
export interface SlideTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Palette name or hex. */
  color?: string;
  /** Morph tag: the same tag on another slide's run glides these words into those. */
  morph?: string;
}

/** An image file to place on a slide: base64 data plus its mime type (png/jpeg/gif/webp/svg+xml). */
export interface SlideImageSource {
  mimeType: string;
  /** Base64 file contents, no `data:` prefix. */
  data: string;
}

/**
 * `morph` is a morph tag: items on different slides with the same tag are treated as
 * the same object by morph transitions (they glide/resize/restyle into each other).
 * Colors are palette names ("blue", "amber-soft") or hex.
 */
export type SlideItem =
  | {
      type: 'heading';
      text: string;
      fontSize?: number;
      x?: number;
      y?: number;
      morph?: string;
      color?: string;
      runs?: SlideTextRun[];
    }
  | {
      type: 'text';
      text: string;
      fontSize?: number;
      x?: number;
      y?: number;
      width?: number;
      morph?: string;
      color?: string;
      runs?: SlideTextRun[];
    }
  | {
      type: 'image';
      image: SlideImageSource;
      /** Width in slide px; height follows the picture's aspect ratio unless given too. */
      width?: number;
      height?: number;
      x?: number;
      y?: number;
      morph?: string;
    }
  | {
      type: 'bullets';
      items: string[];
      fontSize?: number;
      x?: number;
      y?: number;
      width?: number;
      morph?: string;
    }
  | {
      type: 'shape';
      morph?: string;
      shape: 'rectangle' | 'ellipse' | 'diamond';
      text?: string;
      width?: number;
      height?: number;
      x?: number;
      y?: number;
      backgroundColor?: string;
      strokeColor?: string;
    }
  | {
      type: 'code';
      code: string;
      language?: CodeLanguage;
      /** Optional file name shown in a title bar, as if the code lived in that file. */
      fileName?: string;
      fontSize?: number;
      x?: number;
      y?: number;
      morph?: string;
      /** Card surface (palette name or hex); a dark one switches the code to the light token palette. */
      backgroundColor?: string;
    }
  | { type: 'schema'; tables: SpecTable[]; relationships?: SpecRelationship[]; x?: number; y?: number }
  | {
      type: 'sequence';
      title?: string;
      participants: Array<string | SpecParticipant>;
      messages: SpecMessage[];
      background?: string;
      morph?: string;
      x?: number;
      y?: number;
    };

export interface SlideTransitionSpec {
  type: SlideTransitionType;
  direction?: SlideDirection;
  duration?: number;
  easing?: SlideEasing;
  /** Morph only: animate changed text by whole objects, words, or characters (default characters). */
  morphBy?: MorphBy;
}

export interface SlideSpec {
  /** Shown as a large heading at the top of the slide. */
  title?: string;
  notes?: string;
  hidden?: boolean;
  /**
   * Slide background (palette name or hex), set on the slide frame itself rather than a
   * rectangle behind the content. On a dark background, text and shape outlines without
   * an explicit color default to white.
   */
  background?: string;
  /** How this slide is entered (ignored for the first slide of a presentation). */
  transition?: SlideTransitionSpec;
  content?: SlideItem[];
}

/** Everything a set of slide items adds to a project. */
export interface SlideContent {
  elements: CanvasElementModel[];
  tables: TableModel[];
  relationships: RelationshipModel[];
  sequenceDiagrams: SequenceDiagramModel[];
  lifelines: LifelineModel[];
  sequenceMessages: SequenceMessageModel[];
  /** Image files the `image` elements point at (by `fileId`). */
  images: ProjectExportImage[];
  warnings: string[];
}

/**
 * What an AI-built slide transitions with unless told otherwise: a short morph.
 * Almost every slide morphs; because untagged objects each get a unique morph id,
 * only the few objects that deliberately share a tag actually animate between slides
 * and everything else simply cross-fades in place.
 */
export const DEFAULT_PRESENTATION_TRANSITION: SlideTransitionSpec = {
  type: 'morph',
  duration: 300,
  easing: 'ease-in-out',
};

/** Fill in the transition defaults the importer would apply. */
export function normalizeTransition(t: SlideTransitionSpec): SlideTransition {
  return {
    type: t.type,
    direction: t.type === 'slide' ? (t.direction ?? 'left') : t.direction,
    duration: Math.min(10_000, Math.max(0, t.duration ?? 600)),
    easing: t.easing ?? 'ease-in-out',
    ...(t.type === 'morph' && t.morphBy && MORPH_BY_OPTIONS.includes(t.morphBy)
      ? { morphBy: t.morphBy }
      : {}),
  };
}

/** Height of `text` wrapped to `width` at `fontSize` (rough glyph-width model). */
export function wrappedTextHeight(text: string, fontSize: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.56)));
  const lines = text
    .split('\n')
    .reduce((sum, p) => sum + Math.max(1, Math.ceil(p.length / perLine)), 0);
  return Math.ceil(lines * fontSize * 1.25) + 6;
}

/** Tag name prefix of a "solo" tag: a unique tag nothing else shares, so the item never morphs. */
export const SOLO_TAG_PREFIX = 'solo-';

let soloCounter = 0;

/**
 * A fresh morph tag no other item has. A tagged item only ever pairs with the same
 * tag, so giving each object its own keeps it from morphing into look-alikes on
 * neighbouring slides; sharing a tag (see `morph`) is the opt-in.
 */
export function newSoloTag(): string {
  soloCounter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${SOLO_TAG_PREFIX}${rand}${soloCounter.toString(36)}`;
}

/** The `morphId` that makes an item morph with nothing. */
export function soloMorphId(): string {
  return morphIdForTag(newSoloTag()) as string;
}

/** True for a morph tag (name or `tag:` id) made by newSoloTag. */
export function isSoloTag(tagOrMorphId: string | null | undefined): boolean {
  if (!tagOrMorphId) return false;
  const name = morphTagOf(tagOrMorphId) ?? tagOrMorphId;
  return name.startsWith(SOLO_TAG_PREFIX);
}

/**
 * The `morphId` for a slide item: its shared tag when it opted in with `morph`,
 * otherwise a unique one (so most objects do not morph).
 */
function taggedLineage(tag: string | undefined): { morphId: string } {
  const id = tag?.trim() ? morphIdForTag(tag) : null;
  return { morphId: id ?? soloMorphId() };
}

function baseElement(
  type: CanvasElementModel['type'],
  id: string,
  z: number,
): Omit<CanvasElementModel, 'x' | 'y' | 'width' | 'height'> {
  return {
    id,
    type,
    angle: 0,
    strokeColor: '#1e1e1e',
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    zIndex: z,
  };
}

/**
 * Lay out slide items in flow (top to bottom, with margins) inside `frame` and
 * return the elements/tables/diagrams they become. Items with explicit slide-local
 * x/y are placed there and don't move the flow. `slideId` (a frame id in the same
 * file) is stamped on everything; omit it to add content to an existing slide and
 * attach it afterwards.
 */
export function buildSlideContent(
  items: readonly SlideItem[],
  frame: SlideFrameRect,
  options: {
    idPrefix: string;
    slideId?: string;
    zStart?: number;
    label?: string;
    /** Slide-local Y where the flow starts (below existing content); default top margin. */
    startY?: number;
    /** Hex used for text / shape outlines that give no color (a light color on a dark slide). */
    defaultInk?: string;
  },
): SlideContent {
  const out: SlideContent = {
    elements: [],
    tables: [],
    relationships: [],
    sequenceDiagrams: [],
    lifelines: [],
    sequenceMessages: [],
    images: [],
    warnings: [],
  };
  const where = options.label ? `${options.label}: ` : '';
  const inner = frame.width - PAD * 2;
  let n = 0;
  let z = options.zStart ?? 1;
  let cursor = options.startY ?? PAD;
  const newId = (): string => `${options.idPrefix}e${++n}`;

  const place = (
    item: { x?: number; y?: number },
    w: number,
    h: number,
  ): { x: number; y: number } => {
    const explicit = typeof item.x === 'number' || typeof item.y === 'number';
    const x = item.x ?? PAD;
    const y = item.y ?? cursor;
    if (!explicit) {
      cursor = y + h + GAP;
    }
    if (x + w > frame.width + 1 || y + h > frame.height + 1) {
      out.warnings.push(`${where}an item extends past the slide edge (${Math.round(x + w)}x${Math.round(y + h)}).`);
    }
    return { x: frame.x + x, y: frame.y + y };
  };

  /** Palette name or hex -> hex; unknown colors warn (listing valid names) and are ignored. */
  const color = (input: string | undefined, what: string): string | undefined => {
    if (!input?.trim()) return undefined;
    const { hex } = resolveColor(input);
    if (hex) return hex;
    out.warnings.push(
      `${where}unknown color "${input}" for ${what}; ignored. Use hex or one of: ${paletteNames()}.`,
    );
    return undefined;
  };

  const addText = (
    text: string,
    fontSize: number,
    item: {
      x?: number;
      y?: number;
      width?: number;
      morph?: string;
      color?: string;
      runs?: SlideTextRun[];
    },
    bold = false,
  ): void => {
    const runs: TextRun[] | undefined = item.runs?.length
      ? item.runs.map((r) => ({
          text: r.text,
          ...(r.bold ? { bold: true } : {}),
          ...(r.italic ? { italic: true } : {}),
          ...(r.underline ? { underline: true } : {}),
          ...(color(r.color, 'a text run') ? { color: color(r.color, 'a text run') } : {}),
          ...(r.morph?.trim() ? { morph: r.morph.trim().slice(0, 80) } : {}),
        }))
      : undefined;
    if (runs) text = runs.map((r) => r.text).join('');
    const strokeColor = color(item.color, 'text') ?? options.defaultInk;
    const width = Math.min(item.width ?? inner, inner);
    const height = wrappedTextHeight(text, fontSize, width);
    const p = place(item, width, height);
    out.elements.push({
      ...baseElement('text', newId(), z++),
      x: p.x,
      y: p.y,
      width,
      height,
      text,
      fontSize,
      fontFamily: 'normal',
      textAlign: 'left',
      wrap: true,
      ...(bold ? { bold: true } : {}),
      ...(strokeColor ? { strokeColor } : {}),
      ...(runs ? { runs } : {}),
      ...taggedLineage(item.morph),
      ...(options.slideId ? { slideId: options.slideId } : {}),
    });
  };

  for (const item of items) {
    switch (item.type) {
      case 'heading':
        addText(item.text, item.fontSize ?? 44, item, true);
        break;
      case 'text':
        addText(item.text, item.fontSize ?? 26, item);
        break;
      case 'bullets':
        addText(item.items.map((b) => `• ${b}`).join('\n'), item.fontSize ?? 28, item);
        break;
      case 'shape': {
        const w = item.width ?? 320;
        const h = item.height ?? 140;
        const p = place(item, w, h);
        out.elements.push({
          ...baseElement(item.shape, newId(), z++),
          x: p.x,
          y: p.y,
          width: w,
          height: h,
          ...taggedLineage(item.morph),
          ...(color(item.strokeColor, 'a shape outline') ?? options.defaultInk
            ? { strokeColor: color(item.strokeColor, 'a shape outline') ?? options.defaultInk }
            : {}),
          ...(color(item.backgroundColor, 'a shape fill')
            ? {
                backgroundColor: color(item.backgroundColor, 'a shape fill'),
                fillStyle: 'solid' as const,
              }
            : {}),
          ...(item.text
            ? {
                text: item.text,
                fontSize: 24,
                fontFamily: 'normal',
                textAlign: 'center' as const,
                verticalAlign: 'middle' as const,
              }
            : {}),
          ...(options.slideId ? { slideId: options.slideId } : {}),
        });
        break;
      }
      case 'image': {
        const bytes = base64ToBytes(item.image.data);
        if (!bytes) {
          out.warnings.push(`${where}an image is not valid base64; skipped.`);
          break;
        }
        const natural = imageSize(item.image.mimeType, bytes) ?? { width: 480, height: 270 };
        let w: number;
        let h: number;
        if (item.width && item.height) {
          w = item.width;
          h = item.height;
        } else if (item.width || item.height) {
          const scale = item.width ? item.width / natural.width : (item.height as number) / natural.height;
          w = Math.round(natural.width * scale);
          h = Math.round(natural.height * scale);
        } else {
          const room = Math.max(120, frame.height - PAD - (item.y ?? cursor));
          const fitted = fitWithin(natural, inner, room);
          w = fitted.width;
          h = fitted.height;
        }
        const p = place(item, w, h);
        const elementId = newId();
        const fileId = `${elementId}_file`;
        out.images.push({ id: fileId, mimeType: item.image.mimeType, data: item.image.data });
        out.elements.push({
          ...baseElement('image', elementId, z++),
          x: p.x,
          y: p.y,
          width: w,
          height: h,
          fileId,
          ...taggedLineage(item.morph),
          ...(options.slideId ? { slideId: options.slideId } : {}),
        });
        break;
      }
      case 'code': {
        const size = item.fontSize ?? 20;
        const lines = item.code.split('\n');
        const longest = Math.max(...lines.map((l) => l.length), 1);
        const fileName = item.fileName?.trim() || undefined;
        // Every code card has a window-style title bar (matches the client's
        // codeHeaderHeight) above the code, with the title centered between its dots.
        const header = Math.round(size * 1.5 + 14);
        const nameWidth = fileName ? Math.ceil((fileName.length + 4) * 7.4) + 150 : 0;
        const w = Math.min(
          inner,
          Math.max(320, nameWidth, Math.ceil(longest * size * 0.62) + 32),
        );
        const h = header + Math.ceil(lines.length * size * 1.5) + 32;
        const p = place(item, w, h);
        out.elements.push({
          ...baseElement('code', newId(), z++),
          x: p.x,
          y: p.y,
          width: w,
          height: h,
          text: item.code,
          language: item.language ?? 'typescript',
          ...(fileName ? { fileName } : {}),
          fontSize: size,
          backgroundColor: color(item.backgroundColor, 'a code block background') ?? '#f6f8fa',
          fillStyle: 'solid',
          ...taggedLineage(item.morph),
          ...(options.slideId ? { slideId: options.slideId } : {}),
        });
        break;
      }
      case 'schema':
      case 'sequence': {
        const spec =
          item.type === 'schema'
            ? { tables: item.tables, relationships: item.relationships }
            : {
                sequenceDiagrams: [
                  {
                    title: item.title,
                    participants: item.participants,
                    messages: item.messages,
                    background: item.background,
                    morph: item.morph,
                  },
                ],
              };
        const measured = buildSpecFile(spec, { origin: { x: 0, y: 0 } }).file.schema;
        const box = unionRects([
          ...measured.tables.map(tableRect),
          ...measured.sequenceDiagrams.flatMap((d) => {
            const r = sequenceDiagramRect(d, measured.lifelines, measured.sequenceMessages);
            return r ? [r] : [];
          }),
        ]) ?? { x: 0, y: 0, w: 280, h: 140 };
        // A sequence diagram's rounded box extends past its participants and last row;
        // reserve that so it does not touch what is above or beside it.
        const pad = item.type === 'sequence' ? SEQUENCE_BOX_PAD : 0;
        const p = place(item, box.w + pad * 2, box.h + pad * 2);
        const built = buildSpecFile(spec, {
          origin: { x: p.x + pad, y: p.y + pad },
          idPrefix: `${options.idPrefix}${item.type}${++n}_`,
        });
        out.warnings.push(...built.warnings.map((w) => `${where}${w}`));
        const s = built.file.schema;
        const stamp = options.slideId ? { slideId: options.slideId } : {};
        out.tables.push(...s.tables.map((t) => ({ ...t, ...stamp })));
        out.relationships.push(...s.relationships);
        out.sequenceDiagrams.push(...s.sequenceDiagrams.map((d) => ({ ...d, ...stamp })));
        out.lifelines.push(...s.lifelines);
        out.sequenceMessages.push(...s.sequenceMessages);
        break;
      }
    }
  }
  return out;
}

/** Wrap built content (and optional frames) into a project export file. */
export function contentFile(
  content: SlideContent,
  frames: CanvasElementModel[] = [],
  projectName = 'Imported',
): ProjectExportFile {
  const schema: SchemaModel = {
    tables: content.tables,
    relationships: content.relationships,
    notes: [],
    elements: [...frames, ...content.elements],
    sequenceDiagrams: content.sequenceDiagrams,
    lifelines: content.lifelines,
    sequenceMessages: content.sequenceMessages,
    viewport: { x: 0, y: 0, zoom: 1 },
    home: null,
  };
  return {
    format: PROJECT_EXPORT_FORMAT,
    version: PROJECT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: projectName, description: null, type: 'ERD' },
    schema,
    ...(content.images.length ? { images: content.images } : {}),
  };
}

/** A slide frame element (stacked slides share the same rect). */
export function slideFrame(
  id: string,
  rect: SlideFrameRect,
  slide: SlideConfig,
  zIndex: number,
  background?: string,
): CanvasElementModel {
  return {
    ...baseElement('frame', id, zIndex),
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    strokeColor: '#868e96',
    strokeWidth: 1.5,
    cornerRadius: 0,
    ...(background ? { backgroundColor: background, fillStyle: 'solid' as const } : {}),
    slide,
  };
}

/**
 * Ink for text/outlines drawn on `background`: white when the fill is dark enough that
 * the default near-black would vanish, otherwise undefined (keep the default).
 */
export function inkOn(background: string | undefined): string | undefined {
  return background && readableTextOn(background) === LIGHT_TEXT ? LIGHT_TEXT : undefined;
}

export interface BuiltPresentation {
  file: ProjectExportFile;
  /** File ids of the slide frames, in slide order. */
  frameIds: string[];
  warnings: string[];
}

/**
 * Build a presentation (or more slides for one): a frame per slide at `frame`,
 * ordered from `startOrder`, each with its title and content in flow.
 */
export function buildPresentationFile(
  slides: readonly SlideSpec[],
  options: {
    presentation: string;
    frame: SlideFrameRect;
    startOrder?: number;
    defaultTransition?: SlideTransitionSpec;
    idPrefix?: string;
  },
): BuiltPresentation {
  const prefix = options.idPrefix ?? '';
  const frames: CanvasElementModel[] = [];
  const merged: SlideContent = {
    elements: [],
    tables: [],
    relationships: [],
    sequenceDiagrams: [],
    lifelines: [],
    sequenceMessages: [],
    images: [],
    warnings: [],
  };
  let z = 0;
  slides.forEach((s, i) => {
    const frameId = `${prefix}slide${i}`;
    const transition =
      s.transition ?? options.defaultTransition ?? DEFAULT_PRESENTATION_TRANSITION;
    const config: SlideConfig = {
      order: (options.startOrder ?? 0) + i,
      presentation: options.presentation,
      ...(s.hidden ? { hidden: true } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
      ...(transition ? { transition: normalizeTransition(transition) } : {}),
    };
    let background: string | undefined;
    if (s.background?.trim()) {
      background = resolveColor(s.background).hex ?? undefined;
      if (!background) {
        merged.warnings.push(
          `Slide ${i + 1}: unknown background "${s.background}"; ignored. Use hex or one of: ${paletteNames()}.`,
        );
      }
    }
    frames.push(slideFrame(frameId, options.frame, config, z++, background));
    const items: SlideItem[] = [
      ...(s.title ? [{ type: 'heading', text: s.title } as SlideItem] : []),
      ...(s.content ?? []),
    ];
    const built = buildSlideContent(items, options.frame, {
      idPrefix: `${prefix}s${i}_`,
      slideId: frameId,
      zStart: z,
      label: `Slide ${i + 1}`,
      defaultInk: inkOn(background),
    });
    z += built.elements.length + 1;
    merged.elements.push(...built.elements);
    merged.tables.push(...built.tables);
    merged.relationships.push(...built.relationships);
    merged.sequenceDiagrams.push(...built.sequenceDiagrams);
    merged.lifelines.push(...built.lifelines);
    merged.sequenceMessages.push(...built.sequenceMessages);
    merged.images.push(...built.images);
    merged.warnings.push(...built.warnings);
  });
  return {
    file: contentFile(merged, frames),
    frameIds: frames.map((f) => f.id),
    warnings: merged.warnings,
  };
}

/** Rough size of a text block, re-exported for tools that place their own text. */
export { estimateTextSize };

// --- Keeping slides stacked ---------------------------------------------------

export interface StackResult {
  schema: SchemaModel;
  /** Slides whose frame (and contents) were moved/resized onto their presentation's spot. */
  moved: number;
  /** Items that had no slide and were claimed by the slide frame they lie in. */
  claimed: number;
}

function centerInside(cx: number, cy: number, f: CanvasElementModel): boolean {
  return cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height;
}

/** Move one slide (frame + everything it owns) by (dx, dy) inside `s`, in place. */
function shiftSlideIn(s: SchemaModel, frameId: string, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const e of s.elements) {
    if (e.id === frameId || e.slideId === frameId) {
      e.x += dx;
      e.y += dy;
    }
  }
  const tableIds = new Set<string>();
  for (const t of s.tables) {
    if (t.slideId === frameId) {
      t.x += dx;
      t.y += dy;
      tableIds.add(t.id);
    }
  }
  const columnTable = new Map<string, string>();
  for (const t of s.tables) for (const c of t.columns) columnTable.set(c.id, t.id);
  for (const r of s.relationships) {
    const a = columnTable.get(r.sourceColumnId);
    const b = columnTable.get(r.targetColumnId);
    if (a && b && tableIds.has(a) && tableIds.has(b) && r.waypoints?.length) {
      r.waypoints = r.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  }
  for (const d of s.sequenceDiagrams) {
    if (d.slideId !== frameId) continue;
    d.originY += dy;
    for (const l of s.lifelines) if (l.diagramId === d.id) l.x += dx;
    for (const m of s.sequenceMessages) if (m.diagramId === d.id) m.y += dy;
  }
}

/**
 * Put every presentation's slides on one spot. Slides of a presentation are stacked
 * (same x, y, width, height) and the app locks them together; a slide made anywhere
 * else makes the slide panels jump around when you switch slides. The first slide
 * (by order) sets the spot and size; the others move onto it with the contents they
 * own. Contents that belong to no slide but lie inside a slide's frame are claimed
 * first, so they move with it. Returns a modified deep copy.
 */
export function stackSlideFrames(input: SchemaModel): StackResult {
  const schema = JSON.parse(JSON.stringify(input)) as SchemaModel;
  const frames = schema.elements.filter(
    (e): e is CanvasElementModel & { slide: SlideConfig } => e.type === 'frame' && !!e.slide,
  );
  let claimed = 0;
  let moved = 0;

  // Claim unowned content that sits inside a slide frame (the first frame found wins).
  if (frames.length) {
    const owner = (cx: number, cy: number): string | undefined =>
      frames.find((f) => centerInside(cx, cy, f))?.id;
    for (const e of schema.elements) {
      if (e.type === 'frame' || e.slideId) continue;
      const id = owner(e.x + e.width / 2, e.y + e.height / 2);
      if (id) {
        e.slideId = id;
        claimed += 1;
      }
    }
    for (const t of schema.tables) {
      if (t.slideId) continue;
      const r = tableRect(t);
      const id = owner(r.x + r.w / 2, r.y + r.h / 2);
      if (id) {
        t.slideId = id;
        claimed += 1;
      }
    }
    for (const d of schema.sequenceDiagrams) {
      if (d.slideId) continue;
      const r = sequenceDiagramRect(d, schema.lifelines, schema.sequenceMessages);
      const id = r ? owner(r.x + r.w / 2, r.y + r.h / 2) : undefined;
      if (id) {
        d.slideId = id;
        claimed += 1;
      }
    }
  }

  const byPresentation = new Map<string, Array<CanvasElementModel & { slide: SlideConfig }>>();
  for (const f of frames) {
    const key = presentationOf(f);
    byPresentation.set(key, [...(byPresentation.get(key) ?? []), f]);
  }
  for (const group of byPresentation.values()) {
    const ordered = [...group].sort(
      (a, b) => a.slide.order - b.slide.order || a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1),
    );
    const anchor = ordered[0];
    const ax = anchor.x;
    const ay = anchor.y;
    for (const f of ordered.slice(1)) {
      const dx = ax - f.x;
      const dy = ay - f.y;
      const resized = f.width !== anchor.width || f.height !== anchor.height;
      if (dx === 0 && dy === 0 && !resized) continue;
      shiftSlideIn(schema, f.id, dx, dy);
      f.width = anchor.width;
      f.height = anchor.height;
      moved += 1;
    }
  }
  return { schema, moved, claimed };
}

/** Move a whole presentation (every slide frame and its contents) by (dx, dy). */
export function shiftPresentation(
  input: SchemaModel,
  presentation: string,
  dx: number,
  dy: number,
): SchemaModel {
  const schema = JSON.parse(JSON.stringify(input)) as SchemaModel;
  for (const f of schema.elements) {
    if (f.type === 'frame' && f.slide && presentationOf(f) === presentation) {
      shiftSlideIn(schema, f.id, dx, dy);
    }
  }
  return schema;
}
