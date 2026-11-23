import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { FrameScrollService } from './frame-scroll.service';
import type { CanvasElementModel } from '@devdesigner/shared';
import { EditorActionsService, type ExportImageFormat } from '../../../core/editor-bridge/editor-actions.service';
import { ProjectFileService } from '../../../shared/services/project-file.service';
import { ProjectsStore } from '../../../shared/state/projects/projects.store';
import { ProjectStore } from '../state/project/project.store';
import { CanvasViewService } from './canvas-view.service';
import { EditorViewportService } from './editor-viewport.service';
import { CodeActionsService } from './code-actions.service';
import { MediaActionsService } from './media-actions.service';
import { GridTableService } from './grid-table.service';
import { tableBox } from '../helpers/element-geometry.helper';
import { sequenceDiagramBox } from '../helpers/frame-contents.helper';
import type { CanvasContextMenu, ContextMenuEntry } from '../models/context-menu.model';

/** Editor actions that live in sub-features; the editor entry wires them with `connect`. */
export interface CanvasContextMenuHost {
   copySelection(): void;
   pasteClipboard(): Promise<void>;
   hasClipboard(): boolean;
   isEditingText(): boolean;
}

type Hit = { kind: 'element'; el: CanvasElementModel } | { kind: 'table'; id: string } | { kind: 'diagram'; id: string };

const inBox = (b: { x0: number; y0: number; x1: number; y1: number } | null, p: { x: number; y: number }): boolean =>
   !!b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

/**
 * The canvas right-click menu: picks the item under the pointer (keeping the selection
 * when it is already part of it) and offers the actions that suit what is selected.
 * Ctrl+Shift+E opens the same menu with just the export formats.
 */
@Injectable()
export class CanvasContextMenuService {
   private readonly frameScroll = inject(FrameScrollService);
   private readonly store = inject(ProjectStore);
   private readonly canvasView = inject(CanvasViewService);
   private readonly viewport = inject(EditorViewportService);
   private readonly codeActions = inject(CodeActionsService);
   private readonly mediaActions = inject(MediaActionsService);
   private readonly grids = inject(GridTableService);
   private readonly editorActions = inject(EditorActionsService);
   private readonly projectFile = inject(ProjectFileService);
   private readonly projects = inject(ProjectsStore);

   readonly menu$ = signal<CanvasContextMenu | null>(null);
   private host!: CanvasContextMenuHost;
   private lastPointer: { x: number; y: number } | null = null;

   constructor() {
      const track = (e: PointerEvent): void => {
         this.lastPointer = { x: e.clientX, y: e.clientY };
      };
      window.addEventListener('pointermove', track, { passive: true });
      inject(DestroyRef).onDestroy(() => window.removeEventListener('pointermove', track));
   }

   connect(host: CanvasContextMenuHost): void {
      this.host = host;
   }

   close(): void {
      this.menu$.set(null);
   }

