import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PICKER_SWATCHES, themeSwatchCss } from '@devdesigner/shared';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { ProjectStore } from '../state/project/project.store';
import { ERASER_MAX, ERASER_MIN, PEN_MAX, PEN_MIN } from './models/pen-limits.constants';
import { PenPrefsService } from './services/pen-prefs.service';

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
