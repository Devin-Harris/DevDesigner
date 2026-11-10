import { InspectorPanelService } from '../inspector-panel.service';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridTableService } from '../services/grid-table.service';
import { ElementImagesService } from '../services/element-images.service';
import { MediaActionsService } from '../services/media-actions.service';
import { parseGrid } from '../canvas/helpers/grid-table.helper';
import type { GridBorders } from '@devdesigner/shared';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/components/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../shared/ui/directives/popover-trigger.directive';
import {
   CODE_LANGUAGES,
   type ArrowheadType,
   type CanvasElementModel,
   type CodeLanguage,
   type CodeDiffView,
   type FillStyle,
   type FontFamily,
   type MediaPlayback,
   type StrokeStyle,
   type TextAlign,
   type UpdateElementDto,
   type VerticalAlign,
   THEME_STROKE,
   DEFAULT_THEME,
   presentationOf,
   resolveThemeColor,
   themeSwatchCss,
   SLIDE_FIELDS,
   SLIDE_FIELD_LABELS,
   fieldToken,
   resolveThemeFont,
   themeToken,
   type SlideTheme,
} from '@devdesigner/shared';
import { EditorActionsService } from '../../../core/editor-bridge/editor-actions.service';
import { FONT_OPTIONS, fontStack, SURFACE_FILL } from '../canvas/helpers/shape-render.helper';
import { RichTextSessionService } from '../services/rich-text-session.service';
import { clearRunKeys, isPlainRuns, patchRuns, plainOf, runsOrPlain } from '../canvas/helpers/rich-text.helper';
import { listKindOver, toggleList as toggleListRuns, type ListKind } from '../canvas/helpers/rich-list.helper';
import { CODE_LANGUAGE_LABELS } from '../canvas/helpers/code-highlight.helper';
import { canFormatCode } from '../canvas/helpers/code-format.helper';
import { CodeActionsService } from '../services/code-actions.service';
import { DEFAULT_LINE_HEIGHT, ensureFontLoaded, LINE_HEIGHTS, withTextFit } from '../canvas/helpers/text-metrics';
import { ProjectStore } from '../../../stores/project.store';
import { revertable, revertItems } from '../slides/layout-placeholders';

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
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 48, 60, 72, 96];
/** Element types that carry text (their own, or a label) and take font styling. */
const TEXT_TYPES = new Set(['text', 'rectangle', 'ellipse', 'diamond', 'grid']);
const TEXT_SIZE_DEFAULT = 20;
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
   selector: 'dd-element-floating-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MatTooltipModule, IconComponent, PopoverTriggerDirective, ColorSwatchesComponent],
   templateUrl: './element-floating-toolbar.component.html',
   styleUrl: './element-floating-toolbar.component.scss',
})
export class ElementFloatingToolbarComponent {
   protected readonly inspector = inject(InspectorPanelService);
   protected readonly store = inject(ProjectStore);
   private readonly editorActions = inject(EditorActionsService);
   private readonly codeActions = inject(CodeActionsService);
   protected readonly grids = inject(GridTableService);
   private readonly rich = inject(RichTextSessionService);
   protected readonly media = inject(MediaActionsService);
   private readonly images = inject(ElementImagesService);
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
   /** The anchor cell's style while a cell block of this table is selected. */
   private readonly cellStyle = computed(() => {
      const r = this.grids.range();
      return r && r.id === this.element().id ? this.grids.anchorStyle() : null;
   });
   /** Alignment shown in the align menu (the anchor cell's while cells are selected). */
   protected readonly alignOn = computed(() => this.cellStyle()?.align ?? this.element().textAlign);
   protected readonly vAlignOn = computed(() => this.cellStyle()?.vAlign ?? this.element().verticalAlign);
   /** Styling state shown by the toolbar: the selected cells, or the selected characters while editing. */
   protected readonly boldOn = computed(() =>
      this.cellStyle()
         ? (this.cellStyle()!.bold ?? !!this.element().bold)
         : this.editingRich()
           ? !!this.rich.selection()?.bold
           : !!this.element().bold
   );
   protected readonly italicOn = computed(() =>
      this.cellStyle()
         ? (this.cellStyle()!.italic ?? !!this.element().italic)
         : this.editingRich()
           ? !!this.rich.selection()?.italic
           : !!this.element().italic
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
   /** The fill the toolbar shows: the anchor cell's while cells are selected, else the element's. */
   protected readonly fillShown = computed<{ none: boolean; color: string | undefined }>(() => {
      const cell = this.cellStyle();
      if (cell) {
         return cell.fill ? { none: false, color: cell.fill } : { none: true, color: undefined };
      }
      const el = this.element();
      return { none: el.fillStyle === 'none' || !el.backgroundColor, color: el.backgroundColor };
   });
   protected readonly strokeSwatch = computed(
      () =>
         this.cellStyle()?.color ??
         (this.editingRich() ? this.rich.selection()?.color : null) ??
         this.element().strokeColor
   );
   protected readonly currentLineHeight = computed(() => this.element().lineHeight ?? DEFAULT_LINE_HEIGHT);
   /** Pictures have no stroke/fill styling, only opacity and layering. */
   protected readonly isImage = computed(() => this.element().type === 'image');
   /** A frame that is not a slide (slides are sized by their presentation). */
   protected readonly isPlainFrame = computed(() => this.element().type === 'frame' && !this.element().slide);
   protected readonly actions = inject(EditorActionsService);
   protected readonly frameRatios = [
      { id: '16-9', label: '16:9', ratio: 16 / 9, w: 32, h: 18 },
      { id: '4-3', label: '4:3', ratio: 4 / 3, w: 28, h: 21 },
      { id: '1-1', label: '1:1', ratio: 1, w: 22, h: 22 },
      { id: 'a4', label: 'A4', ratio: 794 / 1123, w: 17, h: 24 },
      { id: '9-16', label: '9:16', ratio: 9 / 16, w: 15, h: 27 },
   ];
   protected readonly frameRatioLabel = computed(() => {
      const e = this.element();
      const r = e.width / (e.height || 1);
      return this.frameRatios.find((x) => Math.abs(x.ratio - r) < 0.02)?.label ?? 'Custom';
   });
   /** Reshape the frame to an aspect ratio, keeping its width and top-left corner. */
   protected setFrameRatio(ratio: number): void {
      const e = this.element();
      void this.store.updateElement(e.id, { height: Math.round(e.width / ratio) });
   }
   /** GIFs and videos: what the picture is (null for stills or while loading). */
   protected readonly mediaKind = computed(() => {
      const kind = this.isImage() ? this.images.kind(this.element().fileId) : null;
      return kind === 'gif' || kind === 'video' ? kind : null;
   });
   protected readonly playback = computed<MediaPlayback>(() => this.element().media?.playback ?? 'click');
   protected readonly playbackModes: ReadonlyArray<{ value: MediaPlayback; label: string; hint: string }> = [
      { value: 'click', label: 'On click', hint: 'Still until clicked while presenting' },
      { value: 'hover', label: 'On hover', hint: 'Plays while the pointer is over it' },
      { value: 'auto', label: 'Automatically', hint: 'Plays as soon as it is shown' },
   ];
   protected readonly isCode = computed(() => this.element().type === 'code');
   protected readonly diffOn = computed(() => (this.element().diffView ?? 'off') !== 'off');
   protected readonly diffViews: { id: CodeDiffView; label: string }[] = [
      { id: 'off', label: 'Off (original only)' },
      { id: 'inline', label: 'Inline' },
      { id: 'split', label: 'Side by side' },
   ];

   protected setDiffView(view: CodeDiffView): void {
      void this.codeActions.setDiffView(this.store.selectedElementIds(), view);
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
   protected readonly isGrid = computed(() => this.element().type === 'grid');
   protected readonly gridHeaderOn = computed(() => this.isGrid() && parseGrid(this.element().text).header);
   protected readonly languages = CODE_LANGUAGES.map((id) => ({
      id,
      label: CODE_LANGUAGE_LABELS[id],
   }));
   protected readonly codeSizes = CODE_FONT_SIZES;
   protected readonly languageLabel = computed(() => CODE_LANGUAGE_LABELS[this.element().language ?? 'typescript']);
   protected readonly isLine = computed(() => this.element().type === 'arrow' || this.element().type === 'line');
   /** Text/label controls apply to text elements and to shapes (which have labels). */
   protected readonly canHaveText = computed(() => this.textTargets().length > 0);

   /** Every selected element that takes font styling (the shown element when nothing else is). */
   private readonly textTargets = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      const els = ids.size ? this.store.elements().filter((e) => ids.has(e.id)) : [this.element()];
      return els.filter((e) => TEXT_TYPES.has(e.type));
   });
   /** The font shared by the text in the selection, or null when they differ. */
   protected readonly sharedFont = computed<string | null>(() => {
      const fonts = new Set(this.textTargets().map((e) => e.fontFamily ?? 'normal'));
      return fonts.size === 1 ? [...fonts][0] : null;
   });
   /** The font size shared by the text in the selection, or null when they differ. */
   protected readonly sharedSize = computed<number | null>(() => {
      const sizes = new Set(this.textTargets().map((e) => e.fontSize ?? TEXT_SIZE_DEFAULT));
      return sizes.size === 1 ? [...sizes][0] : null;
   });
   /** Name shown on the font button. */
   protected readonly fontLabel = computed(() => {
      const f = this.sharedFont();
      if (f === null) return 'Mixed';
      return this.themeFonts().find((t) => t.value === f)?.label ?? this.fonts.find((o) => o.value === f)?.label ?? f;
   });
   protected readonly fontLabelStack = computed(() => {
      const f = this.sharedFont();
      if (f === null) return null;
      return this.themeFonts().find((t) => t.value === f)?.stack ?? fontStack(f as FontFamily);
   });
   protected readonly multiText = computed(() => this.textTargets().length > 1);
   protected readonly hasFill = computed(
      () => !this.isText() && !this.isLine() && this.element().type !== 'freedraw' && this.element().type !== 'image'
   );
   /** Closed shapes and code cards can drop their outline entirely ("no stroke"). */
   protected readonly strokeCanBeNone = computed(() => {
      const t = this.element().type;
      return t === 'rectangle' || t === 'ellipse' || t === 'diamond' || t === 'code';
   });
   /** The theme stroke swatch applies to whole elements, not to cell or rich-text styling. */
   protected readonly strokeThemeValue = computed(() => (this.cellsOn() || this.editingRich() ? null : THEME_STROKE));
   protected readonly surfaceFill = SURFACE_FILL;

