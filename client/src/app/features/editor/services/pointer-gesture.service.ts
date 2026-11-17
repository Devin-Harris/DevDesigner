import { EditorViewportService } from './editor-viewport.service';
import type { DragMode } from '../models/drag-mode.model';
import { inject, signal, Injectable } from '@angular/core';
import { RealtimeService } from '../../../core/realtime/realtime.service';
import { ProjectStore } from '../state/project/project.store';
import type { Point } from '../models/geometry.model';
import type { SequenceStart } from '../models/sequence-start.model';
/**
 * State shared by the editor's canvas pointer gestures: what the current drag is doing, where it
 * started, the live modifier keys and the last pointer event.
 */
@Injectable()
export class PointerGestureService {
   private readonly store = inject(ProjectStore);
   private readonly realtime = inject(RealtimeService);
   private readonly viewport = inject(EditorViewportService);

   /** True while an element gesture is in progress, so the floating toolbar hides. */
   readonly gestureActive = signal(false);

   /** True once a move of elements / tables has passed the click threshold. */
   readonly movingItems = signal(false);

   mode: DragMode = 'idle';

   spaceDown = false;

   startClientX = 0;

   startClientY = 0;

   startViewportX = 0;

   startViewportY = 0;

   lastDrawPointer = { x: 0, y: 0 };

   /** True once the current drag has switched to dragging Alt-made copies. */
   dragCopied = false;

   /** Pointer was released while Alt-drag copies were still being created. */
   releasedWhileDuplicating = false;

   lastPointer: PointerEvent | null = null;

   /** Live Shift state, so a move drag can lock to an axis without a pointer move. */
   shiftHeld = false;

   /** Live Ctrl/Cmd state: the arrow end being placed skips binding to whatever is under it. */
   noBindHeld = false;

   private lastCursorSent = 0;

   /** Send our cursor position (world coords) to the room, throttled to ~25fps. */
   broadcastCursor(event: PointerEvent): void {
      if (!this.realtime.hasPeers()) {
         return;
      }
      const now = Date.now();
      if (now - this.lastCursorSent < 40) {
         return;
      }
      this.lastCursorSent = now;
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      this.realtime.sendCursor(world.x, world.y);
   }

   static additive(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
      return event.ctrlKey || event.metaKey || event.shiftKey;
   }

   /**
    * Pointer displacement (world units) of a move drag. While Shift is held (moving
    * or Alt-duplicating), movement locks to the dominant axis relative to the start.
    */
   /** True while the pointer is still within click-jitter range of where the drag began. */
   belowDragThreshold(clientX: number, clientY: number): boolean {
      return Math.hypot(clientX - this.startClientX, clientY - this.startClientY) < 3;
   }

   /**
    * Screen px -> world units factor of the current move/resize beyond the canvas zoom:
    * the slide zoom of the slide the grabbed item is drawn in (1 on the plain canvas).
    */
   gestureScale = 1;

   dragDelta(clientX: number, clientY: number): { dx: number; dy: number } {
      const zoom = this.store.viewport().zoom * this.gestureScale;
      let dx = (clientX - this.startClientX) / zoom;
      let dy = (clientY - this.startClientY) / zoom;
      if (this.shiftHeld) {
         if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0;
         } else {
            dx = 0;
         }
      }
      return { dx, dy };
   }

   // --- items carried by a table drag (tables, their routes, other selected items) ---

   /** Non-table selection members dragged along when a table is grabbed (groups, mixed selections). */
   nodeExtras: {
      elements: Map<string, { x: number; y: number }>;
      sequences: Map<string, SequenceStart>;
   } | null = null;

   dragTableId: string | null = null;

   multiDragStart = new Map<string, { x: number; y: number }>();

   // Manual routes touching the dragged tables. `both` true when both endpoints
   // move together (rigid translate). Otherwise only one end moves: the waypoint
   // nearest that anchor follows it vertically (so the closest vertical run
   // shrinks) while its x is absorbed by the horizontal run. `sourceMoved` picks
   // which end (first vs last waypoint) is the one being dragged.
   waypointDragStart = new Map<string, { wp: Point[]; both: boolean; sourceMoved: boolean }>();
}
