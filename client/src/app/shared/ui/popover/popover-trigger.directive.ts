import { Overlay, type OverlayRef, type ConnectedPosition } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  TemplateRef,
  ViewContainerRef,
  type OnDestroy,
} from '@angular/core';

type PopoverPlacement =
  | 'below-start'
  | 'below-end'
  | 'above-start'
  | 'above-end'
  | 'right-start'
  | 'left-start';

const POSITIONS: Record<PopoverPlacement, ConnectedPosition> = {
  'below-start': { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  'below-end': { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  'above-start': { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  'above-end': { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
  'right-start': { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 6 },
  'left-start': { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -6 },
};

/**
 * Lightweight bespoke popover/menu trigger built on CDK Overlay — the design
 * system's replacement for `matMenuTriggerFor`. Attach a `<ng-template>` holding
 * the popover content (e.g. a `.dbd-menu`); clicking the host toggles it, and it
 * dismisses on backdrop click or Escape. Surface styling lives globally in
 * styles.scss (`.dbd-popover-surface`, `.dbd-menu`, `.dbd-menu-item`).
 *
 *   <button [dbdPopoverTrigger]="menu" placement="below-end">…</button>
 *   <ng-template #menu><div class="dbd-menu">…</div></ng-template>
 */
@Directive({
  selector: '[dbdPopoverTrigger]',
  standalone: true,
  exportAs: 'dbdPopoverTrigger',
})
export class PopoverTriggerDirective implements OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly vcr = inject(ViewContainerRef);

  readonly content = input.required<TemplateRef<unknown>>({ alias: 'dbdPopoverTrigger' });
  readonly placement = input<PopoverPlacement>('below-start');
  readonly disabled = input<boolean>(false);
  readonly opened = output<void>();
  readonly closed = output<void>();

  private ref: OverlayRef | null = null;

  get isOpen(): boolean {
    return !!this.ref;
  }

  @HostListener('click', ['$event'])
  protected onClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.disabled()) return;
    this.toggle();
  }

  toggle(): void {
    this.ref ? this.close() : this.open();
  }

  open(): void {
    if (this.ref) return;
    const primary = POSITIONS[this.placement()];
    // Fallbacks keep the panel on-screen when the preferred side has no room.
    const fallbacks: ConnectedPosition[] = [
      POSITIONS['below-end'],
      POSITIONS['above-start'],
      POSITIONS['above-end'],
      POSITIONS['right-start'],
    ];
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.host)
      .withPush(true)
      .withPositions([primary, ...fallbacks]);

    this.ref = this.overlay.create({
      positionStrategy,
      hasBackdrop: true,
      backdropClass: 'dbd-overlay-backdrop',
      panelClass: 'dbd-popover-panel',
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });

    this.ref.backdropClick().subscribe(() => this.close());
    this.ref.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') this.close();
    });

    // Expose a close() to the projected template so menu items can dismiss:
    //   <ng-template #menu let-close><button (click)="act(); close()">…
    const close = () => this.close();
    this.ref.attach(new TemplatePortal(this.content(), this.vcr, { $implicit: close, close }));
    this.opened.emit();
  }

  close(): void {
    if (!this.ref) return;
    this.ref.dispose();
    this.ref = null;
    this.closed.emit();
  }

  ngOnDestroy(): void {
    this.close();
  }
}
