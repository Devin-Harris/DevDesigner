import { DrawToolService } from './draw-tool.service';
import { ElementGestureService } from './element-gesture.service';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { EditorToolService } from '../../../services/editor-tool.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { TextEditingService } from './text-editing.service';
import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { effect, inject, input, untracked, Injectable, DestroyRef } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { layoutOf, masterOf } from '@devdesigner/shared';
import { MediaActionsService } from '../../../services/media-actions.service';
import { ProjectStore } from '../../../state/project/project.store';
import { CodeActionsService } from '../../../services/code-actions.service';
import { GridTableService } from '../../../services/grid-table.service';
import { gridCellAt } from '../../../helpers/grid-table.helper';
import { standInFor } from '../../../helpers/layout-placeholders';
import { hitTestElement } from '../../../helpers/element-geometry.helper';
import {
   CODE_FONT_SIZE,
   codeDiffActive,
   codeDiffSplit,
   CODE_DOTS_WIDTH,
   codeHeaderHeight,
} from '../../../helpers/render';
/**
 * Double-clicks on the canvas: edit text/code/cells, enter groups, crop images, create text, and
 * take over a layout's inherited item on a slide. Detects double-clicks itself (see `attach`).
 */
@Injectable()
export class CanvasDblClickService {
   private readonly destroyRef = inject(DestroyRef);
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly viewport = inject(EditorViewportService);
   private readonly tools = inject(EditorToolService);
   private readonly grids = inject(GridTableService);
   private readonly codeActions = inject(CodeActionsService);
   private readonly mediaActions = inject(MediaActionsService);
   private readonly textEditing = inject(TextEditingService);
   private readonly drawTool = inject(DrawToolService);
   private readonly elementGestures = inject(ElementGestureService);

   // --- toolbar: add / zoom / grid / align ---

   /** When our own double-click detector last fired (the native event that follows is ignored). */
   lastOwnDblClick = -Infinity;

   replayingDblClick = false;

   /** Canvas layers that handle double-clicks themselves via (dblclick) bindings. */
   static readonly SELF_DBLCLICK = 'dd-table-node, dd-canvas-sequence, dd-sequence-diagram, dd-canvas-connectors';

   onCanvasDblClick(event: MouseEvent): void {
      if (performance.now() - this.lastOwnDblClick < 600) {
         return;
      }
      this.handleDoubleClick(event.target as Element | null, event.currentTarget, event.clientX, event.clientY);
   }

