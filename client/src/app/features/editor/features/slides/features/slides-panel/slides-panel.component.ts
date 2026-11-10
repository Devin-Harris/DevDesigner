import { NgTemplateOutlet } from '@angular/common';
import { AutofocusDirective } from '../../../../../../shared/ui/directives/autofocus.directive';
import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   computed,
   effect,
   inject,
   input,
   output,
   signal,
   untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
   BUILT_IN_DESIGNS,
   BUILT_IN_LAYOUT_SETS,
   BUILT_IN_THEMES,
   DEFAULT_DESIGN,
   DEFAULT_LAYOUT_SET,
   DEFAULT_THEME,
   LAYOUT_KINDS,
   LAYOUT_KIND_LABELS,
   PLACEHOLDER_ROLES,
   THEME_COLOR_LABELS,
   THEME_COLOR_TOKENS,
   THEME_FILL,
   THEME_STROKE,
   effectiveTransition,
   isBuiltInRecord,
   layoutNameOf,
   layoutOf,
   masterOf,
   morphIdForTag,
   morphTagOf,
   parseThemeFile,
   presentableSlides,
   presentationLayouts,
   presentationMaster,
   presentationOf,
   presentationSlides,
   recordKind,
   themeFile,
   themeSwatchCss,
   themeTokensOnly,
   themeToken,
   tokenOf,
   type CanvasElementModel,
   type FontFamily,
   type LayoutKind,
   type MorphBy,
   type ParsedThemeFile,
   type PlaceholderConfig,
   type PlaceholderRole,
   type SlideConfig,
   type SlideDirection,
   type SlideEasing,
   type SlideTheme,
   type SlideTransition,
   type SlideTransitionType,
   type ThemeColorToken,
   type ThemeFilePart,
   type ThemeFontToken,
} from '@devdesigner/shared';
import { ThemeService } from '../../../../../../core/theme/theme.service';
import { UserThemesService } from '../../../../../../core/theme/user-themes.service';
import { CheckboxComponent } from '../../../../../../shared/ui/components/checkbox/checkbox.component';
import { ColorSwatchesComponent } from '../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../../../shared/ui/directives/popover-trigger.directive';
import {
   SegmentedComponent,
   type SegmentedOption,
} from '../../../../../../shared/ui/components/segmented/segmented.component';
import { SelectComponent, type SelectOption } from '../../../../../../shared/ui/components/select/select.component';
import { TagInputComponent } from '../../../../../../shared/ui/components/tag-input/tag-input.component';
import { ProjectStore } from '../../../../state/project/project.store';
import { FRAME_PRESETS } from '../../../../shared/constants/frame-presets';
import { elementBox, tableBox } from '../../../../helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../../../../helpers/frame-contents.helper';
import { FONT_OPTIONS, fontStack } from '../../../../helpers/shape-render.helper';
import { ensureFontLoaded, fitTextElement } from '../../../../helpers/text-metrics';
import { AnimationPaneComponent } from './features/animation-pane/animation-pane.component';
import {
   isLayoutStandIn,
   masterStandIns,
   placeholderDrift,
   placeholderGhosts,
   resetSlideToLayout,
   resetToMaster,
   standInChanged,
   switchLayout,
   syncLayoutCopies,
   type PlaceholderDrift,
} from '../../../../helpers/layout-placeholders';
import { MorphTagSuggestions } from './services/morph-tag-suggestions.service';
import { SlideRenderService } from '../../services/slide-render.service';
import { type SlidesCommand } from './models/slides-command.model';
import { FocusUiState } from './services/focus-ui-state.service';
import {
   addStandardLayouts,
   applyLayoutSet,
   captureLayoutSet,
   deckLayouts,
   isForeignLayout,
} from '../../helpers/standard-layouts';

const TYPE_OPTIONS: SelectOption<SlideTransitionType>[] = [
   { value: 'none', label: 'None' },
   { value: 'fade', label: 'Fade' },
   { value: 'slide', label: 'Slide' },
   { value: 'zoom', label: 'Zoom' },
   { value: 'morph', label: 'Morph' },
];
const DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
   { value: 'left', label: 'To the left' },
   { value: 'right', label: 'To the right' },
   { value: 'up', label: 'Upwards' },
   { value: 'down', label: 'Downwards' },
];
const MORPH_BY_SELECT: SelectOption<MorphBy>[] = [
   { value: 'character', label: 'Characters' },
   { value: 'word', label: 'Words' },
   { value: 'object', label: 'Objects' },
];
const EASING_OPTIONS: SelectOption<SlideEasing>[] = [
   { value: 'ease-in-out', label: 'Ease in-out' },
   { value: 'ease', label: 'Ease' },
   { value: 'ease-in', label: 'Ease in' },
   { value: 'ease-out', label: 'Ease out' },
   { value: 'linear', label: 'Linear' },
];

/**
 * Scroll a slide card into view inside its own scrolling list only. `scrollIntoView`
 * would also scroll the canvas when the panel is panned off screen, dragging the
 * toolbars and minimap away with it.
 */
function revealCard(card: Element | undefined, within: HTMLElement | null): void {
   let list = card?.parentElement ?? null;
   while (list && list !== within && !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) {
      list = list.parentElement;
   }
   if (!card || !list || !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) {
      return;
   }
   const box = list.getBoundingClientRect();
   const r = card.getBoundingClientRect();
   // The panel is scaled with the canvas zoom; scrollTop is in unscaled px.
   const scale = box.height / (list.offsetHeight || 1) || 1;
   if (r.top < box.top) {
      list.scrollTop -= (box.top - r.top) / scale;
   } else if (r.bottom > box.bottom) {
      list.scrollTop += (r.bottom - box.bottom) / scale;
   }
}

/**
 * The slide sorter:the project's presentation as a list of frame thumbnails.
 * Reorder by dragging, skip/duplicate/remove per slide, and edit the selected
 * slide's transition and speaker notes. All edits are ordinary frame updates, so
 * they sync live and undo/redo like any other change.
 */
/** Deck layouts signature last saved, per `deck|layout set` (shared by every panel instance). */
const lastLayoutSave = new Map<string, string>();

@Component({
   selector: 'dd-slides-panel',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      NgTemplateOutlet,
      AutofocusDirective,
      AnimationPaneComponent,
      CheckboxComponent,
      ColorSwatchesComponent,
      FormsModule,
      IconComponent,
      PopoverTriggerDirective,
      MatTooltipModule,
      SelectComponent,
      SegmentedComponent,
      TagInputComponent,
   ],
   templateUrl: './slides-panel.component.html',
   styleUrl: './slides-panel.component.scss',
})
export class SlidesPanelComponent {
   readonly command = output<SlidesCommand>();
   /** `list`: the slide cards (left of the frame); `settings`: transition/size/notes (right). */
   readonly part = input<
      | 'list'
      | 'settings'
      | 'size-menu'
      | 'theme-menu'
      | 'design-menu'
      | 'focus-list'
      | 'focus-settings'
      | 'focus-transition'
      | 'design-layouts'
      | 'design-theme'
   >('list');
   /** Settings panel only: folded sideways to a narrow strip. */
   readonly folded = input<boolean>(false);
   /** The slide of this presentation currently shown on the canvas (the only one visible). */
   readonly active_ = input<string | null>(null, { alias: 'active' });
   /** The presentation this panel belongs to (its name). */
   readonly presentation = input.required<string>();
   /** The last slide shown before a layout was opened (kept highlighted while editing it). */
   readonly lastSlide = input<string | null>(null);

   protected readonly store = inject(ProjectStore);
   private readonly render = inject(SlideRenderService);
   private readonly theme = inject(ThemeService);
   private readonly tagSuggestions = inject(MorphTagSuggestions);
   private readonly destroyRef = inject(DestroyRef);

   protected readonly typeOptions = TYPE_OPTIONS;
   protected readonly directionOptions = DIRECTION_OPTIONS;
   protected readonly easingOptions = EASING_OPTIONS;
   protected readonly morphByOptions = MORPH_BY_SELECT;

   protected readonly canEdit = this.store.canEdit;
   /** Slides of this presentation, in order (skipped ones included). */
   protected readonly frames = computed(() => presentationSlides(this.store.slideFrames(), this.presentation()));

   /** Put the saved name back (Escape, or a name that is empty or already taken). */
   protected cancelRename(input: HTMLInputElement): void {
      input.value = this.presentation();
      input.blur();
   }

   /** Rename the presentation (every one of its slides carries the name). */
   protected commitRename(input: HTMLInputElement): void {
      const current = this.presentation();
      const name = input.value.trim().slice(0, 120);
      if (!name || name === current || this.store.presentations().includes(name)) {
         input.value = current;
         return;
      }
      // Layouts carry the presentation name too.
      const slides = this.store.slideFrames().filter((f) => presentationOf(f) === current);
      const shown = this.active_();
      void this.store
         .batchHistory(async () => {
            for (const f of slides) {
               if (f.slide) {
                  await this.store.updateElement(f.id, { slide: { ...f.slide, presentation: name } });
               }
            }
         })
         // The shown slide and the selection follow the new name.
         .finally(() => (shown ? this.store.setActiveSlide(shown) : undefined));
   }
   /** Ids in the order just dropped, held until the store has caught up with the writes. */
   private readonly pendingOrder = signal<string[] | null>(null);
   /** The slides as listed: the store order, or the just-dropped order while it persists. */
   protected readonly shown = computed(() => {
      const frames = this.frames();
      const pending = this.pendingOrder();
      let list = frames;
      if (pending) {
         const rank = new Map(pending.map((id, i) => [id, i] as const));
         list = [...frames].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      }
      // A slide being cloned shows as a stand-in until the real copy arrives.
      const clone = this.pendingClone();
      const src = clone && list.find((f) => f.id === clone.srcId);
      if (clone && src) {
         list = [...list];
         list.splice(clone.to, 0, { ...src, id: this.pendingCloneId });
      }
      return list;
   });
   /** Stand-in id for a slide copy that is still being created. */
   protected readonly pendingCloneId = '__pending-clone__';
   private readonly pendingClone = signal<{ srcId: string; to: number; known: Set<string> } | null>(null);
   private readonly dropWatch = effect(() => {
      const clone = this.pendingClone();
      const frames = this.frames();
      // The copy has arrived once the slide at its drop slot is one we did not have before.
      if (clone && frames[clone.to] && !clone.known.has(frames[clone.to].id)) {
         untracked(() => this.pendingClone.set(null));
      }
   });

