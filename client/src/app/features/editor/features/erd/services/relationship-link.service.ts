import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { computed, inject, signal, Injectable, type Signal } from '@angular/core';
import type { RelationshipModel, RelationshipType } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import {
   type EndpointDownEvent,
   type SegmentDownEvent,
} from '../../canvas/components/canvas-connectors/canvas-connectors.component';
import { segmentDrag } from '../../../helpers/connectors.helper';
import { columnAnchor } from '../../../helpers/node-metrics.helper';
import { elbowPath } from '../../../helpers/svg-path.helper';
import { findLinkSnap, type LinkSnap } from '../helpers/link-snap.helper';
import type { Point, Side } from '../../../models/geometry.model';
import { type HandleEvent } from '../components/table-node/table-node.component';
import type { ColumnLocation } from '../../../models/geometry.model';
import type { Connector } from '../../../models/connector.model';
/** A relationship end being re-pointed. */
interface RelinkState {
   relationshipId: string;
   which: 'source' | 'target';
}

/** What relationship editing reads from the editor entry; the entry wires it with `connect`. */
export interface RelationshipLinkHost {
   readonly columnLocations: Signal<Map<string, ColumnLocation>>;
   readonly connectors: Signal<Connector[]>;
}

/**
 * Relationship editing on the canvas: drawing a new link from a column handle, re-pointing an
 * end, dragging a route segment, and the relationship toolbar's actions.
 */
@Injectable()
export class RelationshipLinkService {
   private readonly store = inject(ProjectStore);
   private readonly viewport = inject(EditorViewportService);
   private host!: RelationshipLinkHost;

   connect(host: RelationshipLinkHost): void {
      this.host = host;
   }

   readonly selectedRelInline = computed<{
      x: number;
      y: number;
      rel: RelationshipModel;
   } | null>(() => {
      const rel = this.store.selectedRelationship();
      if (!rel) {
         return null;
      }
      const connector = this.host.connectors().find((c) => c.id === rel.id);
      if (!connector) {
         return null;
      }
      const v = this.store.viewport();
      return { x: connector.mx * v.zoom + v.x, y: connector.my * v.zoom + v.y, rel };
   });

   // Linking / re-pointing
   readonly linkSourceColumnId = signal<string | null>(null);

   /** Edge handle the in-flight link started from; the new line is pinned there. */
   private readonly linkSourceSide = signal<Side>('right');

   readonly relinkState = signal<RelinkState | null>(null);

   readonly linkCursor = signal<{ x: number; y: number } | null>(null);

   // Relationship segment being dragged (Miro-style perpendicular slide)
   readonly activeSegment = signal<{
      relationshipId: string;
      segIndex: number;
      a: Point;
      b: Point;
      route: Point[];
   } | null>(null);

   /** True while any connector drag (link / re-point / segment) is in progress. */
   readonly dragging = computed(() => !!(this.linkSourceColumnId() || this.relinkState() || this.activeSegment()));

   /**
    * Column row the in-flight link / re-point would attach to if released now.
    * Magnetic: the cursor only has to be near a table, not on the tiny handle.
    */
   readonly linkSnap = computed<LinkSnap | null>(() => {
      const cursor = this.linkCursor();
      if (!cursor) {
         return null;
      }
      const relink = this.relinkState();
      let exclude: string | null = null;
      if (relink) {
         const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
         exclude = (relink.which === 'source' ? rel?.targetColumnId : rel?.sourceColumnId) ?? null;
      } else {
         exclude = this.linkSourceColumnId();
         if (!exclude) {
            return null;
         }
      }
      return findLinkSnap(this.store.tables(), cursor, exclude, this.store.viewport().zoom);
   });

   /** Dashed preview only for drawing a brand-new relationship (re-point moves the line itself). */
   readonly tempLink = computed<string | null>(() => {
      const cursor = this.linkSnap()?.anchor ?? this.linkCursor();
      const sourceId = this.linkSourceColumnId();
      if (!cursor || !sourceId || this.relinkState()) {
         return null;
      }
      const loc = this.host.columnLocations().get(sourceId);
      if (!loc) {
         return null;
      }
      const a = columnAnchor(loc.table, loc.index, this.linkSourceSide());
      // Orthogonal elbow, never a diagonal, to match the finished connectors.
      return elbowPath(a, cursor);
   });

   onConnectorSelect(payload: { id: string; event: PointerEvent }): void {
      this.store.selectRelationship(payload.id, PointerGestureService.additive(payload.event));
   }

   // --- relationship linking / re-pointing ---

