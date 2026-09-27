import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  type ArrowheadType,
  type CanvasElementModel,
  type FillStyle,
  type FontFamily,
  type StrokeStyle,
  type TextAlign,
  type UpdateElementDto,
  type VerticalAlign,
} from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';

const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#e6e6e6'];
const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#e9d8fd'];
const STROKE_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Bold' },
  { value: 4, label: 'Extra bold' },
];
const STROKE_STYLE_ICONS: { value: StrokeStyle; icon: string }[] = [
  { value: 'solid', icon: 'remove' },
  { value: 'dashed', icon: 'more_horiz' },
  { value: 'dotted', icon: 'drag_handle' },
];
const FONTS: { value: FontFamily; label: string }[] = [
  { value: 'hand', label: 'Hand-drawn' },
  { value: 'normal', label: 'Normal' },
  { value: 'code', label: 'Code' },
];
const FONT_SIZES = [14, 16, 20, 28, 36, 48];
const ARROWHEADS: { value: ArrowheadType; icon: string; label: string }[] = [
  { value: 'none', icon: 'horizontal_rule', label: 'None' },
  { value: 'arrow', icon: 'east', label: 'Arrow' },
  { value: 'triangle', icon: 'play_arrow', label: 'Triangle' },
  { value: 'dot', icon: 'circle', label: 'Dot' },
  { value: 'bar', icon: 'menu', label: 'Bar' },
];

/**
 * Compact floating toolbar shown above the selected element(s) for quick styling
 * (Excalidraw/Lucid style), replacing the side inspector. Reads current values
 * from the representative element and applies every change to ALL selected
 * elements via the granular store methods. Disabled in read-only (VIEW) mode.
 */
@Component({
  selector: 'app-element-floating-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './element-floating-toolbar.component.html',
  styleUrl: './element-floating-toolbar.component.scss',
})
export class ElementFloatingToolbarComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly strokeColors = STROKE_COLORS;
  protected readonly fillColors = FILL_COLORS;
  protected readonly strokeWidths = STROKE_WIDTHS;
  protected readonly strokeStyleIcons = STROKE_STYLE_ICONS;
  protected readonly fonts = FONTS;
  protected readonly fontSizes = FONT_SIZES;
  protected readonly arrowheads = ARROWHEADS;

  /** The representative element whose values the toolbar displays. */
  readonly element = input.required<CanvasElementModel>();

  protected readonly isText = computed(() => this.element().type === 'text');
  protected readonly isLine = computed(
    () => this.element().type === 'arrow' || this.element().type === 'line',
  );
  /** Text/label controls apply to text elements and to shapes (which have labels). */
  protected readonly canHaveText = computed(() => {
    const t = this.element().type;
    return t === 'text' || t === 'rectangle' || t === 'ellipse' || t === 'diamond';
  });
  protected readonly hasFill = computed(
    () => !this.isText() && !this.isLine() && this.element().type !== 'freedraw',
  );

  /** Style keys that are remembered for subsequently drawn elements. */
  private static readonly STYLE_KEYS = [
    'strokeColor',
    'backgroundColor',
    'fillStyle',
    'strokeWidth',
    'strokeStyle',
    'opacity',
    'fontFamily',
    'fontSize',
    'startArrowhead',
    'endArrowhead',
  ] as const;

  /** Apply a patch to every selected element and remember its style for new draws. */
  private patchAll(patch: UpdateElementDto): void {
    const ids = this.store.selectedElementIds();
    const targets = ids.length ? ids : [this.element().id];
    for (const id of targets) {
      void this.store.updateElement(id, patch);
    }
    const stylePatch: Record<string, unknown> = {};
    for (const key of ElementFloatingToolbarComponent.STYLE_KEYS) {
      if (key in patch) {
        stylePatch[key] = (patch as Record<string, unknown>)[key];
      }
    }
    if (Object.keys(stylePatch).length) {
      this.store.setElementStyle(stylePatch);
    }
  }

  protected setStroke(color: string): void {
    this.patchAll({ strokeColor: color });
  }

  protected setFill(color: string): void {
    this.patchAll(
      color === 'transparent'
        ? { fillStyle: 'none' }
        : { backgroundColor: color, fillStyle: 'solid' },
    );
  }

  protected setFillStyle(style: FillStyle): void {
    this.patchAll({ fillStyle: style });
  }

  protected setWidth(value: number): void {
    this.patchAll({ strokeWidth: value });
  }

  protected setStyle(style: StrokeStyle): void {
    this.patchAll({ strokeStyle: style });
  }

  protected setFont(font: FontFamily): void {
    this.patchAll({ fontFamily: font });
  }

  protected setFontSize(size: number): void {
    this.patchAll({ fontSize: size });
  }

  protected setTextAlign(align: TextAlign): void {
    this.patchAll({ textAlign: align });
  }

  protected setVerticalAlign(align: VerticalAlign): void {
    this.patchAll({ verticalAlign: align });
  }

  protected setStartHead(type: ArrowheadType): void {
    this.patchAll({ startArrowhead: type });
  }

  protected setEndHead(type: ArrowheadType): void {
    this.patchAll({ endArrowhead: type });
  }

  protected setOpacity(value: number): void {
    this.patchAll({ opacity: value });
  }

  protected bringToFront(): void {
    const ids = this.store.elements().map((e) => e.id);
    for (const id of this.store.selectedElementIds()) {
      this.store.reorderElements([...ids.filter((x) => x !== id), id]);
    }
  }

  protected sendToBack(): void {
    const ids = this.store.elements().map((e) => e.id);
    for (const id of [...this.store.selectedElementIds()].reverse()) {
      this.store.reorderElements([id, ...ids.filter((x) => x !== id)]);
    }
  }

  protected remove(): void {
    for (const id of [...this.store.selectedElementIds()]) {
      void this.store.deleteElement(id);
    }
  }
}