   /** Frame to show in the thumbnail: stand-ins borrow their source's picture. */
   protected thumbId(f: CanvasElementModel): string {
      return f.id === this.pendingCloneId ? (this.pendingClone()?.srcId ?? f.id) : f.id;
   }
   /** Layouts of this presentation. */
   protected readonly layouts = computed(() => presentationLayouts(this.store.slideFrames(), this.presentation()));
   /** The layouts shown in the Layout tab: the built-in Blank one is not edited. */
   /** The presentation's master (drawn under every slide and layout). */
   protected readonly master = computed(
      () => presentationMaster(this.store.slideFrames(), this.presentation()) ?? null
   );
   protected readonly editableLayouts = computed(() => this.layouts().filter((l) => !l.slide?.defaultLayout));
   /** The Layouts tab's cards: the design's own layouts (not ones kept from another design). */
   protected readonly designLayouts = computed(() => this.editableLayouts().filter((l) => !this.foreign(l)));
   /** The New menu's layouts: standard kinds first in their usual order, then the rest. */
   protected readonly menuLayouts = computed(() => {
      const rank = (l: CanvasElementModel): number => {
         const k = l.slide?.layoutKind;
         return k ? LAYOUT_KINDS.indexOf(k) : LAYOUT_KINDS.length;
      };
      return this.layouts()
         .filter((l) => !this.foreign(l))
         .sort((a, b) => rank(a) - rank(b));
   });
   protected readonly standardKinds = LAYOUT_KINDS.filter((k) => k !== 'blank');
   protected readonly kindLabels = LAYOUT_KIND_LABELS;
   /** Standard layout kinds this design doesn't have yet. */
   protected readonly missingKinds = computed(() => {
      const have = new Set(
         this.designLayouts()
            .map((l) => l.slide?.layoutKind)
            .filter(Boolean)
      );
      return this.standardKinds.filter((k) => !have.has(k));
   });

   /** Keep the shown layout's card in view (e.g. one just added). */
   private readonly followLayout = effect(() => {
      if (this.part() !== 'design-layouts') return;
      this.active_();
      this.designLayouts();
      setTimeout(
         () =>
            (this.host.nativeElement as HTMLElement)
               .querySelector('.f-cards .ly.on')
               ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
         60
      );
   });