   /** The deck theme of the slide (or layout) this element is on; null off slides. */
   protected readonly deckTheme = computed<SlideTheme | null>(() => {
      const el = this.element();
      const frames = this.store.slideFrames();
      const f = el.type === 'frame' ? frames.find((x) => x.id === el.id) : frames.find((x) => x.id === el.slideId);
      return f ? (this.store.presentationThemes().get(presentationOf(f)) ?? DEFAULT_THEME) : null;
   });
   /** On a slide, layout or master: fields can be inserted. */
   protected readonly onSlide = computed(() => this.deckTheme() !== null);
   protected readonly slideFields = SLIDE_FIELDS;
   protected readonly fieldLabels = SLIDE_FIELD_LABELS;
   protected readonly fieldToken = fieldToken;

   /** Insert a field token at the caret while typing, else append it ("{{slide}}") to the text; it fills in when slides are drawn. */
   protected insertField(token: string): void {
      // While typing into the text: at the caret, like any typed text.
      if (this.editingRich() && this.rich.insert(token)) return;
      const el = this.element();
      const sep = el.text && !/\s$/.test(el.text) ? ' ' : '';
      const runs = el.runs?.length ? [...el.runs, { text: sep + token }] : el.runs;
      void this.store.updateElement(el.id, withTextFit(el, { text: (el.text ?? '') + sep + token, runs }));
   }

