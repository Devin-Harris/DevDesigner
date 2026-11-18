import { EditorToolService } from './editor-tool.service';
import { EditorViewportService } from './editor-viewport.service';
import { computed, effect, inject, linkedSignal, untracked, Injectable, type Signal } from '@angular/core';
import type { CanvasElementModel, UpdateElementDto } from '@devdesigner/shared';
import {
   presentationOf,
   type SequenceDiagramModel,
   layoutOf,
   isEmptyPlaceholder,
   placeholderPrompt,
   resolveThemedElements,
   masterOf,
   DEFAULT_THEME,
   type SlideTheme,
} from '@devdesigner/shared';
import {
   boxToOuter,
   slideView,
   slideViewTransform,
   type SlideView,
   toInner,
   toOuter,
   isPlainView,
   slideZoomFloor,
} from '../helpers/slide-zoom.helper';
import { FontMetricsService } from './font-metrics.service';
import type { ShapeView } from '../models/shape-view.model';
import { ThemeService } from '../../../core/theme/theme.service';
import { ProjectStore, type SequenceLayoutSnapshot } from '../state/project/project.store';
import { slotFollower, slotStyle } from '../helpers/layout-placeholders';
import type { MinimapItem } from '../models/minimap-item.model';
import { ConnectorRouteCache, computeConnectors } from '../helpers/connectors.helper';
import { LAYOUT_Z_OFFSET, sequenceDiagramBox } from '../helpers/frame-contents.helper';
import { absolutePoints, elementBox, sameBoxes, tableBox } from '../helpers/element-geometry.helper';
import { buildColumnLocations, tableHeight, tableWidth } from '../helpers/node-metrics.helper';
import { messageLabelBoxes } from '../helpers/message-box.helper';
import { buildShapeViews, ShapeViewCache, codeDiffActive } from '../helpers/render';
import { elbowPath } from '../helpers/svg-path.helper';
import type { Box, Rect, Point } from '../models/geometry.model';
import { DEFAULT_ELEMENT_STROKE } from '../shared/constants/canvas.constants';
import type { SequenceStart } from '../models/sequence-start.model';
const dim = (v: ShapeView): ShapeView => ({ ...v, opacity: v.opacity * 0.5 });
const lock = (v: ShapeView): ShapeView => ({ ...v, locked: true });
/** `make(v)`, made once per view object. */
function variant(cache: WeakMap<ShapeView, ShapeView>, v: ShapeView, make: (v: ShapeView) => ShapeView): ShapeView {
   let out = cache.get(v);
   if (!out) {
      out = make(v);
      cache.set(v, out);
   }
   return out;
}

/** Above this many elements + tables the canvas draws only what is near the view (perf P2.5). */
export const CULL_THRESHOLD = 300;
/** Extra drawn area around the view, as a share of its size, so a pan rarely changes the DOM. */
const CULL_MARGIN = 0.75;

const boxesOverlap = (a: Box, b: Box): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** A relationship end being re-pointed, drawn to the cursor before it is released. */
export interface RelinkPreview {
   relationshipId: string;
   which: 'source' | 'target';
   cursor: Point;
}

/** What the canvas view reads from sub-features; the editor entry wires it with `connect`. */
export interface CanvasViewHost {
   /** The text element being edited inline (drawn by the editor overlay, not the layer). */
   readonly editingTextId: Signal<string | null>;
   readonly relinkPreview: Signal<RelinkPreview | null>;
}

/**
 * What the canvas draws, derived from the store and the viewport: the items shown (focus mode,
 * stacked slides, zoomed slide blocks), shape views, connectors, layers, outlines and the minimap
 * footprint. Selection overlays, export and smart guides read the full (unculled) lists.
 */
@Injectable()
export class CanvasViewService {
   private readonly store = inject(ProjectStore);
   private readonly viewport = inject(EditorViewportService);
   private readonly tools = inject(EditorToolService);
   private readonly theme = inject(ThemeService);
   private readonly fontMetrics = inject(FontMetricsService);
   private host!: CanvasViewHost;

   connect(host: CanvasViewHost): void {
      this.host = host;
   }

   /** The slide being shown/edited; it is the only slide on the canvas. */
   readonly activeSlideId = this.store.activeSlideId;

   /** What the canvas leaves out because it belongs to another (stacked) slide. */
   readonly focusHidden = this.store.hiddenBySlides;

