import { Injectable, inject } from '@angular/core';
import type { CanvasElementModel, TableModel, SlideConfig } from '@devdesigner/shared';
import { presentationOf, presentationSlides, layoutOf, layoutNameOf, presentationLayouts } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { frameContents } from '../../../helpers/frame-contents.helper';
/** What copy/paste reaches in the rest of the editor; the editor entry wires it with `connect`. */
export interface ClipboardHost {
   insertImages(files: File[]): Promise<void>;
   duplicateSlides(ids: readonly string[]): Promise<void>;
   freeFrameOffset(frame: CanvasElementModel, step?: number): number;
   cloneItems(
      tableIds: ReadonlySet<string>,
      diagramIds: ReadonlySet<string>,
      elements: readonly CanvasElementModel[],
      dx: number,
      dy: number
   ): Promise<{ copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] }>;
   orderSlideCopies(copies: readonly CanvasElementModel[], deck: string, afterId: string | null): Promise<void>;
   focusFrame(id: string): void;
}

/** The in-app clipboard: copy the selection, paste it (or a system-clipboard picture). */
@Injectable()
export class ClipboardService {
   private readonly store = inject(ProjectStore);
   private readonly viewport = inject(EditorViewportService);
   private readonly gesture = inject(PointerGestureService);
   private host!: ClipboardHost;

   connect(host: ClipboardHost): void {
      this.host = host;
   }

   /** In-app clipboard for copy/paste of tables and canvas elements. */
   private clipboard: {
      tables: TableModel[];
      elements: CanvasElementModel[];
      diagramIds: string[];
      /** The first copied frame, so pasted slides land on free canvas. */
      frame: CanvasElementModel | null;
      /** The slide loose copied items sat on (and its origin then), if they shared one. */
      sourceSlide?: { id: string; x: number; y: number } | null;
   } | null = null;

   /** Text put on the system clipboard at the last in-app copy, to notice a newer outside copy. */
   private clipboardMark: string | null = null;

   private pasteCount = 0;

