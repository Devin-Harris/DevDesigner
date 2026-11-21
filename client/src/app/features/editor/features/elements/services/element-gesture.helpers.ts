import type { ElementType } from '@devdesigner/shared';
import type { SequenceStart } from '../../../models/sequence-start.model';
import type { WritableSignal } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import type { ResizeHandle } from '../../canvas/components/canvas-shapes/canvas-shapes.component';

/** What element gestures reach in the editor entry; the entry wires it with `connect`. */
export interface ElementGestureHost {
   readonly selectedSlideSets: WritableSignal<string[]>;
   /** Slide frame boxes as last synced (duplicated slides are recorded so they don't drag the deck). */
   readonly slideBounds: Map<string, { x: number; y: number; w: number; h: number }>;
   handlePointerMove(event: PointerEvent): void;
   onPointerUp(): void;
   beginNodeDrag(tableId: string): void;
   syncSlideMoves(): void;
   newPresentationName(): string;
}

/** The element being moved/resized/rotated and its state at gesture start. */
export interface ElementGesture {
   id: string;
   /** Starting geometry of the element(s) at gesture start (for delta math). */
   start: { x: number; y: number; width: number; height: number; angle: number };
   /** The element's full state at gesture start (for undo history). */
   snapshot: CanvasElementModel;
   /** Additional selected elements moved together (id -> start x/y), move only. */
   others?: Map<string, { x: number; y: number }>;
   /** Tables carried along by a moved frame (id -> start x/y). */
   tables?: Map<string, { x: number; y: number }>;
   /** Manual relationship routes between two carried tables (id -> start waypoints). */
   waypoints?: Map<string, { x: number; y: number }[]>;
   /** Sequence diagrams carried along by a moved frame (id -> start layout). */
   sequences?: Map<string, SequenceStart>;
   handle?: ResizeHandle;
   which?: 'start' | 'end';
   /** Original points (absolute) for an endpoint drag. */
   points?: { x: number; y: number }[];
}

/** Elements that Ctrl + resize scales with their content (font size included). */
export const CONTENT_SCALE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(['code', 'rectangle', 'ellipse', 'diamond']);
