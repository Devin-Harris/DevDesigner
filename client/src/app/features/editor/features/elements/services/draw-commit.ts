import type { CanvasElementModel, CreateElementDto } from '@devdesigner/shared';
import { parseGrid } from '../../../helpers/grid-table.helper';
import { framePreset } from '../../../shared/constants/frame-presets';
import { absolutePoints } from '../../../helpers/element-geometry.helper';
import type { DrawToolService } from './draw-tool.service';

/** Turning a finished draw draft into a saved element (draw-tool.service). */
export class DrawCommit {
   constructor(private readonly host: DrawToolService) {}

   /**
    * Persist the draft as a real element. Tiny click-only shapes get a sensible
    * default size so a single click still produces a visible element.
    */
   async commitDraft(selectAfter: boolean): Promise<void> {
      const draft = this.host.tools.draft();
      this.host.tools.draft.set(null);
      const drawSlide = this.host.tools.drawSlideId();
      this.host.tools.drawSlideId.set(null);
      if (this.host.sequenceDraw) {
         this.host.commitSequenceDraw(draft);
         return;
      }
      if (!draft) {
         return;
      }
      const dto = this.draftToDto(draft);
      if (drawSlide && draft.type !== 'frame') {
         dto.slideId = drawSlide;
      }
      // Auto-bind an arrow/line whose endpoint was drawn on top of a shape or table,
      // so it behaves as a flowchart connector and re-routes when the target moves.
      if ((draft.type === 'arrow' || draft.type === 'line') && draft.points?.length) {
         const pts = absolutePoints(draft);
         const start = this.host.elementGestures.bindingTargetAt(pts[0], draft.id);
         // Ctrl/Cmd on release leaves the end free (e.g. pointing at text inside a shape).
         const end = this.host.gesture.noBindHeld
            ? null
            : this.host.elementGestures.bindingTargetAt(pts[pts.length - 1], draft.id);
         if (start) {
            dto.startBinding = start.binding;
         }
         if (end) {
            dto.endBinding = end.binding;
         }
      }
      // Freehand strokes keep the pen active (draw several in a row) and are not
      // selected, so no bounds/toolbar pop up between strokes. Shapes and text
      // revert to the select tool; the shape is selected for immediate styling and
      // text jumps into its inline editor.
      const isPen = draft.type === 'freedraw';
      const created = await this.host.store.addElement(dto, !isPen);
      if (!isPen && (draft.type === 'text' || !this.host.toolbarPrefs.stayOnTool$())) {
         this.host.tools.activeTool$.set('select');
         if (created && selectAfter && created.type === 'text') {
            this.host.textEditing.editingTextId$.set(created.id);
         }
         if (created && created.type === 'grid') {
            // A fresh table opens its first cell for typing.
            this.host.grids.beginEdit({ id: created.id, row: 0, col: 0 });
         }
         if (created && created.type === 'code') {
            // A fresh code card opens straight into its editor.
            this.host.textEditing.editingTextId$.set(created.id);
         }
      }
   }

   draftToDto(draft: CanvasElementModel): CreateElementDto {
      const { x, y, points } = draft;
      let { width, height } = draft;
      let text = draft.text;
      if (draft.type === 'rectangle' || draft.type === 'ellipse' || draft.type === 'diamond') {
         if (width < 4 && height < 4) {
            width = 120;
            height = 80;
         }
      }
      if (draft.type === 'grid' && (width < 40 || height < 24)) {
         const g = parseGrid(draft.text);
         width = g.cols.reduce((a, b) => a + b, 0);
         height = g.rows.reduce((a, b) => a + b, 0);
      }
      let fontSize = draft.fontSize;
      if (draft.type === 'grid') {
         // A table drawn bigger than the default starts with proportionally bigger
         // text (the same diagonal measure a resize uses), so it reads as drawn.
         const g = parseGrid(draft.text);
         const w0 = g.cols.reduce((a, b) => a + b, 0);
         const h0 = g.rows.reduce((a, b) => a + b, 0);
         const k = (width * w0 + height * h0) / (w0 * w0 + h0 * h0);
         fontSize = Math.round(Math.min(96, Math.max(10, (draft.fontSize ?? 14) * k)) * 2) / 2;
      }
      if (draft.type === 'embed' && (width < 80 || height < 60)) {
         width = 640;
         height = 400;
      }
      if (draft.type === 'code' && (width < 40 || height < 40)) {
         width = 360;
         height = 160;
      }
      if (draft.type === 'frame') {
         const preset = framePreset(this.host.tools.framePresetId());
         if (width < 40 || height < 40) {
            width = preset.width;
            height = preset.height;
         }
         const count = this.host.store.elements().filter((e) => e.type === 'frame').length;
         text = text || `Frame ${count + 1}`;
      }
      return {
         type: draft.type,
         x,
         y,
         width,
         height,
         angle: 0,
         strokeColor: draft.strokeColor,
         backgroundColor: draft.backgroundColor,
         fillStyle: draft.fillStyle,
         strokeWidth: draft.strokeWidth,
         strokeStyle: draft.strokeStyle,
         opacity: draft.opacity,
         strokeOpacity: draft.strokeOpacity,
         fillOpacity: draft.fillOpacity,
         zIndex: draft.zIndex,
         cornerRadius: draft.cornerRadius,
         points,
         text,
         fontSize,
         fontFamily: draft.fontFamily,
         textAlign: draft.textAlign,
         startArrowhead: draft.startArrowhead,
         endArrowhead: draft.endArrowhead,
         curvature: draft.curvature,
         language: draft.language,
         fileName: draft.fileName,
      };
   }
}
