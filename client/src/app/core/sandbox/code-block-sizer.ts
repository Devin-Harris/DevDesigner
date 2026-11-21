import type { CanvasElementModel } from '@devdesigner/shared';

/**
 * Measures a code block's content (browser-measured fonts). The sandbox sizes seeded code
 * blocks with it; the editor feature implements it and `app.config.ts` binds it, so `core/`
 * never imports a feature.
 */
export abstract class CodeBlockSizer {
   abstract size(el: CanvasElementModel): { width: number; height: number };
}
