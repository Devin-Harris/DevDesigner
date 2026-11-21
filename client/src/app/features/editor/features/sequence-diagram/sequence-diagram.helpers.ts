import type { SequenceBounds } from '../../state/project/models/project-state.model';

/** Module-level pieces of sequence-diagram.component. */

export interface MessageView {
   id: string;
   y: number;
   leftX: number;
   width: number;
   fromX: number;
   toX: number;
   headX: number;
   dirRight: boolean;
   mid: number;
   label: string;
   /** Max content width (px) of the inline editor so it wraps where the label will; null = no limit. */
   editMaxPx: number | null;
   /** The label as drawn: wrapped so it never hides the arrow (the stored label is unchanged). */
   displayLabel: string;
   dashed: boolean;
   isBreak: boolean;
   spanLeft: number;
   spanWidth: number;
   selected: boolean;
   /** Custom line + arrowhead color; empty = theme default. */
   color: string;
}

export interface BoundingBox {
   left: number;
   top: number;
   width: number;
   height: number;
   right: number;
   bottom: number;
   cx: number;
   cy: number;
}

export type WorldFn = (clientX: number, clientY: number) => { x: number; y: number };

export type SnapFn = (n: number) => number;

/** Smart-guide correction for a diagram drag by (dx, dy) of the given items. */
export type SmartDragFn = (
   diagramId: string,
   items: { diagrams: Iterable<string>; elements: Iterable<string>; tables: Iterable<string> },
   dx: number,
   dy: number
) => { ox: number; oy: number; snappedX: boolean; snappedY: boolean } | null;

export type SmartDragEndFn = () => void;

/** Smart-guide correction for edges of a box being resized (only `xs` / `ys` snap). */
export type SmartEdgesFn = (
   id: string,
   box: { x0: number; y0: number; x1: number; y1: number },
   xs: number[],
   ys: number[]
) => { ox: number; oy: number; snappedX: boolean; snappedY: boolean } | null;

/** Start a resize of the whole multi-selection; false when it isn't one. */
export type GroupResizeFn = (handle: string, event: PointerEvent) => boolean;

/** All eight resize handles, like any other shape. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Selected tables/elements that ride along when a diagram is dragged (mixed selections, groups). */
export interface Companions {
   tables: Map<string, { x: number; y: number }>;
   elements: Map<string, { x: number; y: number }>;
   /** Manual routes whose both ends move, shifted rigidly with them. */
   waypoints: Map<string, { x: number; y: number }[]>;
}

export type Drag =
   | { kind: 'll'; id: string; start: number; startVal: number }
   | { kind: 'llw'; id: string; side: -1 | 1; startClientX: number; startWidth: number }
   | {
        kind: 'msg';
        id: string;
        startClientY: number;
        startY: number;
        /** Start y of every message being moved (the whole selection). */
        startYs: Map<string, number>;
     }
   | {
        kind: 'diagram';
        diagramId: string;
        startX: number;
        startY: number;
        startXs: Map<string, number>;
        startOriginY: number;
        startRows: Map<string, number>;
        /** Other selected diagrams moving along with this one. */
        others: {
           diagramId: string;
           startXs: Map<string, number>;
           startOriginY: number;
           startRows: Map<string, number>;
        }[];
        /** Non-diagram selection members moving along with it. */
        companions: Companions;
     }
   | {
        kind: 'resize';
        handle: Handle;
        startX: number;
        startY: number;
        startXs: Map<string, number>;
        startRows: Map<string, number>;
        left: number;
        right: number;
        centerX: number;
        top: number;
        contentH: number;
        centerY: number;
        headerH: number;
        nRows: number;
        startRowSpacing: number;
        /** For Ctrl + resize (scale with content): the starting text scale and widths. */
        startScale: number;
        startWidths: Map<string, number>;
        /** The last Ctrl-scale applied (1 = none), so release knows to persist it. */
        scaled: number;
        /** The content box at the start (Ctrl-resize lines it up with smart guides). */
        startBox: { x0: number; y0: number; x1: number; y1: number } | null;
        /** The drawn outer box at the start (content grown by the stored bounds). */
        startOuter: { x0: number; y0: number; x1: number; y1: number } | null;
        /** Stored bounds at the start (restored when switching resize modes mid-drag). */
        startBounds: SequenceBounds;
     }
   | {
        /** Drag the gap above a message row: changes the spacing of every row. */
        kind: 'gap';
        startY: number;
        /** The row below the dragged gap (it follows the pointer). */
        row: number;
        startRowSpacing: number;
        startXs: Map<string, number>;
        startRows: Map<string, number>;
        top: number;
     }
   | { kind: 'marquee'; start: { x: number; y: number }; moved: boolean }
   | { kind: 'connect'; fromId: string; startY: number }
   | { kind: 'endpoint'; id: string; which: 'from' | 'to' };

export const BOX_PAD = 26;

/** Extra room above the participants so the title (or "Add title") never crowds them; mirrored in diagram-svg + frame-contents. */
export const TITLE_ROOM = 10;

export const MIN_ROW = 20;

export const MIN_HEADER_W = 60;

export const ZERO_BOUNDS: SequenceBounds = { padLeft: 0, padTop: 0, boxWidth: 0, boxHeight: 0 };
