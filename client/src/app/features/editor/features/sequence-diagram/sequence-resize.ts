import { SequenceLayoutSnapshot } from '../../state/project/project.store';
import { sequenceBoundsFor } from '../../helpers/frame-contents.helper';
import { BOX_PAD, type Companions, type Drag, MIN_ROW, ZERO_BOUNDS } from './sequence-diagram.helpers';
import type { SequenceDiagramComponent } from './sequence-diagram.component';

/** Resize, respace and companion moves of a sequence diagram. */
export class SequenceResize {
   constructor(private readonly host: SequenceDiagramComponent) {}

   snapshotLayout(diagramId: string): SequenceLayoutSnapshot {
      const cfg = this.host.store.sequenceDiagrams().find((x) => x.id === diagramId);
      return {
         lifelineXs: new Map(
            this.host.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.x])
         ),
         messageYs: new Map(
            this.host.store
               .sequenceMessages()
               .filter((m) => m.diagramId === diagramId)
               .map((m) => [m.id, m.y])
         ),
         originY: cfg?.originY ?? 0,
         rowSpacing: cfg?.rowSpacing ?? 48,
         headerHeight: cfg?.headerHeight,
         scale: cfg?.scale ?? 1,
         lifelineWidths: new Map(
            this.host.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.width])
         ),
         bounds: this.host.boundsOf(cfg),
      };
   }

   /** Shift the whole diagram, snapping the block to the grid when grid-snap is on. */
   shiftDiagram(d: Extract<Drag, { kind: 'diagram' }>, event: PointerEvent): void {
      // A plain click (pointer within jitter range) must not snap an unaligned diagram.
      if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < 3) return;
      let dx = (event.clientX - d.startX) / this.host.zoom();
      let dy = (event.clientY - d.startY) / this.host.zoom();
      const smart = this.host.smartDrag()?.(
         d.diagramId,
         {
            diagrams: [d.diagramId, ...d.others.map((o) => o.diagramId)],
            elements: d.companions.elements.keys(),
            tables: d.companions.tables.keys(),
         },
         dx,
         dy
      );
      dx += smart?.ox ?? 0;
      dy += smart?.oy ?? 0;
      const snap = this.host.snap();
      if (snap && d.startXs.size) {
         // Align the block by its leftmost spine and its origin (axes a smart guide caught stay put).
         const refX = Math.min(...d.startXs.values());
         if (!smart?.snappedX) dx = snap(refX + dx) - refX;
         if (!smart?.snappedY) dy = snap(d.startOriginY + dy) - d.startOriginY;
      }
      this.host.store.shiftSequence(d.diagramId, d.startXs, dx, d.startOriginY, dy, d.startRows);
      for (const o of d.others) {
         this.host.store.shiftSequence(o.diagramId, o.startXs, dx, o.startOriginY, dy, o.startRows);
      }
      this.moveCompanions(d.companions, dx, dy);
   }

   /** Snapshot the selected tables/elements (and routes between them) to drag with the diagram. */
   captureCompanions(): Companions {
      const tableIds = new Set(this.host.store.selectedTableIds());
      const elementIds = new Set(this.host.store.selectedElementIds());
      const tables = new Map(
         this.host.store
            .tables()
            .filter((t) => tableIds.has(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }] as const)
      );
      const elements = new Map(
         this.host.store
            .elements()
            .filter((e) => elementIds.has(e.id))
            .map((e) => [e.id, { x: e.x, y: e.y }] as const)
      );
      const waypoints = new Map<string, { x: number; y: number }[]>();
      if (tables.size > 1) {
         const owner = new Map<string, string>();
         for (const t of this.host.store.tables()) for (const c of t.columns) owner.set(c.id, t.id);
         for (const r of this.host.store.relationships()) {
            const a = owner.get(r.sourceColumnId);
            const b = owner.get(r.targetColumnId);
            if (a && b && tables.has(a) && tables.has(b) && r.waypoints?.length) {
               waypoints.set(
                  r.id,
                  r.waypoints.map((w) => ({ ...w }))
               );
            }
         }
      }
      return { tables, elements, waypoints };
   }

   moveCompanions(c: Companions, dx: number, dy: number): void {
      const by = (p: { x: number; y: number }) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
      this.host.store.moveItemsLocal({
         tables: new Map([...c.tables].map(([id, p]) => [id, by(p)])),
         elements: new Map([...c.elements].map(([id, p]) => [id, by(p)])),
         waypoints: new Map([...c.waypoints].map(([id, wp]) => [id, wp.map(by)])),
      });
   }

   /**
    * Ctrl-resize: the scale at which the dragged edge of the drawn box lands on a smart
    * guide, or null when nothing snaps. The box is modelled as a function of the scale
    * (lifelines, header and rows scale about the anchor; the outer padding does not),
    * which is linear in k, so a snapped edge position inverts straight to a scale.
    */
   smartScale(
      d: Extract<Drag, { kind: 'resize' }>,
      k: number,
      centred: boolean,
      horiz: boolean,
      isLeft: boolean,
      vert: boolean,
      isTop: boolean
   ): number | null {
      const hook = this.host.smartEdges();
      const b0 = d.startBox;
      if (!hook || !b0) return null;
      const anchorX = centred ? d.centerX : isLeft ? d.right : d.left;
      const below = b0.y1 - BOX_PAD - d.top; // origin -> bottom edge, minus the padding
      const above = d.top - b0.y0; // padding + title room above the origin (fixed)
      const box = (s: number) => {
         const originY = centred
            ? d.centerY - (d.contentH * s) / 2
            : isTop
              ? d.top + d.contentH - d.contentH * s
              : d.top;
         return {
            x0: anchorX + (b0.x0 + BOX_PAD - anchorX) * s - BOX_PAD,
            x1: anchorX + (b0.x1 - BOX_PAD - anchorX) * s + BOX_PAD,
            y0: originY - above,
            y1: originY + below * s + BOX_PAD,
         };
      };
      const now = box(k);
      const ex = isLeft ? 'x0' : 'x1';
      const ey = isTop ? 'y0' : 'y1';
      const snap = hook(this.host.diagram$().id, now, horiz ? [now[ex]] : [], vert ? [now[ey]] : []);
      const invert = (edge: 'x0' | 'x1' | 'y0' | 'y1', target: number): number | null => {
         const at0 = box(0)[edge];
         const slope = box(1)[edge] - at0;
         return Math.abs(slope) > 1e-6 ? (target - at0) / slope : null;
      };
      if (snap?.snappedX) return invert(ex, now[ex] + snap.ox);
      if (snap?.snappedY) return invert(ey, now[ey] + snap.oy);
      return null;
   }

   /**
    * A resize drag. Plain: the box grows/shrinks around the content (never below it)
    * and the spacing is untouched. Alt: the content is respaced to fill the box (the
    * participants spread and the rows stretch). Ctrl: everything scales together.
    * Shift locks proportions.
    */
   applyResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl && !event.altKey) {
         this.applyBoundsResize(d, event);
         return;
      }
      // Respacing / scaling: the box hugs the content again (Ctrl scales the bounds along).
      this.host.store.setSequenceBoundsLocal(this.host.diagram$().id, ctrl ? d.startBounds : ZERO_BOUNDS);
      this.applyRespaceResize(d, event);
   }

   /** Plain resize: move the dragged edges of the outer box, clamped to the content. */
   applyBoundsResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      const c = d.startBox;
      const b0 = d.startOuter;
      if (!c || !b0) return;
      // Undo any Alt / Ctrl change made earlier in this drag.
      if (d.scaled !== 1) {
         d.scaled = 1;
         this.host.store.scaleSequenceLocal(this.host.diagram$().id, d.headerH, d.startScale, d.startWidths);
      }
      this.host.store.resizeSequenceTo(this.host.diagram$().id, d.startXs, 0, 1, d.startRowSpacing, d.top, d.startRows);
      const dx = (event.clientX - d.startX) / this.host.zoom();
      const dy = (event.clientY - d.startY) / this.host.zoom();
      const isLeft = d.handle.includes('w');
      const isRight = d.handle.includes('e');
      const isTop = d.handle.includes('n');
      const isBottom = d.handle.includes('s');
      const b = { ...b0 };
      if (isLeft) b.x0 += dx;
      if (isRight) b.x1 += dx;
      if (isTop) b.y0 += dy;
      if (isBottom) b.y1 += dy;
      if (event.shiftKey && (isLeft || isRight) && (isTop || isBottom)) {
         const w0 = b0.x1 - b0.x0;
         const h0 = b0.y1 - b0.y0;
         const k = Math.max((b.x1 - b.x0) / w0, (b.y1 - b.y0) / h0);
         if (isLeft) b.x0 = b0.x1 - w0 * k;
         else b.x1 = b0.x0 + w0 * k;
         if (isTop) b.y0 = b0.y1 - h0 * k;
         else b.y1 = b0.y0 + h0 * k;
      } else {
         // Smart guides, then the grid, on the dragged edges.
         const xs = isLeft ? [b.x0] : isRight ? [b.x1] : [];
         const ys = isTop ? [b.y0] : isBottom ? [b.y1] : [];
         const smart = this.host.smartEdges()?.(this.host.diagram$().id, b, xs, ys);
         const snap = this.host.snap();
         const fix = (v: number, snapped: boolean | undefined, off: number) => (snapped ? v + off : snap ? snap(v) : v);
         if (isLeft) b.x0 = fix(b.x0, smart?.snappedX, smart?.ox ?? 0);
         if (isRight) b.x1 = fix(b.x1, smart?.snappedX, smart?.ox ?? 0);
         if (isTop) b.y0 = fix(b.y0, smart?.snappedY, smart?.oy ?? 0);
         if (isBottom) b.y1 = fix(b.y1, smart?.snappedY, smart?.oy ?? 0);
      }
      // Never smaller than the content.
      b.x0 = Math.min(b.x0, c.x0);
      b.y0 = Math.min(b.y0, c.y0);
      b.x1 = Math.max(b.x1, c.x1);
      b.y1 = Math.max(b.y1, c.y1);
      this.host.store.setSequenceBoundsLocal(this.host.diagram$().id, sequenceBoundsFor(c, b));
   }

   /** Alt / Ctrl resize: new spread + vertical size for the content itself (Shift locks). */
   applyRespaceResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      const dx = (event.clientX - d.startX) / this.host.zoom();
      const dy = (event.clientY - d.startY) / this.host.zoom();
      const isLeft = d.handle.includes('w');
      const isRight = d.handle.includes('e');
      const isTop = d.handle.includes('n');
      const isBottom = d.handle.includes('s');
      // Alt now selects respacing, so it no longer resizes from the center.
      const centred = false;
      const factor = 1;
      const spanX = d.right - d.left;
      const horiz = (isLeft || isRight) && spanX > 1;

      let newW = horiz ? Math.max(20, spanX + (isLeft ? -dx : dx) * factor) : spanX;
      let newH =
         isTop || isBottom
            ? Math.max(d.headerH + MIN_ROW * d.nRows, d.contentH + (isTop ? -dy : dy) * factor)
            : d.contentH;

      // Ctrl (Cmd): scale the diagram with its content — spacing, header boxes and text
      // all grow or shrink together, proportions kept (like Ctrl + resize on shapes).
      if ((event.ctrlKey || event.metaKey) && d.contentH > 0) {
         const kx = horiz ? newW / spanX : 0;
         const ky = isTop || isBottom ? newH / d.contentH : 0;
         let k = Math.max(kx, ky) || 1;
         // Never below a readable size or the minimum row height.
         k = Math.max(k, 0.3 / d.startScale, MIN_ROW / Math.max(1, d.startRowSpacing));
         k = Math.min(k, 8 / d.startScale);
         k = this.smartScale(d, k, centred, horiz, isLeft, isTop || isBottom, isTop) ?? k;
         k = Math.max(k, 0.3 / d.startScale, MIN_ROW / Math.max(1, d.startRowSpacing));
         k = Math.min(k, 8 / d.startScale);
         const anchorX = centred ? d.centerX : isLeft ? d.right : d.left;
         const newContent = d.contentH * k;
         const originY = centred ? d.centerY - newContent / 2 : isTop ? d.top + d.contentH - newContent : d.top;
         d.scaled = k;
         this.host.store.scaleSequenceLocal(
            this.host.diagram$().id,
            d.headerH * k,
            d.startScale * k,
            new Map([...d.startWidths].map(([id, w]) => [id, Math.round(w * k)]))
         );
         // Extra room around the content scales along with it.
         this.host.store.setSequenceBoundsLocal(this.host.diagram$().id, {
            padLeft: Math.round(d.startBounds.padLeft * k),
            padTop: Math.round(d.startBounds.padTop * k),
            boxWidth: Math.round(d.startBounds.boxWidth * k),
            boxHeight: Math.round(d.startBounds.boxHeight * k),
         });
         this.host.store.resizeSequenceTo(
            this.host.diagram$().id,
            d.startXs,
            anchorX,
            spanX > 1 ? k : 1,
            d.startRowSpacing * k,
            originY,
            d.startRows
         );
         return;
      }
      this.host.smartDragEnd()?.();
      if (d.scaled !== 1) {
         // Ctrl let go mid-drag: back to the starting content size.
         d.scaled = 1;
         this.host.store.scaleSequenceLocal(this.host.diagram$().id, d.headerH, d.startScale, d.startWidths);
      }

      // Shift on a corner locks proportions.
      if (event.shiftKey && horiz && (isTop || isBottom) && d.contentH > 0) {
         const scale = Math.max(newW / spanX, newH / d.contentH);
         newW = spanX * scale;
         newH = d.contentH * scale;
      }

      // Grid snap: land the dragged edge(s) on the grid (skipped when Shift locks
      // proportions, since snapping each axis would break the ratio).
      const snap = this.host.snap();
      if (snap && !event.shiftKey) {
         const minH = d.headerH + MIN_ROW * d.nRows;
         if (horiz) {
            if (centred) {
               newW = Math.max(20, 2 * Math.abs(snap(d.centerX + newW / 2) - d.centerX));
            } else if (isRight) {
               newW = Math.max(20, snap(d.left + newW) - d.left);
            } else {
               newW = Math.max(20, d.right - snap(d.right - newW));
            }
         }
         if (isTop || isBottom) {
            if (centred) {
               newH = Math.max(minH, 2 * Math.abs(snap(d.centerY + newH / 2) - d.centerY));
            } else if (isBottom) {
               newH = Math.max(minH, snap(d.top + newH) - d.top);
            } else {
               const bottom = d.top + d.contentH;
               newH = Math.max(minH, bottom - snap(bottom - newH));
            }
         }
      }

      const scaleX = horiz ? newW / spanX : 1;
      const anchorX = centred ? d.centerX : isLeft ? d.right : d.left;
      const rowSpacing = d.nRows > 0 ? Math.max(MIN_ROW, (newH - d.headerH) / d.nRows) : d.startRowSpacing;

      let originY = d.top;
      if (isTop || isBottom) {
         if (centred) {
            originY = d.centerY - newH / 2;
         } else if (isTop) {
            originY = d.top + d.contentH - newH; // keep the bottom edge fixed
         }
      }
      this.host.store.resizeSequenceTo(
         this.host.diagram$().id,
         d.startXs,
         anchorX,
         scaleX,
         rowSpacing,
         originY,
         d.startRows
      );
   }

   layoutChanged(a: SequenceLayoutSnapshot, b: SequenceLayoutSnapshot): boolean {
      if (a.originY !== b.originY || a.rowSpacing !== b.rowSpacing) return true;
      if (a.headerHeight !== b.headerHeight || a.scale !== b.scale) return true;
      if (JSON.stringify(a.bounds) !== JSON.stringify(b.bounds)) return true;
      for (const [id, w] of a.lifelineWidths ?? []) if (b.lifelineWidths?.get(id) !== w) return true;
      for (const [id, x] of a.lifelineXs) if (b.lifelineXs.get(id) !== x) return true;
      for (const [id, y] of a.messageYs) if (b.messageYs.get(id) !== y) return true;
      return false;
   }
}
