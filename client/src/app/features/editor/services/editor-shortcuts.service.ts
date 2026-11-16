import { Injectable, inject, type Signal, type WritableSignal } from '@angular/core';
import { ERASER_MAX, ERASER_MIN, PEN_MAX, PEN_MIN } from '../models/pen-limits.constants';
import { PenPrefsService } from './pen-prefs.service';
import { presentationOf, presentationSlides } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import { CodeActionsService } from './code-actions.service';
import { GridTableService } from './grid-table.service';
import { deleteStandIn, detachFromLayout } from '../helpers/layout-placeholders';
import { frameContents } from '../helpers/frame-contents.helper';
import { PointerGestureService } from './pointer-gesture.service';
import { EditorToolService } from './editor-tool.service';
import { EditorViewportService } from './editor-viewport.service';
import type { EditorTool } from '../models/editor-tool.model';
/** What the shortcuts reach in the rest of the editor; the editor entry wires it with `connect`. */
export interface ShortcutsHost {
   readonly presentation: Signal<unknown>;
   readonly focusedDeck: Signal<string | null>;
   readonly focusScreen: Signal<'main' | 'design' | 'morph' | 'anim'>;
   readonly followingId: WritableSignal<string | null>;
   readonly selectedSlideSets: WritableSignal<string[]>;
   stepTransition(delta: number): void;
   selectedPresentationName(): string | null;
   startPresentation(from: 'start' | 'current'): Promise<void>;
   enterDeckFocus(name: string): void;
   exitDeckFocus(): void;
   closeFocusDesign(name: string): void;
   leaveFocusScreen(): void;
   copySelection(): void;
   duplicateAndDrag(): Promise<void>;
   handlePointerMove(event: PointerEvent): void;
   updateDraw(clientX: number, clientY: number, shift: boolean, alt: boolean): void;
   deletePresentation(name: string): void;
   focusFrame(id: string): void;
}

/**
 * Window keyboard handling for the editor: tool keys, undo/redo, arrange, group, copy, delete,
 * view keys and the focus-mode / presenting keys. The editor's host listeners forward here.
 */
@Injectable()
export class EditorShortcutsService {
   private readonly store = inject(ProjectStore);
   private readonly codeActions = inject(CodeActionsService);
   private readonly grids = inject(GridTableService);
   private readonly penPrefs = inject(PenPrefsService);
   private readonly viewport = inject(EditorViewportService);
   private readonly gesture = inject(PointerGestureService);
   private readonly tools = inject(EditorToolService);
   private host!: ShortcutsHost;

   connect(host: ShortcutsHost): void {
      this.host = host;
   }