   onHandleDown(payload: HandleEvent): void {
      if (!this.store.canEdit()) {
         return;
      }
      payload.event.preventDefault();
      this.relinkState.set(null);
      this.linkSourceColumnId.set(payload.columnId);
      this.linkSourceSide.set(payload.side);
      const loc = this.host.columnLocations().get(payload.columnId);
      if (loc) {
         const a = columnAnchor(loc.table, loc.index, payload.side);
         this.linkCursor.set({ x: a.x, y: a.y });
      }
   }

   onEndpointDown(payload: EndpointDownEvent): void {
      if (!this.store.canEdit()) {
         return;
      }
      this.linkSourceColumnId.set(null);
      this.relinkState.set({ relationshipId: payload.relationshipId, which: payload.which });
      this.linkCursor.set(this.viewport.toWorld(payload.event.clientX, payload.event.clientY));
   }

   onHandleUp(payload: HandleEvent): void {
      const relink = this.relinkState();
      if (relink) {
         payload.event.stopPropagation();
         const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
         const opposite = relink.which === 'source' ? rel?.targetColumnId : rel?.sourceColumnId;
         if (payload.columnId !== opposite) {
            this.repoint(relink, payload.columnId, payload.side);
         }
      } else {
         const sourceId = this.linkSourceColumnId();
         if (sourceId && sourceId !== payload.columnId) {
            payload.event.stopPropagation();
            void this.store.addRelationship(sourceId, payload.columnId, undefined, {
               sourceSide: this.linkSourceSide(),
               targetSide: payload.side,
               autoRoute: false,
            });
         }
      }
      this.clearLinking();
   }

   clearLinking(): void {
      this.linkSourceColumnId.set(null);
      this.relinkState.set(null);
      this.linkCursor.set(null);
   }

   /** Released off a handle but near a table: attach to the snapped row. */
   commitLinkSnap(): void {
      const snap = this.linkSnap();
      if (!snap) {
         return;
      }
      const relink = this.relinkState();
      if (relink) {
         this.repoint(relink, snap.columnId, snap.side);
         return;
      }
      const sourceId = this.linkSourceColumnId();
      if (sourceId && sourceId !== snap.columnId) {
         void this.store.addRelationship(sourceId, snap.columnId, undefined, {
            sourceSide: this.linkSourceSide(),
            targetSide: snap.side,
            autoRoute: false,
         });
      }
   }

   /**
    * Re-point one end of a line to a column + side. Dropping an end is an explicit
    * routing choice, so the line switches to manual with both sides pinned (the
    * other end keeps the side it currently uses) and its old bends are dropped.
    */
   private repoint(relink: RelinkState, columnId: string, side: Side): void {
      const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
      const connector = this.host.connectors().find((c) => c.id === relink.relationshipId);
      if (!rel) {
         return;
      }
      const source = relink.which === 'source';
      const sameColumn = (source ? rel.sourceColumnId : rel.targetColumnId) === columnId;
      void this.store.updateRelationship(rel.id, {
         ...(sameColumn ? {} : source ? { sourceColumnId: columnId } : { targetColumnId: columnId }),
         sourceSide: source ? side : (connector?.sourceSide ?? rel.sourceSide),
         targetSide: source ? (connector?.targetSide ?? rel.targetSide) : side,
         autoRoute: false,
         waypoints: [],
      });
   }

   // --- relationship segment dragging (Miro-style manual routing) ---

   onSegmentDown(payload: SegmentDownEvent): void {
      if (!this.store.canEdit()) {
         return;
      }
      const connector = this.host.connectors().find((c) => c.id === payload.relationshipId);
      if (!connector) {
         return;
      }
      // Hand-shaping a line takes it off auto: pin the sides it uses right now.
      if (connector.autoRoute) {
         void this.store.updateRelationship(connector.id, {
            autoRoute: false,
            sourceSide: connector.sourceSide,
            targetSide: connector.targetSide,
         });
      }
      this.activeSegment.set({
         relationshipId: payload.relationshipId,
         segIndex: payload.segmentIndex,
         a: { x: connector.ax, y: connector.ay },
         b: { x: connector.bx, y: connector.by },
         route: connector.routePoints,
      });
   }

   /** Reset route: drop every bend and hand the line back to best-path routing. */
   onResetRoute(relationshipId: string): void {
      if (this.store.canEdit()) {
         void this.store.updateRelationship(relationshipId, { autoRoute: true, waypoints: [] });
      }
   }

