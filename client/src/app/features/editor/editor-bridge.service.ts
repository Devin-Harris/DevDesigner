import { isSandboxId } from '../../core/sandbox/sandbox-backend.service';
import { EditorToolService } from './services/editor-tool.service';
import { SlidePlacementService } from './features/slides/services/slide-placement.service';
import { DeckFocusService } from './features/slides/services/deck-focus.service';
import { SlideshowService } from './features/slides/services/slideshow.service';
import { FollowService } from './features/collaboration/services/follow.service';
import { EditorViewportService } from './services/editor-viewport.service';
import { EditorExportService } from './features/export/services/editor-export.service';
import { EditorShortcutsService } from './services/editor-shortcuts.service';
import { DestroyRef, computed, inject, Injectable, effect } from '@angular/core';
import type { CanvasItemRef } from '../../core/editor-bridge/editor-actions.service';
import { MatDialog } from '@angular/material/dialog';
import { presentationOf, presentationSlides } from '@devdesigner/shared';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { type DeckSummary, EditorActionsService } from '../../core/editor-bridge/editor-actions.service';
import { ProjectStore } from './state/project/project.store';
import { ShareDialogComponent } from './features/share-dialog/share-dialog.component';
import type { EditorTool } from './models/editor-tool.model';
/**
 * The mounted editor's side of the app bridge (part of the editor entry): registers its actions
 * and state with `EditorActionsService` for the top bar, Presentations menu and command palette,
 * and joins the realtime room, taking peers' changes into this editor's store.
 */
@Injectable()
export class EditorBridgeService {
   private readonly store = inject(ProjectStore);
   private readonly dialog = inject(MatDialog);
   private readonly realtime = inject(RealtimeService);
   private readonly editorActions = inject(EditorActionsService);
   private readonly destroyRef = inject(DestroyRef);
   private readonly viewport = inject(EditorViewportService);
   private readonly slideshow = inject(SlideshowService);
   private readonly exporter = inject(EditorExportService);
   private readonly placement = inject(SlidePlacementService);
   private readonly shortcuts = inject(EditorShortcutsService);
   private readonly deckFocus = inject(DeckFocusService);
   private readonly follow = inject(FollowService);
   private readonly tools = inject(EditorToolService);

   constructor() {
      // Join / re-join the realtime room whenever the loaded project changes.
      effect(() => {
         const id = this.store.projectId();
         // Guide sandboxes live only in this browser: no realtime room.
         if (id && !isSandboxId(id)) {
            this.realtime.connect(id);
         }
      });
      // Broadcast this participant's selection so others see what is being edited (only with
      // someone in the room; it re-sends when a peer joins).
      effect(() => {
         if (!this.realtime.hasPeers()) return;
         const tableIds = this.store.selectedTableIds();
         const relationshipIds = this.store.selectedRelationshipIds();
         this.realtime.sendSelection(tableIds, relationshipIds);
      });
      this.realtime.setMutationSink(this.store);
      this.destroyRef.onDestroy(() => {
         this.realtime.disconnect();
         this.realtime.setMutationSink(null);
      });
      // Expose Export/Share to the global top bar while this editor is mounted.
      this.editorActions.register({
         share: () => this.openShare(),
         exportSql: () => this.exporter.openSqlExport(),
         exportImage: (format) => void this.exporter.onExportImage(format),
         exportFramesPdf: () => void this.exporter.exportAllFramesPdf(),
         exportSlidesPdf: () => void this.exporter.exportAllSlidesPdf(),
         exportSelectionFile: () => void this.exporter.exportSelectionFile(),
         importFile: (file) => this.placement.importProjectFile(file),
         deleteSelection: () => this.shortcuts.deleteSelection(),
         focusDeck: (name) => this.deckFocus.focusDeck(name),
         enterDeckFocus: (name) => this.deckFocus.enterDeckFocus(name),
         exitDeckFocus: () => this.deckFocus.exitDeckFocus(),
         jumpToParticipant: (id) => this.follow.jumpToParticipant(id),
         followParticipant: (id) => this.follow.followingId.set(id),
         addFrameToPresentation: (id, deck) => void this.placement.addFrameToPresentation(id, deck),
         exportFrame: (id, format) => this.exporter.exportOneFrame(id, format),
         presentDeck: (name) => this.deckFocus.presentDeck(name),
         followPresenter: (id) => void this.slideshow.followPresenter(id),
         newDeck: () => this.tools.onToolChange('slide'),
         setTool: (tool) => this.tools.onToolChange(tool as EditorTool),
         resetView: () => this.viewport.resetView(),
         setHome: () => this.viewport.setHome(),
         canvasItems: () => this.paletteItems(),
         jumpTo: (item) => this.jumpToItem(item),
         undo: () => this.store.undoElement(),
         redo: () => this.store.redoElement(),
      });
      // The app chrome (top bar, Presentations menu, palette) reads this editor's state.
      this.editorActions.registerState({
         canExportSql: this.canExportSql$,
         hasTableSelection: this.hasTableSelection$,
         hasSelection: this.hasSelection$,
         presentationName: this.store.presentation,
         hasPlainFrames: this.hasPlainFrames$,
         decks: this.deckSummaries$,
         focusedDeck: this.deckFocus.focusedDeck,
         following: this.follow.followingId,
         projectId: this.store.projectId,
         accessMode: this.store.accessMode,
         canEdit: this.store.canEdit,
         canUndo: this.store.canUndo,
         canRedo: this.store.canRedo,
      });
      this.destroyRef.onDestroy(() => this.editorActions.clear());
   }