   /** Grid cell styles are stored inside the grid's JSON, which tokens do not reach. */
   protected readonly swatchTheme = computed(() => (this.cellsOn() ? null : this.deckTheme()));

   /** A stored color as CSS (theme tokens as their concrete color). */
   protected colorCss(color: string | undefined): string | undefined {
      const c = resolveThemeColor(color, this.deckTheme() ?? DEFAULT_THEME);
      return c && themeSwatchCss(c);
   }

   protected readonly themeFonts = computed(() => {
      const t = this.deckTheme();
      return t
         ? [
              { value: themeToken('heading'), label: 'Heading', stack: fontStack(t.fonts.heading) },
              { value: themeToken('body'), label: 'Body', stack: fontStack(t.fonts.body) },
           ]
         : [];
   });
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

   protected readonly borderModes: { id: GridBorders; label: string }[] = [
      { id: 'all', label: 'All borders' },
      { id: 'outer', label: 'Outside only' },
      { id: 'inner', label: 'Inside only' },
      { id: 'rows', label: 'Rows only' },
      { id: 'none', label: 'No borders' },
   ];
   protected readonly gridBorders = computed<GridBorders>(() => parseGrid(this.element().text).borders ?? 'all');
   protected setGridBorders(mode: GridBorders): void {
      void this.grids.setBorders(this.store.selectedElementIds(), mode);
   }

