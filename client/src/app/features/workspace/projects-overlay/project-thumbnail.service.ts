import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
   layoutOf,
   masterOf,
   resolveThemedElements,
   resolveThemedSequences,
   slideSequence,
   type CanvasElementModel,
   type ProjectSummary,
   type SchemaModel,
} from '@devdesigner/shared';
import { contentForFrame } from '../../editor/canvas/helpers/frame-contents.helper';
import { ElementImagesService } from '../../../core/services/element-images.service';
import { ProjectsApiService } from '../../../core/services/projects-api.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { buildDiagramSvg } from '../../editor/export/diagram-svg.helper';

/** What a Projects dialog card should show for one project. */
export type ThumbState =
   { status: 'loading' } | { status: 'ready'; url: string } | { status: 'empty' } | { status: 'error' };

interface Entry {
   state: ThumbState;
   /** Generation + theme the current state was built for; a mismatch triggers a rebuild. */
   gen: number;
   dark: boolean;
   inFlight: boolean;
}

const MAX_CONCURRENT = 3;
const LOADING: ThumbState = { status: 'loading' };

/**
 * Renders the Projects dialog thumbnails from the real project content. It loads
 * a project's graph and runs it through the same SVG builder the image export
 * uses, so the preview matches the canvas (tables, relationships, sequence
 * diagrams, shapes, text), then exposes the result as an object URL for an
 * <img> (so a stored SVG can never run script). Results are cached in memory
 * and refreshed stale-while-revalidate: `invalidate()` (called when the dialog
 * opens) makes every entry rebuild on its next request while the old picture
 * keeps showing. Builds run through a small queue so a long list never floods
 * the API or blocks the UI.
 */
@Injectable({ providedIn: 'root' })
export class ProjectThumbnailService {
   private readonly projects = inject(ProjectsApiService);
   private readonly images = inject(ElementImagesService);
   private readonly theme = inject(ThemeService);

   private readonly states = signal<ReadonlyMap<string, ThumbState>>(new Map());
   private readonly entries = new Map<string, Entry>();
   private readonly queue: string[] = [];
   private active = 0;
   private gen = 0;

   /**
    * The thumbnail state for a project. Reading it in a template re-evaluates as
    * builds finish; the first read (or a stale one) queues a build.
    */
   state(project: ProjectSummary): ThumbState {
      const map = this.states();
      const entry = this.entries.get(project.id);
      const dark = this.theme.dark();
      if (!entry || (!entry.inFlight && (entry.gen !== this.gen || entry.dark !== dark))) {
         this.enqueue(project.id);
      }
      return map.get(project.id) ?? LOADING;
   }

   /** Mark every cached thumbnail stale so it is rebuilt the next time it is shown. */
   invalidate(): void {
      this.gen++;
   }

   private enqueue(id: string): void {
      const existing = this.entries.get(id);
      if (existing?.inFlight) {
         return;
      }
      this.entries.set(id, {
         state: existing?.state ?? LOADING,
         gen: this.gen,
         dark: this.theme.dark(),
         inFlight: true,
      });
      this.queue.push(id);
      this.pump();
   }

   private pump(): void {
      while (this.active < MAX_CONCURRENT && this.queue.length) {
         const id = this.queue.shift() as string;
         this.active++;
         void this.build(id).finally(() => {
            this.active--;
            this.pump();
         });
      }
   }

   private async build(id: string): Promise<void> {
      const entry = this.entries.get(id);
      if (!entry) {
         return;
      }
      let state: ThumbState;
      try {
         const { schema } = await firstValueFrom(this.projects.getGraph(id));
         const sequences = resolveThemedSequences(
            { diagrams: schema.sequenceDiagrams, lifelines: schema.lifelines, messages: schema.sequenceMessages },
            schema.elements
         );
         if (schema.tables.length === 0 && schema.elements.length === 0 && schema.lifelines.length === 0) {
            state = { status: 'empty' };
         } else {
            const imageData = await this.imageData(schema.elements);
            const built =
               this.firstSlideSvg(schema, imageData) ??
               buildDiagramSvg(
                  schema.tables,
                  schema.relationships,
                  resolveThemedElements(schema.elements),
                  sequences,
                  undefined,
                  imageData
               );
            const blob = new Blob([built.svg], { type: 'image/svg+xml' });
            state = { status: 'ready', url: URL.createObjectURL(blob) };
         }
      } catch {
         // Keep a previously built picture if a refresh fails.
         state = entry.state.status === 'ready' ? entry.state : { status: 'error' };
      }
      this.publish(id, state);
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

   private publish(id: string, state: ThumbState): void {
      const entry = this.entries.get(id);
      if (!entry) {
         return;
      }
      const previous = entry.state;
      if (previous.status === 'ready' && previous !== state) {
         URL.revokeObjectURL(previous.url);
      }
      entry.state = state;
      entry.inFlight = false;
      const next = new Map(this.states());
      next.set(id, state);
      this.states.set(next);
   }

   private async imageData(elements: readonly CanvasElementModel[]): Promise<Map<string, string>> {
      const ids = [...new Set(elements.filter((e) => e.type === 'image' && e.fileId).map((e) => e.fileId as string))];
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
