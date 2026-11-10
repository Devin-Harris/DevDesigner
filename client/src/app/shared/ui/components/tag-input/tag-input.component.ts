import { Overlay, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
   ChangeDetectionStrategy,
   Component,
   ElementRef,
   TemplateRef,
   ViewContainerRef,
   computed,
   inject,
   input,
   output,
   signal,
   viewChild,
   type OnDestroy,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Single-line tag field with type-ahead suggestions (e.g. the morph tags used on the
 * previous slide). Free text is always allowed: the suggestions only complete it.
 * Commits on Enter / blur / picking a suggestion (`commit`), like `dd-input`.
 */
@Component({
   selector: 'dd-tag-input',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './tag-input.component.html',
   styleUrl: './tag-input.component.scss',
})
export class TagInputComponent implements OnDestroy {
   private readonly overlay = inject(Overlay);
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
   private readonly vcr = inject(ViewContainerRef);

   /** The committed tag ('' = none). */
   readonly value = input<string>('');
   /** Tags to offer, best first. */
   readonly suggestions = input<readonly string[]>([]);
   readonly placeholder = input<string>('');
   readonly maxlength = input<number>(80);
   readonly disabled = input<boolean>(false);
   /** Tags that can't be used here (another object already has them); never offered or committed. */
   readonly taken = input<readonly string[]>([]);
   readonly takenLabel = input<string>('Already used by another object on this slide');
   /** Heading above the suggestion list. */
   readonly suggestionsLabel = input<string>('From the previous slide');
   /** Fires with the new tag ('' clears it) when the user commits. */
   readonly commit = output<string>();

   private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');
   private readonly list = viewChild.required<TemplateRef<unknown>>('list');

   protected readonly focused = signal(false);
   /** What is typed right now (follows `value` until the user edits). */
   private readonly draft = signal<string | null>(null);
   protected readonly text = computed(() => this.draft() ?? this.value());
   protected readonly active = signal(0);
   private readonly takenKeys = computed(() => new Set(this.taken().map((t) => t.trim().toLowerCase())));
   /** The typed text is a tag another object already carries. */
   protected readonly conflict = computed(() => {
      const d = (this.draft() ?? '').trim().toLowerCase();
      return d !== '' && this.takenKeys().has(d);
   });
   protected readonly menuWidth = signal(220);
   private ref: OverlayRef | null = null;

   /** Suggestions that contain the typed text (all of them when nothing is typed). */
   protected readonly visible = computed(() => {
      const q = (this.draft() ?? '').trim().toLowerCase();
      const seen = new Set<string>();
      return this.suggestions().filter((s) => {
         const k = s.toLowerCase();
         if (
            !s ||
            seen.has(k) ||
            this.takenKeys().has(k) ||
            (q && !k.includes(q)) ||
            (s === this.value() && this.draft() === null)
         ) {
            return false;
         }
         seen.add(k);
         return true;
      });
   });
   protected readonly headLabel = computed(() =>
      (this.draft() ?? '').trim() ? 'Matching tags' : this.suggestionsLabel()
   );

   protected onFocus(): void {
      this.focused.set(true);
      this.active.set(0);
      this.syncMenu();
   }

   protected onInput(event: Event): void {
      this.draft.set((event.target as HTMLInputElement).value);
      this.active.set(0);
      this.syncMenu();
   }

   protected onBlur(): void {
      this.focused.set(false);
      this.closeMenu();
      this.finish();
   }

   protected onKey(event: KeyboardEvent): void {
      const n = this.visible().length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
         event.preventDefault();
         if (n) {
            this.syncMenu();
            this.active.update((i) => (i + (event.key === 'ArrowDown' ? 1 : n - 1)) % n);
         }
      } else if (event.key === 'Enter') {
         event.preventDefault();
         const pick = this.ref && n ? this.visible()[this.active()] : undefined;
         if (pick !== undefined && this.draft() !== null && this.draft()!.trim() !== pick) {
            // A partial entry completes to the highlighted suggestion.
            this.pick(pick);
         } else {
            this.finish();
            this.closeMenu();
         }
      } else if (event.key === 'Escape') {
         if (this.ref) {
            event.stopPropagation();
            this.closeMenu();
         } else {
            this.draft.set(null);
            this.field().nativeElement.blur();
         }
      }
   }

   protected pick(tag: string): void {
      this.draft.set(tag);
      this.finish();
      this.closeMenu();
   }

   protected clear(): void {
      this.draft.set('');
      this.finish();
      this.field().nativeElement.focus();
   }

   /** Emit the typed tag when it differs from the committed one. */
   private finish(): void {
      const d = this.draft();
      this.draft.set(null);
      if (d === null || this.takenKeys().has(d.trim().toLowerCase())) return;
      const next = d.trim().slice(0, this.maxlength());
      if (next !== this.value()) this.commit.emit(next);
   }

   private syncMenu(): void {
      if (this.disabled() || !this.visible().length) {
         this.closeMenu();
         return;
      }
      if (this.ref) return;
      this.menuWidth.set(Math.max(180, this.host.nativeElement.getBoundingClientRect().width));
      this.ref = this.overlay.create({
         positionStrategy: this.overlay
            .position()
            .flexibleConnectedTo(this.host)
            .withPush(true)
            .withPositions([
               { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
               { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
            ]),
         scrollStrategy: this.overlay.scrollStrategies.reposition(),
         panelClass: 'dd-popover-panel',
      });
      this.ref.attach(new TemplatePortal(this.list(), this.vcr));
   }

   private closeMenu(): void {
      this.ref?.dispose();
      this.ref = null;
   }

   ngOnDestroy(): void {
      this.closeMenu();
   }
}
