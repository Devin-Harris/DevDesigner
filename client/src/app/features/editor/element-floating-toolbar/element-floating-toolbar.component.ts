import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import {
  CODE_LANGUAGES,
  type ArrowheadType,
  type CanvasElementModel,
  type CodeLanguage,
  type FillStyle,
  type FontFamily,
  type StrokeStyle,
  type TextAlign,
  type UpdateElementDto,
  type VerticalAlign,
} from '@dbdesigner/shared';
import { EditorActionsService } from '../../../core/services/editor-actions.service';
import { FONT_OPTIONS, fontStack, SURFACE_FILL } from '../canvas/helpers/shape-render.helper';
import { RichTextSessionService } from '../../../core/services/rich-text-session.service';
import {
  clearRunKeys,
  isPlainRuns,
  patchRuns,
  plainOf,
  runsOrPlain,
} from '../canvas/helpers/rich-text.helper';
import {
  listKindOver,
  toggleList as toggleListRuns,
  type ListKind,
} from '../canvas/helpers/rich-list.helper';
import { CODE_LANGUAGE_LABELS } from '../canvas/helpers/code-highlight.helper';
import { canFormatCode } from '../canvas/helpers/code-format.helper';
import { CodeActionsService } from '../../../core/services/code-actions.service';
import {
  DEFAULT_LINE_HEIGHT,
  ensureFontLoaded,
  LINE_HEIGHTS,
  withTextFit,
} from '../canvas/helpers/text-metrics';
import { ProjectStore } from '../../../stores/project.store';