   protected toggleGridHeader(): void {
      void this.grids.toggleHeader(this.store.selectedElementIds());
   }

   /** Selected cells of this table, when styling should target them instead of the whole table. */
   private cellsOn(): boolean {
      const r = this.grids.range();
      return !!r && r.id === this.element().id;
   }

   protected setLanguage(language: CodeLanguage): void {
      this.patchCode({ language });
   }

   protected setCodeSize(fontSize: number): void {
      this.patchCode({ fontSize });
   }

   protected setStroke(color: string): void {
      if (this.cellsOn()) {
         void this.grids.styleSelected({ color });
         return;
      }
      if (this.editingRich() && this.rich.apply({ color })) {
         return;
      }
      this.patchAll({ strokeColor: color });
   }

   /** CSS color for a fill swatch/value; the surface fill tracks the theme. */
   protected fillCss(color: string | undefined): string {
      return color === SURFACE_FILL ? 'var(--dd-surface)' : this.colorCss(color) || '#ffffff';
   }

   protected setFill(color: string): void {
      if (this.cellsOn()) {
         void this.grids.styleSelected({
            fill: color === 'transparent' ? undefined : color,
         });
         return;
      }
      this.patchAll(color === 'transparent' ? { fillStyle: 'none' } : { backgroundColor: color, fillStyle: 'solid' });
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
      const face = (resolveThemeFont(font, this.deckTheme() ?? DEFAULT_THEME) ?? 'normal') as FontFamily;
      void ensureFontLoaded(face).then(() => this.patchText({ fontFamily: font }));
   }

   /** Font changes go to every selected element that has text, never to pictures, lines, etc. */
   private patchText(patch: UpdateElementDto): void {
      for (const el of this.textTargets()) {
         void this.store.updateElement(el.id, withTextFit(el, this.withRunReset(el, patch)));
      }
      this.store.setElementStyle(patch as Record<string, unknown>);
   }