   // ---- Layout cards: drag to reorder, Alt-drag to duplicate ----
   protected readonly lyDrag = signal<{ from: number; to: number; alt: boolean } | null>(null);
   protected lySuppress = false;
   protected onLayoutDown(index: number, event: PointerEvent): void {
      if (event.button !== 0 || !this.canEdit()) return;
      if ((event.target as HTMLElement).closest('.ly-del')) return;
      const scroller = (event.currentTarget as HTMLElement).parentElement as HTMLElement;
      const sx = event.clientX;
      const sy = event.clientY;
      let started = false;
      let lastY = sy;
      let alt = event.altKey;
      let raf = 0;
      /** The gap (0..n) the pointer is over: how many card centres lie above it. */
      const gapAt = (y: number): number => {
         let i = 0;
         for (const c of Array.from(scroller.querySelectorAll<HTMLElement>(':scope > .lyw'))) {
            const r = c.getBoundingClientRect();
            if (y > r.top + r.height / 2) i++;
         }
         return i;
      };
      const update = (): void => this.lyDrag.set({ from: index, to: gapAt(lastY), alt });
      const tick = (): void => {
         const r = scroller.getBoundingClientRect();
         if (lastY < r.top + 28) scroller.scrollTop -= 8;
         else if (lastY > r.bottom - 28) scroller.scrollTop += 8;
         update();
         raf = requestAnimationFrame(tick);
      };
      const move = (e: PointerEvent): void => {
         lastY = e.clientY;
         alt = e.altKey;
         if (!started) {
            if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
            started = true;
            raf = requestAnimationFrame(tick);
         }
         update();
      };
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Alt' && started) {
            alt = e.type === 'keydown';
            e.preventDefault();
            update();
         }
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         window.removeEventListener('keydown', onKey);
         window.removeEventListener('keyup', onKey);
         cancelAnimationFrame(raf);
         const d = this.lyDrag();
         this.lyDrag.set(null);
         if (!started || !d || e.type !== 'pointerup') return;
         this.lySuppress = true;
         setTimeout(() => (this.lySuppress = false), 0);
         const cards = this.designLayouts();
         const src = cards[index];
         if (!src) return;
         if (d.alt) {
            // Position in the deck's full layout list (other designs' layouts included).
            const all = this.layouts();
            const toIndex = d.to < cards.length ? all.indexOf(cards[d.to]) : all.indexOf(cards[cards.length - 1]) + 1;
            this.command.emit({ kind: 'duplicate', id: src.id, toIndex });
            return;
         }
         const to = d.to > index ? d.to - 1 : d.to;
         if (to === index) return;
         const next = [...cards];
         next.splice(index, 1);
         next.splice(to, 0, src);
         // Reuse the cards' own order slots, so other designs' layouts keep their places.
         const slots = cards.map((c) => c.slide?.order ?? 0).sort((a, b) => a - b);
         void this.store.batchHistory(async () => {
            for (let i = 0; i < next.length; i++) {
               const f = next[i];
               if (f.slide && f.slide.order !== slots[i]) {
                  await this.store.updateElement(f.id, { slide: { ...f.slide, order: slots[i] } });
               }
            }
         });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
   }

   /** Add standard layouts to this presentation and show the first one. */
   protected async addStandard(kinds: readonly LayoutKind[]): Promise<void> {
      const anchor = this.active();
      if (!anchor || !this.canEdit()) return;
      const ids = await addStandardLayouts(this.store, anchor, kinds);
      if (ids[0]) this.command.emit({ kind: 'focus', id: ids[0] });
   }
   /** The layout on the canvas right now (being edited), if one is. */
   protected readonly shownLayout = computed(
      () =>
         this.layouts().find((l) => l.id === this.active_()) ??
         (this.master()?.id === this.active_() ? this.master() : null)
   );
   /** Showing a layout opens this tab, so its editing tools are at hand. */
   private readonly shownLayoutId = computed(() => this.shownLayout()?.id ?? null);
   private readonly layoutTab = effect(() => {
      if (this.shownLayoutId()) {
         untracked(() => {
            this.tab.set('design');
            this.designTab.set('layouts');
         });
      }
   });
   /** Leave the layout: show the first slide using it, else the first slide. */
   protected backToSlide(): void {
      const l = this.shownLayout();
      const slide =
         this.frames().find((f) => f.id === this.lastSlide()) ??
         this.frames().find((f) => f.slide?.layoutId === l?.id) ??
         this.frames()[0];
      if (slide) this.command.emit({ kind: 'focus', id: slide.id });
   }
   protected layoutName(l: CanvasElementModel): string {
      return layoutNameOf(l, this.store.slideFrames());
   }
   protected renameLayout(l: CanvasElementModel, input: HTMLInputElement): void {
      const name = input.value.trim().slice(0, 120);
      if (!l.slide || !name || name === this.layoutName(l)) {
         input.value = this.layoutName(l);
         return;
      }
      void this.store.updateElement(l.id, { slide: { ...l.slide, layoutName: name } });
   }
   protected readonly layoutOptions = computed<SelectOption<string>[]>(() =>
      this.layouts().map((l) => ({
         value: l.id,
         label: this.foreign(l) ? `⚠ ${this.layoutName(l)} (not in this design)` : this.layoutName(l),
      }))
   );
   /** The selected slides' common layout ('' = none; first slide's when they differ). */
   protected readonly activeLayoutValue = computed(() => {
      const a = this.active();
      return (a && layoutOf(a, this.store.slideFrames())?.id) ?? '';
   });
   protected setLayout(id: string): void {
      const targets = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
      const layout = this.layouts().find((l) => l.id === id) ?? null;
      void this.store.batchHistory(async () => {
         for (const f of targets) {
            if (f.slide && (f.slide.layoutId ?? '') !== id) {
               await switchLayout(this.store, f, layout);
            }
         }
      });
   }

   protected readonly roleOptions: SelectOption<string>[] = [
      { value: '', label: 'None' },
      ...PLACEHOLDER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
   ];
   /** Selected text boxes on the shown layout (they can be made placeholders). */
   protected readonly layoutTextSelection = computed(() => {
      const l = this.shownLayout();
      const ids = new Set(this.store.selectedElementIds());
      return l ? this.store.elements().filter((e) => ids.has(e.id) && e.slideId === l.id && e.type === 'text') : [];
   });
   /** The shown slide (not a layout) when exactly it is what the tab edits. */
   private readonly driftSlide = computed(() => {
      const a = this.active();
      return a && !a.slide?.layout && this.activeSlides().length <= 1 ? a : null;
   });
   /** Placeholders on the slide moved/restyled or deleted away from its layout; null = none. */
   protected readonly drift = computed(() => {
      this.store.elements();
      const slide = this.driftSlide();
      const d = slide ? placeholderDrift(this.store, slide) : null;
      return d && (d.changed.length || d.missing.length || d.objects.length) ? d : null;
   });
   /** Selected placeholders that drifted (reset just those). */
   protected readonly selectedDrifted = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      const d = this.drift();
      return d ? [...d.changed, ...d.objects].filter((c) => ids.has(c.id)) : [];
   });
   protected driftLabel(d: PlaceholderDrift): string {
      const parts = [
         d.changed.length ? `${d.changed.length} placeholder${d.changed.length > 1 ? 's' : ''} changed` : '',
         d.missing.length ? `${d.missing.length} deleted` : '',
         d.objects.length ? `${d.objects.length} object${d.objects.length > 1 ? 's' : ''} changed` : '',
      ].filter(Boolean);
      return parts.join(', ') + ' from the layout';
   }
   protected resetSlide(selectedOnly: boolean): void {
      const slide = this.driftSlide();
      if (!slide) return;
      const only = selectedOnly ? new Set(this.selectedDrifted().map((c) => c.id)) : undefined;
      void this.store.batchHistory(() => resetSlideToLayout(this.store, slide, only));
   }
   /** Master items the shown slide or layout replaced with its own (double-click to make). */
   protected readonly standIns = computed(() => {
      this.store.elements();
      // The shown layout when editing one (a layout can change the master too), else the slide.
      const a = this.shownLayout() ?? (this.activeSlides().length <= 1 ? this.active() : null);
      // A copy made by just clicking the item, still as the master has it, is not a change.
      return a && !a.slide?.master
         ? masterStandIns(this.store, a.id).filter(
              (e) => !isLayoutStandIn(this.store, e) && standInChanged(this.store, e)
           )
         : [];
   });
   protected readonly selectedStandIns = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.standIns().filter((e) => ids.has(e.id));
   });
   protected resetMaster(selectedOnly: boolean): void {
      const items = selectedOnly ? this.selectedStandIns() : this.standIns();
      void this.store.batchHistory(() => resetToMaster(this.store, items));
   }
   /** Change the selected layout text boxes' placeholders, then bring slides in line. */
   private editPlaceholders(fn: (e: CanvasElementModel) => PlaceholderConfig | null): void {
      const items = this.layoutTextSelection();
      const layout = this.shownLayout();
      if (!layout) return;
      void this.store.batchHistory(async () => {
         for (const e of items) await this.store.updateElement(e.id, { placeholder: fn(e) });
         await syncLayoutCopies(this.store, layout);
      });
   }
   protected setPlaceholder(on: boolean): void {
      this.editPlaceholders((e) => (on ? (e.placeholder ?? {}) : null));
   }
   protected setRole(role: string): void {
      this.editPlaceholders((e) => {
         const { role: _old, ...rest } = e.placeholder ?? {};
         return role ? { ...rest, role: role as PlaceholderRole } : rest;
      });
   }
   /** The New button's layout menu is open. */
   protected readonly newMenu = signal(false);
   private readonly closeNewMenu = (): void => this.newMenu.set(false);
   private readonly newMenuWatch = effect((onCleanup) => {
      if (!this.newMenu()) return;
      // Any press outside the menu closes it.
      const t = setTimeout(() => document.addEventListener('pointerdown', this.closeNewMenu));
      onCleanup(() => {
         clearTimeout(t);
         document.removeEventListener('pointerdown', this.closeNewMenu);
      });
   });
   /** The layout plain "New" uses (the shown layout or the shown slide's), for its tooltip. */
   protected readonly newLayoutName = computed(() => {
      const shown = this.store.slideFrames().find((f) => f.id === this.active_());
      const l = shown?.slide?.layout ? shown : shown && layoutOf(shown, this.store.slideFrames());
      return l ? this.layoutName(l) : null;
   });
   protected addWithLayout(layoutId: string | null): void {
      this.newMenu.set(false);
      this.command.emit({ kind: 'add', layoutId });
   }
   /** Layout thumbnails for the list panel's New menu (rendered here, the settings panel has its own). */
   protected readonly layoutThumbs = signal<ReadonlyMap<string, string>>(new Map());
   private readonly layoutThumbWatch = effect((onCleanup) => {
      // The list panel renders on opening its New menu; the focus filmstrip's popover can't signal open, so it renders up front.
      const part = this.part();
      if (!(part === 'list' && this.newMenu()) && part !== 'focus-list') return;
      const layouts = [...this.layouts()];
      this.theme.dark();
      let live = true;
      void this.render.render(layouts, { fonts: false }).then((rs) => {
         if (live) this.layoutThumbs.set(new Map(rs.map((r) => [r.id, SlideRenderService.dataUrl(r.svg)])));
      });
      onCleanup(() => (live = false));
   });
   protected readonly playable = computed(() => this.frames().some((f) => !f.slide?.hidden));
   /** The single selected frame, when it is not part of the sequence yet. */
   protected readonly selectedLoose = computed<CanvasElementModel | null>(() => {
      const ids = this.store.selectedElementIds();
      if (ids.length !== 1) {
         return null;
      }
      const e = this.store.elements().find((x) => x.id === ids[0]);
      return e && e.type === 'frame' && !e.slide ? e : null;
   });
   protected readonly thumbs = signal<ReadonlyMap<string, string>>(new Map());
   protected readonly overIndex = signal<number | null>(null);
   /** The detail tabs of the settings panel. */
   /** Settings tab; shared with focus mode so the choice survives going in and out of it. */
   protected readonly tab = inject(FocusUiState).canvasTab;

   protected pick(tab: 'transition' | 'design' | 'size' | 'notes' | 'animations'): void {
      this.tab.set(tab);
   }

   /** A tab the deck header asked to open (a fresh object each request). */
   readonly requestTab = input<{ tab: 'transition' | 'design' | 'size' | 'notes' | 'animations' } | null>(null);
   private readonly applyRequestedTab = effect(() => {
      const r = this.requestTab();
      if (r) untracked(() => this.tab.set(r.tab));
   });

   /** The selected slides (the details edit all of them at once). */
   protected readonly activeSlides = computed<CanvasElementModel[]>(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.frames().filter((f) => ids.has(f.id));
   });
   protected readonly selectedCount = computed(() => this.activeSlides().length);
   /** The slide the details show: the first selected one, else the slide on the canvas. */
   protected readonly active = computed<CanvasElementModel | null>(
      () => this.activeSlides()[0] ?? this.frames().find((f) => f.id === this.active_()) ?? null
   );
   protected readonly activeId = computed(() => this.active()?.id ?? null);
   /** Keep the active slide's card in view (e.g. after leaving the presenter on another slide). */
   private readonly revealActive = effect(() => {
      const id = this.activeId();
      if (this.part() !== 'list' || !id) {
         return;
      }
      const index = this.shown().findIndex((f) => f.id === id);
      requestAnimationFrame(() => {
         const host = this.host.nativeElement as HTMLElement;
         revealCard(host.querySelectorAll('li.card')[index], host);
      });
   });
   protected readonly activeNumber = computed(() => {
      const id = this.activeId();
      return id ? this.frames().findIndex((f) => f.id === id) + 1 : 0;
   });
   /** False when the only slide in play is the first (nothing transitions into it). */
   /** On the first slide: there is a next slide whose transition can be mapped. */
   protected readonly morphRelevantNext = computed(() => this.frames().length > 1 && this.activeSlides().length <= 1);

   protected readonly hasTransitionTarget = computed(() => {
      const first = this.frames()[0]?.id;
      const targets = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
      return targets.some((f) => f.id !== first);
   });

   protected readonly sizeOptions = computed<SelectOption<string>[]>(() => {
      const opts = FRAME_PRESETS.map((p) => ({
         value: p.id,
         label: `${p.label} (${p.width} × ${p.height})`,
      }));
      return this.sizeValue() === 'custom' ? [{ value: 'custom', label: 'Custom / mixed' }, ...opts] : opts;
   });
   /** The preset every slide matches, or 'custom'. */
   protected readonly sizeValue = computed(() => {
      // Every slide of a presentation shares one size.
      const slides = this.frames();
      const hit = FRAME_PRESETS.find((p) =>
         slides.every((f) => Math.round(f.width) === p.width && Math.round(f.height) === p.height)
      );
      return slides.length && hit ? hit.id : 'custom';
   });
   protected readonly transition = computed<SlideTransition>(() =>
      effectiveTransition((this.activeSlides().find((f) => f.id !== this.frames()[0]?.id) ?? this.active())?.slide)
   );

   /** True when a morph is involved: the transition into this slide or into the one before it. */
   protected readonly morphRelevant = computed(() => {
      const frames = this.frames();
      // Layouts (and masters) feed every slide that uses them, so their objects can be tagged.
      const layoutIds = new Set(
         this.store
            .slideFrames()
            .filter((f) => f.slide?.layout)
            .map((f) => f.id)
      );
      if (this.selectedObjects().some((e) => !!e.slideId && layoutIds.has(e.slideId))) {
         return true;
      }
      const i = frames.findIndex((f) => f.id === this.activeId());
      if (i < 0) {
         return false;
      }
      const isMorph = (f: CanvasElementModel | undefined): boolean =>
         !!f && effectiveTransition(f.slide).type === 'morph';
      return (i > 0 && isMorph(frames[i])) || (i > 1 && isMorph(frames[i - 1]));
   });
   /** Selected non-frame elements (what a morph tag or pairing applies to). */
   private readonly selectedObjects = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
   });
   /**
    * Everything selected that can carry a morph tag: canvas elements plus sequence
    * participants, messages and diagrams (which the element selection doesn't hold).
    */
   private readonly tagTargets = computed(() => {
      const out: Array<{
         kind: 'element' | 'table' | 'lifeline' | 'message' | 'diagram';
         id: string;
         morphId?: string;
         slideId?: string;
      }> = this.selectedObjects().map((e) => ({
         kind: 'element',
         id: e.id,
         morphId: e.morphId,
         slideId: e.slideId,
      }));
      const tables = new Set(this.store.selectedTableIds());
      for (const t of this.store.tables()) {
         if (tables.has(t.id)) {
            out.push({ kind: 'table', id: t.id, morphId: t.morphId, slideId: t.slideId });
         }
      }
      const diagrams = new Map(this.store.sequenceDiagrams().map((d) => [d.id, d] as const));
      const lifelines = new Set(this.store.selectedLifelineIds());
      const messages = new Set(this.store.selectedMessageIds());
      const boxes = new Set(this.store.selectedDiagramIds());
      for (const l of this.store.lifelines()) {
         if (lifelines.has(l.id)) {
            out.push({
               kind: 'lifeline',
               id: l.id,
               morphId: l.morphId,
               slideId: diagrams.get(l.diagramId)?.slideId,
            });
         }
      }
      for (const m of this.store.sequenceMessages()) {
         if (messages.has(m.id)) {
            out.push({
               kind: 'message',
               id: m.id,
               morphId: m.morphId,
               slideId: diagrams.get(m.diagramId)?.slideId,
            });
         }
      }
      for (const d of diagrams.values()) {
         if (boxes.has(d.id)) {
            out.push({ kind: 'diagram', id: d.id, morphId: d.morphId, slideId: d.slideId });
         }
      }
      return out;
   });
   protected readonly tagCount = computed(() => this.tagTargets().length);
   /** The single selected element, with its split in / out tags (split = either is set). */
   protected readonly splitTarget = computed(() => {
      const t = this.tagTargets();
      if (t.length !== 1 || t[0].kind !== 'element') return null;
      const e = this.store.elements().find((x) => x.id === t[0].id);
      if (!e) return null;
      const split = e.morphIn != null || e.morphOut != null;
      return { id: e.id, split, in: e.morphIn ?? e.morphId, out: e.morphOut ?? e.morphId };
   });
   protected tagText(key: string | undefined): string {
      const t = morphTagOf(key);
      return t && !t.startsWith('solo-') ? t : '';
   }
   /** Split: start both sides from the shared tag. Join: drop both (the shared tag applies). */
   protected toggleSplit(st: { id: string; split: boolean; in?: string; out?: string }): void {
      const e = this.store.elements().find((x) => x.id === st.id);
      if (!e) return;
      const base = e.morphId ?? `tag:solo-${e.id.slice(0, 8)}`;
      void this.store.updateElement(
         e.id,
         st.split ? { morphIn: null, morphOut: null } : { morphIn: base, morphOut: base }
      );
   }
   protected setSplitTag(side: 'in' | 'out', value: string): void {
      const st = this.splitTarget();
      if (!st) return;
      const key = morphIdForTag(value) ?? `tag:solo-${side}-${st.id.slice(0, 8)}`;
      void this.store.updateElement(st.id, side === 'in' ? { morphIn: key } : { morphOut: key });
   }
   /** Tags other objects on this slide already carry: one tag names one object per slide. */
   protected readonly takenTags = computed(() => {
      const targets = this.tagTargets();
      const slideId = targets.find((e) => e.slideId)?.slideId ?? this.store.activeSlideId();
      return this.tagSuggestions.tagsTakenOn(slideId, new Set(targets.map((t) => t.id)));
   });
   /** The morph tag shared by the selection ('' when none or they differ). */
   protected readonly morphTag = computed(() => {
      // A slide's placeholder copy without its own tag shows the one set on the layout's placeholder.
      const byId = new Map(this.selectedObjects().map((e) => [e.id, e] as const));
      const inherited = (id: string): string | undefined => {
         const of = byId.get(id)?.placeholder?.of;
         return of ? this.store.elements().find((p) => p.id === of)?.morphId : undefined;
      };
      const tags = new Set(this.tagTargets().map((e) => morphTagOf(e.morphId ?? inherited(e.id)) ?? ''));
      return tags.size === 1 ? [...tags][0] : '';
   });
   /** Tags used on the slide before the selection's, offered while typing a tag. */
   protected readonly morphTagSuggestions = computed(() =>
      this.tagSuggestions.previousSlideTags(
         this.tagTargets().find((e) => e.slideId)?.slideId ?? this.store.activeSlideId()
      )
   );
   /** How many selected non-frame elements could be linked as one object (2+). */
   protected readonly pairable = computed(() => {
      const n = this.selectedObjects().length;
      return n >= 2 ? n : 0;
   });

   private renderToken = 0;

   // ---- Focus mode views ----
   /** Focus settings dock: Slide or Notes (Transition / Animations open their own screens). */
   /** Focus dock tab; kept outside this panel so it survives trips to the other focus screens. */
   protected readonly ftab = inject(FocusUiState).tab;
   /** The custom theme / design being renamed in a focus menu or card. */
   protected readonly renaming = signal<string | null>(null);
   protected finishRename(id: string, value: string): void {
      if (this.renaming() !== id) return;
      this.renaming.set(null);
      const name = value.trim();
      if (name) void this.renameRecord(id, name);
   }
   /** Themes for the focus menus and cards: built-in, then custom ("My themes"). */
   protected readonly themeGroups = computed(() => {
      const cur = this.deckTheme().id ?? 'default';
      const item = (t: SlideTheme, custom: boolean) => ({
         id: t.id!,
         name: t.name,
         custom,
         on: t.id === cur,
         theme: t,
      });
      const custom = this.library().filter((r) => recordKind(r) === 'theme' && r.id);
      return [
         { name: 'Built-in', items: BUILT_IN_THEMES.map((t) => item(t, false)) },
         ...(custom.length ? [{ name: 'My themes', items: custom.map((t) => item(t, true)) }] : []),
      ];
   });
   /** Designs for the focus top-bar menu: built-in, then custom. */
   protected readonly designGroups = computed(() => {
      const cur = this.design().id;
      const groups = new Map<
         string,
         { id: string; name: string; custom: boolean; on: boolean; theme: SlideTheme | null }[]
      >();
      for (const o of this.designOptions()) {
         const g = o.group ?? 'Designs';
         const list = groups.get(g) ?? [];
         list.push({ id: o.value, name: o.label, custom: !isBuiltInRecord(o.value), on: o.value === cur, theme: null });
         groups.set(g, list);
      }
      return [...groups.entries()].map(([name, items]) => ({ name, items }));
   });
   /** Theme colors offered as slide backgrounds (DeckFocus mock: four swatches). */
   protected readonly bgTokens = ['background', 'heading', 'accent1', 'surface'] as const;
   protected token(k: ThemeColorToken): string {
      return themeToken(k);
   }
   protected setBackground(color: string): void {
      const a = this.active();
      if (!a || !this.canEdit()) return;
      void this.store.updateElement(a.id, { backgroundColor: color, fillStyle: 'solid' });
   }
   /** Animation build steps on a slide (badge ▶ N). */
   protected animCount(f: CanvasElementModel): number {
      const steps = new Set<number>();
      for (const e of this.store.elements()) if (e.slideId === f.id && e.step) steps.add(e.step);
      return steps.size;
   }
   protected readonly transitionLabel = computed(() => {
      const t = this.active()?.slide?.transition?.type ?? 'none';
      return t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1);
   });
   protected readonly focusTypes: { value: SlideTransitionType; label: string }[] = [
      { value: 'morph', label: 'Morph' },
      { value: 'fade', label: 'Fade' },
      { value: 'slide', label: 'Slide' },
      { value: 'zoom', label: 'Zoom' },
      { value: 'none', label: 'None' },
   ];
   protected readonly focusMorphBy: { value: MorphBy; label: string }[] = [
      { value: 'character', label: 'Char' },
      { value: 'word', label: 'Word' },
      { value: 'object', label: 'Object' },
   ];
   /** Slides of this deck that use a layout (DeckDesign "N slides"). */
   protected usage(layoutId: string): number {
      return this.frames().filter((f) => f.slide?.layoutId === layoutId).length;
   }
   /** Theme cards for the design screen: built-in themes, then custom ones. */
   protected readonly themeCards = computed(() => [
      ...BUILT_IN_THEMES.map((t) => ({ ...t, custom: false })),
      ...this.library()
         .filter((r) => recordKind(r) === 'theme' && r.id)
         .map((t) => ({ ...t, custom: true })),
   ]);

   private readonly hostEl = inject(ElementRef<HTMLElement>);
   /** Focus slide list: keep the current slide in view (entering focus, switching slides). */
   private readonly keepCurrentInView = effect(() => {
      if (this.part() !== 'focus-list') return;
      this.active_();
      this.shown();
      setTimeout(() => {
         const el = (this.hostEl.nativeElement as HTMLElement).querySelector('.fs.on');
         el?.scrollIntoView({ block: 'nearest' });
      }, 60);
   });

   constructor() {
      // Re-render thumbnails (debounced) whenever anything that can appear on a slide changes.
      effect((onCleanup) => {
         const master = this.master();
         const frames =
            this.part() === 'list' || this.part() === 'focus-list'
               ? [...this.frames()]
               : [...(master ? [master] : []), ...this.layouts()];
         this.store.elements();
         this.store.tables();
         this.store.relationships();
         this.store.sequenceDiagrams();
         this.store.lifelines();
         this.store.sequenceMessages();
         this.theme.dark();
         const timer = setTimeout(() => void untracked(() => this.refreshThumbs(frames)), 350);
         onCleanup(() => clearTimeout(timer));
      });
      this.destroyRef.onDestroy(() => (this.renderToken += 1));
   }

   /**
    * Re-render only the slides whose content changed. Store rows are immutable, so a
    * slide is unchanged when its frame and every row drawn on it are the same object
    * references as at its last render; edits elsewhere on the canvas render nothing.
    */
   private async refreshThumbs(frames: readonly CanvasElementModel[]): Promise<void> {
      const ids = new Set(frames.map((f) => f.id));
      const deps = new Map(frames.map((f) => [f.id, this.thumbInputs(f)]));
      const dirty = frames.filter((f) => !sameInputs(this.thumbDeps.get(f.id), deps.get(f.id)!));
      const removed = [...this.thumbs().keys()].some((id) => !ids.has(id));
      if (!dirty.length && !removed) {
         return;
      }
      const token = (this.renderToken += 1);
      const rendered = dirty.length ? await this.render.render(dirty, { fonts: false, ghosts: true }) : [];
      if (token !== this.renderToken) {
         return;
      }
      const next = new Map([...this.thumbs()].filter(([id]) => ids.has(id)));
      for (const r of rendered) {
         next.set(r.id, SlideRenderService.dataUrl(r.svg));
      }
      // Clean slides adopt the new rows too, so later comparisons stay cheap ref checks.
      for (const f of frames) {
         this.thumbDeps.set(f.id, deps.get(f.id)!);
      }
      for (const id of [...this.thumbDeps.keys()]) {
         if (!ids.has(id)) this.thumbDeps.delete(id);
      }
      this.thumbs.set(next);
   }

   /** Everything a slide's thumbnail is drawn from (the rows `SlideRenderService` uses). */
   private thumbInputs(frame: CanvasElementModel): readonly unknown[] {
      const mine = contentForFrame(
         frame.id,
         !!frame.slide,
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages(),
         layoutOf(frame, this.store.slideFrames())?.id,
         masterOf(frame, this.store.slideFrames())?.id
      );
      // Fields ({{slide}} / {{total}}) change with the deck's order and size.
      const deckOrder = presentableSlides(this.store.slideFrames())
         .filter((f) => presentationOf(f) === presentationOf(frame))
         .map((f) => f.id)
         .join();
      // Rows not assigned to any slide are offered to every frame and cropped away when
      // outside it, so only those overlapping the frame affect its picture.
      const f = { x0: frame.x, y0: frame.y, x1: frame.x + frame.width, y1: frame.y + frame.height };
      const overlaps = (b: { x0: number; y0: number; x1: number; y1: number } | null): boolean =>
         !!b && b.x1 >= f.x0 && b.x0 <= f.x1 && b.y1 >= f.y0 && b.y0 <= f.y1;
      const elements = mine.elements.filter(
         (e) => e.id === frame.id || e.slideId === frame.id || overlaps(elementBox(e))
      );
      const tables = mine.tables.filter((t) => t.slideId === frame.id || overlaps(tableBox(t)));
      const diagrams = mine.diagrams.filter(
         (d) => d.slideId === frame.id || overlaps(sequenceDiagramBox(d, mine.lifelines, mine.messages))
      );
      const diagramIds = new Set(diagrams.map((d) => d.id));
      const columns = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
      const relationships = this.store
         .relationships()
         .filter((r) => columns.has(r.sourceColumnId) || columns.has(r.targetColumnId));
      // Layout items arrive as re-stacked copies; compare the stored rows instead.
      const rows = new Map(this.store.elements().map((e) => [e.id, e] as const));
      return [
         frame,
         // Thumbnails bake in the theme's colors.
         this.theme.dark(),
         deckOrder,
         ...elements.map((e) => rows.get(e.id) ?? e),
         // Empty placeholders are drawn from their layout slot: redraw when either changes.
         ...placeholderGhosts(frame.id, this.store.elements()).sources,
         ...tables,
         ...diagrams,
         ...mine.lifelines.filter((l) => diagramIds.has(l.diagramId)),
         ...mine.messages.filter((m) => diagramIds.has(m.diagramId)),
         ...relationships,
      ];
   }

   /** Inputs each thumbnail was last rendered from. */
   private readonly thumbDeps = new Map<string, readonly unknown[]>();

   // ---- edits ----

   protected toggleHidden(f: CanvasElementModel): void {
      if (!f.slide) {
         return;
      }
      void this.store.updateElement(f.id, { slide: { ...f.slide, hidden: !f.slide.hidden } });
   }

   protected removeFromSequence(f: CanvasElementModel): void {
      void this.store.updateElement(f.id, { slide: null });
   }

   /** Change the transition of the selected slides (the first slide has none). */
   protected setTransition(patch: Partial<SlideTransition>): void {
      const first = this.frames()[0]?.id;
      const base = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
      const targets = base.filter((f) => f.slide && f.id !== first);
      if (!targets.length) {
         return;
      }
      void this.store.batchHistory(async () => {
         for (const f of targets) {
            const slide: SlideConfig = {
               ...f.slide!,
               transition: { ...effectiveTransition(f.slide), ...patch },
            };
            await this.store.updateElement(f.id, { slide });
         }
      });
   }

   protected setDuration(raw: string): void {
      const ms = Math.min(5000, Math.max(100, Math.round(Number(raw)) || 600));
      this.setTransition({ duration: ms });
   }

   protected setNotes(value: string): void {
      const a = this.active();
      if (!a?.slide || (a.slide.notes ?? '') === value) {
         return;
      }
      void this.store.updateElement(a.id, { slide: { ...a.slide, notes: value || undefined } });
   }

   protected applyToAll(): void {
      const t = this.transition();
      const frames = this.frames();
      void this.store.batchHistory(async () => {
         for (const f of frames) {
            if (f.slide) {
               await this.store.updateElement(f.id, { slide: { ...f.slide, transition: { ...t } } });
            }
         }
      });
   }

   protected readonly colorTokens = THEME_COLOR_TOKENS;
   protected readonly accentTokens = ['heading', 'accent1', 'accent2', 'accent3', 'accent4'] as const;
   protected readonly colorLabels = THEME_COLOR_LABELS;
   protected readonly css = themeSwatchCss;
   /** The follow-light/dark-mode choice for a theme color: the surface for fills, text otherwise. */
   protected followValue(token: ThemeColorToken): string {
      return token === 'background' || token === 'surface' ? THEME_FILL : THEME_STROKE;
   }
   protected isFollow(color: string): boolean {
      return color === THEME_FILL || color === THEME_STROKE;
   }
   protected readonly fontOptions: SelectOption[] = FONT_OPTIONS.map((f) => ({ ...f, font: fontStack(f.value) }));
   protected stackOf(key: string): string {
      return fontStack(key);
   }

   // ---- Designs: one layout set plus a selected theme ----
   // Built-in themes, layout sets and designs never change: editing one saves a custom copy.
   // Custom records live in the project (shared with collaborators) and in My designs.

   private readonly userThemes = inject(UserThemesService);
   private readonly loadMyThemes = effect(() => {
      if (
         this.tab() === 'design' ||
         this.part() === 'design-theme' ||
         this.part() === 'theme-menu' ||
         this.part() === 'design-menu'
      )
         untracked(() => void this.userThemes.load());
   });
   /** The project's custom records. */
   protected readonly customThemes = this.store.customThemes;
   /** Every custom record: the project's, then the rest of My designs. */
   protected readonly library = computed<SlideTheme[]>(() => {
      const out = [...this.customThemes()];
      const ids = new Set(out.map((r) => r.id));
      for (const row of this.userThemes.themes()) if (!ids.has(row.theme.id)) out.push(row.theme);
      return out;
   });
   private record(id: string | undefined): SlideTheme | undefined {
      if (!id) return undefined;
      return (
         [...BUILT_IN_THEMES, ...BUILT_IN_LAYOUT_SETS, ...BUILT_IN_DESIGNS].find((r) => r.id === id) ??
         this.library().find((r) => r.id === id)
      );
   }

   /** The deck's design and layout set, as its frames record them. */
   private readonly deckRefs = computed(() => {
      const name = this.presentation();
      // Prefer a frame that records the design: frames added later may carry only the theme.
      const mine = this.store.slideFrames().filter((f) => presentationOf(f) === name && f.slide?.theme);
      const t = (mine.find((f) => f.slide!.theme!.designId) ?? mine[0])?.slide?.theme;
      return { designId: t?.designId, layoutsId: t?.layoutsId };
   });
   /** The deck's design (Default until another is picked). */
   protected readonly design = computed<SlideTheme>(() => {
      const d = this.record(this.deckRefs().designId);
      return d && recordKind(d) === 'design' ? d : DEFAULT_DESIGN;
   });
   protected readonly designIsCustom = computed(() => !isBuiltInRecord(this.design().id));
   /** The deck's layout set. */
   protected readonly layoutSetId = computed(
      () => this.deckRefs().layoutsId ?? this.design().layoutsId ?? DEFAULT_LAYOUT_SET.id!
   );
   protected readonly layoutSet = computed<SlideTheme>(() => this.record(this.layoutSetId()) ?? DEFAULT_LAYOUT_SET);

   /** The deck's selected theme (the default until one is picked). */
   protected readonly deckTheme = computed<SlideTheme>(() => {
      const name = this.presentation();
      const stored = (name ? this.store.presentationThemes().get(name) : undefined) ?? DEFAULT_THEME;
      const rec = this.record(stored.id);
      return rec && recordKind(rec) === 'theme' ? themeTokensOnly(rec) : themeTokensOnly(stored);
   });
   protected readonly themeIsCustom = computed(() => {
      const id = this.deckTheme().id;
      return !!id && !isBuiltInRecord(id) && this.library().some((r) => r.id === id);
   });

   protected readonly designOptions = computed<SelectOption<string>[]>(() => [
      ...BUILT_IN_DESIGNS.map((d) => ({ value: d.id!, label: d.name, group: 'Built-in' })),
      ...this.library()
         .filter((r) => recordKind(r) === 'design' && r.id)
         .map((d) => ({ value: d.id!, label: d.name, group: 'Custom', renamable: this.canEdit() })),
   ]);
   protected readonly themeOptions = computed<SelectOption<string>[]>(() => {
      const opts: SelectOption<string>[] = [
         ...BUILT_IN_THEMES.map((t) => ({ value: t.id!, label: t.name, group: 'Built-in' })),
         ...this.library()
            .filter((r) => recordKind(r) === 'theme' && r.id)
            .map((t) => ({ value: t.id!, label: t.name, group: 'Custom', renamable: this.canEdit() })),
      ];
      const cur = this.deckTheme();
      if (cur.id && !opts.some((o) => o.value === cur.id))
         opts.push({ value: cur.id, label: cur.name, group: 'Custom' });
      return opts;
   });

   /** A layout from a layout set the deck no longer uses, kept because slides still use it. */
   protected foreign(l: CanvasElementModel): boolean {
      return isForeignLayout(l, this.layoutSetId());
   }
   /** A slide whose layout is not one of the design's layouts. */
   protected slideForeign(f: CanvasElementModel): boolean {
      const l = layoutOf(f, this.store.slideFrames());
      return !!l && this.foreign(l);
   }

   /** Feedback from design, theme and layout actions. */
   protected readonly themeNote = signal<string | null>(null);
   /** Shown after a switch that kept layouts slides still use. */
   protected readonly relayoutNote = signal<string | null>(null);

   /** Design tab sub-tab: the design's layouts, or its theme. */
   protected readonly designTab = signal<'layouts' | 'theme'>('layouts');
   protected readonly designTabOptions: SegmentedOption<'layouts' | 'theme'>[] = [
      { value: 'layouts', label: 'Layouts' },
      { value: 'theme', label: 'Theme' },
   ];
   /** Which part the next imported file is used as. */
   protected readonly importPart = signal<ThemeFilePart>('design');

   private newId(): string {
      return `custom-${crypto.randomUUID()}`;
   }
   /** A name not yet used by a custom record. */
   private freshName(base: string): string {
      const names = new Set(this.library().map((c) => c.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      return name;
   }
   /** Add or replace custom records (by id) in the project and My designs, and drop `remove`. */
   private async saveRecords(upserts: SlideTheme[], remove: string[] = []): Promise<void> {
      const ids = new Set([...upserts.map((u) => u.id), ...remove]);
      await this.store.setCustomThemes([...this.customThemes().filter((c) => !ids.has(c.id)), ...upserts]);
      for (const u of upserts) {
         this.userThemes.save(u).catch(() => this.themeNote.set('Could not save to My designs.'));
      }
      for (const id of remove) {
         const row = this.userThemes.themes().find((t) => t.theme.id === id);
         if (row) void this.userThemes.remove(row.id);
      }
   }
   private designRecord(name: string, themeId: string | undefined, layoutsId: string): SlideTheme {
      return {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'design',
         id: this.newId(),
         name,
         themeId,
         layoutsId,
      };
   }
   private layoutsRecord(name: string, content: Pick<SlideTheme, 'layouts' | 'extraLayouts' | 'master'>): SlideTheme {
      return {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'layouts',
         id: this.newId(),
         name,
         ...content,
      };
   }

   /**
    * Store the theme and the deck's design and layout set on every frame of the deck.
    * `everywhere`: other decks on the same theme take its new colors and fonts (keeping
    * their own design).
    */
   private async stamp(
      theme: SlideTheme,
      designId: string,
      layoutsId: string,
      everywhere = false,
      silent = false
   ): Promise<string[]> {
      const name = this.presentation();
      const tokens = themeTokensOnly(theme);
      const touched: string[] = [];
      for (const f of this.store.slideFrames()) {
         if (!f.slide) continue;
         let next: SlideTheme | null = null;
         if (presentationOf(f) === name) next = { ...tokens, designId, layoutsId };
         else if (everywhere && theme.id && f.slide.theme?.id === theme.id) {
            next = { ...tokens, designId: f.slide.theme.designId, layoutsId: f.slide.theme.layoutsId };
         }
         if (!next) continue;
         touched.push(f.id);
         const patch = { slide: { ...f.slide, theme: next } };
         if (silent) await this.store.patchElementSilently(f.id, patch);
         else await this.store.updateElement(f.id, patch);
      }
      return touched;
   }

   /** Refit text boxes that use a theme font on these frames (fit-to-glyph boxes were sized for the old one). */
   private async refitText(frameIds: readonly string[]): Promise<void> {
      const ids = new Set(frameIds);
      for (const e of this.store.elements()) {
         if (e.type !== 'text' || !e.slideId || !ids.has(e.slideId) || !tokenOf(e.fontFamily)) continue;
         const size = fitTextElement(e);
         if (size.width !== e.width || size.height !== e.height) {
            await this.store.updateElement(e.id, { width: size.width, height: size.height });
         }
      }
   }
   private fontsDiffer(a: SlideTheme, b: SlideTheme): boolean {
      return a.fonts.heading !== b.fonts.heading || a.fonts.body !== b.fonts.body;
   }
   private async loadFonts(theme: SlideTheme): Promise<void> {
      await Promise.all([
         ensureFontLoaded(theme.fonts.heading as FontFamily),
         ensureFontLoaded(theme.fonts.body as FontFamily),
      ]);
   }

   /** Put the deck on a design: its layout set's layouts and the given theme. */
   private async switchTo(design: SlideTheme, set: SlideTheme, theme: SlideTheme): Promise<void> {
      const name = this.presentation();
      if (!name || !this.canEdit()) return;
      const fromSetId = this.layoutSetId();
      const from = this.deckTheme();
      await this.loadFonts(theme);
      this.applying = true;
      try {
         await this.store.batchHistory(async () => {
            const frames = await this.stamp(theme, design.id!, set.id!);
            if (set.id !== fromSetId) {
               const editing = this.shownLayoutId();
               const { kept, replaced } = await applyLayoutSet(this.store, name, fromSetId, set, theme);
               // Keep editing the layout that was on the canvas, now under the new set's id.
               const next = editing && replaced.get(editing);
               if (next) this.command.emit({ kind: 'focus', id: next });
               this.relayoutNote.set(
                  kept
                     ? `${kept} layout${kept > 1 ? 's' : ''} not in this design ${kept > 1 ? 'are' : 'is'} kept for the slides that use ${kept > 1 ? 'them' : 'it'} (flagged).`
                     : null
               );
            }
            if (this.fontsDiffer(from, theme)) await this.refitText(frames);
         });
      } finally {
         this.applying = false;
      }
      this.rebaseline();
   }

   protected async pickDesign(id: string): Promise<void> {
      if (id === this.design().id) return;
      const target = this.record(id);
      if (!target) return;
      this.themeNote.set(null);
      await this.flushLayouts();
      const set = this.record(target.layoutsId) ?? DEFAULT_LAYOUT_SET;
      const theme = this.record(target.themeId) ?? DEFAULT_THEME;
      await this.switchTo(target, set, themeTokensOnly(theme));
   }

   /** New design: a copy of this one (its layouts and theme) to change freely. */
   protected async newDesign(): Promise<void> {
      const name = this.presentation();
      if (!name || !this.canEdit()) return;
      await this.flushLayouts();
      const d = this.design();
      const cur = this.deckTheme();
      const designName = this.freshName(`${d.name} copy`);
      const theme: SlideTheme = {
         ...cur,
         kind: 'theme',
         id: this.newId(),
         name: this.freshName(`${cur.name} copy`),
      };
      const set = this.layoutsRecord(`${designName} layouts`, captureLayoutSet(this.store, name, this.layoutSetId()));
      const design = this.designRecord(designName, theme.id, set.id!);
      await this.saveRecords([theme, set, design]);
      await this.store.batchHistory(async () => {
         await this.retagLayouts(set.id!, false);
         await this.stamp(theme, design.id!, set.id!);
      });
      this.rebaseline();
   }

   /** The option above `id` in a dropdown list, or the one below when it is first. */
   private neighborOf(opts: SelectOption<string>[], id: string): string | undefined {
      const i = opts.findIndex((o) => o.value === id);
      if (i < 0) return undefined;
      return (opts[i - 1] ?? opts[i + 1])?.value;
   }

   /** Delete the deck's custom design; the deck moves to the design above it in the list (or below). */
   protected async deleteDesign(): Promise<void> {
      const d = this.design();
      if (!this.designIsCustom() || !this.canEdit()) return;
      clearTimeout(this.layoutTimer);
      const setId = this.layoutSetId();
      const nextId = this.neighborOf(this.designOptions(), d.id!);
      const next = (nextId && this.record(nextId)) || DEFAULT_DESIGN;
      if (next === DEFAULT_DESIGN) {
         await this.switchTo(DEFAULT_DESIGN, DEFAULT_LAYOUT_SET, this.deckTheme());
      } else {
         const set = this.record(next.layoutsId) ?? DEFAULT_LAYOUT_SET;
         const theme = this.record(next.themeId) ?? DEFAULT_THEME;
         await this.switchTo(next, set, themeTokensOnly(theme));
      }
      const setShared = this.library().some(
         (r) => r.id !== d.id && recordKind(r) === 'design' && r.layoutsId === setId
      );
      await this.saveRecords([], [d.id!, ...(setShared || isBuiltInRecord(setId) ? [] : [setId])]);
      this.themeNote.set(`Deleted "${d.name}".`);
   }

   /** Select a theme for the design (a custom design remembers it). */
   protected async pickTheme(id: string): Promise<void> {
      if (id === this.deckTheme().id) return;
      const rec = this.record(id);
      if (!rec) return;
      const theme = themeTokensOnly(rec);
      const d = this.design();
      if (this.designIsCustom()) await this.saveRecords([{ ...d, themeId: id }]);
      await this.writeTheme(theme, d.id!);
   }

   /** Put a theme's colors and fonts on the deck (and on other decks using it, when it was edited). */
   private async writeTheme(theme: SlideTheme, designId: string, everywhere = false): Promise<void> {
      if (!this.presentation() || !this.canEdit()) return;
      const from = this.deckTheme();
      await this.loadFonts(theme);
      await this.store.batchHistory(async () => {
         const frames = await this.stamp(theme, designId, this.layoutSetId(), everywhere);
         if (this.fontsDiffer(from, theme)) await this.refitText(frames);
      });
   }

   /**
    * Change the theme's colors, fonts or name. A built-in theme is copied into a custom one,
    * and a built-in design into a custom design using it, so the defaults never change.
    */
   private async editTheme(patch: Partial<SlideTheme>): Promise<void> {
      if (!this.canEdit()) return;
      const cur = this.deckTheme();
      const custom = this.themeIsCustom();
      const theme: SlideTheme = custom
         ? { ...cur, kind: 'theme', ...patch }
         : {
              ...cur,
              kind: 'theme',
              id: this.newId(),
              name: this.freshName(`${cur.name} custom`),
              ...patch,
           };
      const upserts: SlideTheme[] = [theme];
      let design = this.design();
      if (!this.designIsCustom()) {
         design = this.designRecord(this.freshName(`${design.name} custom`), theme.id, this.layoutSetId());
         upserts.push(design);
         this.themeNote.set(`Saved your changes as "${design.name}".`);
      } else if (design.themeId !== theme.id) {
         design = { ...design, themeId: theme.id };
         upserts.push(design);
      }
      await this.saveRecords(upserts);
      await this.writeTheme(theme, design.id!, custom);
   }

   protected setThemeColor(token: ThemeColorToken, color: string): void {
      void this.editTheme({ colors: { ...this.deckTheme().colors, [token]: color } });
   }
   protected setThemeFont(token: ThemeFontToken, font: string): void {
      void this.editTheme({ fonts: { ...this.deckTheme().fonts, [token]: font } });
   }
   /** Rename a custom design or theme (from the pencil in its dropdown). */
   protected async renameRecord(id: string, name: string): Promise<void> {
      const rec = this.library().find((r) => r.id === id);
      if (!rec || isBuiltInRecord(id) || !this.canEdit()) return;
      const renamed = { ...rec, name };
      await this.saveRecords([renamed]);
      // Slides carry their theme's name too: keep it in step.
      if (recordKind(rec) === 'theme' && this.deckTheme().id === id) {
         await this.writeTheme(themeTokensOnly(renamed), this.design().id!, true);
      }
   }

   /** Delete any custom theme (the deck's own one moves to its neighbour first). */
   protected async deleteThemeById(id: string): Promise<void> {
      if (!this.canEdit() || isBuiltInRecord(id)) return;
      if (id === this.deckTheme().id) return this.deleteTheme();
      await this.saveRecords([], [id]);
   }

   /** Delete any custom design (and its layout set when nothing else uses it). */
   protected async deleteDesignById(id: string): Promise<void> {
      if (!this.canEdit() || isBuiltInRecord(id)) return;
      if (id === this.design().id) return this.deleteDesign();
      const rec = this.record(id);
      if (!rec) return;
      const setId = rec.layoutsId;
      const setShared = this.library().some((r) => r.id !== id && recordKind(r) === 'design' && r.layoutsId === setId);
      await this.saveRecords([], [id, ...(!setId || setShared || isBuiltInRecord(setId) ? [] : [setId])]);
      this.themeNote.set(`Deleted "${rec.name}".`);
   }

   /** Delete the selected custom theme; the deck takes the theme above it in the list (or below). */
   protected async deleteTheme(): Promise<void> {
      const t = this.deckTheme();
      if (!this.themeIsCustom() || !this.canEdit()) return;
      await this.pickTheme(this.neighborOf(this.themeOptions(), t.id!) ?? DEFAULT_THEME.id!);
      await this.saveRecords([], [t.id!]);
   }

   // ---- Layout edits: saved into the design's layout set ----
   private applying = false;
   private layoutTimer?: ReturnType<typeof setTimeout>;
   /** The deck's layouts as last saved (or first seen), per deck and set. */
   private layoutBaseline: { key: string; sig: string } | null = null;
   private readonly watchLayouts = effect(() => {
      this.store.elements();
      const name = this.presentation();
      this.layoutSetId();
      if (!name || !this.canEdit()) return;
      untracked(() => {
         clearTimeout(this.layoutTimer);
         this.layoutTimer = setTimeout(() => void this.checkLayouts(), 800);
      });
   });
   private layoutSignature(): {
      key: string;
      sig: string;
      content: ReturnType<typeof captureLayoutSet>;
   } | null {
      const name = this.presentation();
      if (!name) return null;
      const setId = this.layoutSetId();
      const content = captureLayoutSet(this.store, name, setId);
      return { key: `${name}|${setId}`, sig: JSON.stringify(content), content };
   }
   /** Until when changes to the layouts are follow-ups of our own switch (saves, refits), not edits. */
   private settleUntil = 0;
   private rebaseline(): void {
      clearTimeout(this.layoutTimer);
      this.settleUntil = Date.now() + 2500;
      const s = this.layoutSignature();
      this.layoutBaseline = s ? { key: s.key, sig: s.sig } : null;
   }
   /** Save pending layout edits now (before the deck switches design). */
   private async flushLayouts(): Promise<void> {
      clearTimeout(this.layoutTimer);
      await this.checkLayouts();
   }
   private async checkLayouts(): Promise<void> {
      if (this.applying || !this.canEdit()) return;
      const s = this.layoutSignature();
      if (!s) return;
      if (!this.layoutBaseline || this.layoutBaseline.key !== s.key || Date.now() < this.settleUntil) {
         this.layoutBaseline = { key: s.key, sig: s.sig };
         return;
      }
      if (s.sig === this.layoutBaseline.sig) return;
      this.layoutBaseline.sig = s.sig;
      // Several parts of one deck are mounted at once (list + settings, focus screens) and
      // each watches its layouts: only the first to see an edit saves it (perf P2.6 guard).
      if (lastLayoutSave.get(s.key) === s.sig) return;
      lastLayoutSave.set(s.key, s.sig);
      const set = this.layoutSet();
      if (!isBuiltInRecord(set.id)) {
         await this.saveRecords([{ ...set, ...s.content }]);
         return;
      }
      // The first edit to built-in layouts: they become a custom set (and design) of their own.
      const wasBuiltIn = !this.designIsCustom();
      let design = this.design();
      const fresh = this.layoutsRecord(
         this.freshName(`${this.designIsCustom() ? design.name : `${design.name} custom`} layouts`),
         s.content
      );
      design = this.designIsCustom()
         ? { ...design, layoutsId: fresh.id }
         : this.designRecord(this.freshName(`${design.name} custom`), this.deckTheme().id, fresh.id!);
      await this.saveRecords([fresh, design]);
      this.applying = true;
      try {
         await this.retagLayouts(fresh.id!, true);
         await this.stamp(this.deckTheme(), design.id!, fresh.id!, false, true);
      } finally {
         this.applying = false;
      }
      this.rebaseline();
      if (wasBuiltIn) this.themeNote.set(`Saved your changes as "${design.name}".`);
   }
   /** Hand the deck's current layouts over to the set `setId`. */
   private async retagLayouts(setId: string, silent: boolean): Promise<void> {
      const name = this.presentation();
      if (!name) return;
      for (const l of deckLayouts(this.store, name)) {
         if (l.slide?.master || this.foreign(l) || !l.slide?.layoutSetId) continue;
         const patch = { slide: { ...l.slide, layoutSetId: setId } };
         if (silent) await this.store.patchElementSilently(l.id, patch);
         else await this.store.updateElement(l.id, patch);
      }
   }

   // ---- Files ----
   /** The deck's layouts as a layout set (for export). */
   private exportedLayouts(): SlideTheme {
      const name = this.presentation() ?? '';
      const set = this.layoutSet();
      return {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'layouts',
         name: isBuiltInRecord(set.id) ? `${this.design().name} layouts` : set.name,
         ...captureLayoutSet(this.store, name, this.layoutSetId()),
      };
   }

   /** Download the design (layouts and theme), just its layouts, or just its theme. */
   protected exportDesign(part: ThemeFilePart): void {
      const d = this.design();
      const layouts = this.exportedLayouts();
      const theme = this.deckTheme();
      const file = themeFile(part, { name: d.name, theme, layouts });
      const title = part === 'design' ? d.name : part === 'theme' ? theme.name : layouts.name;
      const suffix = part === 'theme' ? '.dbtheme' : part === 'layouts' ? '.dblayouts' : '.dbdesign';
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/[^\w .-]+/g, '_')}${suffix}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
   }

   /**
    * Read a file and use it: as a whole design (its layouts and theme become a new design),
    * as this design's layouts, or as a theme to select.
    */
   protected async importDesign(input: HTMLInputElement): Promise<void> {
      const part = this.importPart();
      const file = input.files?.[0];
      input.value = '';
      if (!file || !this.canEdit()) return;
      let parsed: ParsedThemeFile | string;
      try {
         parsed = parseThemeFile(JSON.parse(await file.text()));
      } catch {
         parsed = 'The file is not valid JSON.';
      }
      if (typeof parsed === 'string') {
         this.themeNote.set(parsed);
         return;
      }
      await this.flushLayouts();
      if (part === 'theme') {
         if (!parsed.theme) return this.themeNote.set('The file has no theme.');
         const theme: SlideTheme = {
            ...parsed.theme,
            kind: 'theme',
            id: this.newId(),
            name: this.freshName(parsed.theme.name),
         };
         await this.saveRecords([theme]);
         await this.pickTheme(theme.id!);
         this.themeNote.set(`Imported the theme "${theme.name}".`);
         return;
      }
      if (part === 'layouts') {
         if (!parsed.layouts) return this.themeNote.set('The file has no layouts.');
         const set: SlideTheme = {
            ...parsed.layouts,
            kind: 'layouts',
            id: this.newId(),
            name: this.freshName(parsed.layouts.name),
         };
         const design = this.designIsCustom()
            ? { ...this.design(), layoutsId: set.id }
            : this.designRecord(this.freshName(`${this.design().name} custom`), this.deckTheme().id, set.id!);
         await this.saveRecords([set, design]);
         await this.switchTo(design, set, this.deckTheme());
         this.themeNote.set(`Imported the layouts "${set.name}".`);
         return;
      }
      const upserts: SlideTheme[] = [];
      let theme = this.deckTheme();
      if (parsed.theme) {
         theme = {
            ...parsed.theme,
            kind: 'theme',
            id: this.newId(),
            name: this.freshName(parsed.theme.name),
         };
         upserts.push(theme);
      }
      let set = this.layoutSet();
      if (parsed.layouts) {
         set = {
            ...parsed.layouts,
            kind: 'layouts',
            id: this.newId(),
            name: this.freshName(parsed.layouts.name),
         };
         upserts.push(set);
      }
      const design = this.designRecord(this.freshName(parsed.name), theme.id, set.id!);
      upserts.push(design);
      await this.saveRecords(upserts);
      await this.switchTo(design, set, themeTokensOnly(theme));
      this.themeNote.set(`Imported the design "${design.name}".`);
   }

   protected isSelected(id: string): boolean {
      return this.activeSlides().some((f) => f.id === id);
   }

   protected selectAll(): void {
      this.store.setSelection(
         [],
         [],
         this.frames().map((f) => f.id)
      );
   }

   /** Up/Down arrows move to the previous/next slide. */
   protected stepSlide(delta: number, event: Event): void {
      const t = event.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) {
         return;
      }
      event.preventDefault();
      const list = this.shown().filter((f) => f.id !== this.pendingCloneId);
      if (!list.length) {
         return;
      }
      const cur = list.findIndex((f) => f.id === this.activeId());
      const next = list[Math.min(list.length - 1, Math.max(0, cur < 0 ? 0 : cur + delta))];
      if (next && next.id !== this.activeId()) {
         this.command.emit({ kind: 'focus', id: next.id });
         const cards = event.currentTarget as HTMLElement | null;
         const index = this.shown().findIndex((f) => f.id === next.id);
         requestAnimationFrame(() => {
            revealCard(cards?.querySelectorAll('li.card, .fs')[index], cards);
         });
      }
   }

   /** Plain click shows that slide; Ctrl/Cmd/Shift-click toggles it in the selection. */
   protected onRowClick(f: CanvasElementModel, event: MouseEvent): void {
      if (this.suppressClick || f.id === this.pendingCloneId) {
         return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
         const ids = new Set(this.activeSlides().map((x) => x.id));
         if (ids.has(f.id)) {
            ids.delete(f.id);
         } else {
            ids.add(f.id);
         }
         this.store.setSelection([], [], [...ids]);
         return;
      }
      this.command.emit({ kind: 'focus', id: f.id });
   }

   /** Resize every slide to a preset: all slides share one size. */
   protected setSize(presetId: string): void {
      const preset = FRAME_PRESETS.find((p) => p.id === presetId);
      const targets = [...this.frames(), ...this.layouts()];
      if (!preset || !targets.length) {
         return;
      }
      void this.store.batchHistory(async () => {
         for (const f of targets) {
            if (Math.round(f.width) !== preset.width || Math.round(f.height) !== preset.height) {
               await this.store.updateElement(f.id, { width: preset.width, height: preset.height });
            }
         }
      });
   }

   protected readonly draggingIndex = signal<number | null>(null);
   private suppressClick = false;
   private readonly host = inject(ElementRef<HTMLElement>);

   /** Pointer travel of the dragged card (px), in list coordinates. */
   protected readonly dragDy = signal(0);
   /** How far the cards between the pick-up and drop slots move: dragged height + gap. */
   private readonly dragStep = signal(0);
   /** The dragged card is gliding into its slot after release. */
   protected readonly settling = signal(false);
   /** Alt is down mid-drag: the pointer carries a copy instead of moving the slide. */
   protected readonly cloning = signal(false);
   /** Floating copy shown while cloning, laid over the original's slot. */
   protected readonly cloneGhost = signal<{
      id: string;
      top: number;
      height: number;
      fw: number;
      fh: number;
      count: number;
   } | null>(null);

   /** Transform for a card during a drag: the preview follows the pointer, the rest make room. */
   protected cardTransform(i: number): string | null {
      const from = this.draggingIndex();
      const to = this.overIndex();
      if (from === null || to === null) {
         return null;
      }
      if (this.cloning()) {
         // Alt-drag: the original stays; everything from the insertion point makes room.
         return i >= to ? `translateY(${this.dragStep()}px)` : null;
      }
      if (i === from) {
         return `translateY(${this.dragDy()}px) scale(1.02)`;
      }
      const step = this.dragStep();
      if (from < to && i > from && i <= to) {
         return `translateY(${-step}px)`;
      }
      if (from > to && i >= to && i < from) {
         return `translateY(${step}px)`;
      }
      return null;
   }

   /**
    * Drag a card to reorder the slides (hold Alt to duplicate it there). Built on
    * pointer events like the rest of the canvas, so it works for mouse, pen and touch.
    */
   protected onCardDown(index: number, event: PointerEvent): void {
      if (event.button !== 0 || !this.canEdit()) {
         return;
      }
      if ((event.target as HTMLElement).closest('button')) {
         return;
      }
      if (this.draggingIndex() !== null || this.shown()[index]?.id === this.pendingCloneId) {
         return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const scroller = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.cards');
      const startScroll = scroller?.scrollTop ?? 0;
      // Slot geometry in scroll-content coordinates, captured before anything moves.
      const cards = Array.from((this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li.card'));
      const slots = cards.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }));
      const me = slots[index];
      if (!me) {
         return;
      }
      const gap = slots.length > 1 ? Math.max(0, slots[1].top - slots[0].top - slots[0].height) : 0;
      const centers = slots.map((s) => s.top + s.height / 2);
      const srcFrame = this.shown()[index];
      // Alt-dragging one of several selected slides copies all of them, in deck order.
      const selected = new Set(this.activeSlides().map((f) => f.id));
      const copyIds =
         srcFrame && selected.has(srcFrame.id) && selected.size > 1
            ? this.shown()
                 .filter((f) => selected.has(f.id))
                 .map((f) => f.id)
            : srcFrame
              ? [srcFrame.id]
              : [];
      let started = false;
      let lastY = startY;
      let alt = event.altKey;
      let raf = 0;

      /** Insertion point (0..n) for a copy: how many slot centres lie above the dragged one. */
      const insertionFor = (dy: number): number => {
         const c = centers[index] + dy;
         return centers.filter((v) => v < c).length;
      };
      /** Slot the dragged card's centre currently falls into. */
      const targetFor = (dy: number): number => {
         const c = centers[index] + dy;
         let best = 0;
         let bestDist = Infinity;
         centers.forEach((v, i) => {
            const d = Math.abs(v - c);
            if (d < bestDist) {
               bestDist = d;
               best = i;
            }
         });
         return best;
      };
      const travel = (): number => lastY - startY + ((scroller?.scrollTop ?? 0) - startScroll);
      const setCloning = (on: boolean): void => {
         if (this.cloning() === on) {
            return;
         }
         this.cloning.set(on);
         this.cloneGhost.set(
            on && srcFrame
               ? {
                    id: srcFrame.id,
                    top: me.top,
                    height: me.height,
                    fw: srcFrame.width,
                    fh: srcFrame.height,
                    count: copyIds.length,
                 }
               : null
         );
      };
      const update = (): void => {
         const dy = travel();
         setCloning(alt);
         this.dragDy.set(dy);
         this.overIndex.set(alt ? insertionFor(dy) : targetFor(dy));
      };
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Alt' && started && !this.settling()) {
            alt = e.type === 'keydown';
            update();
         }
      };
      const tick = (): void => {
         // Keep scrolling the list while the pointer rests near its top or bottom edge.
         if (scroller) {
            const r = scroller.getBoundingClientRect();
            if (lastY < r.top + 28) {
               scroller.scrollTop -= 10;
            } else if (lastY > r.bottom - 28) {
               scroller.scrollTop += 10;
            }
         }
         update();
         raf = requestAnimationFrame(tick);
      };

      const move = (e: PointerEvent): void => {
         lastY = e.clientY;
         alt = e.altKey;
         if (!started) {
            if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) {
               return;
            }
            started = true;
            this.dragStep.set(me.height + gap);
            this.settling.set(false);
            this.draggingIndex.set(index);
            raf = requestAnimationFrame(tick);
         }
         update();
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         window.removeEventListener('keydown', onKey);
         window.removeEventListener('keyup', onKey);
         cancelAnimationFrame(raf);
         if (!started) {
            return;
         }
         // The click that follows a drag must not also select the slide.
         this.suppressClick = true;
         setTimeout(() => (this.suppressClick = false), 0);
         const clear = (): void => {
            this.settling.set(false);
            this.cloning.set(false);
            this.cloneGhost.set(null);
            this.draggingIndex.set(null);
            this.overIndex.set(null);
            this.dragDy.set(0);
         };
         const dropped = e.type === 'pointerup';
         // Copy mode (Alt held at release): glide the copy into the gap, then create it.
         if (dropped && alt && srcFrame) {
            const n = slots.length;
            const to = insertionFor(travel());
            const landing = to < n ? slots[to].top : slots[n - 1].top + slots[n - 1].height + gap;
            this.overIndex.set(to);
            this.settling.set(true);
            this.dragDy.set(landing - me.top);
            setTimeout(() => {
               // Keep a stand-in in the gap until the real copy shows up.
               this.pendingClone.set({
                  srcId: srcFrame.id,
                  to,
                  known: new Set(this.frames().map((f) => f.id)),
               });
               setTimeout(() => this.pendingClone.set(null), 5000);
               clear();
               this.command.emit({ kind: 'duplicate', id: srcFrame.id, ids: copyIds, toIndex: to });
            }, 180);
            return;
         }
         // Glide the preview into its slot (or back, if cancelled), then commit.
         setCloning(false);
         const to = dropped ? targetFor(travel()) : index;
         const landing = to > index ? slots[to].top + slots[to].height - me.height : slots[to].top;
         this.overIndex.set(to);
         this.settling.set(true);
         this.dragDy.set(landing - me.top);
         setTimeout(() => {
            clear();
            this.reorder(index, to, false);
         }, 180);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
   }

   private reorder(from: number, to: number, duplicate: boolean): void {
      if (duplicate) {
         // Alt-drag duplicates the slide (with its contents) into the drop position.
         const src = this.shown()[from];
         if (src) {
            this.command.emit({ kind: 'duplicate', id: src.id, toIndex: to });
         }
         return;
      }
      if (from === to) {
         return;
      }
      const list = [...this.shown()];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      // Show the new order straight away; the writes below land one at a time.
      this.pendingOrder.set(list.map((f) => f.id));
      void this.store
         .batchHistory(async () => {
            for (let i = 0; i < list.length; i += 1) {
               const f = list[i];
               if (f.slide && f.slide.order !== i) {
                  await this.store.updateElement(f.id, { slide: { ...f.slide, order: i } });
               }
            }
         })
         .finally(() => this.pendingOrder.set(null));
   }

   /**
    * Tag the selected objects (elements and sequence parts; blank clears it) so only
    * same-tagged objects morph together.
    */
   protected setMorphTag(value: string): void {
      const morphId = morphIdForTag(value);
      // A placeholder copy whose layout slot is tagged would fall back to that tag when
      // cleared, so clearing gives it its own id instead (an untagged override).
      const slotTag = (id: string): string | undefined => {
         const of = this.store.elements().find((e) => e.id === id)?.placeholder?.of;
         const tag = of ? this.store.elements().find((p) => p.id === of)?.morphId : undefined;
         return morphTagOf(tag) !== null ? tag : undefined;
      };
      const next = (t: { kind: string; id: string }): string | null =>
         morphId === null && t.kind === 'element' && slotTag(t.id) ? t.id : morphId;
      const targets = this.tagTargets().filter((e) =>
         morphId === null
            ? morphTagOf(e.morphId) !== null || (e.kind === 'element' && !e.morphId && !!slotTag(e.id))
            : e.morphId !== morphId
      );
      if (!targets.length) {
         return;
      }
      void this.store.batchHistory(async () => {
         for (const t of targets) {
            if (t.kind === 'element') {
               await this.store.updateElement(t.id, { morphId: next(t) });
            } else if (t.kind === 'table') {
               await this.store.updateTable(t.id, { morphId: morphId ?? '' });
            } else if (t.kind === 'lifeline') {
               await this.store.updateLifeline(t.id, { morphId: morphId ?? '' });
            } else if (t.kind === 'message') {
               await this.store.updateMessage(t.id, { morphId: morphId ?? '' });
            } else {
               await this.store.updateSequenceConfig(t.id, { morphId: morphId ?? '' });
            }
         }
      });
   }

   /** Make the selected elements one lineage so they morph into each other across slides. */
   protected pairSelected(): void {
      const ids = new Set(this.store.selectedElementIds());
      const picked = this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
      if (picked.length < 2) {
         return;
      }
      const key = picked[0].morphId ?? picked[0].id;
      void this.store.batchHistory(async () => {
         for (const e of picked) {
            if ((e.morphId ?? e.id) !== key) {
               await this.store.updateElement(e.id, { morphId: key });
            }
         }
      });
   }
}