// Saturated palette shared with the table header tints (no muted pastels).
const STROKE_COLORS = ['#ffffff', '#e5484d', '#f5a623', '#12b76a', '#0ea5e9', '#2f6bff', '#7c5cff', '#ec4899', '#64748b'];
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
const FONT_SIZES = [14, 16, 20, 28, 36, 48];
const CODE_FONT_SIZES = [11, 12, 14, 16, 18, 20, 24];
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
  private readonly codeActions = inject(CodeActionsService);
  private readonly rich = inject(RichTextSessionService);
  protected readonly strokeColors = STROKE_COLORS;
  protected readonly fillColors = FILL_COLORS;
  protected readonly strokeWidths = STROKE_WIDTHS;
  protected readonly strokeStyleIcons = STROKE_STYLE_ICONS;
  protected readonly fonts = FONT_OPTIONS;
  protected readonly lineHeights = LINE_HEIGHTS;
  protected readonly stackOf = fontStack;
  protected readonly fontSizes = FONT_SIZES;
  protected readonly arrowheads = ARROWHEADS;

  /** The representative element whose values the toolbar displays. */
  readonly element = input.required<CanvasElementModel>();

  protected readonly isText = computed(() => this.element().type === 'text');

  /** True while this text element is open in the inline rich-text editor. */
  protected readonly editingRich = computed(() => this.rich.editingId() === this.element().id);
  /** Styling state shown by the toolbar: the selected characters while editing. */
  protected readonly boldOn = computed(() =>
    this.editingRich() ? !!this.rich.selection()?.bold : !!this.element().bold,
  );
  protected readonly italicOn = computed(() =>
    this.editingRich() ? !!this.rich.selection()?.italic : !!this.element().italic,
  );
  protected readonly underlineOn = computed(() => {
    if (this.editingRich()) {
      return !!this.rich.selection()?.underline;
    }
    const el = this.element();
    const runs = runsOrPlain(el.text ?? '', el.runs);
    return runs.length > 0 && runs.every((r) => r.underline);
  });
  /** The morph tag of the words selected in the rich editor ('' = none). */
  protected readonly runMorphTag = computed(() => this.rich.selection()?.morph ?? '');
  protected readonly strokeSwatch = computed(
    () => (this.editingRich() ? this.rich.selection()?.color : null) ?? this.element().strokeColor,
  );
  protected readonly currentLineHeight = computed(
    () => this.element().lineHeight ?? DEFAULT_LINE_HEIGHT,
  );
  /** Pictures have no stroke/fill styling, only opacity and layering. */
  protected readonly isImage = computed(() => this.element().type === 'image');
  protected readonly isCode = computed(() => this.element().type === 'code');
  protected readonly languages = CODE_LANGUAGES.map((id) => ({
    id,
    label: CODE_LANGUAGE_LABELS[id],
  }));
  protected readonly codeSizes = CODE_FONT_SIZES;
  protected readonly languageLabel = computed(
    () => CODE_LANGUAGE_LABELS[this.element().language ?? 'typescript'],
  );
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
      // Text boxes hug their glyphs: a font/size/weight change refits the box.
      const el = this.store.elements().find((e) => e.id === id);
      void this.store.updateElement(id, el ? withTextFit(el, this.withRunReset(el, patch)) : patch);
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

  /**
   * An element-level color/bold/italic change should win over per-character
   * overrides, so the overrides it replaces are dropped from the rich runs.
   */
  private withRunReset(el: CanvasElementModel, patch: UpdateElementDto): UpdateElementDto {
    if (el.type !== 'text' || !el.runs?.length) {
      return patch;
    }
    const keys: ('bold' | 'italic' | 'color')[] = [];
    if ('strokeColor' in patch) keys.push('color');
    if ('bold' in patch) keys.push('bold');
    if ('italic' in patch) keys.push('italic');
    if (!keys.length) {
      return patch;
    }
    return { ...patch, runs: clearRunKeys(el.runs, keys) };
  }

  /** Code-block edits apply to every selected code block and never touch the sticky text style. */
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

  protected editFileName(): void {
    this.codeActions.editFileName(this.element().id);
  }

  protected fitToContent(): void {
    void this.codeActions.fitToContent(this.store.selectedElementIds());
  }

  protected setLanguage(language: CodeLanguage): void {
    this.patchCode({ language });
  }

  protected setCodeSize(fontSize: number): void {
    this.patchCode({ fontSize });
  }

  protected setStroke(color: string): void {
    if (this.editingRich() && this.rich.apply({ color })) {
      return;
    }
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
    // Fonts are downloaded on first use; wait so the box is measured in the real face.
    void ensureFontLoaded(font).then(() => this.patchAll({ fontFamily: font }));
  }

  protected setLineHeight(lineHeight: number): void {
    this.patchAll({ lineHeight });
  }

  protected setFontSize(size: number): void {
    this.patchAll({ fontSize: size });
  }

  protected toggleBold(): void {
    if (this.editingRich() && this.rich.apply({ bold: !this.boldOn() })) {
      return;
    }
    this.patchAll({ bold: !this.element().bold });
  }

  /** Switch a text block between auto-size and fixed-width (wrapping) mode. */
  protected toggleWrap(): void {
    const on = !this.element().wrap;
    const ids = this.store.selectedElementIds();
    for (const id of ids.length ? ids : [this.element().id]) {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type === 'text') {
        void this.store.updateElement(id, withTextFit(el, { wrap: on }));
      }
    }
  }

  /** Underline has no element-level flag: it is applied to every run of the block. */
  protected toggleUnderline(): void {
    const on = !this.underlineOn();
    if (this.editingRich() && this.rich.apply({ underline: on })) {
      return;
    }
    const ids = this.store.selectedElementIds();
    for (const id of ids.length ? ids : [this.element().id]) {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type !== 'text') {
        continue;
      }
      const text = el.text ?? '';
      const runs = patchRuns(runsOrPlain(text, el.runs), 0, text.length, { underline: on });
      void this.store.updateElement(id, withTextFit(el, { runs: isPlainRuns(runs) ? null : runs }));
    }
  }

  /** The list kind of the selected lines (editing) or of the whole block. */
  protected readonly listKind = computed<ListKind | null>(() => {
    if (this.editingRich()) {
      return this.rich.selection()?.list ?? null;
    }
    const text = this.element().text ?? '';
    return listKindOver(text, 0, text.length);
  });

  /** Make the selected lines (or every line of the selected text blocks) a list, or undo it. */
  protected toggleList(kind: ListKind): void {
    if (this.editingRich() && this.rich.toggleList(kind)) {
      return;
    }
    const ids = this.store.selectedElementIds();
    for (const id of ids.length ? ids : [this.element().id]) {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type !== 'text') {
        continue;
      }
      const text = el.text ?? '';
      const { runs } = toggleListRuns(runsOrPlain(text, el.runs), 0, text.length, kind);
      void this.store.updateElement(
        id,
        withTextFit(el, { text: plainOf(runs), runs: isPlainRuns(runs) ? null : runs }),
      );
    }
  }

  /** Tag the selected words so they glide into the same-tagged words of the next slide. */
  protected setRunMorphTag(tag: string): void {
    this.rich.apply({ morph: tag.trim().slice(0, 80) || null });
  }

  protected toggleItalic(): void {
    if (this.editingRich() && this.rich.apply({ italic: !this.italicOn() })) {
      return;
    }
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
    this.store.arrangeSelection('front');
  }

  protected sendToBack(): void {
    this.store.arrangeSelection('back');
  }

  protected remove(): void {
    // The editor owns delete so a frame takes its contents with it.
    this.editorActions.deleteSelection();
  }
}