   /** The elements on the canvas right now (not collapsed away with another slide). */
   shownElements(): CanvasElementModel[] {
      const hide = this.focusHidden();
      const locked = this.store.layoutItemIds();
      return this.store.elements().filter((e) => !hide?.elementIds.has(e.id) && !locked.has(e.id));
   }

   /** Tables that are on the canvas right now (focus mode collapses other slides' tables). */
   readonly visibleTables = computed(() => {
      const hide = this.focusHidden();
      const tables = this.store.tables();
      return hide ? tables.filter((t) => !hide.tableIds.has(t.id)) : tables;
   });

   /** Sequence diagrams hidden by focus mode. */
   readonly hiddenDiagramIds = computed<ReadonlySet<string> | null>(() => this.focusHidden()?.diagramIds ?? null);

   /**
    * Slides zoomed out inside their block (Ctrl + scroll over a shown slide). Their frame
    * and items are drawn in a layer of their own, scaled about the frame's centre and
    * clipped to the block, so the staging room around the frame shows.
    */
   readonly slideViews = computed<SlideView[]>(() => {
      // Every shown slide is drawn through its block, also at scale 1: the block is a
      // window onto the slide, so items staged outside the frame only show zoomed out.
      const zoom = this.store.slideZoom();
      const pan = this.store.slidePan();
      const frames = this.store.slideFrames();
      return [...this.store.shownByPresentation()].flatMap(([name, id]) => {
         const frame = frames.find((f) => f.id === id);
         return frame ? [slideView(frame, name, zoom[name] ?? 1, pan[name], this.slideFloor(frame))] : [];
      });
   });

   /** How far a slide may zoom out: further when its own content reaches past the usual limit. */
   slideFloor(frame: CanvasElementModel): number {
      const boxes = [
         ...this.store.elements().filter((e) => e.slideId === frame.id && e.type !== 'frame').map(elementBox),
         ...this.store.tables().filter((t) => t.slideId === frame.id).map(tableBox),
      ];
      return slideZoomFloor(frame, boxes);
   }

   /** Which zoomed slide view draws each item (frame + what the slide owns), by kind. */
   readonly zoomedItems = computed(() => {
      const views = new Map(this.slideViews().map((v) => [v.frameId, v]));
      const elements = new Map<string, SlideView>();
      const tables = new Map<string, SlideView>();
      const diagrams = new Map<string, SlideView>();
      // A shape being drawn inside a zoomed slide is drawn there before it is saved.
      const draft = this.tools.draft();
      const draftView = draft ? views.get(this.tools.drawSlideId() ?? '') : undefined;
      if (draft && draftView) elements.set(draft.id, draftView);
      if (views.size) {
         // A zoomed slide's layout and master items are drawn in its layer too, beneath its own.
         const frames = this.store.slideFrames();
         const layoutViews = new Map<string, SlideView>();
         for (const f of frames) {
            const v = views.get(f.id);
            if (!v) continue;
            for (const u of [layoutOf(f, frames), masterOf(f, frames)]) {
               if (u && !views.has(u.id) && !layoutViews.has(u.id)) layoutViews.set(u.id, v);
            }
         }
         const locked = this.store.layoutItemIds();
         for (const e of this.store.elements()) {
            // The frame joins its layer only zoomed out: at scale 1 its title strip and
            // handles sit on or past the block's edge, where the layer clips.
            const own = views.get(e.id);
            const v =
               own && !isPlainView(own)
                  ? own
                  : e.slideId
                    ? (views.get(e.slideId) ?? (locked.has(e.id) ? layoutViews.get(e.slideId) : undefined))
                    : undefined;
            if (v) elements.set(e.id, v);
         }
         for (const t of this.store.tables()) {
            const v = t.slideId ? views.get(t.slideId) : undefined;
            if (v) tables.set(t.id, v);
         }
         for (const d of this.store.sequenceDiagrams()) {
            const v = d.slideId ? views.get(d.slideId) : undefined;
            if (v) diagrams.set(d.id, v);
         }
      }
      return { elements, tables, diagrams };
   });

   /** The zoomed slide view an item is drawn in, if any. */
   viewOf(id: string): SlideView | undefined {
      const z = this.zoomedItems();
      return z.elements.get(id) ?? z.tables.get(id) ?? z.diagrams.get(id);
   }

   /**
    * Slide zoom an item is drawn at (1 on the plain canvas). The slide frame itself is
    * the block: moving it moves the whole presentation at canvas scale.
    */
   itemScale(id: string): number {
      const v = this.viewOf(id);
      return v && v.frameId !== id ? v.scale : 1;
   }