/**
 * Whether a slide's thumbnail inputs are unchanged. `[0]` is the frame; rows that are
 * not the same reference still match when they differ only by the frame's own move
 * (the picture is cropped to the frame, so dragging a whole slide looks identical).
 */
function sameInputs(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
   if (!a || a.length !== b.length) {
      return false;
   }
   const fa = a[0] as CanvasElementModel;
   const fb = b[0] as CanvasElementModel;
   const dx = fb.x - fa.x;
   const dy = fb.y - fa.y;
   return a.every(
      (v, i) => v === b[i] || (typeof v === 'object' && v !== null && shiftedKey(v, 0, 0) === shiftedKey(b[i], dx, dy))
   );
}

/** A row's JSON with its world-space position fields shifted back by (dx, dy). */
function shiftedKey(row: unknown, dx: number, dy: number): string {
   const r = row as Record<string, unknown>;
   const out: Record<string, unknown> = { ...r };
   if (typeof r['x'] === 'number') out['x'] = (r['x'] as number) - dx;
   if (typeof r['y'] === 'number') out['y'] = (r['y'] as number) - dy;
   if (typeof r['originY'] === 'number') out['originY'] = (r['originY'] as number) - dy;
   if (Array.isArray(r['waypoints'])) {
      out['waypoints'] = (r['waypoints'] as { x: number; y: number }[]).map((p) => ({
         ...p,
         x: p.x - dx,
         y: p.y - dy,
      }));
   }
   return JSON.stringify(out);
}
