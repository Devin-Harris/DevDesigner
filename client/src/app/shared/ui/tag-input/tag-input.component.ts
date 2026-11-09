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
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="box" [class.disabled]="disabled()" [class.focus]="focused()" [class.bad]="conflict()">
      <dd-icon name="link" class="lead" />
      <input
        #field
        type="text"
        autocomplete="off"
        spellcheck="false"
        [attr.maxlength]="maxlength()"
        [attr.placeholder]="placeholder()"
        [disabled]="disabled()"
        [value]="text()"
        (focus)="onFocus()"
        (input)="onInput($event)"
        (keydown)="onKey($event)"
        (blur)="onBlur()"
      />
      @if (text() && !disabled()) {
        <button type="button" class="clear" tabindex="-1" title="Clear tag" (mousedown)="$event.preventDefault()" (click)="clear()">
          <dd-icon name="close" />
        </button>
      }
    </div>
    @if (conflict()) {
      <p class="warn">{{ takenLabel() }}</p>
    }
    <ng-template #list>
      <div class="dd-menu tag-menu" [style.width.px]="menuWidth()">
        <div class="tag-menu-head">{{ headLabel() }}</div>
        @for (s of visible(); track s; let i = $index) {
          <button
            type="button"
            class="dd-menu-item"
            [class.on]="i === active()"
            (mousedown)="$event.preventDefault()"
            (mouseenter)="active.set(i)"
            (click)="pick(s)"
          >
            <span class="tag-name">{{ s }}</span>
          </button>
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .box {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        box-sizing: border-box;
        padding: 0 6px 0 9px;
        background: var(--dd-surface-2);
        border: 1px solid var(--dd-border);
        border-radius: var(--dd-radius-sm);
        transition:
          border-color 0.12s ease,
          box-shadow 0.12s ease;
      }
      .box:hover:not(.disabled) {
        border-color: var(--dd-border-strong);
      }
      .box.focus {
        border-color: var(--dd-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dd-primary) 22%, transparent);
      }
      .box.bad,
      .box.bad.focus {
        border-color: var(--dd-danger);
        box-shadow: none;
      }
      .warn {
        margin: 4px 2px 0;
        font-size: 11px;
        color: var(--dd-danger);
      }
      .box.disabled {
        opacity: 0.55;
      }
      .lead {
        --dd-icon-size: 15px;
        color: var(--dd-text-muted);
        flex: none;
      }
      input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: none;
        outline: none;
        background: transparent;
        font: inherit;
        font-family: var(--dd-font);
        font-size: 13px;
        color: var(--dd-text);
      }
      input::placeholder {
        color: var(--dd-faint, var(--dd-text-muted));
      }
      .clear {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: none;
        border-radius: var(--dd-radius-sm);
        background: transparent;
        color: var(--dd-text-muted);
        cursor: pointer;
        --dd-icon-size: 14px;
      }
      .clear:hover {
        background: var(--dd-surface);
        color: var(--dd-text);
      }
      .tag-menu {
        min-width: 0;
      }
      .tag-menu-head {
        padding: 4px 10px 5px;
        font-size: 10.5px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--dd-text-muted);
      }
      .tag-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
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
  private readonly takenKeys = computed(
    () => new Set(this.taken().map((t) => t.trim().toLowerCase())),
  );
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
      if (!s || seen.has(k) || this.takenKeys().has(k) || (q && !k.includes(q)) || (s === this.value() && this.draft() === null)) {
        return false;
      }
      seen.add(k);
      return true;
    });
  });
  protected readonly headLabel = computed(() =>
    (this.draft() ?? '').trim() ? 'Matching tags' : this.suggestionsLabel(),
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