   onKeyDown(event: KeyboardEvent): void {
      if (this.host.presentation()) {
         // The presenter owns the keyboard; nothing behind it may react.
         return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if (typing) {
         return;
      }
      // Transition screen: ← / → step to the previous / next slide pair.
      if (
         (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
         !event.ctrlKey &&
         !event.metaKey &&
         !event.altKey &&
         !event.shiftKey &&
         this.host.focusedDeck() &&
         this.host.focusScreen() === 'morph'
      ) {
         event.preventDefault();
         this.host.stepTransition(event.key === 'ArrowLeft' ? -1 : 1);
         return;
      }
      if (event.key === 'F5') {
         // Only with a presentation selected; otherwise the browser's reload runs as usual.
         const name = this.host.selectedPresentationName();
         if (name) {
            // Present from the beginning; Shift+F5 from the current slide (as in PowerPoint).
            event.preventDefault();
            this.store.selectPresentation(name);
            void this.host.startPresentation(event.shiftKey ? 'current' : 'start');
         }
         return;
      }
      if (event.key === ' ') {
         this.gesture.spaceDown = true;
         event.preventDefault();
         return;
      }
      // Shift+F: focus the selected presentation (or leave focus mode).
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'KeyF') {
         const name =
            this.host.focusedDeck() ?? this.host.selectedSlideSets()[0] ?? this.host.selectedPresentationName();
         if (name) {
            event.preventDefault();
            if (this.host.focusedDeck()) this.host.exitDeckFocus();
            else this.host.enterDeckFocus(name);
            return;
         }
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && (event.code === 'Digit1' || event.code === 'Digit2')) {
         event.preventDefault();
         if (event.code === 'Digit1') this.viewport.zoomToFit();
         else this.viewport.zoomToSelection();
         return;
      }
      if (event.key === 'Home') {
         this.viewport.resetView();
         event.preventDefault();
         return;
      }
      if (event.key === 'Escape') {
         if (this.host.followingId()) {
            this.host.followingId.set(null);
            return;
         }
         if (this.tools.activeTool() === 'select' && this.host.focusedDeck()) {
            if (this.host.focusScreen() === 'design') this.host.closeFocusDesign(this.host.focusedDeck()!);
            else if (this.host.focusScreen() !== 'main') this.host.leaveFocusScreen();
            else this.host.exitDeckFocus();
            return;
         }
         this.tools.activeTool.set('select');
         return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
         if (this.store.canEdit()) {
            event.preventDefault();
            if (event.shiftKey) {
               this.store.redoElement();
            } else {
               this.store.undoElement();
            }
         }
         return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
         if (this.store.canEdit()) {
            event.preventDefault();
            this.store.redoElement();
         }
         return;
      }
      if (mod && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
         // Ctrl+[ / ] steps the selection back / forward one layer; Shift goes all the way.
         event.preventDefault();
         if (this.store.canEdit()) {
            const forward = event.code === 'BracketRight';
            this.store.arrangeSelection(
               event.shiftKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward'
            );
         }
         return;
      }
      if (event.shiftKey && event.altKey && !mod && event.code === 'KeyS') {
         // Fit the selected code blocks to their content.
         event.preventDefault();
         if (this.store.canEdit()) {
            void this.codeActions.fitToContent(this.store.selectedElementIds());
         }
         return;
      }
      if (event.shiftKey && event.altKey && !mod && event.code === 'KeyF') {
         // Format the selected code blocks.
         event.preventDefault();
         if (this.store.canEdit()) {
            void this.codeActions.format(this.store.selectedElementIds());
         }
         return;
      }
      if (mod && event.key.toLowerCase() === 'g') {
         // Group / ungroup the selection (also stops the browser's find-next).
         event.preventDefault();
         if (this.store.canEdit()) {
            if (event.shiftKey) {
               void this.store.ungroupSelection();
            } else {
               void this.store.groupSelection();
            }
         }
         return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
         this.host.copySelection();
         return;
      }
      if (mod && event.key.toLowerCase() === 'v') {
         // Handled by the window `paste` event, which also sees system-clipboard images.
         return;
      }
      // Shift/Alt pressed or released mid-draw re-applies the constraint immediately.
      if (event.key === 'Alt' && (this.gesture.mode === 'element' || this.gesture.mode === 'node')) {
         event.preventDefault();
         void this.host.duplicateAndDrag();
         return;
      }
      if (event.key === 'Shift' && (this.gesture.mode === 'element' || this.gesture.mode === 'node')) {
         this.gesture.shiftHeld = true;
         if (this.gesture.lastPointer) {
            this.host.handlePointerMove(this.gesture.lastPointer);
         }
         return;
      }
      if (this.gesture.mode === 'draw' && (event.key === 'Shift' || event.key === 'Alt')) {
         event.preventDefault(); // keep Alt from focusing the browser menu
         this.host.updateDraw(
            this.gesture.lastDrawPointer.x,
            this.gesture.lastDrawPointer.y,
            event.key === 'Shift' ? true : event.shiftKey,
            event.key === 'Alt' ? true : event.altKey
         );
         return;
      }
      // Keys on a table's cell selection: Delete clears the cells, Enter/F2 edits, Esc drops back to the table.
      const cells = this.grids.range();
      if (cells && mod && event.key.toLowerCase() === 'm' && this.store.canEdit()) {
         event.preventDefault();
         void (this.grids.canMerge() ? this.grids.mergeSelected() : this.grids.unmergeSelected());
         return;
      }
      if (cells && !mod) {
         if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.canEdit()) {
            event.preventDefault();
            void this.grids.clearSelectedText();
            return;
         }
         if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            this.grids.beginEdit({ id: cells.id, row: cells.r0, col: cells.c0 });
            return;
         }
         if (event.key === 'Escape') {
            event.preventDefault();
            this.grids.clearCellSelection();
            return;
         }
      }
      if (!mod && !event.altKey && (event.key === '[' || event.key === ']') && this.tools.activeTool() === 'freedraw') {
         // [ / ]: shrink / grow the pen or eraser.
         event.preventDefault();
         const up = event.key === ']';
         if (this.penPrefs.eraser()) {
            const v = this.penPrefs.eraserSize();
            this.penPrefs.eraserSize.set(
               Math.min(ERASER_MAX, Math.max(ERASER_MIN, Math.round(up ? v * 1.25 + 1 : v / 1.25 - 1)))
            );
         } else {
            const v = this.penPrefs.width();
            const next = Math.round((up ? v * 1.25 + 0.5 : v / 1.25 - 0.5) * 2) / 2;
            this.penPrefs.width.set(Math.min(PEN_MAX, Math.max(PEN_MIN, next)));
         }
         return;
      }
      if (!mod && !event.altKey && event.key.toLowerCase() === 'x' && this.store.canEdit()) {
         // X: the pen's eraser (switches to the pen if another tool is active).
         event.preventDefault();
         if (this.tools.activeTool() !== 'freedraw') {
            this.tools.activeTool.set('freedraw');
            this.penPrefs.eraser.set(true);
         } else {
            this.penPrefs.eraser.update((v) => !v);
         }
         return;
      }
      const tool = mod || event.altKey ? undefined : EditorShortcutsService.TOOL_SHORTCUTS[event.key.toLowerCase()];
      // P always means the pen itself, so it leaves the eraser.
      if (tool === 'freedraw') this.penPrefs.eraser.set(false);
      // The laser pointer is a presenting tool, so view-only guests may use it too.
      if (tool && (this.store.canEdit() || tool === 'laser')) {
         // Pressing a shape / line key again cycles through its family (R → O → D, A → L).
         const cur = this.tools.activeTool();
         const family = EditorShortcutsService.TOOL_CYCLES.find((f) => f.includes(tool));
         if (family && family.includes(cur) && !event.repeat) {
            this.tools.activeTool.set(family[(family.indexOf(cur) + 1) % family.length]);
         } else {
            this.tools.activeTool.set(tool);
         }
         return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.canEdit()) {
         const sets = this.host.selectedSlideSets();
         if (sets.length) {
            event.preventDefault();
            const shown = this.store.shownByPresentation();
            const frameIds = new Set(sets.map((set) => shown.get(set)));
            const rest = this.store.selectedElementIds().filter((id) => !frameIds.has(id));
            const others = [
               [...this.store.selectedTableIds()],
               [...this.store.selectedRelationshipIds()],
               [...this.store.selectedMessageIds()],
               [...this.store.selectedLifelineIds()],
               [...this.store.selectedDiagramIds()],
            ];
            this.host.selectedSlideSets.set([]);
            for (const set of sets) this.host.deletePresentation(set);
            this.store.setSelection(others[0], others[1], rest, others[2], others[3], others[4]);
            if (
               !rest.length &&
               !this.store.selectedTableIds().length &&
               !this.store.selectedRelationshipIds().length &&
               !this.store.selectedMessageIds().length &&
               !this.store.selectedLifelineIds().length &&
               !this.store.selectedDiagramIds().length
            ) {
               return;
            }
         }
         const relIds = [...this.store.selectedRelationshipIds()];
         const tableIds = [...this.store.selectedTableIds()];
         const elementIds = [...this.store.selectedElementIds()];
         const lifelineIds = [...this.store.selectedLifelineIds()];
         const messageIds = [...this.store.selectedMessageIds()];
         const diagramId = this.store.selectedDiagramIds().length > 0;
         if (
            relIds.length ||
            tableIds.length ||
            elementIds.length ||
            lifelineIds.length ||
            messageIds.length ||
            diagramId
         ) {
            event.preventDefault();
            this.deleteSelection();
         }
      }
   }

   /**
    * Delete everything selected. Deleting a frame also deletes what sits inside it
    * (elements, tables and sequence diagrams), so a frame removes its whole page.
    */
   deleteSelection(): void {
      if (!this.store.canEdit()) {
         return;
      }
      const relIds = [...this.store.selectedRelationshipIds()];
      const tableIds = new Set(this.store.selectedTableIds());
      const elementIds = new Set(this.store.selectedElementIds());
      const lifelineIds = [...this.store.selectedLifelineIds()];
      const messageIds = [...this.store.selectedMessageIds()];
      const diagramIds = new Set<string>();
      this.store.selectedDiagramIds().forEach((id) => diagramIds.add(id));
      const inner = frameContents(
         elementIds,
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages(),
         this.store.shownSlideIds()
      );
      inner.elementIds.forEach((id) => elementIds.add(id));
      inner.tableIds.forEach((id) => tableIds.add(id));
      inner.diagramIds.forEach((id) => diagramIds.add(id));

      // Slides using a deleted layout keep its look: its items are copied onto them first.
      const layouts = this.store.slideFrames().filter((f) => f.slide?.layout && elementIds.has(f.id));
      // A deck losing its shown slide shows the nearest surviving one: the slide above, else below.
      const nextShown: string[] = [];
      for (const shownId of this.store.shownSlideIds()) {
         if (!elementIds.has(shownId)) continue;
         const frame = this.store.slideFrames().find((f) => f.id === shownId);
         if (!frame || frame.slide?.layout) continue;
         const list = presentationSlides(this.store.slideFrames(), presentationOf(frame));
         const at = list.findIndex((f) => f.id === shownId);
         const up = list
            .slice(0, Math.max(0, at))
            .reverse()
            .find((f) => !elementIds.has(f.id));
         const down = list.slice(at + 1).find((f) => !elementIds.has(f.id));
         const pick = up ?? down;
         if (pick) nextShown.push(pick.id);
      }
      const activeDeck = this.store.presentation();
      void this.store
         .batchHistory(async () => {
            // Slides deleted along with the layout need no copy of its look.
            for (const l of layouts) await detachFromLayout(this.store, l, elementIds);
            const jobs: unknown[] = [];
            relIds.forEach((id) => jobs.push(this.store.deleteRelationship(id)));
            tableIds.forEach((id) => jobs.push(this.store.deleteTable(id)));
            elementIds.forEach((id) => {
               // A slide's or layout's copy of a master item stays as a marker deleting it there
               // (unless its frame goes too).
               const el = this.store.elements().find((e) => e.id === id);
               const keepMarker = !!el?.overrides && !(el.slideId && elementIds.has(el.slideId));
               jobs.push(keepMarker ? deleteStandIn(this.store, el!) : this.store.deleteElement(id));
            });
            diagramIds.forEach((id) => jobs.push(this.store.deleteSequence(id)));
            if (!diagramIds.size) {
               messageIds.forEach((id) => jobs.push(this.store.deleteMessage(id)));
               lifelineIds.forEach((id) => jobs.push(this.store.deleteLifeline(id)));
            }
            await Promise.all(jobs);
         })
         .then(() => {
            if (!nextShown.length) return;
            for (const id of nextShown) this.store.setActiveSlide(id);
            // Keep the deck the user was working in selected, with its new slide highlighted.
            const mine = nextShown.find((id) => {
               const f = this.store.slideFrames().find((x) => x.id === id);
               return !!f && presentationOf(f) === activeDeck;
            });
            if (mine) this.host.focusFrame(mine);
         });
   }

   /** Single-key tool shortcuts (Excalidraw-style). */
   private static readonly TOOL_SHORTCUTS: Record<string, EditorTool> = {
      v: 'select',
      h: 'hand',
      e: 'table',
      r: 'rectangle',
      o: 'ellipse',
      d: 'diamond',
      a: 'arrow',
      l: 'line',
      t: 'text',
      p: 'freedraw',
      f: 'frame',
      s: 'slide',
      c: 'code',
      g: 'grid',
      k: 'laser',
      q: 'sequence',
   };

   /** Tool families a repeated shortcut cycles through. */
   private static readonly TOOL_CYCLES: readonly (readonly EditorTool[])[] = [
      ['rectangle', 'ellipse', 'diamond'],
      ['arrow', 'line'],
   ];

   onKeyUp(event: KeyboardEvent): void {
      if (event.key === ' ') {
         this.gesture.spaceDown = false;
      }
      if (event.key === 'Shift') {
         this.gesture.shiftHeld = false;
         if ((this.gesture.mode === 'element' || this.gesture.mode === 'node') && this.gesture.lastPointer) {
            this.host.handlePointerMove(this.gesture.lastPointer);
         }
      }
      if (this.gesture.mode === 'draw' && (event.key === 'Shift' || event.key === 'Alt')) {
         this.host.updateDraw(
            this.gesture.lastDrawPointer.x,
            this.gesture.lastDrawPointer.y,
            event.key === 'Shift' ? false : event.shiftKey,
            event.key === 'Alt' ? false : event.altKey
         );
      }
   }
}
