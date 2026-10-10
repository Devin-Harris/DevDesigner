import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
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
import { EditorActionsService } from '../../../core/services/editor-actions.service';
import { SURFACE_FILL } from '../canvas/helpers/shape-render.helper';
import { ProjectStore } from '../../../stores/project.store';

// Saturated palette shared with the table header tints (no muted pastels).
const STROKE_COLORS = ['#e5484d', '#f5a623', '#12b76a', '#0ea5e9', '#2f6bff', '#7c5cff', '#ec4899', '#64748b'];
const FILL_COLORS = ['transparent', SURFACE_FILL, '#e5484d', '#f5a623', '#12b76a', '#0ea5e9', '#2f6bff', '#7c5cff', '#ec4899'];
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
  imports: [MatTooltipModule, IconComponent, PopoverTriggerDirective],
  templateUrl: './element-floating-toolbar.component.html',
  styleUrl: './element-floating-toolbar.component.scss',
})
export class ElementFloatingToolbarComponent {
  protected readonly store = inject(ProjectStore);
  private readonly editorActions = inject(EditorActionsService);
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
  /** Pictures have no stroke/fill styling, only opacity and layering. */
  protected readonly isImage = computed(() => this.element().type === 'image');
  protected readonly isLine = computed(
    () => this.element().type === 'arrow' || this.element().type === 'line',
  );
  /** Text/label controls apply to text elements and to shapes (which have labels). */
  protected readonly canHaveText = computed(() => {
    const t = this.element().type;
    return t === 'text' || t === 'rectangle' || t === 'ellipse' || t === 'diamond';
  });
  protected readonly hasFill = computed(
    () =>
      !this.isText() &&
      !this.isLine() &&
      this.element().type !== 'freedraw' &&
      this.element().type !== 'image',
  );
  /** Corner radius applies to rectangles only. */
  protected readonly isRect = computed(() => this.element().type === 'rectangle');

  /** Style keys that are remembered for subsequently drawn elements. */
  private static readonly STYLE_KEYS = [
    'strokeColor',
    'backgroundColor',
    'fillStyle',
    'strokeWidth',
    'strokeStyle',
    'opacity',
    'cornerRadius',
    'fontFamily',
    'fontSize',
    'bold',
    'italic',
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

  /** CSS color for a fill swatch/value; the surface fill tracks the theme. */
  protected fillCss(color: string | undefined): string {
    return color === SURFACE_FILL ? 'var(--dbd-surface)' : color || '#ffffff';
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

  protected toggleBold(): void {
    this.patchAll({ bold: !this.element().bold });
  }

  protected toggleItalic(): void {
    this.patchAll({ italic: !this.element().italic });
  }

  protected setCornerRadius(value: number): void {
    this.patchAll({ cornerRadius: value });
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

  /** Toggle between a straight line and a curve (drag the midpoint handle to fine-tune). */
  protected toggleCurve(): void {
    const el = this.element();
    if (el.curvature) {
      this.patchAll({ curvature: 0 });
      return;
    }
    for (const id of this.store.selectedElementIds()) {
      const target = this.store.elements().find((e) => e.id === id);
      const pts = target?.points;
      if (!target || !pts || pts.length < 2) {
        continue;
      }
      const a = pts[0];
      const b = pts[pts.length - 1];
      const bend = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) * 0.25);
      void this.store.updateElement(id, { curvature: bend });
    }
  }

  /** Swap the start and end arrowheads so the line points the other way. */
  protected reverseArrowheads(): void {
    this.patchAll({
      startArrowhead: this.element().endArrowhead ?? 'none',
      endArrowhead: this.element().startArrowhead ?? 'none',
    });
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
    // The editor owns delete so a frame takes its contents with it.
    this.editorActions.deleteSelection();
  }
}
