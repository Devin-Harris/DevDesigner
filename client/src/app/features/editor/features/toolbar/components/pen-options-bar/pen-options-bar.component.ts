import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PICKER_SWATCHES, themeSwatchCss } from '@devdesigner/shared';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { ERASER_MAX, ERASER_MIN, PEN_MAX, PEN_MIN } from '../../../../models/pen-limits.constants';
import { PenPrefsService } from '../../../../services/pen-prefs.service';
import { CallPipe } from '../../../../../../shared/ui/pipes/collection.pipes';

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
   imports: [CallPipe, IconComponent, MatTooltipModule],
   templateUrl: './pen-options-bar.component.html',
   styleUrl: './pen-options-bar.component.scss',
})
export class PenOptionsBarComponent {
   /** The sticky stroke color new strokes are drawn with. */
   readonly strokeColor$ = input<string | undefined>(undefined, { alias: 'strokeColor' });
   /** A pen color was picked (the host makes it the sticky stroke color). */
   readonly colorChange = output<string>();

   protected readonly pen = inject(PenPrefsService);
   protected readonly colors = PICKER_SWATCHES.filter((c) => c.toLowerCase() !== '#ffffff').slice(0, 7);
   protected readonly widths = WIDTHS;
   protected readonly erasers = ERASERS;
   protected readonly penMin = PEN_MIN;
   protected readonly penMax = PEN_MAX;
   protected readonly eraserMin = ERASER_MIN;
   protected readonly eraserMax = ERASER_MAX;

   protected readonly width$ = this.pen.width;

   protected css(c: string): string {
      return themeSwatchCss(c);
   }

   protected setColor(c: string): void {
      this.colorChange.emit(c);
   }

   protected setWidth(w: number): void {
      this.pen.width.set(w);
   }
}
