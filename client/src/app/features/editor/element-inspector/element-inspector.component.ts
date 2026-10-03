import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type {
  CanvasElementModel,
  FillStyle,
  FontFamily,
  StrokeStyle,
  UpdateElementDto,
} from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

const STROKE_COLORS = ['#e7ecf3', '#e03131', '#2f9e44', '#1971c2', '#6f8bff', '#f0b45e', '#9b8bff'];
const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#d0bfff', '#ffec99'];

/**
 * The "shape & line styling" side panel — the design's calm, full-width companion
 * to the floating toolbar. Shown when a drawable element is selected; controls
 * that don't apply to the element type simply drop out. Writes go to every
 * selected element via the same store methods the floating toolbar uses.
 */
@Component({
  selector: 'app-element-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './element-inspector.component.html',
  styleUrl: './element-inspector.component.scss',
})
export class ElementInspectorComponent {
  protected readonly store = inject(ProjectStore);
  readonly element = input.required<CanvasElementModel>();

  protected readonly strokeColors = STROKE_COLORS;
  protected readonly fillColors = FILL_COLORS;
  protected readonly widths = [1, 2, 4];
  protected readonly styles: StrokeStyle[] = ['solid', 'dashed', 'dotted'];
  protected readonly fonts: { value: FontFamily; label: string }[] = [
    { value: 'hand', label: 'Hand' },
    { value: 'normal', label: 'Normal' },
    { value: 'code', label: 'Code' },
  ];

  protected readonly kindLabel = computed(() => {
    const t = this.element().type;
    if (t === 'arrow' || t === 'line') return t === 'arrow' ? 'Arrow' : 'Line';
    if (t === 'freedraw') return 'Pen stroke';
    if (t === 'text') return 'Text';
    return t.charAt(0).toUpperCase() + t.slice(1);
  });

  protected readonly isText = computed(() => this.element().type === 'text');
  protected readonly isLine = computed(
    () => this.element().type === 'arrow' || this.element().type === 'line',
  );
  protected readonly isRect = computed(() => this.element().type === 'rectangle');
  protected readonly hasFill = computed(
    () => !this.isText() && !this.isLine() && this.element().type !== 'freedraw',
  );
  protected readonly canHaveText = computed(() => {
    const t = this.element().type;
    return t === 'text' || t === 'rectangle' || t === 'ellipse' || t === 'diamond';
  });

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
  ] as const;

  private patchAll(patch: UpdateElementDto): void {
    const ids = this.store.selectedElementIds();
    const targets = ids.length ? ids : [this.element().id];
    for (const id of targets) {
      void this.store.updateElement(id, patch);
    }
    const stylePatch: Record<string, unknown> = {};
    for (const key of ElementInspectorComponent.STYLE_KEYS) {
      if (key in patch) stylePatch[key] = (patch as Record<string, unknown>)[key];
    }
    if (Object.keys(stylePatch).length) this.store.setElementStyle(stylePatch);
  }

  protected setStroke(color: string): void {
    this.patchAll({ strokeColor: color });
  }
  protected setFill(color: string): void {
    this.patchAll(
      color === 'transparent' ? { fillStyle: 'none' } : { backgroundColor: color, fillStyle: 'solid' },
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
  protected setCornerRadius(value: number): void {
    this.patchAll({ cornerRadius: value });
  }
  protected setOpacity(value: number): void {
    this.patchAll({ opacity: value });
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
