import { computed } from '@angular/core';
import {
   type GridData,
   type GridPart,
   clearGridTag,
   gridPartTag,
   parseGrid,
   serializeGrid,
   setGridPartTag,
} from '@devdesigner/shared';
import { gridMirrorPart, gridPartLabel, gridZoneAt } from './grid-zones.helper';
import { COL, type DragEnd, type Hit, type PartLine, type PctBox } from './deck-compare.model';
import type { DeckCompareComponent } from './deck-compare.component';

/** Drag-to-pair, forcing and zoom/pan gestures for the deck comparison. */
export class DeckCompareDrag {
   constructor(private readonly host: DeckCompareComponent) {}

   /** The grid part under a screen point (null = the whole table); see gridZoneAt. */
   zoneAt(
      side: 'a' | 'b',
      h: Hit,
      clientX: number,
      clientY: number,
      opts: { level?: GridPart['kind']; cellOnly?: boolean }
   ): GridPart | null {
      const el = this.host.hitEl(side, h.key);
      if (!el || !h.grid) return null;
      const r = el.getBoundingClientRect();
      return gridZoneAt(
         h.grid.rows,
         h.grid.cols,
         (clientX - r.left) / (r.width || 1),
         (clientY - r.top) / (r.height || 1),
         r.width,
         r.height,
         opts
      );
   }

   /** Grid parts to outline over the slides: the hovered zone and both ends of a part drag. */
   readonly zones = computed(() => {
      const out: Array<{
         side: 'a' | 'b';
         key: string;
         box: PctBox;
         label: string;
         kind: 'hover' | 'from' | 'over';
         color: string;
      }> = [];
      const add = (
         side: 'a' | 'b',
         key: string,
         part: GridPart | null,
         kind: 'hover' | 'from' | 'over',
         color: string
      ): void => {
         const h = (side === 'a' ? this.host.hitsA$() : this.host.hitsB$()).find((x) => x.key === key);
         if (!h?.grid) return;
         const box = part
            ? this.host.partRect(h, part)
            : { left: h.left, top: h.top, width: h.width, height: h.height };
         out.push({ side, key: `${kind}-${key}`, box, label: gridPartLabel(part), kind, color });
      };
      const d = this.host.drag$();
      if (d?.active) {
         if (d.from.part !== undefined) add(d.from.side, d.from.key, d.from.part, 'from', d.color);
         if (d.over && (d.from.part !== undefined || d.overPart))
            add(d.from.side === 'a' ? 'b' : 'a', d.over, d.overPart, 'over', d.color);
      } else if (!d) {
         const z = this.host.hoverZone();
         if (z) add(z.side, z.key, z.part, 'hover', 'var(--dd-primary)');
      }
      return out;
   });