   /**
    * The viewport an item is effectively drawn through: the canvas viewport, composed
    * with its slide's zoom when it sits in a zoomed-out slide. For overlays placed in
    * screen px over an item (inline text / cell editors).
    */
   viewportFor(id: string): { x: number; y: number; zoom: number } {
      const v = this.store.viewport();
      const view = this.viewOf(id);
      if (!view) return v;
      return {
         x: v.x + (view.cx - view.fx * view.scale) * v.zoom,
         y: v.y + (view.cy - view.fy * view.scale) * v.zoom,
         zoom: v.zoom * view.scale,
      };
   }

   /** An item's box as drawn on the canvas (through its slide's zoom, if any). */
   drawnBox(id: string, box: Box): Box {
      const view = this.viewOf(id);
      return view ? boxToOuter(view, box) : box;
   }

   /**
    * A canvas rect as seen through a slide's block: clipped to the block and mapped into
    * the slide's coordinates; null when it misses the block (nothing there is visible).
    */
   rectThrough(view: SlideView, rect: Rect): Rect | null {
      const k = view.block;
      const x0 = Math.max(rect.minX, k.x0);
      const y0 = Math.max(rect.minY, k.y0);
      const x1 = Math.min(rect.maxX, k.x1);
      const y1 = Math.min(rect.maxY, k.y1);
      if (x0 > x1 || y0 > y1) return null;
      const p = toInner(view, { x: x0, y: y0 });
      const q = toInner(view, { x: x1, y: y1 });
      return { minX: p.x, minY: p.y, maxX: q.x, maxY: q.y };
   }

   /** Tables drawn on the canvas itself (not inside a zoomed slide). */
   /** Whether the canvas is big enough to draw only what is near the view. */
   private readonly culling = computed(
      () => this.store.elements().length + this.store.tables().length > CULL_THRESHOLD
   );

   /**
    * World area the canvas draws when culling: the view plus a margin. It only moves when
    * the view leaves it (or shrinks well inside it), so most pan frames keep the same lists.
    */
   private readonly cullRect = linkedSignal<Box | null, Box | null>({
      source: () => (this.culling() ? this.viewport.minimapView() : null),
      computation: (view, previous) => {
         if (!view) return null;
         const prev = previous?.value;
         const w = view.x1 - view.x0;
         const h = view.y1 - view.y0;
         if (prev) {
            const inside = view.x0 >= prev.x0 && view.y0 >= prev.y0 && view.x1 <= prev.x1 && view.y1 <= prev.y1;
            const prevArea = (prev.x1 - prev.x0) * (prev.y1 - prev.y0);
            if (inside && w * h * 16 > prevArea) return prev;
         }
         return {
            x0: view.x0 - w * CULL_MARGIN,
            y0: view.y0 - h * CULL_MARGIN,
            x1: view.x1 + w * CULL_MARGIN,
            y1: view.y1 + h * CULL_MARGIN,
         };
      },
   });

   /** Items always drawn, wherever they are: the selection, the inline edit and the draft. */
   private readonly neverCulled = computed(
      () =>
         new Set<string>([
            ...this.store.selectedElementIds(),
            ...this.store.selectedTableIds(),
            ...this.store.selectedRelationshipIds(),
            this.host.editingTextId() ?? '',
            this.tools.draft()?.id ?? '',
         ])
   );

   private readonly elementById = computed(() => new Map(this.store.elements().map((e) => [e.id, e])));

   /** Tables drawn on the canvas itself (not inside a zoomed slide), near the view when culling. */
   readonly outerTables = computed(() => {
      const z = this.zoomedItems().tables;
      const all = this.visibleTables();
      const outer = z.size ? all.filter((t) => !z.has(t.id)) : all;
      const rect = this.cullRect();
      if (!rect) return outer;
      const keep = this.neverCulled();
      return outer.filter((t) => keep.has(t.id) || boxesOverlap(tableBox(t), rect));
   });

   readonly outerShapeViews = computed(() => {
      const z = this.zoomedItems().elements;
      const all = this.shapeViews();
      const outer = z.size ? all.filter((v) => !z.has(v.id)) : all;
      const rect = this.cullRect();
      if (!rect) return outer;
      const keep = this.neverCulled();
      const byId = this.elementById();
      return outer.filter((v) => {
         const e = byId.get(v.id);
         return !e || keep.has(v.id) || boxesOverlap(elementBox(e), rect);
      });
   });

