import type { GridPart, MorphItem } from '@devdesigner/shared';

/** One end of a drag: an object, or a row / column / cell of a grid table (`part`). */
export interface DragEnd {
   side: 'a' | 'b';
   key: string;
   part?: GridPart | null;
}

export type PctBox = { left: number; top: number; width: number; height: number };

/** A row / column / cell pairing drawn between two paired tables. */
export interface PartLine {
   key: string;
   a: string;
   b: string;
   aId: string;
   bId: string;
   tag: string;
   pa: GridPart;
   pb: GridPart;
   color: string;
   label: string;
   x1: number;
   y1: number;
   x2: number;
   y2: number;
   d: string;
}

export interface Side {
   item: MorphItem;
   label: string;
   /** Element id (pairs can be set by hand for elements only; tables pair by name). */
   id: string | null;
}

export interface MorphPair {
   from: string;
   to: string;
   why: 'text' | 'name' | 'tag' | 'look-alike' | 'fades in' | 'fades out';
   /** Item centres relative to their frames. */
   a?: { x: number; y: number };
   b?: { x: number; y: number };
   /** Element ids on the slide before / after (null = table or nothing). */
   aId: string | null;
   bId: string | null;
   /** Set by hand (split in / out tags on these objects). */
   forced: boolean;
   /** Set to "no transition". */
   cut?: boolean;
   /** Stage keys of the two objects ("a3" / "b1"), for highlighting. */
   aKey: string | null;
   bKey: string | null;
   color: string | null;
}

/** One object outline drawn over a slide picture (percent of the slide box). */
export interface Hit {
   /** Sits wholly off the slide (it moves in / out): drawn with its label. */
   outside: boolean;
   key: string;
   id: string | null;
   label: string;
   left: number;
   top: number;
   width: number;
   height: number;
   /** Pair number and colour; null = fades in / out. */
   num: number | null;
   color: string | null;
   forced: boolean;
   /** The partner's key on the other slide. */
   partner: string | null;
   /** Set to "no transition" on this side: switches instantly. */
   cut: boolean;
   /** Set to never morph here (fades). */
   solo: boolean;
   /** Also morphs from the slide before the before-slide (a side) / into the slide after (b side). */
   chain: string | null;
   /**
    * A line/arrow: its hit is a band along the drawn line (a box around a diagonal line
    * would cover the shapes it connects). Center and length in % of the slide width/height,
    * angle in degrees.
    */
   line: { cx: number; cy: number; len: number; angle: number } | null;
   /** A grid table: its row / column weights (its rows, columns and cells pair too). */
   grid: { rows: number[]; cols: number[] } | null;
}

export const PAIR_COLORS = ['#2bb3a8', '#6f8bff', '#e0a84a', '#ef6b6b', '#9b7bff', '#3fb950', '#e879c6', '#5ac8fa'];

/** Slide width and gap as parts of the 100-unit pair view. */
export const COL = 46;

export const GAP = 8;

/** How far the pair view zooms out. */
export const MIN_ZOOM = 0.3;