   /**
    * After a segment drag, store any side the line flipped to (the renderer flips
    * it live once a bend crosses past the far edge of its table), so the side
    * sticks even if the bends are later cleared.
    */
   persistFlippedSides(): void {
      const active = this.activeSegment();
      if (!active) {
         return;
      }
      const rel = this.store.relationships().find((r) => r.id === active.relationshipId);
      const c = this.host.connectors().find((x) => x.id === active.relationshipId);
      if (rel && c && (c.sourceSide !== rel.sourceSide || c.targetSide !== rel.targetSide)) {
         void this.store.updateRelationship(rel.id, { sourceSide: c.sourceSide, targetSide: c.targetSide });
      }
   }

   /** Double-clicking a line hands it back to best-path routing. */
   onAutoRoute(relationshipId: string): void {
      if (this.store.canEdit()) {
         void this.store.updateRelationship(relationshipId, { autoRoute: true, waypoints: [] });
      }
   }

   moveActiveSegment(clientX: number, clientY: number): void {
      const active = this.activeSegment();
      if (!active) {
         return;
      }
      // Connector routing never snaps to the grid, even in snap mode: column
      // anchors sit at row centers (off grid), so grid-snapped waypoints would not
      // line up with them and the line would jump around as tables move.
      const cursor = this.viewport.toWorld(clientX, clientY);
      const waypoints = segmentDrag(active.a, active.b, active.route, active.segIndex, cursor);
      this.store.setWaypoints(active.relationshipId, waypoints);
   }

   // --- relationship inline toolbar ---

   onSetRelType(type: RelationshipType): void {
      const rel = this.store.selectedRelationship();
      if (rel && this.store.canEdit()) {
         void this.store.updateRelationship(rel.id, { type });
      }
   }

   /**
    * Toggle best-path routing for every selected line (the toolbar's state is the
    * primary selection's). Turning it on drops manual bends; turning it off pins
    * the sides each line uses now so nothing jumps.
    */
   onToggleAutoRoute(): void {
      const primary = this.store.selectedRelationship();
      if (!primary || !this.store.canEdit()) {
         return;
      }
      const enable = primary.autoRoute === false;
      const ids = new Set(this.store.selectedRelationshipIds());
      for (const c of this.host.connectors()) {
         if (!ids.has(c.id)) {
            continue;
         }
         void this.store.updateRelationship(
            c.id,
            enable
               ? { autoRoute: true, waypoints: [] }
               : { autoRoute: false, sourceSide: c.sourceSide, targetSide: c.targetSide }
         );
      }
   }

   onDeleteRel(): void {
      const rel = this.store.selectedRelationship();
      if (rel && this.store.canEdit()) {
         void this.store.deleteRelationship(rel.id);
      }
   }

   /**
    * Keep manual relationship routes in place relative to their tables after the
    * tables moved from `start`. Both ends moved alike: the route translates rigidly.
    * Otherwise each waypoint takes a blend of the two ends' moves (nearer end
    * weighs more), and waypoint pairs that shared an x or y keep sharing it so the
    * route stays orthogonal.
    */
   followRoutes(start: Map<string, { x: number; y: number }>): void {
      const now = new Map(this.store.tables().map((t) => [t.id, t] as const));
      const delta = (id: string | undefined): { x: number; y: number } => {
         const a = id ? start.get(id) : undefined;
         const b = id ? now.get(id) : undefined;
         return a && b ? { x: b.x - a.x, y: b.y - a.y } : { x: 0, y: 0 };
      };
      const locs = this.host.columnLocations();
      for (const rel of this.store.relationships()) {
         const wp = rel.waypoints;
         if (!wp?.length) continue;
         const ds = delta(locs.get(rel.sourceColumnId)?.table.id);
         const dt = delta(locs.get(rel.targetColumnId)?.table.id);
         if (!ds.x && !ds.y && !dt.x && !dt.y) continue;
         const n = wp.length;
         const next = wp.map((w, i) => {
            const f = (i + 1) / (n + 1);
            return { x: w.x + ds.x + (dt.x - ds.x) * f, y: w.y + ds.y + (dt.y - ds.y) * f };
         });
         for (let i = 0; i + 1 < n; i++) {
            if (Math.abs(wp[i].x - wp[i + 1].x) < 0.5) {
               next[i].x = next[i + 1].x = (next[i].x + next[i + 1].x) / 2;
            }
            if (Math.abs(wp[i].y - wp[i + 1].y) < 0.5) {
               next[i].y = next[i + 1].y = (next[i].y + next[i + 1].y) / 2;
            }
         }
         this.store.setWaypoints(
            rel.id,
            next.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y) }))
         );
      }
   }
}