   /** Step every selected text's size to the next preset up or down (each from its own size). */
   protected stepFontSize(dir: 1 | -1): void {
      for (const el of this.textTargets()) {
         const cur = el.fontSize ?? TEXT_SIZE_DEFAULT;
         const next =
            dir > 0
               ? (FONT_SIZES.find((s) => s > cur) ?? Math.round(cur * 1.25))
               : ([...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(6, Math.round(cur * 0.8)));
         void this.store.updateElement(el.id, withTextFit(el, { fontSize: next }));
      }
   }

   /** A size typed into the size menu. */
   protected setCustomFontSize(value: string): void {
      const n = Math.round(Number(value));
      if (Number.isFinite(n) && n >= 4 && n <= 400) {
         this.setFontSize(n);
      }
   }

   protected setLineHeight(lineHeight: number): void {
      this.patchAll({ lineHeight });
   }

   protected setFontSize(size: number): void {
      this.patchText({ fontSize: size });
   }

   protected toggleBold(): void {
      if (this.cellsOn()) {
         void this.grids.styleSelected({ bold: !this.boldOn() });
         return;
      }
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
            withTextFit(el, { text: plainOf(runs), runs: isPlainRuns(runs) ? null : runs })
         );
      }
   }

   /** Tag the selected words so they glide into the same-tagged words of the next slide. */
   protected setRunMorphTag(tag: string): void {
      this.rich.apply({ morph: tag.trim().slice(0, 80) || null });
   }

   protected toggleItalic(): void {
      if (this.cellsOn()) {
         void this.grids.styleSelected({ italic: !this.italicOn() });
         return;
      }
      if (this.editingRich() && this.rich.apply({ italic: !this.italicOn() })) {
         return;
      }
      this.patchAll({ italic: !this.element().italic });
   }

   protected setCornerRadius(value: number): void {
      this.patchAll({ cornerRadius: value });
   }

   protected setEllipticCorners(on: boolean): void {
      this.patchAll({ ellipticCorners: on });
   }

   protected setTextAlign(align: TextAlign): void {
      if (this.cellsOn()) {
         void this.grids.styleSelected({ align });
         return;
      }
      this.patchAll({ textAlign: align });
   }

   protected setVerticalAlign(align: VerticalAlign): void {
      if (this.cellsOn()) {
         void this.grids.styleSelected({ vAlign: align });
         return;
      }
      this.patchAll({ verticalAlign: align });
   }

   protected setStartHead(type: ArrowheadType): void {
      this.patchAll({ startArrowhead: type });
   }

   protected setEndHead(type: ArrowheadType): void {
      this.patchAll({ endArrowhead: type });
   }

   /** Toggle between a straight line and a curve (drag the midpoint handle to fine-tune). */
   /** How the selected line/arrow is routed. */
   protected readonly route = computed<'straight' | 'curved' | 'elbow'>(() => {
      const e = this.element();
      return e.elbow ? 'elbow' : e.curvature ? 'curved' : 'straight';
   });

   protected setRoute(mode: 'straight' | 'curved' | 'elbow'): void {
      if (mode === this.route()) return;
      if (mode === 'elbow') {
         this.patchAll({ elbow: true, curvature: 0 });
      } else if (mode === 'straight') {
         this.patchAll({ elbow: false, curvature: 0 });
      } else {
         if (this.element().elbow) this.patchAll({ elbow: false });
         this.toggleCurve();
      }
   }

   protected toggleClipContent(): void {
      const e = this.element();
      void this.store.updateElement(e.id, { clipContent: !e.clipContent });
   }

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

   protected setPlayback(value: MediaPlayback): void {
      void this.media.setMedia(this.element().id, { playback: value === 'click' ? undefined : value });
   }

   protected toggleMediaFlag(key: 'loop' | 'muted'): void {
      const el = this.element();
      const on = key === 'loop' ? (el.media?.loop ?? false) : (el.media?.muted ?? false);
      void this.media.setMedia(el.id, { [key]: !on });
   }

   protected readonly copied = signal(false);
   /** Copy a code block's text to the clipboard. */
   protected copyCode(): void {
      const text = this.element().text ?? '';
      void navigator.clipboard?.writeText(text).then(() => {
         this.copied.set(true);
         setTimeout(() => this.copied.set(false), 1200);
      });
   }

   protected setAlt(value: string): void {
      const alt = value.trim();
      void this.media.setMedia(this.element().id, { alt: alt || undefined });
   }

   /** Video trim, in seconds (empty clears it). */
   protected setTrim(key: 'start' | 'end', raw: string): void {
      const n = raw === '' ? undefined : Math.max(0, Number(raw));
      void this.media.setMedia(this.element().id, { [key]: n === undefined || Number.isNaN(n) ? undefined : n });
   }

   protected bringToFront(): void {
      this.store.arrangeSelection('front');
   }

   protected sendToBack(): void {
      this.store.arrangeSelection('back');
   }

   /** Selected items changed from their slide's layout (or master) that can go back. */
   protected readonly revert = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return revertable(
         this.store,
         this.store.elements().filter((e) => ids.has(e.id))
      );
   });

   protected revertToLayout(): void {
      const items = this.revert().items;
      void this.store.batchHistory(() => revertItems(this.store, items));
   }

   protected remove(): void {
      // The editor owns delete so a frame takes its contents with it.
      this.editorActions.deleteSelection();
   }
}