   /** Open the owner share dialog (create/list/revoke VIEW/EDIT links). */
   openShare(): void {
      const projectId = this.store.projectId();
      if (!projectId || this.store.accessMode() !== 'OWNER') {
         return;
      }
      this.dialog.open(ShareDialogComponent, {
         width: '560px',
         maxWidth: '92vw',
         data: { projectId },
      });
   }

   /** Canvas items the command palette can search and jump to. */
   paletteItems(): CanvasItemRef[] {
      const items: CanvasItemRef[] = this.store.tables().map((t) => ({ kind: 'table', id: t.id, label: t.name }));
      for (const e of this.store.elements()) {
         if (e.type === 'code') {
            const first = (e.text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
            items.push({ kind: 'code', id: e.id, label: e.fileName || first.trim().slice(0, 60) || 'Code block' });
         } else if (e.type === 'text' && e.text?.trim()) {
            items.push({ kind: 'text', id: e.id, label: e.text.trim().split(/\r?\n/)[0].slice(0, 60) });
         } else if (e.type === 'frame' && !e.slide && e.text?.trim()) {
            items.push({ kind: 'frame', id: e.id, label: e.text.trim() });
         }
      }
      for (const d of this.store.sequenceDiagrams()) {
         items.push({ kind: 'sequence', id: d.id, label: d.title || 'Sequence diagram' });
      }
      return items;
   }

   /** Select a palette item and centre it in view. */
   jumpToItem(item: CanvasItemRef): void {
      if (item.kind === 'table') {
         const t = this.store.tables().find((x) => x.id === item.id);
         if (!t) return;
         this.store.setSelection([t.id], [], []);
         this.viewport.panToWorld({ x: t.x + 120, y: t.y + 60 });
      } else if (item.kind === 'sequence') {
         const d = this.store.sequenceDiagrams().find((x) => x.id === item.id);
         if (!d) return;
         const xs = this.store
            .lifelines()
            .filter((l) => l.diagramId === d.id)
            .map((l) => l.x);
         this.store.setSelection([], [], [], [], [], [d.id]);
         if (xs.length) {
            this.viewport.panToWorld({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: d.originY + 160 });
         }
      } else {
         const e = this.store.elements().find((x) => x.id === item.id);
         if (!e) return;
         this.store.setSelection([], [], [e.id]);
         this.viewport.panToWorld({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
      }
   }

   /** Every presentation with its slide count and current presenter (top-right Presentations menu). */
   private readonly deckSummaries$ = computed<DeckSummary[]>(() => {
      const frames = this.store.slideFrames();
      const presenters = this.slideshow.presenters();
      return this.store.presentations().map((name) => {
         const p = presenters.find((x) => {
            const f = frames.find((fr) => fr.id === x.presenting?.frameId);
            return !!f && presentationOf(f) === name;
         });
         return {
            name,
            slides: presentationSlides(frames, name).length,
            presenter: p ? { id: p.id, name: p.name, color: p.color } : null,
         };
      });
   });

   private readonly hasTableSelection$ = computed(() => this.store.selectedTableIds().length > 0);

   /** SQL needs unique table names within the exported scope (selection or whole diagram). */
   private readonly canExportSql$ = computed(() => {
      const selected = this.store.selectedTableIds();
      const tables = this.store.tables();
      const scope = selected.length ? tables.filter((t) => selected.includes(t.id)) : tables;
      const names = scope.map((t) => t.name.trim().toLowerCase());
      return new Set(names).size === names.length;
   });

   /** The export menu offers plain frames apart from the selected presentation's slides. */
   private readonly hasPlainFrames$ = computed(() => this.store.elements().some((e) => e.type === 'frame' && !e.slide));

   private readonly hasSelection$ = computed(
      () =>
         this.store.selectedTableIds().length > 0 ||
         this.store.selectedElementIds().length > 0 ||
         this.store.selectedMessageIds().length > 0 ||
         this.store.selectedLifelineIds().length > 0 ||
         this.store.selectedDiagramIds().length > 0
   );
}
