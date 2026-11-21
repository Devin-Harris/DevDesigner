import type { SchemaModel } from '@devdesigner/shared';

/**
 * Draws a project's content as a standalone SVG for its Projects-dialog thumbnail.
 * Declared here and implemented by the editor feature (which owns the renderer), and bound
 * in `app.config.ts`, so `shared/` never imports a feature.
 */
export abstract class ProjectPictureRenderer {
   /** The project's picture as SVG markup: its first slide when it has one, else the whole canvas. */
   abstract svgOf(schema: SchemaModel): Promise<string>;
}