   onPaste(event: ClipboardEvent): void {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
         return;
      }
      if (!this.store.canEdit()) {
         return;
      }
      const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
         event.preventDefault();
         void this.host.insertImages(files);
         return;
      }
      // Something copied elsewhere since our last copy replaces it: don't paste the stale one.
      const text = event.clipboardData?.getData('text/plain') ?? '';
      // Line endings are compared loosely: the Windows clipboard turns \n into \r\n.
      const eol = (s: string) => s.replace(/\r\n?/g, '\n');
      if (this.clipboard && this.clipboardMark !== null && text && eol(text) !== eol(this.clipboardMark)) {
         this.clipboard = null;
         this.clipboardMark = null;
      }
      if (this.clipboard) {
         event.preventDefault();
         void this.pasteClipboard();
      }
   }

   /** Snapshot the selected tables and elements into the in-app clipboard. */
   copySelection(): void {
      const tableIds = this.store.selectedTableIds();
      let elementIds = this.store.selectedElementIds();
      // Nothing picked while a layout is shown: copy the layout itself (pasting duplicates it).
      const shownLayout = this.store
         .elements()
         .find((e) => e.id === this.store.activeSlideId() && e.slide?.layout && !e.slide.master);
      if (
         shownLayout &&
         !tableIds.length &&
         (!elementIds.length || (elementIds.length === 1 && elementIds[0] === shownLayout.id)) &&
         !this.store.selectedDiagramIds().length
      ) {
         this.clipboard = {
            tables: [],
            elements: [shownLayout],
            diagramIds: [],
            frame: shownLayout,
            sourceSlide: null,
         };
         this.pasteCount = 0;
         const mark = `devdesigner:${Date.now()}`;
         this.clipboardMark = mark;
         void navigator.clipboard?.writeText(mark).catch(() => (this.clipboardMark = null));
         return;
      }
      // A slide left selected next to items picked on the canvas means "copy those items",
      // not the whole slide around them.
      const slideIds = new Set(this.store.slideFrames().map((f) => f.id));
      const picked = elementIds.filter((id) => !slideIds.has(id));
      if (picked.length && picked.length < elementIds.length) {
         elementIds = picked;
      }
      // Copying a frame (slide) copies everything inside it too.
      const inner = frameContents(
         new Set(elementIds),
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages(),
         this.store.shownSlideIds()
      );
      const selectedDiagrams = new Set(this.store.selectedDiagramIds());
      const tables = this.store.tables().filter((t) => tableIds.includes(t.id) || inner.tableIds.has(t.id));
      const elements = this.store.elements().filter((e) => elementIds.includes(e.id) || inner.elementIds.has(e.id));
      if (!tables.length && !elements.length && !selectedDiagrams.size && !inner.diagramIds.size) {
         return;
      }
      const frame = elements.find((e) => e.type === 'frame' && elementIds.includes(e.id)) ?? null;
      // Loose items all on one slide remember where that slide was, so pasting onto
      // another slide puts them at the same spot on it.
      const owners = new Set<string | undefined>([...elements.map((e) => e.slideId), ...tables.map((t) => t.slideId)]);
      const ownerId = !frame && owners.size === 1 ? [...owners][0] : undefined;
      const owner = ownerId ? this.store.elements().find((e) => e.id === ownerId && e.slide) : undefined;
      this.clipboard = {
         tables,
         elements,
         diagramIds: [...new Set([...inner.diagramIds, ...selectedDiagrams])],
         frame,
         sourceSlide: owner ? { id: owner.id, x: owner.x, y: owner.y } : null,
      };
      this.pasteCount = 0;
      // A lone code block also lands on the system clipboard as plain text; anything else
      // leaves a marker there, so a later copy in another app is noticed on paste.
      const mark =
         !tables.length && elements.length === 1 && elements[0].type === 'code'
            ? (elements[0].text ?? '')
            : `devdesigner:${Date.now()}`;
      this.clipboardMark = mark || null;
      if (mark) {
         void navigator.clipboard?.writeText(mark).catch(() => (this.clipboardMark = null));
      }
   }

   /**
    * A pasted slide's config moved into `target`: ordered right after `after`, wearing
    * that deck's theme, and using its layout of the same kind or name (else its default).
    */
   private slideForPresentation(copy: CanvasElementModel, target: string, after: CanvasElementModel): SlideConfig {
      const frames = this.store.slideFrames();
      const slides = presentationSlides(frames, target).filter((f) => f.id !== copy.id);
      const at = slides.findIndex((f) => f.id === after.id);
      const lo = at >= 0 ? slides[at].slide!.order : slides[slides.length - 1]?.slide?.order;
      const hi = at >= 0 ? slides[at + 1]?.slide?.order : undefined;
      const order = lo === undefined ? 0 : hi === undefined ? lo + 1 : (lo + hi) / 2;
      const own = layoutOf(copy, frames);
      const layouts = presentationLayouts(frames, target).filter((l) => !l.slide?.master);
      const layout =
         (own?.slide?.layoutKind && layouts.find((l) => l.slide?.layoutKind === own.slide?.layoutKind)) ||
         (own && layouts.find((l) => layoutNameOf(l, frames) === layoutNameOf(own, frames))) ||
         layouts.find((l) => l.slide?.defaultLayout);
      const theme = frames.find((f) => presentationOf(f) === target && f.slide?.theme)?.slide?.theme;
      return { ...copy.slide!, presentation: target, order, layoutId: layout?.id, theme };
   }

   /** The cursor in world coordinates, if it is over the canvas. */
   private pasteAnchor(): { x: number; y: number } | null {
      const p = this.gesture.lastPointer;
      if (!p) return null;
      const rect = this.viewport.canvasRect();
      if (p.clientX < rect.left || p.clientX > rect.right || p.clientY < rect.top || p.clientY > rect.bottom) {
         return null;
      }
      return this.viewport.toWorld(p.clientX, p.clientY);
   }

   /** Paste the clipboard, each successive paste stepping further from the original. */
   async pasteClipboard(): Promise<void> {
      const clip = this.clipboard;
      if (!clip) {
         return;
      }
      // A copied layout pastes as a duplicate right after it.
      const layoutSrc =
         clip.frame?.slide?.layout && !clip.frame.slide.master
            ? this.store.elements().find((e) => e.id === clip.frame!.id)
            : null;
      if (layoutSrc) {
         await this.host.duplicateSlides([layoutSrc.id]);
         return;
      }
      this.pasteCount++;
      // Slides are pasted a page-width away on free canvas, other things nudged diagonally.
      const slide = clip.frame ? this.store.elements().find((e) => e.id === clip.frame?.id) : null;
      const frame = slide ?? clip.frame;
      const isSlide = !!frame?.slide;
      // A slide pasted while another presentation is selected joins that one: it lands
      // on that deck's spot, right after the slide it shows.
      const target = this.store.presentation();
      const targetShown = this.store.elements().find((e) => e.id === this.store.activeSlideId());
      const intoOther =
         isSlide && !frame?.slide?.layout && !!target && !!targetShown && presentationOf(frame!) !== target;
      let dx = isSlide ? 0 : frame ? this.host.freeFrameOffset(frame, this.pasteCount) : 24 * this.pasteCount;
      let dy = frame && !isSlide ? 0 : isSlide ? 0 : 24 * this.pasteCount;
      // Items copied off a slide and pasted while a different slide is shown land at the
      // same spot on that slide (repeat pastes step diagonally from there).
      const src = clip.sourceSlide;
      const shownSlide = targetShown?.slide ? targetShown : null;
      if (intoOther) {
         dx = targetShown!.x - frame!.x;
         dy = targetShown!.y - frame!.y;
      } else if (!frame && src && shownSlide && shownSlide.id !== src.id) {
         const step = 24 * (this.pasteCount - 1);
         dx = shownSlide.x - src.x + step;
         dy = shownSlide.y - src.y + step;
      } else if (!frame) {
         // Loose items paste centered on the cursor when it is over the canvas.
         const at = this.pasteAnchor();
         const boxes = [
            ...clip.elements.map((e) => ({ x: e.x, y: e.y, w: e.width ?? 0, h: e.height ?? 0 })),
            ...clip.tables.map((t) => ({ x: t.x, y: t.y, w: 0, h: 0 })),
         ];
         if (at && boxes.length) {
            const minX = Math.min(...boxes.map((b) => b.x));
            const minY = Math.min(...boxes.map((b) => b.y));
            const maxX = Math.max(...boxes.map((b) => b.x + b.w));
            const maxY = Math.max(...boxes.map((b) => b.y + b.h));
            dx = Math.round(at.x - (minX + maxX) / 2);
            dy = Math.round(at.y - (minY + maxY) / 2);
         }
      }
      // Pasted onto a shown slide, loose items always land inside its frame: the slide
      // owns them, and slide content off the frame is hidden on the canvas (it would only
      // show faintly while the slide is dragged). Moved in by the least needed; centered
      // when larger than the slide.
      if (!frame && shownSlide) {
         const boxes = [
            ...clip.elements.map((e) => ({ x: e.x, y: e.y, w: e.width ?? 0, h: e.height ?? 0 })),
            ...clip.tables.map((t) => ({ x: t.x, y: t.y, w: 0, h: 0 })),
         ];
         if (boxes.length) {
            const x0 = Math.min(...boxes.map((b) => b.x)) + dx;
            const y0 = Math.min(...boxes.map((b) => b.y)) + dy;
            const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + dx;
            const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + dy;
            const fit = (lo: number, hi: number, f0: number, f1: number): number =>
               hi - lo > f1 - f0 ? (f0 + f1) / 2 - (lo + hi) / 2 : lo < f0 ? f0 - lo : hi > f1 ? f1 - hi : 0;
            dx += Math.round(fit(x0, x1, shownSlide.x, shownSlide.x + shownSlide.width));
            dy += Math.round(fit(y0, y1, shownSlide.y, shownSlide.y + shownSlide.height));
         }
      }
      let result: { copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] } | null = null;
      await this.store.batchHistory(async () => {
         result = await this.host.cloneItems(
            new Set(clip.tables.map((t) => t.id).filter((id) => this.store.tables().some((t) => t.id === id))),
            new Set(clip.diagramIds.filter((id) => this.store.sequenceDiagrams().some((d) => d.id === id))),
            clip.elements.map((e) => this.store.elements().find((x) => x.id === e.id) ?? e),
            dx,
            dy
         );
         const slideCopies = result
            ? [...result.copies.values()].filter((c) => c.type === 'frame' && c.slide && !c.slide.layout)
            : [];
         if (intoOther && target && targetShown) {
            for (const copy of slideCopies) {
               await this.store.updateElement(copy.id, { slide: this.slideForPresentation(copy, target, targetShown) });
            }
            await this.host.orderSlideCopies(slideCopies, target, targetShown.id);
         } else if (slideCopies.length) {
            // Pasted slides go right after the slide shown in their deck, in their copied order.
            const deck = presentationOf(slideCopies[0]);
            await this.host.orderSlideCopies(slideCopies, deck, this.store.shownByPresentation().get(deck) ?? null);
         }
      });
      const r = result as { copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] } | null;
      if (!r) {
         return;
      }
      const pastedSlides = [...r.copies.values()].filter((c) => c.type === 'frame' && c.slide);
      if (pastedSlides.length) {
         this.host.focusFrame(pastedSlides[pastedSlides.length - 1].id);
         if (pastedSlides.length > 1)
            this.store.setSelection(
               [],
               [],
               pastedSlides.map((c) => c.id)
            );
         return;
      }
      // Pasted content lands on the slide that is shown, not on the one it was copied from.
      const shown = this.store.activeSlideId();
      if (shown) {
         await this.store.assignSlide(
            {
               elements: [...r.copies.values()].filter((c) => c.type !== 'frame').map((c) => c.id),
               tables: r.tableIds,
               diagrams: r.diagramIds,
            },
            shown
         );
      }
      this.store.setSelection(
         r.tableIds,
         [],
         [...r.copies.values()].map((c) => c.id),
         [],
         [],
         r.diagramIds
      );
   }
}