   /** Right-click on the canvas. Text being edited keeps the browser's own menu. */
   onContextMenu(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || this.host.isEditingText()) {
         return;
      }
      event.preventDefault();
      const hit = this.hitAt(event.clientX, event.clientY);
      if (hit) this.selectHit(hit);
      else this.store.clearSelection();
      const items = hit ? this.selectionItems() : this.canvasItems();
      this.menu$.set({ x: event.clientX, y: event.clientY, items });
   }

   /** Ctrl+Shift+E: choose an export format for the selection (or the whole project). */
   openExportMenu(): void {
      const canvasRect = this.viewport.canvasRect();
      const p =
         this.lastPointer &&
         inBox({ x0: canvasRect.left, y0: canvasRect.top, x1: canvasRect.right, y1: canvasRect.bottom }, this.lastPointer)
            ? this.lastPointer
            : { x: canvasRect.left + canvasRect.width / 2, y: canvasRect.top + canvasRect.height / 2 };
      this.menu$.set({ x: p.x, y: p.y, title: this.hasSelection() ? 'Export selection' : 'Export', items: this.exportItems() });
   }

   // --- hit testing ---

   private hitAt(clientX: number, clientY: number): Hit | null {
      const world = this.viewport.toWorld(clientX, clientY);
      const elements = this.canvasView.shownElements();
      for (let i = elements.length - 1; i >= 0; i--) {
         const e = elements[i];
         if (e.type !== 'frame' && this.frameScroll.hits(e, world)) return { kind: 'element', el: e };
      }
      const tables = this.store.tables();
      for (let i = tables.length - 1; i >= 0; i--) {
         if (inBox(tableBox(tables[i]), world)) return { kind: 'table', id: tables[i].id };
      }
      const lifelines = this.store.lifelines();
      const messages = this.store.sequenceMessages();
      for (const d of this.store.sequenceDiagrams()) {
         if (inBox(sequenceDiagramBox(d, lifelines, messages), world)) return { kind: 'diagram', id: d.id };
      }
      for (let i = elements.length - 1; i >= 0; i--) {
         const e = elements[i];
         if (e.type === 'frame' && this.frameScroll.hits(e, world)) return { kind: 'element', el: e };
      }
      return null;
   }

   private selectHit(hit: Hit): void {
      switch (hit.kind) {
         case 'element':
            if (!this.store.selectedElementIds().includes(hit.el.id)) this.store.selectElement(hit.el.id);
            break;
         case 'table':
            if (!this.store.selectedTableIds().includes(hit.id)) this.store.selectTable(hit.id);
            break;
         case 'diagram':
            if (!this.store.selectedDiagramIds().includes(hit.id)) this.store.selectSequence(hit.id);
            break;
      }
   }

   private hasSelection(): boolean {
      return (
         this.store.selectedElementIds().length +
            this.store.selectedTableIds().length +
            this.store.selectedDiagramIds().length >
         0
      );
   }

   // --- menus ---

   private selectionItems(): ContextMenuEntry[] {
      const edit = this.store.canEdit();
      const elIds = new Set(this.store.selectedElementIds());
      const els = this.store.elements().filter((e) => elIds.has(e.id));
      const count = els.length + this.store.selectedTableIds().length + this.store.selectedDiagramIds().length;
      const only = (type: CanvasElementModel['type']): boolean =>
         els.length > 0 && els.length === count && els.every((e) => e.type === type);
      const single = count === 1 ? els[0] : undefined;
      const items: ContextMenuEntry[] = [];

      if (only('code') && edit) {
         const ids = els.map((e) => e.id);
         const allCollapsed = els.every((e) => e.expandedHeight != null);
         items.push(
            { label: 'Format', icon: 'code', kbd: 'Shift+Alt+F', run: () => void this.codeActions.format(ids) },
            { label: 'Fit to content', icon: 'fit_screen', kbd: 'Shift+Alt+S', run: () => void this.codeActions.fitToContent(ids) },
            {
               label: allCollapsed ? 'Expand' : 'Collapse',
               icon: allCollapsed ? 'unfold_more' : 'unfold_less',
               run: () => {
                  for (const e of els) if ((e.expandedHeight != null) === allCollapsed) void this.codeActions.toggleCollapsed(e.id);
               },
            }
         );
      }
      if (single?.type === 'image' && edit) {
         items.push({ label: 'Crop', icon: 'crop', run: () => this.mediaActions.startCrop(single.id) });
         if (single.media?.clip) {
            items.push({ label: 'Release clip', icon: 'crop_free', run: () => void this.mediaActions.releaseClip(single.id) });
         }
      }
      if (single?.type === 'grid' && edit) {
         items.push({ label: 'Fit all columns', icon: 'fit_screen', run: () => this.grids.autoFitAll(single.id) });
      }
      if (single?.type === 'frame') {
         const id = single.id;
         items.push(
            { heading: 'Export frame' },
            ...(['png', 'svg', 'pdf'] as const).map((f) => ({
               label: f.toUpperCase(),
               icon: f === 'pdf' ? 'picture_as_pdf' : 'image',
               run: () => this.editorActions.exportFrame(id, f),
            }))
         );
      }
      const diagramIds = this.store.selectedDiagramIds();
      if (edit && diagramIds.length > 0 && diagramIds.length === count) {
         items.push(
            {
               label: 'Space messages evenly',
               icon: 'vertical_distribute',
               run: () => diagramIds.forEach((id) => this.store.spaceSequenceEvenly(id)),
            },
            {
               label: 'Fit to content',
               icon: 'fit_screen',
               run: () => diagramIds.forEach((id) => this.store.fitSequenceToContent(id)),
            }
         );
      }
      if (items.length) items.push({ sep: true });

      items.push({ label: 'Copy', icon: 'content_copy', kbd: 'Ctrl+C', run: () => this.host.copySelection() });
      if (edit) {
         if (this.host.hasClipboard()) {
            items.push({ label: 'Paste', icon: 'content_paste', kbd: 'Ctrl+V', run: () => void this.host.pasteClipboard() });
         }
         items.push(
            {
               label: 'Duplicate',
               icon: 'library_add',
               run: () => {
                  this.host.copySelection();
                  void this.host.pasteClipboard();
               },
            }
         );
         if (els.length > 0) {
            items.push(
               { sep: true },
               { label: 'Bring to front', icon: 'flip_to_front', kbd: 'Ctrl+Shift+]', run: () => this.store.arrangeSelection('front') },
               { label: 'Bring forward', icon: 'bring_forward', kbd: 'Ctrl+]', run: () => this.store.arrangeSelection('forward') },
               { label: 'Send backward', icon: 'send_backward', kbd: 'Ctrl+[', run: () => this.store.arrangeSelection('backward') },
               { label: 'Send to back', icon: 'flip_to_back', kbd: 'Ctrl+Shift+[', run: () => this.store.arrangeSelection('back') }
            );
         }
         const grouped =
            els.some((e) => e.groupId) ||
            this.store.tables().some((t) => t.groupId && this.store.selectedTableIds().includes(t.id)) ||
            this.store.sequenceDiagrams().some((d) => d.groupId && this.store.selectedDiagramIds().includes(d.id));
         if (count > 1 || grouped) items.push({ sep: true });
         if (count > 1) items.push({ label: 'Group', icon: 'group_work', kbd: 'Ctrl+G', run: () => void this.store.groupSelection() });
         if (grouped) {
            items.push({ label: 'Ungroup', icon: 'workspaces', kbd: 'Ctrl+Shift+G', run: () => void this.store.ungroupSelection() });
         }
      }
      items.push({ sep: true }, { heading: 'Export selection' }, ...this.exportItems());
      if (edit) {
         items.push(
            { sep: true },
            { label: 'Delete', icon: 'delete', kbd: 'Del', danger: true, run: () => this.editorActions.deleteSelection() }
         );
      }
      return items;
   }

   private canvasItems(): ContextMenuEntry[] {
      const items: ContextMenuEntry[] = [];
      if (this.store.canEdit() && this.host.hasClipboard()) {
         items.push({ label: 'Paste', icon: 'content_paste', kbd: 'Ctrl+V', run: () => void this.host.pasteClipboard() }, { sep: true });
      }
      items.push(
         { heading: 'Export' },
         ...this.exportItems(),
         { sep: true },
         { label: 'Reload', icon: 'sync', kbd: 'Ctrl+R', run: () => location.reload() }
      );
      return items;
   }

   private downloadProject(): void {
      const id = this.store.projectId();
      if (id) void this.projectFile.download(id, this.projects.selected()?.name ?? 'project');
   }

   /** Export formats; each covers the selection when there is one, else the whole project. */
   private exportItems(): ContextMenuEntry[] {
      const image = (format: ExportImageFormat, label: string, icon: string): ContextMenuEntry => ({
         label,
         icon,
         run: () => this.editorActions.exportImage(format),
      });
      const items: ContextMenuEntry[] = [
         image('png', 'PNG image', 'image'),
         image('svg', 'SVG image', 'image'),
         image('pdf', 'PDF', 'picture_as_pdf'),
         this.hasSelection()
            ? { label: 'JSON (selection)', icon: 'download', run: () => this.editorActions.exportSelectionFile() }
            : { label: 'JSON (project file)', icon: 'download', run: () => this.downloadProject() },
      ];
      if (this.store.tables().length > 0 && this.editorActions.canExportSql$()) {
         items.push({ label: 'SQL', icon: 'description', run: () => this.editorActions.exportSql() });
      }
      return items;
   }
}
