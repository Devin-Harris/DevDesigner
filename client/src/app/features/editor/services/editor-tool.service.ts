import { inject, signal, Injectable } from '@angular/core';
import { ToolbarPrefsService } from './toolbar-prefs.service';
import { PenPrefsService } from './pen-prefs.service';
import type { CanvasElementModel } from '@devdesigner/shared';
import { DEFAULT_FRAME_PRESET } from '../shared/constants/frame-presets';
import type { EditorTool } from '../models/editor-tool.model';
/** The active canvas tool, its options, and the element being drawn with it. */
@Injectable()
export class EditorToolService {
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
}
