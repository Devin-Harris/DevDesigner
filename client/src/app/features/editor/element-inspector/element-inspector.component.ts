import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  CODE_LANGUAGES,
  type CanvasElementModel,
  type CodeLanguage,
  type CodeDiffView,
  type FillStyle,
  type FontFamily,
  type StrokeStyle,
  type UpdateElementDto,
  DEFAULT_THEME,
  presentationOf,
  resolveThemeFont,
  themeToken,
  type SlideTheme,
} from '@dbdesigner/shared';
import { SURFACE_FILL } from '../canvas/helpers/shape-render.helper';
import { CODE_LANGUAGE_LABELS } from '../canvas/helpers/code-highlight.helper';
import { canFormatCode } from '../canvas/helpers/code-format.helper';
import { CodeActionsService } from '../../../core/services/code-actions.service';
import { FONT_OPTIONS, fontStack } from '../canvas/helpers/shape-render.helper';
import { withTextFit } from '../canvas/helpers/text-metrics';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';

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
  imports: [ColorSwatchesComponent, IconComponent],
  templateUrl: './element-inspector.component.html',
  styleUrl: './element-inspector.component.scss',
})
export class ElementInspectorComponent {
  protected readonly store = inject(ProjectStore);
  private readonly codeActions = inject(CodeActionsService);
  readonly element = input.required<CanvasElementModel>();

  /** Closed shapes and code cards can drop their outline entirely. */
  protected readonly strokeCanBeNone = computed(() =>
    ['rectangle', 'ellipse', 'diamond', 'code'].includes(this.element().type),
  );
  protected readonly widths = [1, 2, 4];
  protected readonly styles: StrokeStyle[] = ['solid', 'dashed', 'dotted'];
  protected readonly fonts = FONT_OPTIONS as { value: FontFamily; label: string }[];

  /** The deck theme of the slide (or layout) this element is on; null off slides. */
  protected readonly deckTheme = computed<SlideTheme | null>(() => {
    const el = this.element();
    const frames = this.store.slideFrames();
    const f = el.type === 'frame' ? frames.find((x) => x.id === el.id) : frames.find((x) => x.id === el.slideId);
    return f ? (this.store.presentationThemes().get(presentationOf(f)) ?? DEFAULT_THEME) : null;
  });
  protected readonly themeFonts = computed(() => {
    const t = this.deckTheme();
    return t
      ? [
          { value: themeToken('heading'), label: 'Heading' },
          { value: themeToken('body'), label: 'Body' },
        ]
      : [];
  });
  /** CSS font stack for a family key or theme font token. */
  protected stackOf(key: string): string {
    return fontStack(resolveThemeFont(key, this.deckTheme() ?? DEFAULT_THEME));
  }

  protected readonly kindLabel = computed(() => {
    const t = this.element().type;
    if (t === 'arrow' || t === 'line') return t === 'arrow' ? 'Arrow' : 'Line';
    if (t === 'freedraw') return 'Pen stroke';
    if (t === 'text') return 'Text';
    if (t === 'code') return 'Code block';
    return t.charAt(0).toUpperCase() + t.slice(1);
  });

  protected readonly isText = computed(() => this.element().type === 'text');
  protected readonly isCode = computed(() => this.element().type === 'code');
  protected readonly languages = CODE_LANGUAGES.map((id) => ({
    id,
    label: CODE_LANGUAGE_LABELS[id],
  }));
  protected readonly codeSizes = [11, 12, 14, 16, 18, 20, 24];
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
      // Text boxes hug their glyphs: a font/size/weight change refits the box.
      const el = this.store.elements().find((e) => e.id === id);
      void this.store.updateElement(id, el ? withTextFit(el, patch) : patch);
    }
    const stylePatch: Record<string, unknown> = {};
    for (const key of ElementInspectorComponent.STYLE_KEYS) {
      if (key in patch) stylePatch[key] = (patch as Record<string, unknown>)[key];
    }
    if (Object.keys(stylePatch).length) this.store.setElementStyle(stylePatch);
  }

  /** Code-block edits go to every selected code block and skip the sticky text style. */
  private patchCode(patch: UpdateElementDto): void {
    const ids = this.store.selectedElementIds();
    const targets = ids.length ? ids : [this.element().id];
    for (const id of targets) {
      if (this.store.elements().find((e) => e.id === id)?.type === 'code') {
        void this.store.updateElement(id, patch);
      }
    }
  }

  protected readonly canFormat = computed(() => canFormatCode(this.element().language));

  protected format(): void {
    void this.codeActions.format(this.store.selectedElementIds());
  }

  protected readonly diffViews: { id: CodeDiffView; label: string; title: string }[] = [
    { id: 'off', label: 'Off', title: 'Show only the original code' },
    { id: 'inline', label: 'Inline', title: 'Removed and added lines interleaved' },
    { id: 'split', label: 'Side by side', title: 'Original on the left, changes on the right' },
  ];

  protected setDiffView(view: CodeDiffView): void {
    void this.codeActions.setDiffView(this.store.selectedElementIds(), view);
  }

  protected editDiff(side: 'original' | 'modified'): void {
    this.codeActions.editDiffSide(this.element().id, side);
  }

  protected toggleWhitespace(): void {
    void this.codeActions.toggleDiffWhitespace(this.store.selectedElementIds());
  }

  protected swapDiff(): void {
    void this.codeActions.swapDiffSides(this.element().id);
  }

  protected clearDiff(): void {
    void this.codeActions.clearDiff(this.element().id);
  }

  protected fitToContent(): void {
    void this.codeActions.fitToContent(this.store.selectedElementIds());
  }

  protected setFileName(value: string): void {
    const ids = this.store.selectedElementIds();
    for (const id of ids.length ? ids : [this.element().id]) {
      void this.codeActions.setFileName(id, value);
    }
  }

  protected setLanguage(language: CodeLanguage): void {
    this.patchCode({ language });
  }

  protected setCodeSize(fontSize: number): void {
    this.patchCode({ fontSize });
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

  protected setEllipticCorners(on: boolean): void {
    this.patchAll({ ellipticCorners: on });
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
    this.store.arrangeSelection('front');
  }

  protected sendToBack(): void {
    this.store.arrangeSelection('back');
  }
  protected remove(): void {
    for (const id of [...this.store.selectedElementIds()]) {
      void this.store.deleteElement(id);
    }
  }
}
