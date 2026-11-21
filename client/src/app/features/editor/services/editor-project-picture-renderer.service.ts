import { Injectable, inject } from '@angular/core';
import {
   layoutOf,
   masterOf,
   resolveThemedElements,
   resolveThemedSequences,
   slideSequence,
   type CanvasElementModel,
   type SchemaModel,
} from '@devdesigner/shared';
import { ProjectPictureRenderer } from '../../../shared/features/projects-overlay/services/project-picture-renderer';
import { contentForFrame } from '../helpers/frame-contents.helper';
import { buildDiagramSvg } from '../helpers/diagram-svg.helper';
import { ElementImagesService } from './element-images.service';

/**
 * The editor's project thumbnails: the same SVG builder the image export uses, so the
 * preview matches the canvas. Bound to `ProjectPictureRenderer` in `app.config.ts`.
 */
@Injectable({ providedIn: 'root' })
export class EditorProjectPictureRenderer extends ProjectPictureRenderer {
   private readonly images = inject(ElementImagesService);

   async svgOf(schema: SchemaModel): Promise<string> {
      const imageData = await this.imageData(schema.elements);
      const built =
         this.firstSlideSvg(schema, imageData) ??
         buildDiagramSvg(
            schema.tables,
            schema.relationships,
            resolveThemedElements(schema.elements),
            resolveThemedSequences(
               { diagrams: schema.sequenceDiagrams, lifelines: schema.lifelines, messages: schema.sequenceMessages },
               schema.elements
            ),
            undefined,
            imageData
         );
      return built.svg;
   }

   /**
    * A project with a presentation previews as its first slide, rendered the
    * way the slide player draws it (cropped to the frame, with its layout and
    * master underneath). Drawing the whole canvas instead shrinks the slides to
    * specks among layouts and off-slide scratch content.
    */
   private firstSlideSvg(schema: SchemaModel, imageData: ReadonlyMap<string, string>) {
      const frames = slideSequence(schema.elements.filter((e) => e.type === 'frame'));
      const frame = frames.find((f) => !f.slide?.layout && !f.slide?.master && !f.slide?.hidden);
      if (!frame) return null;
      const mine = contentForFrame(
         frame.id,
         true,
         schema.elements,
         schema.tables,
         schema.sequenceDiagrams,
         schema.lifelines,
         schema.sequenceMessages,
         layoutOf(frame, frames)?.id,
         masterOf(frame, frames)?.id
      );
      return buildDiagramSvg(
         mine.tables,
         schema.relationships,
         resolveThemedElements(mine.elements, schema.elements),
         resolveThemedSequences(
            { diagrams: mine.diagrams, lifelines: mine.lifelines, messages: mine.messages },
            schema.elements
         ),
         { x: frame.x, y: frame.y, width: frame.width, height: frame.height, frameId: frame.id },
         imageData
      );
   }

   /** Still images (first frames of GIFs and videos) as data URIs, by file id. */
   private async imageData(elements: readonly CanvasElementModel[]): Promise<Map<string, string>> {
      const ids = [
         ...new Set(
            elements
               .filter((e) => (e.type === 'image' || e.type === 'embed') && e.fileId)
               .map((e) => e.fileId as string)
         ),
      ];
      const data = new Map<string, string>();
      await Promise.all(
         ids.map(async (fileId) => {
            const url = await this.images.stillDataUrl(fileId);
            if (url) {
               data.set(fileId, url);
            }
         })
      );
      return data;
   }
}
