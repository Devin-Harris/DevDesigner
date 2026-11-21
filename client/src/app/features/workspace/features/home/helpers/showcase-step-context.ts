import type { CanvasElementModel, SchemaModel, SchemaMutation } from '@devdesigner/shared';
import type { Box, CursorFn, PlayerHooks, PlayerStore } from './showcase-player';

/** What the showcase's build steps share with `playBuild` (one build run). */
export interface StepContext {
   store: PlayerStore;
   cursor: CursorFn;
   hooks: PlayerHooks;
   /** Apply mutations locally (stops the run once it is aborted). */
   apply: (...m: SchemaMutation[]) => void;
   /** Wait, scaled by the run's speed (rejects once aborted). */
   wait: (ms: number) => Promise<void>;
   /** Move the fake cursor to (x, y), optionally labelled, then wait. */
   point: (x: number, y: number, label?: string, ms?: number) => Promise<void>;
   /** Patch an element and apply the update; returns the new row. */
   update: (el: CanvasElementModel, patch: Partial<CanvasElementModel>) => CanvasElementModel;
   boxOf: (el: CanvasElementModel) => Box;
   /** Type text into a field one character at a time with the caret following it. */
   typeChars: (
      el: CanvasElementModel,
      field: 'text' | 'diffText',
      full: string,
      caretAt: (typed: string) => { x: number; y: number },
      box: Box,
      from?: number,
      to?: number,
      grow?: (cur: CanvasElementModel, typed: string) => CanvasElementModel
   ) => Promise<CanvasElementModel>;
   /** The whole finished example, and the share this run builds. */
   full: SchemaModel;
   snap: SchemaModel;
}