   handleDoubleClick(target: Element | null, canvas: EventTarget | null, clientX: number, clientY: number): void {
      // Toolbars, panels, the minimap and the inline editor are children of the
      // canvas element, so their double-clicks bubble up here. Only a double-click
      // on the drawing surface itself (the canvas or the world layer) is ours.
      const onSurface =
         !!target &&
         (target === canvas || !!target.closest('.world')) &&
         !target.closest('.text-editor, [contenteditable="true"], textarea, input');
      if (!onSurface || this.textEditing.editingTextId()) {
         return;
      }
      // Layers with their own (dblclick) handlers — ERD tables (rename table / edit
      // column), sequence diagrams (title, participants, messages), connectors (reset
      // route). The native dblclick can be swallowed when the first click re-renders
      // the item, so replay it on the node under the pointer; it bubbles to whichever
      // handler owns that spot. The native one that may follow is suppressed (see
      // the capture listener in the constructor) so it doesn't run twice.
      if (target.closest(CanvasDblClickService.SELF_DBLCLICK)) {
         this.replayingDblClick = true;
         try {
            target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX, clientY }));
         } finally {
            this.replayingDblClick = false;
         }
         return;
      }
      const world = this.viewport.toWorld(clientX, clientY);
      const hits = this.canvasView
         .shownElements()
         .reverse()
         .filter((e) => hitTestElement(e, world));
      // What is under the pointer, in order of intent: the item just clicked (selected),
      // then text (slide text often sits over a card or picture), then the topmost item.
      const selected = new Set(this.store.selectedElementIds());
      const isTexty = (e: CanvasElementModel): boolean => e.type === 'text' || e.type === 'code' || e.type === 'grid';
      const hit = hits.find((e) => selected.has(e.id) && e.type !== 'frame') ?? hits.find(isTexty) ?? hits[0];
      // Double-clicking a member of a group steps into it (selecting just that
      // member); once inside, the usual double-click behaviour applies.
      const locked = (id: string): boolean => {
         const gid = this.store.groupIdOf(id);
         return !!gid && gid !== this.store.enteredGroupId();
      };
      const diagram = this.store.sequenceDiagrams().find((d) => {
         const b = this.canvasView.diagramBox(d);
         return !!b && world.x >= b.minX && world.x <= b.maxX && world.y >= b.minY && world.y <= b.maxY;
      });
      if (diagram && locked(diagram.id)) {
         this.store.enterGroup('diagram', diagram.id);
         return;
      }
      if (hit && locked(hit.id)) {
         this.store.enterGroup('element', hit.id);
         return;
      }
      if (!this.store.canEdit() || !this.store.projectId()) {
         return;
      }
      // Double-clicking a picture crops it inline.
      if (hit?.type === 'image') {
         this.store.selectElement(hit.id);
         this.mediaActions.startCrop(hit.id);
         return;
      }
      // Double-clicking a master item drawn under a shown slide or layout gives that frame
      // its own copy to edit (reset to master deletes it again).
      if (!hit) {
         const inherited = this.inheritedMasterItemAt(world);
         if (inherited) {
            void this.editInherited(inherited.item, inherited.frame);
            return;
         }
      }
      // Double-clicking a grid table edits the cell under the pointer.
      if (hit?.type === 'grid') {
         const cell = gridCellAt(hit, world);
         if (cell) {
            this.store.selectElement(hit.id);
            this.grids.beginEdit({ id: hit.id, ...cell });
         }
         return;
      }
      // Double-clicking a code block's file-name bar edits the name, not the code.
      if (hit?.type === 'code') {
         const header = codeHeaderHeight(hit.fontSize ?? CODE_FONT_SIZE);
         if (world.y < hit.y + header) {
            // Double-clicks on the window dots are not an edit gesture.
            if (world.x >= hit.x + CODE_DOTS_WIDTH) {
               this.codeActions.editFileName(hit.id);
            }
            return;
         }
      }
      // Double-clicking a text element edits it; double-clicking a shape edits its
      // centered label; double-clicking empty canvas creates a text block.
      if (hit) {
         if (
            hit.type === 'text' ||
            hit.type === 'code' ||
            hit.type === 'frame' ||
            hit.type === 'rectangle' ||
            hit.type === 'ellipse' ||
            hit.type === 'diamond' ||
            hit.type === 'arrow' ||
            hit.type === 'line'
         ) {
            this.store.selectElement(hit.id);
            // Older text boxes may have been resized narrower so they wrapped; text
            // no longer wraps, so refit the box to its content before editing.
            if (hit.type === 'text') {
               const lineH = (hit.fontSize ?? DEFAULT_FONT_SIZE) * (hit.lineHeight ?? 1.25);
               const explicit = (hit.text ?? '').split('\n').length;
               const looksWrapped = hit.height > explicit * lineH + 4 + lineH * 0.5;
               if (hit.wrap === undefined && looksWrapped) {
                  // Legacy narrow text becomes an explicit fixed-width block.
                  this.store.patchElementLocal(hit.id, { wrap: true });
                  void this.store.updateElement(hit.id, { wrap: true });
               } else if (!hit.wrap) {
                  this.store.patchElementLocal(hit.id, this.textEditing.fitTextSize(hit, hit.text ?? ''));
               }
            }
            if (hit.type === 'text') {
               this.textEditing.editClickPoint = { x: clientX, y: clientY };
            }
            if (hit.type === 'code') {
               // Both diff sides open for editing; the caret starts in the pane clicked.
               this.codeActions.diffEditSide.set(
                  codeDiffActive(hit) && world.x >= hit.x + hit.width * codeDiffSplit(hit) ? 'modified' : 'original'
               );
            }
            this.textEditing.editingTextId.set(hit.id);
         }
         return;
      }
      this.createTextAt(world);
   }

   /**
    * The topmost master or layout item drawn locked under a shown slide or layout at a
    * world point, with the shown frame it is under.
    */
   inheritedMasterItemAt(world: {
      x: number;
      y: number;
   }): { item: CanvasElementModel; frame: CanvasElementModel } | null {
      const locked = this.store.layoutItemIds();
      const masters = this.store.masterItemIds();
      const hide = this.canvasView.focusHidden();
      const frames = this.store.slideFrames();
      const shown = frames.filter((f) => this.store.shownSlideIds().has(f.id));
      const items = this.store
         .elements()
         .filter((e) => locked.has(e.id) && !hide?.elementIds.has(e.id))
         .sort((a, b) => (masters.has(a.id) ? 0 : 1) - (masters.has(b.id) ? 0 : 1) || a.zIndex - b.zIndex)
         .reverse();
      for (const item of items) {
         if (!hitTestElement(item, world)) continue;
         const frame = shown.find(
            (f) => masterOf(f, frames)?.id === item.slideId || layoutOf(f, frames)?.id === item.slideId
         );
         const raw = this.store.elements().find((e) => e.id === item.id);
         if (frame && raw) return { item: raw, frame };
      }
      return null;
   }

   /** Copies made by grabbing a master item, as made: dropped again if left unchanged. */
   private readonly pristineStandIns = new Map<string, string>();

   async grabInherited(item: CanvasElementModel, frame: CanvasElementModel, event: PointerEvent): Promise<void> {
      let held = true;
      const up = (): void => {
         held = false;
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointerup', up);
      const copy = await standInFor(this.store, item, frame, true);
      if (!copy) return;
      this.pristineStandIns.set(copy.id, this.standInLook(copy));
      this.store.selectElement(copy.id, false);
      if (!held) return;
      window.removeEventListener('pointerup', up);
      this.gesture.startClientX = event.clientX;
      this.gesture.startClientY = event.clientY;
      this.gesture.gestureScale = this.canvasView.itemScale(copy.id);
      this.gesture.dragCopied = false;
      this.elementGestures.beginElementDrag(copy);
   }

   private standInLook(e: CanvasElementModel): string {
      const { zIndex: _z, ...rest } = e;
      return JSON.stringify(rest);
   }

   /** A grabbed master item's copy that was never changed goes once it is deselected. */
   private readonly prunePristine = effect(() => {
      const selected = new Set(this.store.selectedElementIds());
      const editing = this.textEditing.editingTextId();
      untracked(() => {
         for (const [id, look] of [...this.pristineStandIns]) {
            if (selected.has(id) || editing === id) continue;
            this.pristineStandIns.delete(id);
            const el = this.store.elements().find((e) => e.id === id);
            if (el && this.standInLook(el) === look) void this.store.deleteElementSilently(id);
         }
      });
   });

   private async editInherited(item: CanvasElementModel, frame: CanvasElementModel): Promise<void> {
      const copy = await standInFor(this.store, item, frame);
      if (!copy) return;
      this.store.selectElement(copy.id);
      if (['text', 'rectangle', 'ellipse', 'diamond', 'code'].includes(copy.type))
         this.textEditing.editingTextId.set(copy.id);
   }

   /** Create an empty text block at a world point and open its inline editor. */
   private createTextAt(world: { x: number; y: number }): void {
      const style = this.store.elementStyle();
      const draft: CanvasElementModel = {
         id: `draft-${Date.now()}`,
         type: 'text',
         x: Math.round(world.x),
         y: Math.round(world.y),
         width: 4,
         height: style.fontSize,
         angle: 0,
         strokeColor: style.strokeColor ?? this.canvasView.defaultStroke(),
         fillStyle: style.fillStyle,
         strokeWidth: style.strokeWidth,
         strokeStyle: style.strokeStyle,
         opacity: style.opacity,
         zIndex: this.store.elements().length,
         text: '',
         fontSize: style.fontSize,
         fontFamily: style.fontFamily,
         textAlign: 'left',
      };
      this.tools.draft.set(draft);
      void this.drawTool.commitDraft(true);
   }

   /** Listen on the editor's host element for our own double-click detection. */
   attach(host: HTMLElement): void {
      // Double-click detection of our own. The browser only fires `dblclick` when both
      // clicks land on the same live DOM node, but the first click often re-renders the
      // item under the pointer (selection moves it between layers, slide placeholders
      // swap for their copies...), which silently swallows the native event. Two quick
      // presses close together count as a double-click wherever they land.
      let lastDown: { t: number; x: number; y: number } | null = null;
      let pending: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent): void => {
         if (e.button !== 0 || e.pointerType === 'touch') return;
         const now = performance.now();
         const near =
            lastDown && now - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
         pending = near ? { x: e.clientX, y: e.clientY } : null;
         lastDown = near ? null : { t: now, x: e.clientX, y: e.clientY };
      };
      const onUp = (e: PointerEvent): void => {
         const p = pending;
         pending = null;
         if (!p || e.button !== 0 || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 6) return;
         const canvas = this.viewport.canvasRef().nativeElement;
         const target = document.elementFromPoint(e.clientX, e.clientY);
         if (!target || !canvas.contains(target)) return;
         this.lastOwnDblClick = performance.now();
         this.handleDoubleClick(target, canvas, e.clientX, e.clientY);
      };
      // A native dblclick right after one we replayed is the same gesture: drop it
      // before it reaches item handlers (it would e.g. enter a group, then edit).
      const dedupeDbl = (e: MouseEvent): void => {
         if (
            !this.replayingDblClick &&
            performance.now() - this.lastOwnDblClick < 600 &&
            (e.target as Element | null)?.closest?.(CanvasDblClickService.SELF_DBLCLICK)
         ) {
            e.stopImmediatePropagation();
         }
      };
      host.addEventListener('dblclick', dedupeDbl, { capture: true });
      host.addEventListener('pointerdown', onDown, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      this.destroyRef.onDestroy(() => {
         host.removeEventListener('dblclick', dedupeDbl, { capture: true });
         host.removeEventListener('pointerdown', onDown, { capture: true });
         window.removeEventListener('pointerup', onUp, { capture: true });
      });
   }
}
