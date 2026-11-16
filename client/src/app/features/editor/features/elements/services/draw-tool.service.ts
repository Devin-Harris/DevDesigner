import { ElementGestureService } from './element-gesture.service';
import { CanvasSnapService } from '../../../services/canvas-snap.service';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { EditorToolService } from '../../../services/editor-tool.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { TextEditingService } from './text-editing.service';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { effect, inject, Injectable, untracked } from '@angular/core';
import { ToolbarPrefsService } from '../../../services/toolbar-prefs.service';
import { PenPrefsService } from '../../../services/pen-prefs.service';
import type { CanvasElementModel, CreateElementDto, ElementType } from '@devdesigner/shared';
import { inBlock, toInner } from '../../../helpers/slide-zoom.helper';
import { ProjectStore, elementToCreateDto } from '../../../state/project/project.store';
import { splitAtGaps } from '../../../helpers/render';
import { GridTableService } from '../../../services/grid-table.service';
import { defaultGrid, parseGrid, serializeGrid } from '../../../helpers/grid-table.helper';
import { NODE_WIDTH } from '../../../shared/constants/canvas.constants';
import { framePreset } from '../../../shared/constants/frame-presets';
import { absolutePoints, elementBox, hitTestElement, toRelative } from '../../../helpers/element-geometry.helper';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import { CODE_FONT_SIZE, SURFACE_FILL } from '../../../helpers/render';
import type { EditorTool } from '../../../models/editor-tool.model';
import { densify } from '../helpers/erase-geometry.helper';
import { distanceToSegment } from '../helpers/erase-geometry.helper';
import { segDistance } from '../helpers/erase-geometry.helper';
/** Drawing new items with the active tool (shapes, lines, pen, frames, text, code, grids, tables) and the pen eraser. */
@Injectable()
export class DrawToolService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly snap = inject(CanvasSnapService);
   private readonly viewport = inject(EditorViewportService);
   private readonly tools = inject(EditorToolService);
   private readonly grids = inject(GridTableService);
   private readonly penPrefs = inject(PenPrefsService);
   private readonly toolbarPrefs = inject(ToolbarPrefsService);
   private readonly textEditing = inject(TextEditingService);
   private readonly elementGestures = inject(ElementGestureService);

   /** World-space point a shape draw started from (the corner, or the center with Alt). */
   private drawAnchor = { x: 0, y: 0 };

   /** The slide whose items a draw lines up with (null: the canvas), taken at press. */
   private drawCtx: string | null = null;

   /** The hover guides on screen are ours (so only we clear them). */
   private hoverGuides = false;

   constructor() {
      // Switching tools (or starting any gesture) drops the pre-draw guides.
      effect(() => {
         this.tools.activeTool();
         untracked(() => this.clearHoverSnap());
      });
   }

   /** Tools whose starting point lines up with nearby items before you press. */
   private presnaps(tool: EditorTool): boolean {
      return (
         tool === 'rectangle' ||
         tool === 'ellipse' ||
         tool === 'diamond' ||
         tool === 'frame' ||
         tool === 'line' ||
         tool === 'arrow' ||
         tool === 'code' ||
         tool === 'grid'
      );
   }

   /** The space a point is drawn in: a zoomed slide's own coordinates, else the canvas (on a shown slide, its items). */
   private spaceAt(clientX: number, clientY: number): {
      point: { x: number; y: number };
      ctx: string | null;
      view: ReturnType<CanvasViewService['slideViews']>[number] | undefined;
   } {
      const raw = this.viewport.toWorldRaw(clientX, clientY);
      const view = this.canvasView.slideViews().find((v) => inBlock(v, raw));
      if (view) return { point: toInner(view, raw), ctx: view.frameId, view };
      const shown = this.store.shownSlideIds();
      const frame = this.store
         .slideFrames()
         .find(
            (f) => shown.has(f.id) && raw.x >= f.x && raw.x <= f.x + f.width && raw.y >= f.y && raw.y <= f.y + f.height
         );
      return { point: raw, ctx: frame?.id ?? null, view: undefined };
   }

   /** A point snapped to nearby items' edges and centers (guides shown), or null when nothing is in reach. */
   private snapPoint(clientX: number, clientY: number): { x: number; y: number } | null {
      if (!this.snap.smartGuides()) return null;
      const { point: p, ctx, view } = this.spaceAt(clientX, clientY);
      // Targets are picked nearest the point: rebuild them as it moves.
      this.snap.smartBase = null;
      const s = this.snap.smartEdges('draft-hover', { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, [p.x], [p.y], {
         ctx,
         view,
      });
      this.snap.smartBase = null;
      if (!s || (!s.snappedX && !s.snappedY)) return null;
      return { x: p.x + (s.snappedX ? s.ox : 0), y: p.y + (s.snappedY ? s.oy : 0) };
   }

   /**
    * Hovering with a shape tool: the cursor point lines up with nearby items (guides
    * shown) before anything is drawn, so the first corner starts on the line.
    */
   hoverSnap(event: PointerEvent): void {
      const target = event.target as Node | null;
      const overCanvas = !!target && this.viewport.canvasRef().nativeElement.contains(target);
      if (!overCanvas || !this.store.canEdit() || !this.presnaps(this.tools.activeTool())) {
         this.clearHoverSnap();
         return;
      }
      const hit = this.snapPoint(event.clientX, event.clientY);
      this.hoverGuides = true;
      if (!hit) this.snap.smartSnapState.set(null);
   }

   clearHoverSnap(): void {
      if (!this.hoverGuides) return;
      this.hoverGuides = false;
      this.snap.smartBase = null;
      this.snap.smartSnapState.set(null);
   }

   /** Add an ERD table centered near the given screen point. */
   addTableAt(clientX: number, clientY: number): void {
      const world = this.viewport.toWorld(clientX, clientY);
      let x = Math.round(world.x - NODE_WIDTH / 2);
      let y = Math.round(world.y - 12);
      if (this.snap.gridSnap()) {
         x = snapToGrid(x);
         y = snapToGrid(y);
      }
      void this.store.addTable(x, y);
   }

   /** Drop a starter sequence diagram (header origin + two participants) at the pointer. */
   addSequenceAt(clientX: number, clientY: number): void {
      const world = this.viewport.toWorld(clientX, clientY);
      let x = Math.round(world.x);
      let y = Math.round(world.y);
      if (this.snap.gridSnap()) {
         x = snapToGrid(x);
         y = snapToGrid(y);
      }
      void this.store.addSequenceStarter(x, y);
   }

   /** Pen strokes cut by the current eraser drag: their state before the drag. */
   private erased = new Map<string, CanvasElementModel>();

   private lastErasePoint: { x: number; y: number } | null = null;

   beginErase(event: PointerEvent): void {
      this.gesture.mode = 'erase';
      this.gesture.gestureActive.set(true);
      this.erased.clear();
      this.lastErasePoint = null;
      this.eraseAt(event.clientX, event.clientY);
   }

   /**
    * Cut the parts of pen strokes under the eraser (from the last sample to here).
    * Erased points become NaN gaps locally; pointer-up splits the stroke into pieces.
    */
   eraseAt(clientX: number, clientY: number): void {
      const raw = this.viewport.toWorldRaw(clientX, clientY);
      const view = this.canvasView.slideViews().find((v) => inBlock(v, raw));
      const p = view ? toInner(view, raw) : raw;
      const from = this.lastErasePoint ?? p;
      this.lastErasePoint = p;
      const r = this.penPrefs.eraserSize() / 2 / this.store.viewport().zoom;
      for (const el of this.store.elements()) {
         if (el.type !== 'freedraw') continue;
         const reach = r + el.strokeWidth;
         if (!hitTestElement(el, p, reach) && !hitTestElement(el, from, reach)) {
            // Cheap reject unless the eraser segment crosses the stroke's box.
            const b = elementBox(el);
            if (
               Math.max(p.x, from.x) < b.x0 - reach ||
               Math.min(p.x, from.x) > b.x1 + reach ||
               Math.max(p.y, from.y) < b.y0 - reach ||
               Math.min(p.y, from.y) > b.y1 + reach
            )
               continue;
         }
         if (!this.erased.has(el.id)) this.erased.set(el.id, el);
         // Subdivide only the segments the eraser touches, so a cut can land between
         // widely spaced samples. (Densifying the whole stroke would make the brush
         // read it as slow and draw it thicker.)
         const pts = densify(
            el.points ?? [],
            Math.max(1, r / 3),
            (a, b) => segDistance({ x: el.x + a.x, y: el.y + a.y }, { x: el.x + b.x, y: el.y + b.y }, from, p) <= reach
         );
         let changed = false;
         const next = pts.map((q) => {
            if (!Number.isFinite(q.x)) return q;
            const a = { x: el.x + q.x, y: el.y + q.y };
            if (distanceToSegment(a, from, p) <= reach) {
               changed = true;
               return { x: NaN, y: NaN };
            }
            return q;
         });
         if (changed) this.store.patchElementLocal(el.id, { points: next });
      }
   }

   /** Replace each cut stroke by its remaining pieces, as one undo step. */
   commitErase(): void {
      const erased = [...this.erased];
      this.erased.clear();
      this.lastErasePoint = null;
      const work: { before: CanvasElementModel; pieces: { x: number; y: number }[][] }[] = [];
      for (const [id, before] of erased) {
         const now = this.store.elements().find((e) => e.id === id);
         if (!now) continue;
         const pieces = splitAtGaps(absolutePoints(now)).filter((run) => run.length > 1);
         // Restore the original first so undo re-creates the stroke as it was.
         this.store.patchElementLocal(id, { points: before.points });
         if (pieces.length === 1 && pieces[0].length === (now.points ?? []).length) continue;
         work.push({ before, pieces });
      }
      if (work.length === 0) return;
      void this.store.batchHistory(async () => {
         for (const { before, pieces } of work) {
            await this.store.deleteElement(before.id);
            for (const run of pieces) {
               const o = run[0];
               let x1 = o.x,
                  y1 = o.y,
                  x0 = o.x,
                  y0 = o.y;
               for (const q of run) {
                  x0 = Math.min(x0, q.x);
                  y0 = Math.min(y0, q.y);
                  x1 = Math.max(x1, q.x);
                  y1 = Math.max(y1, q.y);
               }
               const dto = elementToCreateDto({
                  ...before,
                  x: o.x,
                  y: o.y,
                  width: x1 - x0,
                  height: y1 - y0,
                  points: run.map((q) => ({ x: q.x - o.x, y: q.y - o.y })),
               });
               delete (dto as { id?: string }).id;
               await this.store.addElement(dto, false);
            }
         }
      });
   }

   /** Start drawing an element of the active tool at the pointer. */
   beginDraw(
      tool: Exclude<EditorTool, 'select' | 'hand' | 'table' | 'sequence' | 'laser' | 'slide'>,
      event: PointerEvent
   ): void {
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      // Start where the hover guides showed: lined up with nearby items, else on the grid.
      const lined = this.presnaps(tool) ? this.snapPoint(event.clientX, event.clientY) : null;
      this.hoverGuides = false;
      this.snap.smartBase = null;
      this.drawCtx = this.spaceAt(event.clientX, event.clientY).ctx;
      const x = lined ? lined.x : this.snap.gridSnap() ? snapToGrid(world.x) : world.x;
      const y = lined ? lined.y : this.snap.gridSnap() ? snapToGrid(world.y) : world.y;
      const type = tool as ElementType;
      const sticky = this.store.elementStyle();
      // Frames keep their own quiet look; they don't inherit the last-used shape style.
      const style =
         type === 'code'
            ? {
                 // A code card: a hairline border, no fill override (it picks a theme-matched surface).
                 ...sticky,
                 strokeColor:
                    this.canvasView.themeVar('--dd-border-strong') ??
                    this.canvasView.themeVar('--dd-text-muted') ??
                    sticky.strokeColor,
                 backgroundColor: undefined,
                 fillStyle: 'none' as const,
                 strokeWidth: 1,
                 strokeStyle: 'solid' as const,
                 opacity: 100,
                 cornerRadius: 8,
                 fontFamily: 'code',
                 fontSize: CODE_FONT_SIZE,
              }
            : type === 'grid'
              ? {
                   // A table: opaque surface, hairline borders, readable body text.
                   ...sticky,
                   strokeColor: this.canvasView.defaultStroke(),
                   backgroundColor: SURFACE_FILL,
                   fillStyle: 'solid' as const,
                   strokeWidth: 1,
                   strokeStyle: 'solid' as const,
                   opacity: 100,
                   cornerRadius: 4,
                }
              : type === 'frame'
                ? {
                     ...sticky,
                     strokeColor: this.canvasView.themeVar('--dd-text-muted') ?? sticky.strokeColor,
                     backgroundColor: undefined,
                     fillStyle: 'none' as const,
                     strokeWidth: 1.5,
                     strokeStyle: 'solid' as const,
                     opacity: 100,
                     cornerRadius: 0,
                  }
                : sticky;
      const draft: CanvasElementModel = {
         id: `draft-${Date.now()}`,
         type,
         x,
         y,
         width: 0,
         height: 0,
         angle: 0,
         strokeColor: style.strokeColor ?? this.canvasView.defaultStroke(),
         backgroundColor: style.backgroundColor,
         fillStyle: style.fillStyle,
         strokeWidth:
            type === 'freedraw'
               ? this.penPrefs.highlighter()
                  ? Math.max(this.penPrefs.width(), 2) * 4
                  : this.penPrefs.width()
               : style.strokeWidth,
         strokeStyle: style.strokeStyle,
         opacity: type === 'freedraw' && this.penPrefs.highlighter() ? 50 : style.opacity,
         zIndex: this.store.elements().length,
         cornerRadius: style.cornerRadius,
         startArrowhead: style.startArrowhead,
         endArrowhead: style.endArrowhead,
         ...(type === 'line' || type === 'arrow'
            ? {
                 points: [
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                 ],
              }
            : {}),
         ...(type === 'freedraw' ? { points: [{ x: 0, y: 0 }] } : {}),
         ...(type === 'grid' ? { text: serializeGrid(defaultGrid()), fontSize: 14, fontFamily: 'normal' } : {}),
         ...(type === 'code'
            ? {
                 text: '',
                 fontSize: CODE_FONT_SIZE,
                 fontFamily: 'code',
                 language: this.textEditing.lastCodeLanguage(),
              }
            : {}),
         ...(type === 'text'
            ? {
                 text: '',
                 fontSize: style.fontSize,
                 fontFamily: style.fontFamily,
                 textAlign: 'left' as const,
                 width: 4,
                 height: style.fontSize,
              }
            : {}),
      };
      this.tools.draft.set(draft);
      // Started inside a zoomed-out slide: the whole stroke is drawn in its coordinates.
      const raw = this.viewport.toWorldRaw(event.clientX, event.clientY);
      this.tools.drawSlideId.set(this.canvasView.slideViews().find((v) => inBlock(v, raw))?.frameId ?? null);
      this.drawAnchor = { x, y };
      this.gesture.lastDrawPointer = { x: event.clientX, y: event.clientY };
      this.gesture.startClientX = event.clientX;
      this.gesture.startClientY = event.clientY;
      if (type === 'text') {
         // Text is placed on click; commit immediately and open the inline editor.
         void this.commitDraft(true);
         this.gesture.mode = 'idle';
         return;
      }
      this.gesture.mode = 'draw';
      this.gesture.gestureActive.set(true);
   }

   updateDraw(clientX: number, clientY: number, shift: boolean, alt: boolean): void {
      const draft = this.tools.draft();
      if (!draft) {
         return;
      }
      this.gesture.lastDrawPointer = { x: clientX, y: clientY };
      // Stay in the space the stroke started in, even when the pointer crosses a block edge.
      const view = this.canvasView.slideViews().find((v) => v.frameId === this.tools.drawSlideId());
      const raw = this.viewport.toWorldRaw(clientX, clientY);
      const world = view ? toInner(view, raw) : raw;
      const snap = this.snap.gridSnap();
      if (draft.type === 'freedraw') {
         const pt = toRelative(draft, world);
         this.tools.draft.set({ ...draft, points: [...(draft.points ?? []), pt] });
         return;
      }
      if (draft.type === 'line' || draft.type === 'arrow') {
         // Highlight the shape/table the free end would bind to; binding beats snapping.
         const bindBox = this.elementGestures.bindingTargetAt(world, draft.id)?.box ?? null;
         this.elementGestures.bindHighlight.set(bindBox);
         const space = { ctx: this.tools.drawSlideId() ?? null, view };
         const spanOf = (px: number, py: number) => ({
            x0: Math.min(px, draft.x),
            y0: Math.min(py, draft.y),
            x1: Math.max(px, draft.x),
            y1: Math.max(py, draft.y),
         });
         let end: { x: number; y: number };
         if (shift) {
            // Lock to 45° steps from the start point, keeping the cursor's distance along it,
            // then slide along that direction to line up with nearby items.
            const vx = world.x - draft.x;
            const vy = world.y - draft.y;
            const step = Math.PI / 4;
            const ang = Math.round(Math.atan2(vy, vx) / step) * step;
            const ux = Math.cos(ang);
            const uy = Math.sin(ang);
            let len = vx * ux + vy * uy;
            const px = draft.x + ux * len;
            const py = draft.y + uy * len;
            const smart = bindBox
               ? null
               : this.snap.smartEdges(
                    draft.id,
                    spanOf(px, py),
                    Math.abs(ux) > 1e-6 ? [px] : [],
                    Math.abs(uy) > 1e-6 ? [py] : [],
                    space
                 );
            const lx = smart?.snappedX ? (px + smart.ox - draft.x) / ux : null;
            const ly = smart?.snappedY ? (py + smart.oy - draft.y) / uy : null;
            const pick = [lx, ly]
               .filter((v): v is number => v !== null)
               .sort((a, b) => Math.abs(a - len) - Math.abs(b - len))[0];
            if (pick !== undefined && smart) {
               len = pick;
               if (pick !== lx)
                  Object.assign(smart, { snappedX: false, guides: smart.guides.filter((q) => q.axis === 'y') });
               if (pick !== ly)
                  Object.assign(smart, { snappedY: false, guides: smart.guides.filter((q) => q.axis === 'x') });
               this.snap.smartSnapState.set(
                  smart.guides.length ? { snap: smart, view: this.snap.smartBase?.view } : null
               );
            } else {
               if (bindBox) this.snap.smartSnapState.set(null);
               if (snap) len = snapToGrid(len);
            }
            end = { x: Math.round(ux * len), y: Math.round(uy * len) };
         } else {
            const smart = bindBox
               ? null
               : this.snap.smartEdges(draft.id, spanOf(world.x, world.y), [world.x], [world.y], space);
            if (bindBox) this.snap.smartSnapState.set(null);
            const ex = smart?.snappedX ? world.x + smart.ox : snap ? snapToGrid(world.x) : world.x;
            const ey = smart?.snappedY ? world.y + smart.oy : snap ? snapToGrid(world.y) : world.y;
            end = { x: ex - draft.x, y: ey - draft.y };
         }
         this.tools.draft.set({ ...draft, points: [{ x: 0, y: 0 }, end] });
         return;
      }
      // Rectangle / ellipse / diamond: grow the box from the anchor. Shift forces a
      // square (circle for an ellipse); Alt makes the anchor the center.
      const { x: ax, y: ay } = this.drawAnchor;
      // The dragged corner lines up with nearby items too (not with Alt: the box grows about its center).
      const ratioLocked = draft.type === 'frame' && !!framePreset(this.tools.framePresetId()).ratio;
      const smart =
         alt || draft.type === 'text'
            ? null
            : this.snap.smartEdges(
                 draft.id,
                 {
                    x0: Math.min(ax, world.x),
                    y0: Math.min(ay, world.y),
                    x1: Math.max(ax, world.x),
                    y1: Math.max(ay, world.y),
                 },
                 [world.x],
                 ratioLocked ? [] : [world.y],
                 { ctx: this.drawCtx, view }
              );
      const ex = smart?.snappedX ? world.x + smart.ox : snap ? snapToGrid(world.x) : world.x;
      const ey = smart?.snappedY ? world.y + smart.oy : snap ? snapToGrid(world.y) : world.y;
      let dx = ex - ax;
      let dy = ey - ay;
      if (draft.type === 'frame') {
         // A preset frame is locked to its page ratio: width follows the pointer, height follows width.
         const ratio = framePreset(this.tools.framePresetId()).ratio;
         if (ratio) {
            dy = (dy < 0 ? -1 : 1) * (Math.abs(dx) / ratio);
         }
      } else if (shift) {
         const size = Math.max(Math.abs(dx), Math.abs(dy));
         dx = (dx < 0 ? -1 : 1) * size;
         dy = (dy < 0 ? -1 : 1) * size;
      }
      if (alt) {
         this.tools.draft.set({
            ...draft,
            x: ax - Math.abs(dx),
            y: ay - Math.abs(dy),
            width: Math.abs(dx) * 2,
            height: Math.abs(dy) * 2,
         });
         return;
      }
      this.tools.draft.set({
         ...draft,
         x: Math.min(ax, ax + dx),
         y: Math.min(ay, ay + dy),
         width: Math.abs(dx),
         height: Math.abs(dy),
      });
   }

   /**
    * Persist the draft as a real element. Tiny click-only shapes get a sensible
    * default size so a single click still produces a visible element.
    */
   async commitDraft(selectAfter: boolean): Promise<void> {
      const draft = this.tools.draft();
      this.tools.draft.set(null);
      const drawSlide = this.tools.drawSlideId();
      this.tools.drawSlideId.set(null);
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
         const start = this.elementGestures.bindingTargetAt(pts[0], draft.id);
         const end = this.elementGestures.bindingTargetAt(pts[pts.length - 1], draft.id);
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
      const created = await this.store.addElement(dto, !isPen);
      if (!isPen && (draft.type === 'text' || !this.toolbarPrefs.stayOnTool())) {
         this.tools.activeTool.set('select');
         if (created && selectAfter && created.type === 'text') {
            this.textEditing.editingTextId.set(created.id);
         }
         if (created && created.type === 'grid') {
            // A fresh table opens its first cell for typing.
            this.grids.beginEdit({ id: created.id, row: 0, col: 0 });
         }
         if (created && created.type === 'code') {
            // A fresh code card opens straight into its editor.
            this.textEditing.editingTextId.set(created.id);
         }
      }
   }

   private draftToDto(draft: CanvasElementModel): CreateElementDto {
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
      if (draft.type === 'code' && (width < 40 || height < 40)) {
         width = 360;
         height = 160;
      }
      if (draft.type === 'frame') {
         const preset = framePreset(this.tools.framePresetId());
         if (width < 40 || height < 40) {
            width = preset.width;
            height = preset.height;
         }
         const count = this.store.elements().filter((e) => e.type === 'frame').length;
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
