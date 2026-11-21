import { inject, Injectable, type Signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { CanvasElementModel, RelationshipModel, TableModel } from '@devdesigner/shared';
import {
   generateSql,
   PROJECT_EXPORT_FORMAT,
   PROJECT_EXPORT_VERSION,
   presentationOf,
   presentationSlides,
   layoutOf,
   resolveThemedSequences,
   masterOf,
} from '@devdesigner/shared';
import { ProjectFileService } from '../../../../../shared/services/project-file.service';
import { TelemetryService } from '../../../../../core/telemetry/telemetry.service';
import { ElementImagesService } from '../../../services/element-images.service';
import { ProjectsStore } from '../../../../../shared/state/projects/projects.store';
import { ProjectStore } from '../../../state/project/project.store';
import { contentForFrame } from '../../../helpers/frame-contents.helper';
import { buildDiagramSvg, type SequenceExportData } from '../../../helpers/diagram-svg.helper';
import { embedFonts } from '../../../helpers/font-embed.helper';
import type {
   FrameOrderDialogComponent,
   FrameOrderDialogData,
} from '../components/frame-order-dialog/frame-order-dialog.component';
import {
   downloadBlob,
   exportDiagramImage,
   pagesToPdfBlob,
   type DiagramImage,
   type ImageFormat,
} from '../helpers/image-export.helper';
/** What export reads from the rest of the editor; the editor entry wires it with `connect`. */
export interface ExportHost {
   /** Presentations selected as a whole (their every slide is in scope). */
   readonly selectedSlideSets: Signal<string[]>;
}

/**
 * Exports from the editor: SQL, PNG/SVG/PDF pictures of the selection, frames and slides, and
 * the selection as a project file.
 */
@Injectable()
export class EditorExportService {
   private readonly store = inject(ProjectStore);
   private readonly dialog = inject(MatDialog);
   private readonly snackBar = inject(MatSnackBar);
   private readonly images = inject(ElementImagesService);
   private readonly projectsStore = inject(ProjectsStore);
   private readonly projectFile = inject(ProjectFileService);
   private readonly telemetry = inject(TelemetryService);
   private host!: ExportHost;

   connect(host: ExportHost): void {
      this.host = host;
   }

   /** Export one frame as an image (PNG / SVG / PDF). */
   exportOneFrame(frameId: string, format: ImageFormat): void {
      const frame = this.store.elements().find((e) => e.id === frameId);
      if (frame) void this.exportFrames(format, [frame], true, frame.text || 'frame');
   }

   /**
    * Tables + relationships to export. If any tables are selected (marquee or
    * multi-select), export just those and only the relationships whose endpoints
    * both fall inside the selection; otherwise export the whole diagram.
    */
   private exportScope(ignoreSelection = false): {
      tables: TableModel[];
      relationships: RelationshipModel[];
      elements: CanvasElementModel[];
      sequences: SequenceExportData;
      selectionOnly: boolean;
   } {
      const selectedTableIds = new Set(ignoreSelection ? [] : this.store.selectedTableIds());
      const selectedElementIds = new Set(ignoreSelection ? [] : this.store.selectedElementIds());
      const selectedMessageIds = new Set(ignoreSelection ? [] : this.store.selectedMessageIds());
      const selectedLifelineIds = new Set(ignoreSelection ? [] : this.store.selectedLifelineIds());
      const selectedDiagramIds = new Set(ignoreSelection ? [] : this.store.selectedDiagramIds());
      // A presentation selected as a whole brings every one of its slides, not just the shown one.
      for (const set of ignoreSelection ? [] : this.host.selectedSlideSets()) {
         for (const f of presentationSlides(this.store.slideFrames(), set)) selectedElementIds.add(f.id);
      }
      // A selected slide frame brings along everything it owns.
      const selectedFrameIds = new Set(
         this.store
            .elements()
            .filter((e) => e.type === 'frame' && selectedElementIds.has(e.id))
            .map((e) => e.id)
      );
      if (selectedFrameIds.size) {
         for (const e of this.store.elements()) {
            if (e.slideId && selectedFrameIds.has(e.slideId)) selectedElementIds.add(e.id);
         }
         for (const t of this.store.tables()) {
            if (t.slideId && selectedFrameIds.has(t.slideId)) selectedTableIds.add(t.id);
         }
         for (const d of this.store.sequenceDiagrams()) {
            if (d.slideId && selectedFrameIds.has(d.slideId)) selectedDiagramIds.add(d.id);
         }
      }
      const selectionOnly =
         selectedTableIds.size > 0 ||
         selectedElementIds.size > 0 ||
         selectedMessageIds.size > 0 ||
         selectedLifelineIds.size > 0 ||
         selectedDiagramIds.size > 0;
      const tables = selectionOnly
         ? this.store.tables().filter((t) => selectedTableIds.has(t.id))
         : this.store.tables();
      // Pictures draw deck theme tokens as their concrete colors/fonts.
      const themed = this.store.themedElements();
      const elements = selectionOnly ? themed.filter((e) => selectedElementIds.has(e.id)) : themed;

      const columnIds = new Set<string>();
      for (const table of tables) {
         for (const column of table.columns) {
            columnIds.add(column.id);
         }
      }
      const relationships = this.store
         .relationships()
         .filter((r) => columnIds.has(r.sourceColumnId) && columnIds.has(r.targetColumnId));

      // A selection includes a sequence diagram when the diagram itself, or any of
      // its participants/messages, is selected. With only some messages selected,
      // draw just those (participants stay so the arrows have ends).
      const allLifelines = this.store.lifelines();
      const allMessages = this.store.sequenceMessages();
      const diagrams = this.store.sequenceDiagrams().filter((d) => {
         if (!selectionOnly) return true;
         return (
            selectedDiagramIds.has(d.id) ||
            allLifelines.some((l) => l.diagramId === d.id && selectedLifelineIds.has(l.id)) ||
            allMessages.some((m) => m.diagramId === d.id && selectedMessageIds.has(m.id))
         );
      });
      const diagramIds = new Set(diagrams.map((d) => d.id));
      const messages = allMessages.filter((m) => {
         if (!diagramIds.has(m.diagramId)) return false;
         if (!selectionOnly || selectedDiagramIds.has(m.diagramId)) return true;
         const hasPicked = allMessages.some((o) => o.diagramId === m.diagramId && selectedMessageIds.has(o.id));
         return !hasPicked || selectedMessageIds.has(m.id);
      });
      const sequences: SequenceExportData = resolveThemedSequences(
         { diagrams, lifelines: allLifelines.filter((l) => diagramIds.has(l.diagramId)), messages },
         this.store.slideFrames()
      );

      return { tables, relationships, elements, sequences, selectionOnly };
   }

   private exportBaseName(selectionOnly: boolean): string {
      return selectionOnly ? 'diagram-selection' : 'diagram';
   }

   /**
    * Save just the current selection as a project file. It imports as its own new
    * project; references that leave the selection (e.g. an arrow bound to an
    * unselected table) are dropped by the importer.
    */
   async exportSelectionFile(): Promise<void> {
      const { tables, relationships, elements: picked, sequences: drawn, selectionOnly } = this.exportScope();
      if (!selectionOnly) return;
      // The file holds the stored rows, so theme tokens stay tokens (the scope's are resolved for drawing).
      const keep = new Set(picked.map((e) => e.id));
      // Slides need their deck's layouts and master, and those frames' items, to look the same.
      const frames = this.store.slideFrames();
      const decks = new Set(frames.filter((f) => keep.has(f.id)).map((f) => presentationOf(f)));
      const designFrames = new Set(
         frames.filter((f) => (f.slide?.layout || f.slide?.master) && decks.has(presentationOf(f))).map((f) => f.id)
      );
      const elements = this.store
         .elements()
         .filter((e) => keep.has(e.id) || designFrames.has(e.id) || (!!e.slideId && designFrames.has(e.slideId)));
      const diagramIds = new Set(drawn.diagrams.map((d) => d.id));
      const messageIds = new Set(drawn.messages.map((m) => m.id));
      const sequences = {
         diagrams: this.store.sequenceDiagrams().filter((d) => diagramIds.has(d.id)),
         lifelines: this.store.lifelines().filter((l) => diagramIds.has(l.diagramId)),
         messages: this.store.sequenceMessages().filter((m) => messageIds.has(m.id)),
      };
      // Embed the files behind image elements; the importer drops images without one.
      const fileIds = [
         ...new Set(
            elements.flatMap((e) => ((e.type === 'image' || e.type === 'embed') && e.fileId ? [e.fileId] : []))
         ),
      ];
      const images = (
         await Promise.all(
            fileIds.map(async (id) => {
               const url = await this.images.dataUrl(id);
               const match = url && /^data:([^;,]+);base64,(.*)$/s.exec(url);
               return match ? { id, mimeType: match[1], data: match[2] } : null;
            })
         )
      ).filter((img) => img !== null);
      const current = this.projectsStore.selected();
      const baseName = (current?.name ?? 'project').slice(0, 100);
      this.projectFile.save(
         {
            format: PROJECT_EXPORT_FORMAT,
            version: PROJECT_EXPORT_VERSION,
            exportedAt: new Date().toISOString(),
            project: {
               name: `${baseName} (selection)`,
               description: current?.description ?? null,
               type: current?.type ?? 'ERD',
            },
            schema: {
               tables,
               relationships,
               notes: [],
               elements,
               sequenceDiagrams: [...sequences.diagrams],
               lifelines: [...sequences.lifelines],
               sequenceMessages: [...sequences.messages],
               viewport: this.store.viewport(),
               ...(decks.size && this.store.customThemes().length ? { themes: this.store.customThemes() } : {}),
            },
            ...(images.length ? { images } : {}),
         },
         `${baseName}-selection`
      );
   }

   /** Open the SQL export dialog for the current scope (selection or whole diagram). */
   async openSqlExport(): Promise<void> {
      const { tables, relationships, selectionOnly } = this.exportScope();
      const sql = generateSql(
         // Elements are decorative and are ignored by the SQL generator.
         {
            tables,
            relationships,
            notes: [],
            elements: [],
            sequenceDiagrams: [],
            lifelines: [],
            sequenceMessages: [],
            viewport: this.store.viewport(),
         },
         { dialect: 'mysql' }
      );
      // Loaded on first use: the dialog (and the SQL formatter it pulls in) stays out of the editor chunk.
      const { ExportDialogComponent } = await import('../components/export-dialog/export-dialog.component');
      this.dialog.open(ExportDialogComponent, {
         width: '720px',
         maxWidth: '92vw',
         data: { sql, baseName: this.exportBaseName(selectionOnly), selectionOnly },
      });
   }

   /** Export the current scope as an image, matching the live theme and layout. */
   async onExportImage(format: ImageFormat): Promise<void> {
      // Selecting one or more frames exports those frames (each as its own fixed-size page).
      const selectedIds = new Set(this.store.selectedElementIds());
      const selectedFrames = this.store.elements().filter((e) => e.type === 'frame' && selectedIds.has(e.id));
      if (selectedFrames.length) {
         await this.exportFrames(format, selectedFrames);
         return;
      }
      const { tables, relationships, elements, sequences, selectionOnly } = this.exportScope();
      if (tables.length === 0 && elements.length === 0 && sequences.lifelines.length === 0) {
         this.snackBar.open('Nothing to export yet. Add a table or shape first.', undefined, {
            duration: 2500,
         });
         return;
      }
      try {
         const imageData = await this.imageDataFor(elements);
         const built = buildDiagramSvg(tables, relationships, elements, sequences, undefined, imageData);
         const diagram = { ...built, svg: await embedFonts(built.svg) };
         await exportDiagramImage(format, diagram, this.exportBaseName(selectionOnly));
         this.telemetry.track('client.export_image', { format, scope: selectionOnly ? 'selection' : 'canvas' });
      } catch (err) {
         this.snackBar.open(`Export failed: ${err instanceof Error ? err.message : String(err)}`, undefined, {
            duration: 4000,
         });
      }
   }

   /** `data:` URIs for the pictures among `elements`, so exports are self-contained. */
   private async imageDataFor(elements: readonly CanvasElementModel[]): Promise<Map<string, string>> {
      const ids = [
         ...new Set(
            elements
               .filter((e) => (e.type === 'image' || e.type === 'embed') && e.fileId)
               .map((e) => e.fileId as string)
         ),
      ];
      const data = new Map<string, string>();
      await Promise.all(
         ids.map(async (id) => {
            const url = await this.images.stillDataUrl(id);
            if (url) {
               data.set(id, url);
            }
         })
      );
      return data;
   }

   /** Export every frame on the canvas as a multi-page PDF (one page per frame). */
   async exportAllFramesPdf(): Promise<void> {
      // Slide frames belong to their presentation and have their own export.
      const frames = this.store.elements().filter((e) => e.type === 'frame' && !e.slide);
      if (!frames.length) {
         this.snackBar.open('No frames yet. Draw one with the Frame tool (F).', undefined, {
            duration: 2500,
         });
         return;
      }
      await this.exportFrames('pdf', frames);
   }

   /** Export the selected presentation's slides, in order, as a multi-page PDF. */
   async exportAllSlidesPdf(): Promise<void> {
      const slides = this.store.presentationFrames().filter((f) => !f.slide?.hidden);
      if (!slides.length) {
         this.snackBar.open('No slides to export in this presentation.', undefined, {
            duration: 2500,
         });
         return;
      }
      await this.exportFrames('pdf', slides, true, this.store.presentation() ?? undefined);
   }

   /**
    * Export frames as cropped, exact-size images. PDF bundles them into one
    * multi-page file (reading order by default; with several frames the user
    * arranges the pages first); SVG/PNG
    * download one file per frame, named after the frame.
    */
   private async exportFrames(
      format: ImageFormat,
      frames: readonly CanvasElementModel[],
      /** Keep `frames` in the given order (slide sequence) instead of reading order + arrange dialog. */
      keepOrder = false,
      /** File name for a multi-page PDF (defaults to "slides" / "frames"). */
      pdfName?: string
   ): Promise<void> {
      // Whole-canvas scope: a frame crops the full diagram, whatever is selected.
      const { tables, relationships, elements, sequences } = this.exportScope(true);
      let ordered = keepOrder ? [...frames] : [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
      if (!keepOrder && format === 'pdf' && ordered.length > 1) {
         const arranged = await this.arrangeFramePages(ordered);
         if (!arranged) {
            return;
         }
         ordered = arranged;
      }
      try {
         const images: DiagramImage[] = [];
         const imageData = await this.imageDataFor(elements);
         for (const frame of ordered) {
            // A slide's picture holds only its own contents (slides are stacked).
            const mine = contentForFrame(
               frame.id,
               !!frame.slide,
               elements,
               tables,
               sequences.diagrams,
               sequences.lifelines,
               sequences.messages,
               layoutOf(frame, this.store.slideFrames())?.id,
               masterOf(frame, this.store.slideFrames())?.id
            );
            const built = buildDiagramSvg(
               mine.tables,
               relationships,
               mine.elements,
               { diagrams: mine.diagrams, lifelines: mine.lifelines, messages: mine.messages },
               { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
               imageData
            );
            images.push({ ...built, svg: await embedFonts(built.svg) });
         }
         if (format === 'pdf') {
            const name =
               ordered.length === 1
                  ? EditorExportService.fileSafe(ordered[0].text)
                  : pdfName
                    ? EditorExportService.fileSafe(pdfName) || 'slides'
                    : keepOrder
                      ? 'slides'
                      : 'frames';
            downloadBlob(await pagesToPdfBlob(images), `${name}.pdf`);
            this.trackFrames(format, ordered);
            return;
         }
         const used = new Map<string, number>();
         for (let i = 0; i < ordered.length; i += 1) {
            const base = EditorExportService.fileSafe(ordered[i].text) || `frame-${i + 1}`;
            const n = (used.get(base) ?? 0) + 1;
            used.set(base, n);
            await exportDiagramImage(format, images[i], n > 1 ? `${base}-${n}` : base);
         }
         this.trackFrames(format, ordered);
      } catch (err) {
         this.snackBar.open(`Export failed: ${err instanceof Error ? err.message : String(err)}`, undefined, {
            duration: 4000,
         });
      }
   }

   /** `client.export_image` for a frame export: slides count as slide / deck, other frames as a selection. */
   private trackFrames(format: ImageFormat, frames: readonly CanvasElementModel[]): void {
      const slides = frames.some((f) => f.slide);
      const scope = slides ? (frames.length > 1 ? 'deck' : 'slide') : 'selection';
      this.telemetry.track('client.export_image', { format, scope });
   }

   /** Page order the user last picked, reused as the starting order next time. */
   private lastFramePageOrder: string[] = [];

   /**
    * Ask the user for the PDF page order. Starts from their previous arrangement
    * (frames not seen before follow in reading order). Null when cancelled.
    */
   private async arrangeFramePages(frames: CanvasElementModel[]): Promise<CanvasElementModel[] | null> {
      const rank = (f: CanvasElementModel): number => {
         const i = this.lastFramePageOrder.indexOf(f.id);
         return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const start = [...frames].sort((a, b) => rank(a) - rank(b)); // stable: reading order for new ones
      const { FrameOrderDialogComponent: dialog } =
         await import('../components/frame-order-dialog/frame-order-dialog.component');
      const ref = this.dialog.open<FrameOrderDialogComponent, FrameOrderDialogData, string[]>(dialog, {
         width: '460px',
         maxWidth: '92vw',
         data: {
            frames: start.map((f) => ({
               id: f.id,
               name: f.text || 'Untitled frame',
               width: Math.round(f.width),
               height: Math.round(f.height),
            })),
         },
      });
      const ids = await firstValueFrom(ref.afterClosed());
      if (!ids) {
         return null;
      }
      this.lastFramePageOrder = ids;
      const byId = new Map(frames.map((f) => [f.id, f]));
      return ids.map((id) => byId.get(id)).filter((f): f is CanvasElementModel => !!f);
   }

   /** A frame name made safe for use as a file name. */
   private static fileSafe(name: string | undefined): string {
      return (
         (name ?? 'frame')
            .trim()
            .replace(/[^\w\-. ]+/g, '')
            .replace(/\s+/g, '-') || 'frame'
      );
   }
}
