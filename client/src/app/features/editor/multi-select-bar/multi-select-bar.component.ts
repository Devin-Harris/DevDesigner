import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
import type { AlignAction } from '../canvas/models/toolbar-actions';

export type ArrangeOp = 'front' | 'forward' | 'backward' | 'back';

/**
 * Floating bar under a multi-selection (2+ tables / elements / diagrams):
 * Align ▾, Group / Ungroup, layer order, duplicate and delete. Replaces the old
 * quick-align strip above the status bar so the view island never changes shape.
 */
@Component({
  selector: 'app-multi-select-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MatTooltipModule, PopoverTriggerDirective, ColorSwatchesComponent],
  template: `
    <span class="count">{{ count() }} selected</span>
    <span class="sep"></span>
    <button class="tb" [dbdPopoverTrigger]="alignMenu" placement="below-start">
      <dbd-icon name="align_horizontal_left" />Align<dbd-icon name="expand_more" class="chev" />
    </button>
    <ng-template #alignMenu let-close>
      <div class="align-pop">
        <div class="lab">Align</div>
        <div class="grid6">
          <button class="ib" (click)="align.emit('left'); close()" matTooltip="Align left" aria-label="Align left"><dbd-icon name="align_horizontal_left" /></button>
          <button class="ib" (click)="align.emit('hcenter'); close()" matTooltip="Center horizontally" aria-label="Center horizontally"><dbd-icon name="align_horizontal_center" /></button>
          <button class="ib" (click)="align.emit('right'); close()" matTooltip="Align right" aria-label="Align right"><dbd-icon name="align_horizontal_right" /></button>
          <button class="ib" (click)="align.emit('top'); close()" matTooltip="Align top" aria-label="Align top"><dbd-icon name="align_vertical_top" /></button>
          <button class="ib" (click)="align.emit('vcenter'); close()" matTooltip="Center vertically" aria-label="Center vertically"><dbd-icon name="align_vertical_center" /></button>
          <button class="ib" (click)="align.emit('bottom'); close()" matTooltip="Align bottom" aria-label="Align bottom"><dbd-icon name="align_vertical_bottom" /></button>
        </div>
        <div class="lab gap">Distribute &amp; tidy</div>
        <div class="chips">
          <button class="chip" [disabled]="!canDistribute()" (click)="align.emit('dist-h'); close()">Horizontally</button>
          <button class="chip" [disabled]="!canDistribute()" (click)="align.emit('dist-v'); close()">Vertically</button>
          <button class="chip" (click)="align.emit('gaps-h'); close()" matTooltip="Line up left to right, 40 px apart">Equal gaps &#8596; 40</button>
          <button class="chip" (click)="align.emit('gaps-v'); close()" matTooltip="Stack top to bottom, 40 px apart">Equal gaps &#8597; 40</button>
        </div>
      </div>
    </ng-template>

    @if (canStyle()) {
      <span class="sep"></span>
      <button class="ib" [dbdPopoverTrigger]="fillMenu" placement="below-start" matTooltip="Fill for all" aria-label="Fill for all">
        <span class="sw fill"></span>
      </button>
      <ng-template #fillMenu let-close>
        <div class="picker">
          <dbd-color-swatches noneValue="transparent" noneLabel="No fill" (pick)="fill.emit($event); close()" />
        </div>
      </ng-template>
      <button class="ib" [dbdPopoverTrigger]="strokeMenu" placement="below-start" matTooltip="Stroke for all" aria-label="Stroke for all">
        <span class="sw stroke"></span>
      </button>
      <ng-template #strokeMenu let-close>
        <div class="picker">
          <dbd-color-swatches noneValue="transparent" noneLabel="No stroke" (pick)="stroke.emit($event); close()" />
        </div>
      </ng-template>
    }

    @if (grouped()) {
      <button class="tb" (click)="ungroup.emit()" matTooltip="Ungroup (Ctrl+Shift+G)">Ungroup</button>
    } @else {
      <button class="tb" (click)="group.emit()" matTooltip="Group (Ctrl+G)">Group</button>
    }

    <button class="ib" [dbdPopoverTrigger]="layerMenu" placement="below-start" matTooltip="Layer order" aria-label="Layer order">
      <dbd-icon name="flip_to_front" />
    </button>
    <ng-template #layerMenu let-close>
      <div class="dbd-menu">
        <button class="dbd-menu-item" (click)="arrange.emit('front'); close()"><dbd-icon name="flip_to_front" />Bring to front<span class="kbd">Ctrl Shift ]</span></button>
        <button class="dbd-menu-item" (click)="arrange.emit('forward'); close()"><dbd-icon name="bring_forward" />Bring forward<span class="kbd">Ctrl ]</span></button>
        <button class="dbd-menu-item" (click)="arrange.emit('backward'); close()"><dbd-icon name="send_backward" />Send backward<span class="kbd">Ctrl [</span></button>
        <button class="dbd-menu-item" (click)="arrange.emit('back'); close()"><dbd-icon name="flip_to_back" />Send to back<span class="kbd">Ctrl Shift [</span></button>
      </div>
    </ng-template>

    <button class="ib" (click)="duplicate.emit()" matTooltip="Duplicate" aria-label="Duplicate">
      <dbd-icon name="content_copy" />
    </button>
    <button class="ib del" (click)="remove.emit()" matTooltip="Delete" aria-label="Delete">
      <dbd-icon name="delete" />
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      z-index: 6;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      height: 40px;
      padding: 0 4px;
      box-sizing: border-box;
      background: var(--dbd-surface);
      color: var(--dbd-text);
      border: 1px solid var(--dbd-border);
      border-radius: 11px;
      box-shadow: var(--dbd-shadow-2);
      white-space: nowrap;
      font-size: 13px;
    }
    .count {
      padding: 0 8px;
      font-size: 12px;
      color: var(--dbd-text-muted);
    }
    .sep {
      width: 1px;
      height: 20px;
      background: var(--dbd-border);
      margin: 0 2px;
    }
    .tb,
    .ib {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 30px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--dbd-text);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      --dbd-icon-size: 17px;
    }
    .tb {
      padding: 0 8px;
    }
    .ib {
      width: 30px;
      color: var(--dbd-text-muted);
    }
    .tb:hover,
    .ib:hover {
      background: var(--dbd-surface-2);
      color: var(--dbd-text);
    }
    .del:hover {
      color: #e5484d;
    }
    .chev {
      --dbd-icon-size: 14px;
      color: var(--dbd-text-muted);
    }
    .align-pop {
      width: 268px;
      padding: 10px;
      background: var(--dbd-surface);
      border: 1px solid var(--dbd-border);
      border-radius: 12px;
      box-shadow: var(--dbd-shadow-2);
    }
    .lab {
      margin: 2px 0 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--dbd-text-muted);
    }
    .lab.gap { margin-top: 12px; }
    .grid6 {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 4px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      height: 26px;
      padding: 0 10px;
      border: 1px solid var(--dbd-border);
      border-radius: 999px;
      background: var(--dbd-surface);
      color: var(--dbd-text);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .chip:hover:not(:disabled) {
      border-color: var(--dbd-primary);
      color: var(--dbd-primary);
      background: var(--dbd-primary-weak);
    }
    .chip:disabled { opacity: 0.45; cursor: default; }
    .sw { width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box; }
    .sw.fill {
      background: linear-gradient(135deg, var(--dbd-surface-2) 50%, var(--dbd-text-muted) 50%);
      box-shadow: inset 0 0 0 1px var(--dbd-border);
    }
    .sw.stroke { border: 3px solid var(--dbd-text-muted); }
    .picker {
      padding: 10px;
      background: var(--dbd-surface);
      border: 1px solid var(--dbd-border);
      border-radius: 12px;
      box-shadow: var(--dbd-shadow-2);
    }
    .kbd {
      margin-left: auto;
      padding-left: 16px;
      font-size: 11px;
      color: var(--dbd-text-muted);
    }
  `,
})
export class MultiSelectBarComponent {
  readonly count = input.required<number>();
  readonly canDistribute = input(false);
  /** The selection is exactly one (not entered) group: offer Ungroup. */
  readonly grouped = input(false);
  /** Some selected items take a fill / stroke (shapes, lines). */
  readonly canStyle = input(false);

  readonly align = output<AlignAction>();
  readonly group = output<void>();
  readonly ungroup = output<void>();
  readonly arrange = output<ArrangeOp>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();
  readonly fill = output<string>();
  readonly stroke = output<string>();
}
