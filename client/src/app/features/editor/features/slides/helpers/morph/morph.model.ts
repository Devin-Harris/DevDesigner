import type { MorphBy } from '@devdesigner/shared';
import type { LifelineModel, SequenceDiagramModel, SequenceMessageModel } from '@devdesigner/shared';
import type { SlideItem } from '../../services/slide-render.service';

/** Shared morph types. */

export type Offset = { x: number; y: number };

/**
 * Two paired sequence diagrams and how their parts pair up: participants (by tag,
 * then name) and messages (by tag, then wording and endpoints).
 */
export interface SeqPair {
   a: SequenceDiagramModel;
   b: SequenceDiagramModel;
   llA: LifelineModel[];
   llB: LifelineModel[];
   msA: SequenceMessageModel[];
   msB: SequenceMessageModel[];
   lifelines: Array<[LifelineModel, LifelineModel]>;
   messages: Array<[SequenceMessageModel, SequenceMessageModel]>;
}

/** A piece of sequence text (title, participant label, message label) animated glyph by glyph. */
export interface SeqTextJob {
   kind: 'title' | 'lifeline' | 'message';
   pair: SeqPair;
   /** Ids of the text on slide A / slide B (data-seq-title / data-lid / data-mid). */
   aId: string;
   bId: string;
}

export interface Pair {
   a: SlideItem;
   b: SlideItem;
}

/**
 * A code block whose code changed: the card's bounds are drawn live (so they grow
 * or shrink smoothly), lines that are in both versions stay and glide to their new
 * row, removed lines fade out late, and new lines fade in.
 */
export interface CodeMorph {
   pair: Pair;
   clip: SVGRectElement;
   /** The clipped layer drawing its lines (stacked right above its card). */
   layer: SVGGElement;
   moves: Array<{ el: SVGGElement; dx: number; dy: number }>;
   fadeOut: SVGGElement[];
   fadeIn: SVGGElement[];
}

/**
 * A matched pair of grid tables. The table itself is drawn live without cell text
 * (rows and columns interpolate when the structure is the same, else the two
 * layouts cross-fade); cells with the same text glide to their new place, cells
 * whose text changed in place morph glyph by glyph, the rest fade out / in.
 */
export interface GridMorph {
   pair: Pair;
   clip: SVGRectElement;
   /** The clipped layer drawing its cell text (stacked right above its card). */
   layer: SVGGElement;
   /** Same number of rows and columns on both slides. */
   sameShape: boolean;
   /** Rows / columns (a, b) whose borders glide into each other (in order). */
   rowPairs: Array<[number, number]>;
   colPairs: Array<[number, number]>;
   moves: Array<{ el: SVGGElement; dx: number; dy: number }>;
   fadeOut: SVGGElement[];
   fadeIn: SVGGElement[];
   /** Cells whose text changed in place: glyph-morphed once measured, else cross-faded. */
   changed: Array<{ a: SVGGElement; b: SVGGElement }>;
}

/** What the code and grid morph builders need from the running MorphStage. */
export interface MorphContext {
   /** The stage's SVG (layers and clip paths are added to it). */
   readonly svg: SVGSVGElement;
   /** World origin of slide A / slide B. */
   readonly offA: Offset;
   readonly offB: Offset;
   /** Playing backwards (B -> A). */
   readonly reversed: boolean;
   /** A fresh number for a clip-path id. */
   nextClipId(): number;
   /** How this pair animates its text. */
   byFor(p: Pair): MorphBy;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** A slide's SVG, taken apart into the pieces a morph animates. */
export interface Side {
   root: SVGSVGElement;
   /** The world -> slide-local `<g transform>` holding all content. */
   main: SVGGElement;
   items: Map<string, SVGGElement>;
   /** Content that isn't a tagged table/element (connectors, sequence diagrams). */
   rest: Element[];
}
