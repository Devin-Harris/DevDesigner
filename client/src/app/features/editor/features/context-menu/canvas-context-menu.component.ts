import {
   afterRenderEffect,
   computed,
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   inject,
   signal,
   viewChild,
} from '@angular/core';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import { CanvasContextMenuService } from '../../services/canvas-context-menu.service';
import type { ContextMenuEntry } from '../../models/context-menu.model';

const EDGE = 8;

/** Renders the canvas context menu at the pointer, kept on screen; closes on outside click / Escape. */
@Component({
   selector: 'dd-canvas-context-menu',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   template: `
      @if (svc.menu$(); as m) {
         <div
            #panel
            class="dd-menu ctx-menu"
            role="menu"
            tabindex="-1"
            [style.left.px]="pos$().x"
            [style.top.px]="pos$().y"
            (pointerdown)="$event.stopPropagation()"
            (contextmenu)="$event.preventDefault()"
            (keydown)="onKey($event)"
         >
            @if (m.title) {
               <div class="dd-menu-label">{{ m.title }}</div>
            }
            @for (r of rows$(); track $index) {
               @switch (r.type) {
                  @case ('sep') {
                     <div class="dd-menu-sep"></div>
                  }
                  @case ('heading') {
                     <div class="dd-menu-label">{{ r.text }}</div>
                  }
                  @case ('action') {
                     @if (r.action; as a) {
                        <button class="dd-menu-item" type="button" role="menuitem" [class.danger]="a.danger" (click)="pick(a)">
                           <dd-icon [name]="a.on === true ? 'check' : (a.icon ?? 'chevron_right')" [class.check]="a.on === true" />
                           {{ a.label }}
                           @if (a.kbd) {
                              <kbd>{{ a.kbd }}</kbd>
                           }
                        </button>
                     }
                  }
               }
            }
         </div>
      }
   `,
   styles: `
      .ctx-menu {
         position: fixed;
         z-index: 1000;
         min-width: 208px;
         max-height: calc(100vh - 16px);
      }
      dd-icon.check {
         color: var(--dd-primary);
      }
   `,
})
export class CanvasContextMenuComponent {
   protected readonly svc = inject(CanvasContextMenuService);
   private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
   protected readonly pos$ = signal({ x: 0, y: 0 });

   constructor() {
      // Place at the pointer, flipped / pushed to stay inside the window, then focus the first item.
      afterRenderEffect(() => {
         const m = this.svc.menu$();
         const el = this.panel()?.nativeElement;
         if (!m || !el) return;
         const w = el.offsetWidth;
         const h = el.offsetHeight;
         let x = m.x + 2;
         let y = m.y + 2;
         if (x + w > innerWidth - EDGE) x = Math.max(EDGE, m.x - w - 2);
         if (y + h > innerHeight - EDGE) y = Math.max(EDGE, innerHeight - EDGE - h);
         const cur = this.pos$();
         if (cur.x !== x || cur.y !== y) this.pos$.set({ x, y });
         if (!el.contains(document.activeElement)) el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      });

      const outside = (e: Event): void => {
         if (!this.svc.menu$()) return;
         const el = this.panel()?.nativeElement;
         if (el && e.target instanceof Node && el.contains(e.target)) return;
         this.svc.close();
      };
      const esc = (e: KeyboardEvent): void => {
         if (e.key === 'Escape' && this.svc.menu$()) {
            e.stopPropagation();
            this.svc.close();
         }
      };
      const close = (): void => this.svc.close();
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('wheel', outside, { capture: true, passive: true });
      window.addEventListener('keydown', esc, true);
      window.addEventListener('resize', close);
      window.addEventListener('blur', close);
      inject(DestroyRef).onDestroy(() => {
         window.removeEventListener('pointerdown', outside, true);
         window.removeEventListener('wheel', outside, true);
         window.removeEventListener('keydown', esc, true);
         window.removeEventListener('resize', close);
         window.removeEventListener('blur', close);
      });
   }

   /** Menu rows with their kind spelled out for the template. */
   protected readonly rows$ = computed(() =>
      (this.svc.menu$()?.items ?? []).map((it) =>
         'sep' in it
            ? { type: 'sep' as const }
            : 'heading' in it
              ? { type: 'heading' as const, text: it.heading }
              : { type: 'action' as const, action: it }
      )
   );

   protected pick(a: Extract<ContextMenuEntry, { run: () => void }>): void {
      this.svc.close();
      a.run();
   }

   /** Arrow keys move between items (Enter / Space click the focused one natively). */
   protected onKey(e: KeyboardEvent): void {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
         e.stopPropagation();
         return;
      }
      e.preventDefault();
      e.stopPropagation();
      const buttons = [...(this.panel()?.nativeElement.querySelectorAll<HTMLElement>('button') ?? [])];
      if (!buttons.length) return;
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      const next =
         e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
   }
}
