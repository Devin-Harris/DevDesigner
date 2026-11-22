// Shared enums and string unions imported by both client and server.
// SQLite has no native enum type, so these are modeled as string unions and
// stored in varchar columns that are typed against these values in code.

/** Effective access a caller has to a project (see BUILD_INSTRUCTIONS.md section 6). */
export type AccessLevel = 'OWNER' | 'EDIT' | 'VIEW';
export const ACCESS_LEVELS: readonly AccessLevel[] = ['OWNER', 'EDIT', 'VIEW'] as const;

/** Access level a share link grants. Owner access is never granted by a link. */
export type ShareAccessLevel = 'EDIT' | 'VIEW';

/**
 * What kind of diagram a project holds. Drives the workspace type filter, the
 * project card tag, and the editor breadcrumb chip. Purely organizational — it
 * does not change canvas behavior. New projects default to 'ERD'.
 */
export type ProjectType = 'ERD' | 'FLOW' | 'SCRATCH';
export const PROJECT_TYPES: readonly ProjectType[] = ['ERD', 'FLOW', 'SCRATCH'] as const;

/** Relationship cardinality between two columns. */
export type RelationshipType = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY';
export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_MANY',
] as const;

/** Referential action for a foreign key's ON DELETE / ON UPDATE clause. */
export type ReferentialAction = 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT';

/** Known base data-type names supported by the MySQL generator (section 9). */
export type DataTypeName =
  | 'INT'
  | 'BIGINT'
  | 'VARCHAR'
  | 'TEXT'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'DECIMAL'
  | 'FLOAT'
  | 'JSON'
  | 'ENUM';

export const DATA_TYPE_NAMES: readonly DataTypeName[] = [
  'INT',
  'BIGINT',
  'VARCHAR',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'DECIMAL',
  'FLOAT',
  'JSON',
  'ENUM',
] as const;

/** SQL dialects the generator is designed to grow into (only MySQL now). */
export type SqlDialect = 'mysql' | 'postgres' | 'sqlite';

/**
 * Kinds of free-form drawing element on the canvas (the excalidraw-style layer
 * that lives alongside the ERD). These are decorative and are ignored by the SQL
 * generator and schema validation.
 */
export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'line'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'frame'
  | 'image'
  | 'code'
  | 'grid'
  /** A live frame: a sandboxed iframe of the URL in `text`. */
  | 'embed';

export const ELEMENT_TYPES: readonly ElementType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'line',
  'arrow',
  'freedraw',
  'text',
  'frame',
  'image',
  'code',
  'grid',
  'embed',
] as const;

/** Languages a `code` element can be syntax-highlighted as (highlighting is render-only). */
export type CodeLanguage =
  | 'plaintext'
  | 'typescript'
  | 'sql'
  | 'json'
  | 'python'
  | 'csharp'
  | 'java'
  | 'html'
  | 'css'
  | 'scss'
  | 'bash';

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  'plaintext',
  'typescript',
  'sql',
  'json',
  'python',
  'csharp',
  'java',
  'html',
  'css',
  'scss',
  'bash',
] as const;

/** How a code block shows its diff: side by side, interleaved, or just the original. */
export type CodeDiffView = 'split' | 'inline' | 'off';
export const CODE_DIFF_VIEWS: readonly CodeDiffView[] = ['split', 'inline', 'off'] as const;

/** How a shape's interior is filled. */
export type FillStyle = 'none' | 'solid' | 'hachure';
export const FILL_STYLES: readonly FillStyle[] = ['none', 'solid', 'hachure'] as const;

/** How a shape's outline (or a line/arrow) is stroked. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted'] as const;

/** Horizontal alignment for text elements and shape labels. */
export type TextAlign = 'left' | 'center' | 'right';
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'] as const;

/** Vertical alignment for text elements and shape labels. */
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export const VERTICAL_ALIGNS: readonly VerticalAlign[] = ['top', 'middle', 'bottom'] as const;

/** Font family presets for text elements (Excalidraw-style). */
export type FontFamily =
  | 'hand'
  | 'normal'
  | 'code'
  | 'inter'
  | 'poppins'
  | 'serif'
  | 'display'
  | 'condensed'
  | 'caveat'
  | 'marker'
  | 'grotesk';
export const FONT_FAMILIES: readonly FontFamily[] = [
  'normal',
  'inter',
  'poppins',
  'serif',
  'display',
  'grotesk',
  'condensed',
  'hand',
  'caveat',
  'marker',
  'code',
] as const;