   beginDrag(event: PointerEvent, from: DragEnd, moving: string | null, active: boolean): void {
      const fromHit = (from.side === 'a' ? this.host.hitsA$() : this.host.hitsB$()).find((x) => x.key === from.key);
      const color = this.host.lines$().find((l) => l.key === moving)?.color ?? fromHit?.color ?? 'var(--dd-primary)';
      this.host.hoverZone.set(null);
      this.host.drag$.set({
         from,
         moving,
         sx: event.clientX,
         sy: event.clientY,
         active,
         path: '',
         over: null,
         overPart: null,
         color,
      });
      if (active) this.dragTo(event.clientX, event.clientY);
      const move = (e: PointerEvent): void => {
         const d = this.host.drag$();
         if (!d) return;
         if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
         if (!d.active) this.host.drag$.set({ ...d, active: true });
         this.dragTo(e.clientX, e.clientY);
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         const d = this.host.drag$();
         this.host.drag$.set(null);
         if (!d?.active) return;
         this.host.suppressClick = true;
         setTimeout(() => (this.host.suppressClick = false), 0);
         // Drop on the object that was highlighted while dragging (what you see is what
         // you get); else whatever is under the pointer now.
         const other: 'a' | 'b' = d.from.side === 'a' ? 'b' : 'a';
         const target: DragEnd | null = d.over
            ? { side: other, key: d.over, part: d.overPart }
            : this.targetAt(e.clientX, e.clientY, d.from);
         if (!target) return;
         const fromHit = (d.from.side === 'a' ? this.host.hitsA$() : this.host.hitsB$()).find(
            (x) => x.key === d.from.key
         );
         const toHit = (target.side === 'a' ? this.host.hitsA$() : this.host.hitsB$()).find(
            (x) => x.key === target.key
         );
         if (!fromHit?.id || !toHit?.id) return;
         const [aId, bId] = d.from.side === 'a' ? [fromHit.id, toHit.id] : [toHit.id, fromHit.id];
         // Re-aiming a whole-table line onto a row / column / cell: the fixed end takes the
         // part at the same spot of its own table (its end can be re-aimed in turn).
         const fromPart =
            d.from.part ??
            (target.part && fromHit.grid && toHit.grid
               ? gridMirrorPart(toHit.grid, fromHit.grid, target.part)
               : undefined);
         if (fromPart && target.part) {
            const [aPart, bPart] = d.from.side === 'a' ? [fromPart, target.part] : [target.part, fromPart];
            this.forcePart(aId, aPart, bId, bPart, fromHit.partner === toHit.key);
         } else {
            this.host.force(aId, bId);
         }
         // Keep the new pair selected, so it is clear what changed.
         this.host.armed$.set({ side: target.side, key: target.key });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
   }

   dragTo(clientX: number, clientY: number): void {
      const d = this.host.drag$();
      if (!d) return;
      const start = this.host.centerOf(d.from.side, d.from.key, d.from.part);
      const end = this.host.toUnits(clientX, clientY);
      if (!start || !end) return;
      const target = this.targetAt(clientX, clientY, d.from);
      const snap = target ? this.host.centerOf(target.side, target.key, target.part) : null;
      const e = snap ?? end;
      const mx = (start.x + e.x) / 2;
      this.host.drag$.set({
         ...d,
         over: target?.key ?? null,
         overPart: target?.part ?? null,
         path: `M${start.x} ${start.y} C ${mx} ${start.y}, ${mx} ${e.y}, ${e.x} ${e.y}`,
      });
   }

   /** The object on the OTHER slide under the pointer, if it can be paired. */
   targetAt(clientX: number, clientY: number, from: DragEnd): DragEnd | null {
      const fromSide = from.side;
      // Geometry first: the smallest object box on the other slide that holds the pointer
      // (the innermost one, like clicking nested objects on the canvas). It works the same
      // for objects past the slide's edges, whose outlines may be clipped on screen.
      const geo = this.innermostAt(fromSide === 'a' ? 'b' : 'a', clientX, clientY);
      const el = geo
         ? (this.host.hitEl(fromSide === 'a' ? 'b' : 'a', geo.key) ?? undefined)
         : (document
              .elementsFromPoint(clientX, clientY)
              // Only this view's object outlines: the canvas underneath has "hit" boxes too.
              .filter(
                 (n) =>
                    (n as HTMLElement).classList?.contains('hit') &&
                    !!(n as HTMLElement).dataset['side'] &&
                    this.host.pairView()?.nativeElement.contains(n)
              )
              .sort((p, q) => p.clientWidth * p.clientHeight - q.clientWidth * q.clientHeight)[0] as
              HTMLElement | undefined);
      const side = el?.dataset['side'] as 'a' | 'b' | undefined;
      const key = el?.dataset['key'];
      if (!side || !key || side === fromSide) return null;
      const h = (side === 'a' ? this.host.hitsA$() : this.host.hitsB$()).find((x) => x.key === key);
      if (!h?.id) return null;
      // From a row / column / cell: only a part of the same kind, of a table, will do.
      // Over anything that is not a table, the drag pairs the whole objects instead.
      if (from.part) {
         if (!h.grid) return { side, key };
         return { side, key, part: this.zoneAt(side, h, clientX, clientY, { level: from.part.kind }) };
      }
      // Re-aiming a table-to-table line: the zones pick a part (the band round it: the table).
      const fromHit = (fromSide === 'a' ? this.host.hitsA$() : this.host.hitsB$()).find((x) => x.key === from.key);
      if (this.host.drag$()?.moving && from.part === undefined && fromHit?.grid && h.grid) {
         return { side, key, part: this.zoneAt(side, h, clientX, clientY, {}) };
      }
      return { side, key };
   }

   /**
    * The object on `side` a click there would pick on the canvas: from the topmost object
    * under the pointer down, see-through (unfilled) shapes let the pointer through to
    * smaller things inside them, and the first solid object stops the search. So a code
    * block inside a rectangle is picked even when it overflows the rectangle.
    */
   innermostAt(side: 'a' | 'b', clientX: number, clientY: number): Hit | null {
      const u = this.host.toUnits(clientX, clientY);
      if (!u) return null;
      const x = ((u.x - (side === 'b' ? COL + this.host.gap() : 0)) / COL) * 100;
      const y = (u.y / this.host.viewH$()) * 100;
      const byId = new Map(this.host.store.elements().map((e) => [e.id, e] as const));
      const under = (side === 'a' ? this.host.hitsA$() : this.host.hitsB$())
         .filter(
            (h) => !h.line && !!h.id && x >= h.left && x <= h.left + h.width && y >= h.top && y <= h.top + h.height
         )
         .sort((p, q) => (byId.get(q.id!)?.zIndex ?? 0) - (byId.get(p.id!)?.zIndex ?? 0));
      const seeThrough = (h: Hit): boolean => {
         const e = byId.get(h.id!);
         return (
            !!e &&
            (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'triangle') &&
            (e.fillStyle === 'none' || !e.backgroundColor || e.backgroundColor === 'transparent')
         );
      };
      let best: Hit | null = null;
      for (const h of under) {
         if (!best || h.width * h.height < best.width * best.height) best = h;
         if (!seeThrough(h)) {
            // A solid object on top wins over anything bigger beneath it.
            if (best !== h && !seeThrough(best)) best = h;
            break;
         }
      }
      return best;
   }

   unpairArmed(): void {
      const h = this.host.armedHit$();
      const side = this.host.armed$()?.side;
      if (!h) return;
      const aId = side === 'a' ? h.id : this.host.idOfKey(h.partner);
      const bId = side === 'b' ? h.id : this.host.idOfKey(h.partner);
      if (h.forced) {
         // A pairing you made: remove its tags, back to automatic.
         void this.host.store.batchHistory(async () => {
            if (aId) await this.host.store.updateElement(aId, { morphOut: null });
            if (bId) await this.host.store.updateElement(bId, { morphIn: null });
         });
         return;
      }
      // Only the later slide's side changes: its object fades in this time.
      if (bId) void this.host.store.updateElement(bId, { morphIn: `tag:solo-in-${bId.slice(0, 8)}` });
   }

   /**
    * Back to automatic for both objects: they pair with their look-alikes again (or,
    * when those are claimed by pairs you set, they fade out / in).
    */
   resetArmed(): void {
      const { aId, bId } = this.host.armedIds();
      // A pair turned into fade / no transition is no longer paired: find the other end
      // by the shared id the tags carry, and clear it too.
      const ids = [aId, bId].filter((x): x is string => !!x).map((x) => x.slice(0, 8));
      const linked = (k: string | null | undefined): boolean =>
         !!k && /^tag:(solo|cut)-(in|out)-/.test(k) && ids.some((id) => k.includes(id));
      void this.host.store.batchHistory(async () => {
         for (const e of this.host.store.elements()) {
            const patch: { morphIn?: null; morphOut?: null } = {};
            if (e.id === bId || linked(e.morphIn)) patch.morphIn = null;
            if (e.id === aId || linked(e.morphOut)) patch.morphOut = null;
            if ((patch.morphIn === null && e.morphIn) || (patch.morphOut === null && e.morphOut)) {
               await this.host.store.updateElement(e.id, patch);
            }
         }
      });
   }

   async forceOps(aId: string, bId: string): Promise<void> {
      const tag = `tag:pair-${aId.slice(0, 6)}-${bId.slice(0, 6)}`;
      const els = this.host.store.elements();
      const oldOut = els.find((e) => e.id === aId)?.morphOut;
      const oldIn = els.find((e) => e.id === bId)?.morphIn;
      // The objects these two were hand-paired with before lose that pairing too,
      // so no stale half-tag is left behind.
      const stale = els.filter(
         (e) =>
            e.id !== aId &&
            e.id !== bId &&
            ((!!oldOut && oldOut.startsWith('tag:pair-') && e.morphIn === oldOut) ||
               (!!oldIn && oldIn.startsWith('tag:pair-') && e.morphOut === oldIn))
      );
      for (const e of stale) {
         await this.host.store.updateElement(e.id, e.morphIn === oldOut ? { morphIn: null } : { morphOut: null });
      }
      await this.host.store.updateElement(aId, { morphOut: tag });
      await this.host.store.updateElement(bId, { morphIn: tag });
   }

   /**
    * Make a row / column / cell of grid `aId` (slide before) morph into one of grid
    * `bId`: split `out` / `in` tags in the grids' own JSON. The two tables are paired
    * too when they were not already.
    */
   forcePart(aId: string, aPart: GridPart, bId: string, bPart: GridPart, tablesPaired: boolean): void {
      const tag = `pair-${Math.random().toString(36).slice(2, 10)}`;
      const els = this.host.store.elements();
      const ea = els.find((x) => x.id === aId);
      const eb = els.find((x) => x.id === bId);
      if (ea?.type !== 'grid' || eb?.type !== 'grid') return;
      const oldOut = gridPartTag(parseGrid(ea.text), aPart, 'out');
      const oldIn = gridPartTag(parseGrid(eb.text), bPart, 'in');
      // The parts these two were paired with before lose that pairing too.
      const frames = new Set([this.host.previous()?.id, this.host.slide().id]);
      const grids = new Map<string, GridData>();
      for (const e of els) {
         if (e.type !== 'grid' || !e.slideId || !frames.has(e.slideId)) continue;
         const g = parseGrid(e.text);
         let m = g.morph;
         if (oldOut) m = clearGridTag(m, 'in', oldOut);
         if (oldIn) m = clearGridTag(m, 'out', oldIn);
         if (e.id === aId) m = setGridPartTag(m, aPart, 'out', tag);
         if (e.id === bId) m = setGridPartTag(m, bPart, 'in', tag);
         grids.set(e.id, { ...g, morph: m });
      }
      void this.host.store.batchHistory(async () => {
         if (!tablesPaired) await this.forceOps(aId, bId);
         for (const [id, g] of grids) {
            const text = serializeGrid(g);
            if (text !== els.find((x) => x.id === id)?.text) await this.host.store.updateElement(id, { text });
         }
      });
   }

   /** Remove a row / column / cell pairing (back to automatic). */
   removePartLine(l: PartLine): void {
      const els = this.host.store.elements();
      void this.host.store.batchHistory(async () => {
         for (const [id, dir] of [
            [l.aId, 'out'],
            [l.bId, 'in'],
         ] as const) {
            const e = els.find((x) => x.id === id);
            if (!e) continue;
            const g = parseGrid(e.text);
            await this.host.store.updateElement(id, {
               text: serializeGrid({ ...g, morph: clearGridTag(g.morph, dir, l.tag) }),
            });
         }
      });
      this.host.lit$.set(null);
   }

   /** The wheel zooms around the pointer, like the canvas. */
   onZoomWheel(e: WheelEvent): void {
      e.preventDefault();
      const fit = e.currentTarget as HTMLElement;
      const view = this.host.pairView()?.nativeElement;
      if (!view) return;
      const before = view.getBoundingClientRect();
      const fx = (e.clientX - before.left) / before.width;
      const fy = (e.clientY - before.top) / before.height;
      this.host.setZoom(this.host.zoom$() * Math.exp(-e.deltaY * 0.0025));
      requestAnimationFrame(() => {
         const after = view.getBoundingClientRect();
         fit.scrollLeft += after.left + fx * after.width - e.clientX;
         fit.scrollTop += after.top + fy * after.height - e.clientY;
      });
   }

   /** Middle-button drag pans the zoomed view. */
   startPan(e: PointerEvent): void {
      if (e.button !== 1) return;
      e.preventDefault();
      const fit = e.currentTarget as HTMLElement;
      const sx = e.clientX,
         sy = e.clientY,
         l = fit.scrollLeft,
         t = fit.scrollTop;
      fit.classList.add('panning');
      const move = (m: PointerEvent): void => {
         fit.scrollLeft = l - (m.clientX - sx);
         fit.scrollTop = t - (m.clientY - sy);
      };
      const up = (): void => {
         fit.classList.remove('panning');
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   }
}
