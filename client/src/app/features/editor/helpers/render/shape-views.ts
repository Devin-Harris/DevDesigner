import type { CanvasElementModel, ElementBinding, TableModel } from '@devdesigner/shared';
import type { Box, Point } from '../../models/geometry.model';
import type { ShapeView } from '../../models/shape-view.model';
import { usableRuns } from '../rich-text.helper';
import {
   absolutePoints,
   type RotatedBox,
   elementBox,
   elementCenter,
   FRAME_TITLE_H,
   FRAME_TITLE_W,
   tableBox,
} from '../element-geometry.helper';
import { curvedPath, freehandFillPath, polylinePath } from '../freedraw-path.helper';
import { textInkInsets } from '../text-metrics';
import { fontWeightFor } from './fonts';
import { SURFACE_FILL, contrastSafe, type ThemeColors } from './theme-colors';
import { DEFAULT_FONT_SIZE, LINE_HEIGHT, layoutTextBlock } from './text-layout';
import { codeBlockView } from './code-block.render';
import { gridTableView } from './grid-table.render';
import {
   arrowLabel,
   boxToBbox,
   dashArray,
   fillOf,
   imageView,
   rectCornerRadius,
   rotation,
   lineEnds,
   shapeLabel,
   splitAtGaps,
} from './shape-primitives';

interface ViewMemo {
   el: CanvasElementModel;
   key: string;
   view: ShapeView;
   clip?: { key: string; view: ShapeView; base: ShapeView };
}

/**
 * Per-element memo for `buildShapeViews` (one per caller, e.g. the editor canvas). An element
 * whose model and inputs (selection, theme guard, bound-end boxes, font generation) are
 * unchanged keeps its previous view object, so layout work runs only for what changed and
 * `@for` sees the same object.
 */
export class ShapeViewCache {
   readonly entries = new Map<string, ViewMemo>();
}

/** Two values equal by reference, or arrays/plain objects equal one level down. */
function sameField(a: unknown, b: unknown): boolean {
   if (a === b) return true;
   if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => x === b[i] || sameShallow(x, b[i]));
   }
   return sameShallow(a, b);
}

function sameShallow(a: unknown, b: unknown): boolean {
   if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) {
      return false;
   }
   const ka = Object.keys(a);
   if (ka.length !== Object.keys(b).length) return false;
   return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** Same element content (derived copies such as themed or placeholder elements count as equal). */
function sameElement(a: CanvasElementModel, b: CanvasElementModel): boolean {
   if (a === b) return true;
   const ka = Object.keys(a) as (keyof CanvasElementModel)[];
   if (ka.length !== Object.keys(b).length) return false;
   return ka.every((k) => sameField(a[k], b[k]));
}

const boxKey = (b: RotatedBox | null): string => (b ? `${b.x0},${b.y0},${b.x1},${b.y1},${b.angle ?? 0}` : '-');

/**
 * Build render views for every element, resolving styling, rotation, bound arrow
 * endpoints, text layout, and shape labels. Bound connectors route around other
 * shapes/tables. `tables`/`elements` supply binding targets and obstacles.
 */