/** Arrowhead style at a line/arrow endpoint. */
export type ArrowheadType = 'none' | 'arrow' | 'triangle' | 'dot' | 'bar';
export const ARROWHEAD_TYPES: readonly ArrowheadType[] = [
  'none',
  'arrow',
  'triangle',
  'dot',
  'bar',
] as const;

/** Raster/vector formats accepted for image elements. */
export const IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

/** Largest accepted image upload, in bytes (decoded). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Video formats accepted for image elements (a video file behind `fileId`). */
export const VIDEO_MIME_TYPES: readonly string[] = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'] as const;

/** Largest accepted video upload, in bytes (decoded). */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

/** Every file type an image element can show (pictures and videos). */
export const MEDIA_MIME_TYPES: readonly string[] = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

/** Largest upload for a file of this type. */
export function maxMediaBytes(mimeType: string): number {
  return VIDEO_MIME_TYPES.includes(mimeType) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/** When an animated picture (GIF) or video starts: on its own, on click, or while hovered. */
export type MediaPlayback = 'auto' | 'click' | 'hover';
export const MEDIA_PLAYBACK_MODES: readonly MediaPlayback[] = ['auto', 'click', 'hover'] as const;

/** Shapes an image can be clipped to (from "clip to shape"). */
export type MediaClipShape = 'rectangle' | 'ellipse' | 'diamond';
export const MEDIA_CLIP_SHAPES: readonly MediaClipShape[] = ['rectangle', 'ellipse', 'diamond'] as const;

/** How a slide is entered during a presentation (the transition INTO that slide). */
export type SlideTransitionType = 'none' | 'fade' | 'slide' | 'zoom' | 'morph';
export const SLIDE_TRANSITION_TYPES: readonly SlideTransitionType[] = [
  'none',
  'fade',
  'slide',
  'zoom',
  'morph',
] as const;

/**
 * What a morph transition animates text by (PowerPoint's Morph "Effect Options"):
 * whole objects, words, or individual characters.
 */
export type MorphBy = 'object' | 'word' | 'character';
export const MORPH_BY_OPTIONS: readonly MorphBy[] = ['object', 'word', 'character'] as const;
/** Used when a morph transition does not say: words glide as units, letters only where words differ. */
export const DEFAULT_MORPH_BY: MorphBy = 'character';

/** Which way a `slide` transition travels (the new slide arrives from the opposite side). */
export type SlideDirection = 'left' | 'right' | 'up' | 'down';
export const SLIDE_DIRECTIONS: readonly SlideDirection[] = ['left', 'right', 'up', 'down'] as const;

/** What an object-level slide animation does: bring it in, take it out, or draw attention to it. */
export type SlideAnimationKind = 'enter' | 'exit' | 'emphasis';
export const SLIDE_ANIMATION_KINDS: readonly SlideAnimationKind[] = [
  'enter',
  'exit',
  'emphasis',
] as const;

/**
 * The motion of an animation. `pulse` is an emphasis; `morph` (a code block's diff only)
 * morphs between the original and the changed code; the rest are entrances and exits.
 */
export type SlideAnimationEffect = 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'pulse' | 'morph';
export const SLIDE_ANIMATION_EFFECTS: readonly SlideAnimationEffect[] = [
  'appear',
  'fade',
  'fly',
  'wipe',
  'zoom',
  'pulse',
  'morph',
] as const;

/** The effects each kind of animation offers. */
export const SLIDE_ANIMATION_EFFECTS_BY_KIND: Readonly<
  Record<SlideAnimationKind, readonly SlideAnimationEffect[]>
> = {
  enter: ['appear', 'fade', 'fly', 'wipe', 'zoom', 'morph'],
  exit: ['appear', 'fade', 'fly', 'wipe', 'zoom', 'morph'],
  emphasis: ['pulse'],
};

/**
 * When an animation starts: `click` waits for the presenter to advance, `with` starts
 * together with the animation before it, `after` starts once that one has finished.
 */
export type SlideAnimationTrigger = 'click' | 'with' | 'after';
export const SLIDE_ANIMATION_TRIGGERS: readonly SlideAnimationTrigger[] = [
  'click',
  'with',
  'after',
] as const;

/** Easing curves a transition can use. */
export type SlideEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
export const SLIDE_EASINGS: readonly SlideEasing[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
] as const;
