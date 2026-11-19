import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { StopClicksDirective } from '../../../../../../../../shared/ui/directives/stop-clicks.directive';

/**
 * The presenter's floating control bar: previous / next, position, slide name, timer,
 * laser, notes, overview and exit. Drag the grip to move it (double-click resets).
 */
@Component({
   selector: 'dd-presenter-controls',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [StopClicksDirective, IconComponent],
   templateUrl: './presenter-controls.component.html',
   styleUrl: './presenter-controls.component.scss',
})
export class PresenterControlsComponent {
   /** Faded out (the pointer is away from the bar). */
   readonly hidden = input(false);
   /** "3 / 12". */
   readonly position = input.required<number>();
   readonly count = input.required<number>();
   /** Click steps on this slide and how many have played. */
   readonly clicks = input(0);
   readonly clickStep = input(0);
   readonly name = input('');
   readonly clock = input('');
   readonly canPrev = input(true);
   readonly canNext = input(true);
   /** Following someone else's presentation: navigation is theirs. */
   readonly following = input(false);
   readonly laserOn = input(false);
   readonly notesOn = input(false);
   readonly gridOn = input(false);

   readonly prev = output();
   readonly next = output();
   readonly toggleLaser = output();
   readonly toggleNotes = output();
   readonly toggleGrid = output();
   readonly exit = output();

   /** How far the user has dragged the bar from its bottom-centre home. */
   protected readonly offset = signal({ x: 0, y: 0 });
   protected readonly transform = computed(() => {
      const o = this.offset();
      return `translate(calc(-50% + ${o.x}px), ${o.y}px)`;
   });
   private readonly drag = signal<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
   /** The bar is being dragged (the presenter keeps it and the cursor visible meanwhile). */
   readonly dragging = computed(() => this.drag() !== null);

   protected onDown(event: PointerEvent): void {
      event.preventDefault();
      event.stopPropagation();
      try {
         (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
         /* synthetic pointers can refuse capture */
      }
      const o = this.offset();
      this.drag.set({ id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: o.x, oy: o.y });
   }

   protected onMove(event: PointerEvent): void {
      const d = this.drag();
      if (!d || d.id !== event.pointerId) return;
      // Keep the bar on screen: centre stays within the viewport horizontally, and it can
      // travel from its bottom spot up to the top edge.
      const halfW = window.innerWidth / 2 - 40;
      const x = Math.max(-halfW, Math.min(halfW, d.ox + event.clientX - d.sx));
      const y = Math.max(-(window.innerHeight - 70), Math.min(0, d.oy + event.clientY - d.sy));
      this.offset.set({ x, y });
   }

   protected onUp(event: PointerEvent): void {
      if (this.drag()?.id === event.pointerId) this.drag.set(null);
   }
}
