import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { inject, Injectable } from '@angular/core';
import { LOCAL_LASER, LaserService } from '../../../../../core/realtime/laser.service';
import { RealtimeService } from '../../../../../core/realtime/realtime.service';
/** Drawing with the laser pointer (K): local trail plus the throttled relay to the room. */
@Injectable()
export class LaserInputService {
   private readonly laser = inject(LaserService);
   private readonly realtime = inject(RealtimeService);
   private readonly gesture = inject(PointerGestureService);
   private readonly viewport = inject(EditorViewportService);

   // --- laser pointer (ephemeral: never persisted, undoable, or dirtying) ---

   /** Pointer id currently driving the laser, or null when it is not held. */
   private laserPointerId: number | null = null;

   private lastLaserSent = 0;

   onLaserPointerDown(event: PointerEvent): void {
      // Middle-button and space-drag fall through to the canvas so panning still works.
      if (event.button !== 0 || this.gesture.spaceDown) {
         return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
         (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
         // synthetic/touch pointers can refuse capture; window listeners still see moves
      }
      this.laserPointerId = event.pointerId;
      this.addLaserSample(event, true);
   }

   onLaserPointerMove(event: PointerEvent): void {
      if (this.laserPointerId === event.pointerId) {
         this.addLaserSample(event, false);
      }
   }

   onLaserPointerUp(event: PointerEvent): void {
      if (this.laserPointerId !== event.pointerId) {
         return;
      }
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      this.laserPointerId = null;
      this.laser.release(LOCAL_LASER);
      this.realtime.sendLaser(world.x, world.y, true);
   }

   private addLaserSample(event: PointerEvent, force: boolean): void {
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      this.laser.add(LOCAL_LASER, world.x, world.y);
      const now = Date.now();
      if (!force && now - this.lastLaserSent < 33) {
         return;
      }
      this.lastLaserSent = now;
      if (this.realtime.hasPeers()) {
         this.realtime.sendLaser(world.x, world.y);
      }
   }
}