export function buildShapeViews(
   elements: readonly CanvasElementModel[],
   tables: readonly TableModel[],
   selectedIds: ReadonlySet<string>,
   canvasTheme?: ThemeColors,
   messageBoxes?: ReadonlyMap<string, Box>,
   /** A diff code block being edited: drawn as two plain halves under its two editors. */
   diffEditingId?: string | null,
   /** Reuse unchanged views from earlier calls; `generation` changes when web fonts load. */
   memo?: { cache: ShapeViewCache; generation: number }
): ShapeView[] {
   const tableById = new Map(tables.map((t) => [t.id, t]));
   const elementById = new Map(elements.map((e) => [e.id, e]));
   // Items on a filled slide are kept readable against the slide, not the canvas
   // (a deck theme's dark text on a light slide must not flip in dark mode).
   const guardFor = (element: CanvasElementModel): ThemeColors | undefined => {
      const frame = element.slideId ? elementById.get(element.slideId) : undefined;
      return canvasTheme &&
         frame &&
         frame.fillStyle !== 'none' &&
         frame.backgroundColor &&
         frame.backgroundColor !== SURFACE_FILL &&
         frame.backgroundColor !== 'transparent'
         ? { ...canvasTheme, canvasBg: frame.backgroundColor }
         : canvasTheme;
   };
   const targetBox = (binding: ElementBinding): RotatedBox | null => {
      if (binding.targetKind === 'message') {
         return messageBoxes?.get(binding.targetId) ?? null;
      }
      if (binding.targetKind === 'table') {
         const t = tableById.get(binding.targetId);
         return t ? tableBox(t) : null;
      }
      const e = elementById.get(binding.targetId);
      return e ? { ...elementBox(e), angle: e.angle } : null;
   };

   const seen = memo ? new Map<string, ViewMemo>() : null;
   const views = elements.map((element) => {
      if (!memo || !seen) return buildView(element);
      const theme = guardFor(element);
      const bound =
         element.type === 'line' || element.type === 'arrow'
            ? `|${element.startBinding ? boxKey(targetBox(element.startBinding)) : ''}|${element.endBinding ? boxKey(targetBox(element.endBinding)) : ''}`
            : '';
      const key = `${memo.generation}|${selectedIds.has(element.id) ? 1 : 0}|${element.id === diffEditingId ? 1 : 0}|${theme?.canvasBg}|${theme?.text}|${theme?.surface}${bound}`;
      const prev = memo.cache.entries.get(element.id);
      const hit = prev && prev.key === key && sameElement(prev.el, element) ? prev : null;
      const entry: ViewMemo = hit ?? { el: element, key, view: buildView(element) };
      seen.set(element.id, entry);
      return entry.view;
   });
   if (memo && seen) {
      memo.cache.entries.clear();
      for (const [id, entry] of seen) memo.cache.entries.set(id, entry);
   }

   function buildView(element: CanvasElementModel): ShapeView {
      const theme = guardFor(element);
      const box = elementBox(element);
      const center = elementCenter(element);
      const stroke = contrastSafe(element.strokeColor, theme);
      const { fill, fillOpacity, hatch } = fillOf(element, theme);
      const base: ShapeView = {
         id: element.id,
         type: element.type,
         selected: selectedIds.has(element.id),
         opacity: element.opacity / 100,
         stroke,
         strokeOpacity: (element.strokeOpacity ?? 100) / 100,
         strokeWidth: element.strokeWidth,
         dash: dashArray(element),
         fill,
         fillOpacity: fillOpacity * ((element.fillOpacity ?? 100) / 100),
         hatch,
         transform: rotation(element, center),
         freehand: false,
         markerStart: 'none',
         markerEnd: 'none',
         markerColor: stroke,
         bbox: boxToBbox(box),
      };

      switch (element.type) {
         case 'rectangle':
            base.rect = {
               x: element.x,
               y: element.y,
               width: element.width,
               height: element.height,
               rx: rectCornerRadius(element),
            };
            base.label = shapeLabel(element, base.bbox, theme);
            break;
         case 'code':
            base.code = codeBlockView(element, theme, element.id === diffEditingId);
            // The card carries its own fill; the SVG layer draws the border from stroke.
            base.fill = base.code.background;
            break;
         case 'grid':
            base.grid = gridTableView(element, theme, stroke, fill);
            break;
         case 'image':
            if (element.fileId) {
               base.image = imageView(element, element.fileId);
            }
            break;
         case 'frame': {
            // A page outline: square corners, transparent unless a fill was chosen,
            // with its name sitting above the top-left corner (outside the frame, so
            // it never lands in an export crop).
            base.rect = { x: element.x, y: element.y, width: element.width, height: element.height, rx: 0 };
            // A slide's name is drawn on the slide outline instead (editor overlay).
            if (element.text && !element.slide) {
               base.label = layoutTextBlock(
                  element.text,
                  { x: element.x, y: element.y - FRAME_TITLE_H, width: FRAME_TITLE_W, height: FRAME_TITLE_H },
                  {
                     fontSize: 14,
                     fontFamilyKey: 'normal',
                     fontWeight: 600,
                     color: stroke,
                     align: 'left',
                     vAlign: 'middle',
                     padding: 0,
                     wrap: false,
                  }
               );
            }
            break;
         }
         case 'ellipse':
            base.ellipse = {
               cx: element.x + element.width / 2,
               cy: element.y + element.height / 2,
               rx: element.width / 2,
               ry: element.height / 2,
            };
            base.label = shapeLabel(element, base.bbox, theme);
            break;
         case 'diamond': {
            const midX = element.x + element.width / 2;
            const midY = element.y + element.height / 2;
            base.polygon = [
               `${midX},${element.y}`,
               `${element.x + element.width},${midY}`,
               `${midX},${element.y + element.height}`,
               `${element.x},${midY}`,
            ].join(' ');
            base.label = shapeLabel(element, base.bbox, theme);
            break;
         }
         case 'freedraw':
            // Non-finite points are gaps a live eraser drag has cut; draw each piece apart.
            base.path = splitAtGaps(absolutePoints(element))
               .map((run) => freehandFillPath(run, element.strokeWidth))
               .join(' ');
            base.freehand = true;
            base.fill = stroke;
            break;
         case 'line':
         case 'arrow': {
            const ends: Point[] = lineEnds(element, targetBox);
            const curvature = ends.length >= 2 && !element.elbow ? (element.curvature ?? 0) : 0;
            let labelAt: Point | undefined;
            if (element.elbow && ends.length >= 2) {
               // Right-angle route: out along the longer axis, across at the midpoint, then in.
               const s = ends[0];
               const t = ends[ends.length - 1];
               const across = Math.abs(t.x - s.x) >= Math.abs(t.y - s.y);
               const mx = (s.x + t.x) / 2;
               const my = (s.y + t.y) / 2;
               base.path = across ? `M${s.x} ${s.y} H${mx} V${t.y} H${t.x}` : `M${s.x} ${s.y} V${my} H${t.x} V${t.y}`;
               base.bend = { x: mx, y: my };
               labelAt = { x: mx, y: my };
            } else if (Math.abs(curvature) > 0.5) {
               const curve = curvedPath(ends[0], ends[ends.length - 1], curvature);
               base.path = curve.path;
               base.bend = curve.mid;
               labelAt = curve.mid;
            } else {
               base.path = polylinePath(ends);
               if (ends.length >= 2) {
                  base.bend = {
                     x: (ends[0].x + ends[ends.length - 1].x) / 2,
                     y: (ends[0].y + ends[ends.length - 1].y) / 2,
                  };
               }
            }
            base.fill = 'none';
            // Default arrowheads: arrow => end only; line => none. Element can override.
            const defaultEnd: ShapeView['markerEnd'] = element.type === 'arrow' ? 'arrow' : 'none';
            base.markerStart = element.startArrowhead ?? 'none';
            base.markerEnd = element.endArrowhead ?? defaultEnd;
            if (ends.length >= 2) {
               base.ends = { start: ends[0], end: ends[ends.length - 1] };
               base.label = arrowLabel(element, labelAt ?? ends[0], labelAt ? labelAt : ends[ends.length - 1], theme);
            }
            // Recompute bbox from resolved ends so the selection box tracks bindings.
            if (ends.length) {
               const xs = ends.map((p) => p.x);
               const ys = ends.map((p) => p.y);
               base.bbox = {
                  x: Math.min(...xs),
                  y: Math.min(...ys),
                  width: Math.max(...xs) - Math.min(...xs),
                  height: Math.max(...ys) - Math.min(...ys),
               };
            }
            break;
         }
         case 'text': {
            // Text hugs its glyphs and never wraps: the box is sized to the content
            // (resizing scales the font instead). The one exception is legacy text
            // that was resized narrower before this model — it keeps its wrapping
            // until it is next edited, so existing drawings do not change.
            const tFontSize = element.fontSize ?? DEFAULT_FONT_SIZE;
            const tWeight = element.bold ? 800 : fontWeightFor(element.strokeWidth);
            // Legacy-wrapped text is recognised from its stored HEIGHT (taller than its
            // explicit lines), which — unlike a width measurement — does not depend on
            // whether the web font has loaded yet.
            const explicitLines = (element.text ?? '').split('\n').length;
            const lineH = tFontSize * (element.lineHeight ?? LINE_HEIGHT);
            const legacyWrapped = element.wrap ?? element.height > explicitLines * lineH + 4 + lineH * 0.5;
            // Lay out in the stored layout box (where the editor draws it), not the
            // glyph-trimmed `elementBox`, or the glyphs shift down by the top inset.
            const layoutBox = { x: element.x, y: element.y, width: element.width, height: element.height };
            base.text = layoutTextBlock(element.text ?? '', layoutBox, {
               fontSize: tFontSize,
               fontFamilyKey: element.fontFamily,
               fontWeight: tWeight,
               italic: element.italic,
               color: stroke,
               align: element.textAlign ?? 'left',
               vAlign: element.verticalAlign ?? 'top',
               padding: 2,
               wrap: legacyWrapped,
               lineHeight: element.lineHeight,
               runs: usableRuns(element.text ?? '', element.runs),
               resolveColor: (c) => contrastSafe(c, theme),
            });
            const contentH = base.text.lines.length * tFontSize * (element.lineHeight ?? LINE_HEIGHT) + 4;
            // The outline hugs the glyphs (the layout box keeps its line-height padding).
            const ink = textInkInsets(element);
            const bottom = legacyWrapped ? contentH : element.height - ink.bottom;
            base.bbox = {
               x: element.x + ink.left,
               y: element.y + ink.top,
               width: Math.max(1, element.width - ink.left - ink.right),
               height: Math.max(1, bottom - ink.top),
            };
            break;
         }
      }
      return base;
   }
   // Frames are page backdrops: draw them beneath everything else (stable sort).
   // Frames set to clip their content: shapes whose centre lies inside the (smallest)
   // such frame are cut to its box. Slides keep their own clipping.
   const clipFrames = elements
      .filter((e) => e.type === 'frame' && e.clipContent && !e.slide)
      .sort((a, b) => a.width * a.height - b.width * b.height);
   // Views can be shared through the memo, so a clipped one is a copy (itself memoized).
   const out = clipFrames.length
      ? views.map((v) => {
           const el = elementById.get(v.id);
           if (!el || el.type === 'frame' || el.slideId) return v;
           const c = elementCenter(el);
           const f = clipFrames.find(
              (fr) => c.x >= fr.x && c.x <= fr.x + fr.width && c.y >= fr.y && c.y <= fr.y + fr.height
           );
           if (!f) return v;
           const frameClip = { x: f.x, y: f.y, width: f.width, height: f.height };
           const entry = seen?.get(v.id);
           const key = `${f.x},${f.y},${f.width},${f.height}`;
           if (entry?.clip && entry.clip.key === key && entry.clip.base === v) return entry.clip.view;
           const clipped = { ...v, frameClip };
           if (entry) entry.clip = { key, view: clipped, base: v };
           return clipped;
        })
      : views;
   return out.sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame'));
}
