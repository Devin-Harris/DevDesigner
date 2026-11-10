import { inject, signal, Injectable, computed } from '@angular/core';
import { ToolbarPrefsService } from './toolbar-prefs.service';
import { PenPrefsService } from './pen-prefs.service';
import type { CanvasElementModel } from '@devdesigner/shared';
import { DEFAULT_FRAME_PRESET } from '../shared/constants/frame-presets';
import type { EditorTool } from '../models/editor-tool.model';
import { ProjectStore } from '../state/project/project.store';
/** The active canvas tool, its options, and the element being drawn with it. */
@Injectable()
export class EditorToolService {
   private readonly store = inject(ProjectStore);
   private readonly toolbarPrefs = inject(ToolbarPrefsService);
   private readonly penPrefs = inject(PenPrefsService);

   /** The zoomed-out slide the current drawing gesture started in (its draft is drawn there). */
   readonly drawSlideId = signal<string | null>(null);

   // --- drawing tools / canvas elements ---

   /** The active tool. 'select' is the pointer mode; others draw that element. */
   readonly activeTool = signal<EditorTool>('select');

   /** Aspect-ratio preset new frames are drawn with (see frame-presets). */
   readonly framePresetId = signal<string>(DEFAULT_FRAME_PRESET);

   /** The element currently being drawn (local only until committed on pointer-up). */
   readonly draft = signal<CanvasElementModel | null>(null);

   /** After placing something: back to Select, unless the toolbar is set to stay on the tool. */
   afterPlace(): void {
      if (!this.toolbarPrefs.stayOnTool()) this.activeTool.set('select');
   }

   onToolChange(tool: EditorTool): void {
      if (tool === 'freedraw') this.penPrefs.eraser.set(false);
      this.activeTool.set(tool);
   }

   /** True while a pan gesture is active (hand tool, middle-mouse, or space-drag). */
   readonly panning = signal(false);

   /**
    * Canvas cursor driven by the active tool and pan state: a crosshair for the
    * drawing tools (Excalidraw-style), grab/grabbing for the hand/pan tool, and
    * the default pointer for select.
    */
   readonly canvasCursor = computed(() => {
      if (this.panning()) {
         return 'grabbing';
      }
      const tool = this.activeTool();
      if (tool === 'hand') {
         return 'grab';
      }
      if (tool === 'select') {
         return 'default';
      }
      if (tool === 'freedraw' && this.penPrefs.eraser()) {
         // A ring the size of the eraser's reach (browsers cap cursors at 128px).
         const d = Math.min(126, Math.max(6, Math.round(this.penPrefs.eraserSize())));
         const c = d / 2 + 1;
         return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${d + 2}' height='${d + 2}'%3E%3Ccircle cx='${c}' cy='${c}' r='${d / 2}' fill='rgba(255,255,255,0.35)' stroke='black' stroke-width='1'/%3E%3C/svg%3E") ${c} ${c}, cell`;
      }
      return 'crosshair';
   });

   readonly shapesInteractive = computed(() => this.activeTool() === 'select' && this.store.canEdit());
}