   /** Relationship lines between two tables of the same zoomed slide are drawn inside it. */
   readonly zoomedConnectorIds = computed(() => {
      const out = new Map<string, SlideView>();
      const z = this.zoomedItems().tables;
      if (!z.size) return out;
      const tableOf = new Map<string, string>();
      for (const t of this.store.tables()) for (const c of t.columns) tableOf.set(c.id, t.id);
      for (const r of this.store.relationships()) {
         const a = z.get(tableOf.get(r.sourceColumnId) ?? '');
         const b = z.get(tableOf.get(r.targetColumnId) ?? '');
         if (a && a === b) out.set(r.id, a);
      }
      return out;
   });

   readonly outerConnectors = computed(() => {
      const z = this.zoomedConnectorIds();
      const all = this.displayConnectors();
      const outer = z.size ? all.filter((c) => !z.has(c.id)) : all;
      const rect = this.cullRect();
      if (!rect) return outer;
      const keep = this.neverCulled();
      return outer.filter((c) => {
         if (keep.has(c.id)) return true;
         const pts = c.routePoints.length
            ? c.routePoints
            : [
                 { x: c.ax, y: c.ay },
                 { x: c.bx, y: c.by },
              ];
         const xs = pts.map((p) => p.x);
         const ys = pts.map((p) => p.y);
         return boxesOverlap(
            { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
            rect
         );
      });
   });

   readonly outerHiddenDiagramIds = computed<ReadonlySet<string> | null>(() => {
      const z = this.zoomedItems().diagrams;
      const hidden = this.hiddenDiagramIds();
      return z.size ? new Set([...(hidden ?? []), ...z.keys()]) : hidden;
   });

   /** Everything each zoomed slide view draws, for its own set of layers. */
   readonly slideViewLayers = computed(() => {
      const z = this.zoomedItems();
      const conn = this.zoomedConnectorIds();
      const shapes = this.shapeViews();
      const tables = this.visibleTables();
      const connectors = this.displayConnectors();
      const hidden = this.hiddenDiagramIds();
      const diagrams = this.store.sequenceDiagrams();
      return this.slideViews().map((v) => ({
         view: v,
         transform: slideViewTransform(v),
         left: v.block.x0,
         top: v.block.y0,
         width: v.block.x1 - v.block.x0,
         height: v.block.y1 - v.block.y0,
         shapes: shapes.filter((s) => z.elements.get(s.id) === v),
         tables: tables.filter((t) => z.tables.get(t.id) === v),
         connectors: connectors.filter((c) => conn.get(c.id) === v),
         hiddenDiagramIds: new Set(
            diagrams.filter((d) => z.diagrams.get(d.id) !== v || hidden?.has(d.id)).map((d) => d.id)
         ) as ReadonlySet<string>,
         toWorld: (clientX: number, clientY: number) => toInner(v, this.viewport.toWorldRaw(clientX, clientY)),
      }));
   });

   readonly columnLocations = computed(() => buildColumnLocations(this.store.tables()));

   /** Frame boxes (connectors stay inside a shared frame); unchanged unless a frame moves or resizes. */
   private readonly frameBoxes = computed(
      () =>
         this.store
            .elements()
            .filter((e) => e.type === 'frame')
            .map(elementBox),
      { equal: sameBoxes }
   );

   readonly connectors = computed(() =>
      computeConnectors(
         this.visibleTables(),
         this.store.relationships(),
         new Set(this.store.selectedRelationshipIds()),
         this.frameBoxes(),
         this.connectorRoutes
      )
   );

   /** Routes of relationships nothing moved around since the last pass (see computeConnectors). */
   private readonly connectorRoutes = new ConnectorRouteCache();

   /** World boxes of sequence message labels: anchor targets for lines/arrows. */
   readonly messageBoxes = computed(() =>
      messageLabelBoxes(this.store.sequenceDiagrams(), this.store.lifelines(), this.store.sequenceMessages())
   );

   /**
    * Stacking of sequence diagrams against drawing elements. A diagram with a
    * zIndex at or below the topmost element sits among the content shapes (the
    * content layer is split into slices around each such diagram); one above
    * every element also clears the table nodes. Table nodes stay at z 400;
    * elements flagged `aboveTables` draw in their own slice at z 401.
    */
   readonly diagramLayers = computed(() => {
      const els = this.store.elements().filter((e) => e.type !== 'frame');
      const maxZ = els.reduce((m, e) => Math.max(m, e.zIndex), -Infinity);
      const sorted = [...this.store.sequenceDiagrams()].sort((a, b) => a.zIndex - b.zIndex);
      const among = sorted.filter((d) => d.zIndex <= maxZ);
      const z = new Map<string, number>();
      among.forEach((d, i) => z.set(d.id, 11 + 2 * i));
      // 401 is the above-tables content slice (elements brought in front of the ERD).
      sorted.filter((d) => d.zIndex > maxZ).forEach((d, i) => z.set(d.id, 402 + i));
      const segmentOf = new Map<string, number>();
      // A shown slide's layout items sit beneath everything on it.
      const locked = this.store.layoutItemIds();
      for (const e of els) {
         if (locked.has(e.id)) {
            segmentOf.set(e.id, 0);
            continue;
         }
         if (e.aboveTables) {
            segmentOf.set(e.id, among.length + 1);
            continue;
         }
         let s = 0;
         while (s < among.length && among[s].zIndex < e.zIndex) s++;
         segmentOf.set(e.id, s);
      }
      return { z, segmentOf, segments: among.length + 1 };
   });

   /** One content-layer slice per gap between diagrams (a single one without diagrams). */
   readonly contentSegments = computed(() => {
      const { segmentOf, segments } = this.diagramLayers();
      // One extra slice above the table nodes for elements flagged `aboveTables`.
      return Array.from({ length: segments + 1 }, (_, index) => ({
         index,
         z: index === segments ? 401 : 10 + 2 * index,
         // Anything unknown (the in-progress draft) is newest, so it draws on top.
         accept: (id: string): boolean => (segmentOf.get(id) ?? segments - 1) === index,
      }));
   });

   /** Render views for all elements plus any in-progress draft, resolved for the SVG layer. */
   readonly shapeViews = computed(() => {
      const draft = this.tools.draft();
      const hide = this.focusHidden();
      const shown = hide ? this.store.elements().filter((e) => !hide.elementIds.has(e.id)) : this.store.elements();
      // A shown slide's layout items draw beneath it, locked.
      const locked = this.store.layoutItemIds();
      const editing = this.host.editingTextId();
      const looks = this.emptyCopyLooks();
      const fills = this.layoutFills();
      // Elements draw in array order, so a shown slide's layout items go first (beneath it).
      const ordered = locked.size
         ? [...shown.filter((e) => locked.has(e.id)), ...shown.filter((e) => !locked.has(e.id))]
         : shown;
      const masters = this.store.masterItemIds();
      const under = this.inheritedOffsets();
      const all = ordered.map((e) => {
         if (locked.has(e.id)) {
            // The master's items sit below the layout's.
            const depth = masters.has(e.id) ? 2 : 1;
            // Drawn where the shown slide is (its layout catches up once a drag settles).
            const d = e.slideId ? under.get(e.slideId) : undefined;
            const at = d ? { x: e.x + d.dx, y: e.y + d.dy } : {};
            return { ...e, ...at, zIndex: e.zIndex - LAYOUT_Z_OFFSET * depth, aboveTables: false };
         }
         const fill = fills.get(e.id);
         if (fill) return { ...e, ...fill };
         // An empty placeholder copy shows its layout slot's text, ghosted (not while typed into).
         const look = looks.get(e.id);
         if (look && e.id !== editing) return { ...look.el, opacity: look.el.opacity * 0.45 };
         if (isEmptyPlaceholder(e) && e.id !== editing) {
            return { ...e, text: placeholderPrompt(e.placeholder!), runs: undefined, opacity: e.opacity * 0.45 };
         }
         return e;
      });
      // Fields ({{slide}}, {{date}}, ...) stay as tokens on the canvas; they fill in when presenting/exporting.
      const filled = all;
      // A diff card being edited shows both sides plain, one under each of its two editors.
      const editedDiff = editing ? filled.find((e) => e.id === editing) : undefined;
      const diffEditingId = editedDiff?.type === 'code' && codeDiffActive(editedDiff) ? editing : null;
      // Deck theme tokens ($accent1, $heading, ...) resolve against each item's presentation.
      const elements = resolveThemedElements(draft ? [...filled, draft] : filled, this.store.slideFrames());
      // Depend on the theme so colors re-resolve (and re-contrast) on toggle, and re-measure
      // text once web fonts arrive.
      this.theme.dark();
      this.fontMetrics.fontsLoaded$();
      const views = buildShapeViews(
         elements,
         this.visibleTables(),
         new Set(this.store.selectedElementIds()),
         this.themeColors(),
         this.messageBoxes(),
         diffEditingId,
         { cache: this.shapeViewCache, generation: this.fontMetrics.generation }
      );
      // Slide items staged wholly outside their frame (morph entrances/exits) are dimmed:
      // they are part of the slide but never shown when presenting.
      const frames = new Map(this.store.slideFrames().map((f) => [f.id, f]));
      const offSlide = new Set(
         elements
            .filter((e) => {
               const f = e.slideId ? frames.get(e.slideId) : undefined;
               if (!f || e.type === 'frame') return false;
               const b = elementBox(e);
               return b.x1 <= f.x || b.x0 >= f.x + f.width || b.y1 <= f.y || b.y0 >= f.y + f.height;
            })
            .map((e) => e.id)
      );
      // Derived copies are memoized per view, so unchanged items keep their object identity.
      const out = offSlide.size
         ? views.map((v) => (offSlide.has(v.id) ? variant(this.dimmedViews, v, dim) : v))
         : views;
      return locked.size ? out.map((v) => (locked.has(v.id) ? variant(this.lockedViews, v, lock) : v)) : out;
   });

   /** Unchanged elements keep their render view between rebuilds (see buildShapeViews). */
   private readonly shapeViewCache = new ShapeViewCache();

   private readonly dimmedViews = new WeakMap<ShapeView, ShapeView>();

   private readonly lockedViews = new WeakMap<ShapeView, ShapeView>();

   /** Resolved canvas background + text color for the render-time contrast guard. */
   readonly themeColors = computed(
      (): { canvasBg: string; text: string; surface: string } | undefined => {
         // Re-read the tokens only when the theme flips, not on every shape rebuild.
         this.theme.themeChanged$();
         try {
            const styles = getComputedStyle(this.viewport.canvasRef().nativeElement);
            const canvasBg = styles.getPropertyValue('--dd-canvas-bg').trim();
            const text = styles.getPropertyValue('--dd-text').trim();
            const surface = styles.getPropertyValue('--dd-surface').trim();
            return canvasBg && text ? { canvasBg, text, surface } : undefined;
         } catch {
            return undefined;
         }
      },
      { equal: (a, b) => a?.canvasBg === b?.canvasBg && a?.text === b?.text && a?.surface === b?.surface }
   );

   /** The shapes layer is interactive only in select mode (drawing passes through it). */
   /** Two or more independently movable units (a whole group counts as one). */
   readonly alignUnitCount = computed(() => {
      const byItem = this.store.groupByItem();
      const entered = this.store.enteredGroupId();
      const ids = [
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ];
      const units = new Set(
         ids.map((id) => {
            const g = byItem.get(id);
            return g && g !== entered ? g : id;
         })
      );
      return units.size;
   });

   /** Screen-space placement + value for the inline text editor overlay. */
   /**
    * Empty placeholder copies, drawn as their layout slot: its size, style and text (the
    * prompt), at the copy's own spot. `patch` is the slot look to store when typed into.
    */
   readonly emptyCopyLooks = computed(() => {
      const elements = this.store.elements();
      const out = new Map<string, { el: CanvasElementModel; patch: UpdateElementDto }>();
      if (!elements.some((e) => e.placeholder?.of)) return out;
      const byId = new Map(elements.map((e) => [e.id, e] as const));
      for (const e of elements) {
         const slot = e.placeholder?.of ? byId.get(e.placeholder.of) : undefined;
         if (!slot || !isEmptyPlaceholder(e)) continue;
         const patch = slotStyle(slot);
         out.set(e.id, {
            el: { ...e, ...(patch as Partial<CanvasElementModel>), text: slot.text, runs: slot.runs },
            patch,
         });
      }
      return out;
   });

   /** Slide placeholders nobody changed follow their layout slot when it moves or restyles. */
   private readonly followSlots = (() => {
      const follow = slotFollower(this.store);
      return effect(() => {
         this.store.elements();
         untracked(follow);
      });
   })();

   /**
    * Layout / master frames drawn under a shown frame -> how far that frame sits from
    * them (non-zero only while a moved slide's stack has not caught up yet).
    */
   private readonly inheritedOffsets = computed(() => {
      const frames = this.store.slideFrames();
      const shown = this.store.shownSlideIds();
      const out = new Map<string, { dx: number; dy: number }>();
      for (const f of frames) {
         if (!shown.has(f.id)) continue;
         for (const u of [layoutOf(f, frames), masterOf(f, frames)]) {
            if (u && !shown.has(u.id) && (u.x !== f.x || u.y !== f.y)) out.set(u.id, { dx: f.x - u.x, dy: f.y - u.y });
         }
      }
      return out;
   });

   /** Shown slides/layouts without a background of their own take their layout's, else the master's. */
   private readonly layoutFills = computed(() => {
      const frames = this.store.slideFrames();
      const shown = this.store.shownSlideIds();
      const out = new Map<string, Pick<CanvasElementModel, 'fillStyle' | 'backgroundColor'>>();
      const filled = (u: CanvasElementModel | undefined) => (u && u.fillStyle !== 'none' ? u : undefined);
      for (const f of frames) {
         const l =
            shown.has(f.id) && f.fillStyle === 'none'
               ? (filled(layoutOf(f, frames)) ?? filled(masterOf(f, frames)))
               : undefined;
         if (l) {
            out.set(f.id, { fillStyle: l.fillStyle, backgroundColor: l.backgroundColor });
         }
      }
      return out;
   });

   /** The deck theme an element's tokens resolve against (its presentation's, else the default). */
   deckThemeOf(el: Pick<CanvasElementModel, 'id' | 'type' | 'slideId'>): SlideTheme {
      const f =
         el.type === 'frame'
            ? this.store.slideFrames().find((x) => x.id === el.id)
            : this.store.slideFrames().find((x) => x.id === el.slideId);
      return (f && this.store.presentationThemes().get(presentationOf(f))) || DEFAULT_THEME;
   }

   /**
    * Connectors as rendered. While re-pointing an endpoint, the affected line's
    * own end follows the cursor (so the line moves in place) instead of showing a
    * separate temporary line.
    */
   readonly displayConnectors = computed(() => {
      const base = this.connectors();
      const relink = this.host.relinkPreview();
      if (!relink) {
         return base;
      }
      const cursor = relink.cursor;
      return base.map((c) => {
         if (c.id !== relink.relationshipId) {
            return c;
         }
         const fixed = relink.which === 'source' ? { x: c.bx, y: c.by } : { x: c.ax, y: c.ay };
         return {
            ...c,
            d: elbowPath(fixed, cursor),
            ax: relink.which === 'source' ? cursor.x : c.ax,
            ay: relink.which === 'source' ? cursor.y : c.ay,
            bx: relink.which === 'target' ? cursor.x : c.bx,
            by: relink.which === 'target' ? cursor.y : c.by,
            routePoints: [fixed, cursor],
            segments: [],
         };
      });
   });

   // --- drawing new elements ---

   /** Default stroke color for new elements: the theme's text color, so it reads on either theme. */
   defaultStroke(): string {
      try {
         const c = getComputedStyle(this.viewport.canvasRef().nativeElement).getPropertyValue('--dd-text').trim();
         return c || DEFAULT_ELEMENT_STROKE;
      } catch {
         return DEFAULT_ELEMENT_STROKE;
      }
   }

   /** Read a theme CSS custom property from the canvas, or null if unavailable. */
   themeVar(name: string): string | null {
      try {
         return getComputedStyle(this.viewport.canvasRef().nativeElement).getPropertyValue(name).trim() || null;
      } catch {
         return null;
      }
   }

   /** A sequence diagram's bounding box as drawn (header, spines and padding). */
   diagramBox(d: SequenceDiagramModel): Rect | null {
      const pad = 26;
      const lls = this.store.lifelines().filter((l) => l.diagramId === d.id);
      if (!lls.length) return null;
      const hb = d.originY + d.headerHeight;
      const maxRow = this.store
         .sequenceMessages()
         .filter((m) => m.diagramId === d.id)
         .reduce((mx, m) => Math.max(mx, Math.round((m.y - hb) / d.rowSpacing)), 0);
      return {
         minX: Math.min(...lls.map((l) => l.x - l.width / 2)) - pad,
         maxX: Math.max(...lls.map((l) => l.x + l.width / 2)) + pad,
         minY: d.originY - pad,
         maxY: hb + d.rowSpacing * (Math.max(1, maxRow) + 1) + pad,
      };
   }

   /** Simplified world-space footprint of every element, for the minimap. */
   readonly minimapItems = computed<MinimapItem[]>(() => {
      const items: MinimapItem[] = [];
      // Items of a shown slide are placed as drawn (through its zoom); the ones the block
      // does not show (staged outside its view) are left out, as on the canvas.
      const add = (id: string, item: MinimapItem): void => {
         const view = this.viewOf(id);
         if (!view) {
            items.push(item);
            return;
         }
         const b = boxToOuter(view, item);
         const k = view.block;
         if (b.x1 < k.x0 || b.x0 > k.x1 || b.y1 < k.y0 || b.y0 > k.y1) return;
         items.push({ ...item, ...b, points: item.points?.map((p) => toOuter(view, p)) });
      };
      for (const t of this.store.tables()) {
         add(t.id, {
            kind: 'table',
            x0: t.x,
            y0: t.y,
            x1: t.x + tableWidth(t),
            y1: t.y + tableHeight(t),
         });
      }
      for (const d of this.store.sequenceDiagrams()) {
         const b = this.diagramBox(d);
         if (b) {
            add(d.id, { kind: 'sequence', x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
         }
      }
      for (const el of this.store.elements()) {
         const b = elementBox(el);
         const kind: MinimapItem['kind'] =
            el.type === 'text'
               ? 'text'
               : el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw'
                 ? 'line'
                 : el.type === 'frame'
                   ? 'frame'
                   : el.type === 'code'
                     ? 'text'
                     : 'shape';
         add(el.id, {
            kind,
            ...b,
            points: kind === 'line' ? absolutePoints(el) : undefined,
         });
      }
      return items;
   });

   /** A sequence diagram's current layout, captured so it can be shifted rigidly. */
   sequenceStart(diagramId: string): SequenceStart | null {
      const d = this.store.sequenceDiagrams().find((x) => x.id === diagramId);
      if (!d) {
         return null;
      }
      const hb = d.originY + d.headerHeight;
      const rowOf = (y: number): number => Math.max(1, Math.round((y - hb) / d.rowSpacing));
      return {
         xs: new Map(
            this.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.x])
         ),
         originY: d.originY,
         rows: new Map(
            this.store
               .sequenceMessages()
               .filter((m) => m.diagramId === diagramId)
               .map((m) => [m.id, rowOf(m.y)])
         ),
      };
   }

   layoutSnapshot(diagramId: string): SequenceLayoutSnapshot {
      const cfg = this.store.sequenceDiagrams().find((x) => x.id === diagramId);
      return {
         lifelineXs: new Map(
            this.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.x])
         ),
         messageYs: new Map(
            this.store
               .sequenceMessages()
               .filter((m) => m.diagramId === diagramId)
               .map((m) => [m.id, m.y])
         ),
         originY: cfg?.originY ?? 0,
         rowSpacing: cfg?.rowSpacing ?? 48,
      };
   }

   /** Dashed outlines around selected groups and the group currently entered. */
   readonly groupOutlines = computed(() => {
      const groups = this.store.groups();
      if (!groups.size) {
         return [];
      }
      const entered = this.store.enteredGroupId();
      const selT = new Set(this.store.selectedTableIds());
      const selE = new Set(this.store.selectedElementIds());
      const selD = new Set(this.store.selectedDiagramIds());
      const tables = new Map(this.store.tables().map((t) => [t.id, t] as const));
      const elements = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const diagrams = new Map(this.store.sequenceDiagrams().map((d) => [d.id, d] as const));
      const lifelines = this.store.lifelines();
      const messages = this.store.sequenceMessages();
      const pad = 8;
      const out: {
         id: string;
         left: number;
         top: number;
         width: number;
         height: number;
         entered: boolean;
      }[] = [];
      for (const [gid, g] of groups) {
         const active =
            gid === entered ||
            g.tableIds.some((id) => selT.has(id)) ||
            g.elementIds.some((id) => selE.has(id)) ||
            g.diagramIds.some((id) => selD.has(id));
         if (!active) {
            continue;
         }
         const boxes: Box[] = [];
         for (const id of g.tableIds) {
            const t = tables.get(id);
            if (t) boxes.push(tableBox(t));
         }
         for (const id of g.elementIds) {
            const e = elements.get(id);
            if (e) boxes.push(elementBox(e));
         }
         for (const id of g.diagramIds) {
            const d = diagrams.get(id);
            const b = d ? sequenceDiagramBox(d, lifelines, messages) : null;
            if (b) boxes.push(b);
         }
         if (!boxes.length) {
            continue;
         }
         const x0 = Math.min(...boxes.map((b) => b.x0)) - pad;
         const y0 = Math.min(...boxes.map((b) => b.y0)) - pad;
         const x1 = Math.max(...boxes.map((b) => b.x1)) + pad;
         const y1 = Math.max(...boxes.map((b) => b.y1)) + pad;
         out.push({
            id: gid,
            left: x0,
            top: y0,
            width: x1 - x0,
            height: y1 - y0,
            entered: gid === entered,
         });
      }
      return out;
   });
}
