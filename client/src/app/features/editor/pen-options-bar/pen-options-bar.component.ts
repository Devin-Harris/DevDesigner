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
   /** Dragging erases the pen strokes it touches instead of drawing. */
   readonly eraser = signal(false);
   /** Eraser diameter in screen pixels. */
   readonly eraserSize = signal(24);
   /** Pen thickness, kept apart from the shapes' stroke width. */
   readonly width = signal(2);
}

export const PEN_MIN = 0.5;
export const PEN_MAX = 24;
export const ERASER_MIN = 4;
export const ERASER_MAX = 120;

const WIDTHS = [
   { value: 1, label: 'Thin', dot: 4 },
   { value: 2, label: 'Medium', dot: 8 },
   { value: 4, label: 'Thick', dot: 13 },
   { value: 8, label: 'Extra thick', dot: 18 },
];

const ERASERS = [
   { value: 12, label: 'Small eraser', dot: 6 },
   { value: 24, label: 'Medium eraser', dot: 11 },
   { value: 48, label: 'Large eraser', dot: 16 },
   { value: 96, label: 'Huge eraser', dot: 22 },
];

/**
 * Options for the Draw tool, shown while it is active: pen color, thickness and
 * the highlighter. They set the style the next strokes are drawn with.
 */
@Component({
   selector: 'dd-pen-options-bar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, MatTooltipModule],
   templateUrl: './pen-options-bar.component.html',
   styleUrl: './pen-options-bar.component.scss',
})
export class PenOptionsBarComponent {
   private readonly store = inject(ProjectStore);
   protected readonly pen = inject(PenPrefsService);
   protected readonly colors = PICKER_SWATCHES.filter((c) => c.toLowerCase() !== '#ffffff').slice(0, 7);
   protected readonly widths = WIDTHS;
   protected readonly erasers = ERASERS;
   protected readonly penMin = PEN_MIN;
   protected readonly penMax = PEN_MAX;
   protected readonly eraserMin = ERASER_MIN;
   protected readonly eraserMax = ERASER_MAX;

   protected readonly current = computed(() => this.store.elementStyle().strokeColor);
   protected readonly width = this.pen.width;

   protected css(c: string): string {
      return themeSwatchCss(c);
   }

   protected setColor(c: string): void {
      this.store.setElementStyle({ strokeColor: c });
   }

   protected setWidth(w: number): void {
      this.pen.width.set(w);
   }
}
