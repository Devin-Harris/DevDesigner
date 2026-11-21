import { EditorViewportService } from '../../../services/editor-viewport.service';
import { computed, inject, signal, Injectable, effect, untracked } from '@angular/core';
import { RealtimeService } from '../../../../../core/realtime/realtime.service';
import { ProjectStore } from '../../../state/project/project.store';
/** Following a collaborator: jump to them and keep their cursor in view. */
@Injectable()
export class FollowService {
   private readonly store = inject(ProjectStore);
   private readonly realtime = inject(RealtimeService);
   private readonly viewport = inject(EditorViewportService);

   // ---- Following a collaborator -----------------------------------------
   /** Participant whose cursor the view keeps in sight, or null. */
   readonly followingId = signal<string | null>(null);

   readonly followingName$ = computed(() => {
      const id = this.followingId();
      return id ? (this.realtime.participants$().find((p) => p.id === id)?.name ?? null) : null;
   });

   /** Center the view on a collaborator's cursor. */
   jumpToParticipant(id: string): void {
      const c = this.realtime.remoteCursors().find((x) => x.participantId === id);
      if (!c) return;
      const rect = this.viewport.canvasRect();
      const v = this.store.viewport();
      this.viewport.animateViewport(rect.width / 2 - c.x * v.zoom, rect.height / 2 - c.y * v.zoom, v.zoom);
   }

   constructor() {
      // Keep the followed collaborator's cursor in the middle part of the view.
      effect(() => {
         const id = this.followingId();
         if (!id) return;
         if (!this.realtime.participants$().some((p) => p.id === id)) {
            untracked(() => this.followingId.set(null));
            return;
         }
         const c = this.realtime.remoteCursors().find((x) => x.participantId === id);
         if (!c) return;
         untracked(() => {
            const v = this.store.viewport();
            const { width, height } = this.viewport.canvasSize();
            const sx = c.x * v.zoom + v.x;
            const sy = c.y * v.zoom + v.y;
            if (sx < width * 0.2 || sx > width * 0.8 || sy < height * 0.2 || sy > height * 0.8) {
               this.jumpToParticipant(id);
            }
         });
      });
   }
}
