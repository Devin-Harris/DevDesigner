import { Injectable, computed, signal } from '@angular/core';

/** How long a laser sample stays visible before it has fully faded (ms). */
export const LASER_TRAIL_MS = 1000;

/** The local participant's trail key (remote trails are keyed by participant id). */
export const LOCAL_LASER = 'local';

interface LaserSample {
   x: number;
   y: number;
   t: number;
   /** First sample of a new stroke: no segment is drawn from the previous sample. */
   start?: boolean;
}

interface LaserTrail {
   points: LaserSample[];
   /** Latest position while the pointer is held; null once released. */
   head: { x: number; y: number } | null;
}

/** A trail ready to render: world-space points with their age in [0, 1]. */
export interface LaserView {
   id: string;
   head: { x: number; y: number } | null;
   points: { x: number; y: number; age: number; start?: boolean }[];
}

/**
 * Ephemeral laser-pointer state for the local user and remote participants.
 * Nothing here is persisted, undoable, or part of the project: samples live for
 * about a second and are pruned by a requestAnimationFrame clock that only runs
 * while at least one trail is visible.
 */
@Injectable({ providedIn: 'root' })
export class LaserService {
   private readonly trails = signal<Record<string, LaserTrail>>({});
   private readonly now = signal(0);
   private frame: number | null = null;

   /** Every visible trail with per-point age, recomputed on each animation frame. */
   readonly views = computed<LaserView[]>(() => {
      const now = this.now();
      const out: LaserView[] = [];
      for (const [id, trail] of Object.entries(this.trails())) {
         const points = trail.points
            .map((p) => ({ x: p.x, y: p.y, age: (now - p.t) / LASER_TRAIL_MS, start: p.start }))
            .filter((p) => p.age < 1);
         if (points.length || trail.head) {
            out.push({ id, head: trail.head, points });
         }
      }
      return out;
   });

   /** Add a sample to a trail and mark the pointer as held. */
   add(id: string, x: number, y: number): void {
      const t = performance.now();
      // Keep the clock current so a fresh sample never reads as "from the future"
      // (now starts at 0, which made the first stroke's segments huge until the
      // first animation frame).
      this.now.set(t);
      this.trails.update((all) => {
         const prev = all[id];
         // A sample added while no pointer is held begins a new stroke.
         const start = !prev?.head;
         const points = [...(prev?.points ?? []).filter((p) => t - p.t < LASER_TRAIL_MS), { x, y, t, start }];
         return { ...all, [id]: { points, head: { x, y } } };
      });
      this.startClock();
   }

   /** The pointer was released: drop the head dot and let the trail fade out. */
   release(id: string): void {
      this.trails.update((all) => {
         const prev = all[id];
         return prev ? { ...all, [id]: { ...prev, head: null } } : all;
      });
      this.startClock();
   }

   /** Forget the trails of remote participants who are no longer in the room. */
   pruneRemote(liveIds: Set<string>): void {
      this.trails.update((all) => {
         const out: Record<string, LaserTrail> = {};
         for (const [id, trail] of Object.entries(all)) {
            if (id === LOCAL_LASER || liveIds.has(id)) {
               out[id] = trail;
            }
         }
         return out;
      });
   }

   clear(): void {
      this.trails.set({});
      this.stopClock();
   }

   private startClock(): void {
      if (this.frame !== null) {
         return;
      }
      const tick = (): void => {
         const t = performance.now();
         this.now.set(t);
         let alive = false;
         this.trails.update((all) => {
            const out: Record<string, LaserTrail> = {};
            for (const [id, trail] of Object.entries(all)) {
               const points = trail.points.filter((p) => t - p.t < LASER_TRAIL_MS);
               if (points.length || trail.head) {
                  out[id] = points.length === trail.points.length ? trail : { ...trail, points };
                  alive = true;
               }
            }
            return alive ? out : {};
         });
         this.frame = alive ? requestAnimationFrame(tick) : null;
      };
      this.frame = requestAnimationFrame(tick);
   }

   private stopClock(): void {
      if (this.frame !== null) {
         cancelAnimationFrame(this.frame);
         this.frame = null;
      }
   }
}
