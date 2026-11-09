import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PICKER_SWATCHES, themeSwatchCss } from '@devdesigner/shared';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ProjectStore } from '../../../stores/project.store';

/** Pen settings that apply only to the Draw tool. */
@Injectable({ providedIn: 'root' })
export class PenPrefsService {
  /** Strokes are drawn wide and half see-through, like a marker. */
  readonly highlighter = signal(false);
}

const WIDTHS = [
  { value: 1, label: 'Thin', dot: 4 },
  { value: 2, label: 'Medium', dot: 8 },
  { value: 4, label: 'Thick', dot: 13 },
];

/**
 * Options for the Draw tool, shown while it is active: pen color, thickness and
 * the highlighter. They set the style the next strokes are drawn with.
 */
@Component({
  selector: 'app-pen-options-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MatTooltipModule],
  template: `
    @for (c of colors; track c) {
      <button
        class="sw"
        [class.on]="c === current()"
        [style.background]="css(c)"
        (click)="setColor(c)"
        [attr.aria-label]="'Pen color ' + c"
      ></button>
    }
    <span class="sep"></span>
    @for (w of widths; track w.value) {
      <button class="ib" [class.on]="w.value === width()" (click)="setWidth(w.value)" [matTooltip]="w.label" [attr.aria-label]="w.label">
        <span class="dot" [style.width.px]="w.dot" [style.height.px]="w.dot"></span>
      </button>
    }
    <span class="sep"></span>
    <button
      class="ib"
      [class.on]="pen.highlighter()"
      (click)="pen.highlighter.set(!pen.highlighter())"
      matTooltip="Highlighter (wide, 50% opacity)"
      aria-label="Highlighter"
    >
      <dd-icon name="highlight" />
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      z-index: 6;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px;
      background: var(--dd-surface);
      border: 1px solid var(--dd-border);
      border-radius: 12px;
      box-shadow: var(--dd-shadow-2);
    }
    .sw {
      width: 22px;
      height: 22px;
      margin: 0 2px;
      padding: 0;
      border: none;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
      cursor: pointer;
    }
    .sw.on {
      outline: 2px solid var(--dd-primary);
      outline-offset: 2px;
    }
    .sep {
      width: 1px;
      height: 22px;
      margin: 0 4px;
      background: var(--dd-border);
    }
    .ib {
      width: 34px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--dd-text-muted);
      cursor: pointer;
      --dd-icon-size: 18px;
    }
    .ib:hover {
      background: var(--dd-surface-2);
      color: var(--dd-text);
    }
    .ib.on {
      background: var(--dd-primary-weak);
      color: var(--dd-primary);
    }
    .dot {
      border-radius: 50%;
      background: currentColor;
    }
  `,
})
export class PenOptionsBarComponent {
  private readonly store = inject(ProjectStore);
  protected readonly pen = inject(PenPrefsService);
  protected readonly colors = PICKER_SWATCHES.filter((c) => c.toLowerCase() !== '#ffffff').slice(0, 7);
  protected readonly widths = WIDTHS;

  protected readonly current = computed(() => this.store.elementStyle().strokeColor);
  protected readonly width = computed(() => this.store.elementStyle().strokeWidth);

  protected css(c: string): string {
    return themeSwatchCss(c);
  }

  protected setColor(c: string): void {
    this.store.setElementStyle({ strokeColor: c });
  }

  protected setWidth(w: number): void {
    this.store.setElementStyle({ strokeWidth: w });
  }
}
