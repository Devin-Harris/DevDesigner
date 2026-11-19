import { CompareUiState } from '../../deck-compare/services/compare-ui-state.service';
import { DestroyRef, ElementRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
   BUILT_IN_THEMES,
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
   morphIdForTag,
   morphTagOf,
   presentationLayouts,
   presentationMaster,
   presentationOf,
   presentationSlides,
   recordKind,
   themeSwatchCss,
   themeToken,
   type CanvasElementModel,
   type LayoutKind,
   type MorphBy,
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
   transitionMorphs,
} from '@devdesigner/shared';
import { ThemeService } from '../../../../../../../core/theme/theme.service';
import type { SegmentedOption } from '../../../../../../../shared/ui/components/segmented/segmented.component';
import type { SelectOption } from '../../../../../../../shared/ui/components/select/select.component';
import { ProjectStore } from '../../../../../state/project/project.store';
import { FRAME_PRESETS } from '../../../../../shared/constants/frame-presets';
import { FONT_OPTIONS, fontStack } from '../../../../../helpers/render';
import {
   isLayoutStandIn,
   masterStandIns,
   placeholderDrift,
   resetSlideToLayout,
   resetToMaster,
   standInChanged,
   switchLayout,
   syncLayoutCopies,
   type PlaceholderDrift,
} from '../../../../../helpers/layout-placeholders';
import { MorphTagSuggestions } from '../services/morph-tag-suggestions.service';
import { SlideRenderService } from '../../../services/slide-render.service';
import { SlideThumbnailsService } from '../../../services/slide-thumbnails.service';
import { DeckLayoutSyncService } from '../../../services/deck-layout-sync.service';
import type { SlidesCommand } from '../models/slides-command.model';
import type { SettingsTab, SlidesPanelBindings } from '../models/slides-panel.model';
import { FocusUiState } from '../services/focus-ui-state.service';
import {
   addStandardLayouts,
} from '../../../helpers/standard-layouts';

const TYPE_OPTIONS: SelectOption<SlideTransitionType>[] = [
   { value: 'none', label: 'None' },
   { value: 'fade', label: 'Fade' },
   { value: 'slide', label: 'Slide' },
   { value: 'zoom', label: 'Zoom' },
   // Stored as 'morph': objects on both slides morph, the rest cross-fades.
   { value: 'morph', label: 'Auto' },
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
 * State and actions of one mounted slides panel (component-scoped: provided by
 * SlidesPanelComponent, injected by its part components). The host binds its inputs
 * and output in with `bind`; deck-wide work lives in DeckLayoutSyncService and
 * SlideThumbnailsService.
 */
@Injectable()
export class SlidesPanelState {
   /** The host SlidesPanelComponent's inputs and output (see `bind`). */
   private bindings!: SlidesPanelBindings;
   readonly command = { emit: (command: SlidesCommand): void => this.bindings.command.emit(command) };
   readonly part = computed(() => this.bindings.part());
   readonly folded = computed(() => this.bindings.folded());
   readonly active_ = computed(() => this.bindings.active_());
   readonly presentation = computed(() => this.bindings.presentation());
   readonly lastSlide = computed(() => this.bindings.lastSlide());
   readonly requestTab = computed(() => this.bindings.requestTab());

   /** Called once by the host, before anything reads the inputs. */
   bind(host: SlidesPanelBindings): void {
      this.bindings = host;
   }

   readonly store = inject(ProjectStore);
   private readonly render = inject(SlideRenderService);
   private readonly theme = inject(ThemeService);
   private readonly tagSuggestions = inject(MorphTagSuggestions);
   private readonly destroyRef = inject(DestroyRef);

   readonly typeOptions = TYPE_OPTIONS;
   readonly directionOptions = DIRECTION_OPTIONS;
   readonly easingOptions = EASING_OPTIONS;
   readonly morphByOptions = MORPH_BY_SELECT;

   readonly canEdit = this.store.canEdit;
   /** Slides of this presentation, in order (skipped ones included). */
   readonly frames = computed(() => presentationSlides(this.store.slideFrames(), this.presentation()));

   /** Put the saved name back (Escape, or a name that is empty or already taken). */
   cancelRename(input: HTMLInputElement): void {
      input.value = this.presentation();
      input.blur();
   }

   /** Rename the presentation (every one of its slides carries the name). */
   commitRename(input: HTMLInputElement): void {
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
   readonly shown = computed(() => {
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
   readonly pendingCloneId = '__pending-clone__';
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
   thumbId(f: CanvasElementModel): string {
      return f.id === this.pendingCloneId ? (this.pendingClone()?.srcId ?? f.id) : f.id;
   }
   /** Layouts of this presentation. */
   readonly layouts = computed(() => presentationLayouts(this.store.slideFrames(), this.presentation()));
   /** The layouts shown in the Layout tab: the built-in Blank one is not edited. */
   /** The presentation's master (drawn under every slide and layout). */
   readonly master = computed(
      () => presentationMaster(this.store.slideFrames(), this.presentation()) ?? null
   );
   readonly editableLayouts = computed(() => this.layouts().filter((l) => !l.slide?.defaultLayout));
   /** The Layouts tab's cards: the design's own layouts (not ones kept from another design). */
   readonly designLayouts = computed(() => this.editableLayouts().filter((l) => !this.foreign(l)));
   /** The New menu's layouts: standard kinds first in their usual order, then the rest. */
   readonly menuLayouts = computed(() => {
      const rank = (l: CanvasElementModel): number => {
         const k = l.slide?.layoutKind;
         return k ? LAYOUT_KINDS.indexOf(k) : LAYOUT_KINDS.length;
      };
      return this.layouts()
         .filter((l) => !this.foreign(l))
         .sort((a, b) => rank(a) - rank(b));
   });
   readonly standardKinds = LAYOUT_KINDS.filter((k) => k !== 'blank');
   readonly kindLabels = LAYOUT_KIND_LABELS;
   /** Standard layout kinds this design doesn't have yet. */
   readonly missingKinds = computed(() => {
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
   readonly lyDrag = signal<{ from: number; to: number; alt: boolean } | null>(null);
   lySuppress = false;
   onLayoutDown(index: number, event: PointerEvent): void {
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
   async addStandard(kinds: readonly LayoutKind[]): Promise<void> {
      const anchor = this.active();
      if (!anchor || !this.canEdit()) return;
      const ids = await addStandardLayouts(this.store, anchor, kinds);
      if (ids[0]) this.command.emit({ kind: 'focus', id: ids[0] });
   }
   /** The layout on the canvas right now (being edited), if one is. */
   readonly shownLayout = computed(
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
   backToSlide(): void {
      const l = this.shownLayout();
      const slide =
         this.frames().find((f) => f.id === this.lastSlide()) ??
         this.frames().find((f) => f.slide?.layoutId === l?.id) ??
         this.frames()[0];
      if (slide) this.command.emit({ kind: 'focus', id: slide.id });
   }
   layoutName(l: CanvasElementModel): string {
      return layoutNameOf(l, this.store.slideFrames());
   }
   renameLayout(l: CanvasElementModel, input: HTMLInputElement): void {
      const name = input.value.trim().slice(0, 120);
      if (!l.slide || !name || name === this.layoutName(l)) {
         input.value = this.layoutName(l);
         return;
      }
      void this.store.updateElement(l.id, { slide: { ...l.slide, layoutName: name } });
   }
   readonly layoutOptions = computed<SelectOption<string>[]>(() =>
      this.layouts().map((l) => ({
         value: l.id,
         label: this.foreign(l) ? `⚠ ${this.layoutName(l)} (not in this design)` : this.layoutName(l),
      }))
   );
   /** The selected slides' common layout ('' = none; first slide's when they differ). */
   readonly activeLayoutValue = computed(() => {
      const a = this.active();
      return (a && layoutOf(a, this.store.slideFrames())?.id) ?? '';
   });
   setLayout(id: string): void {
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

   readonly roleOptions: SelectOption<string>[] = [
      { value: '', label: 'None' },
      ...PLACEHOLDER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
   ];
   /** Selected text boxes on the shown layout (they can be made placeholders). */
   readonly layoutTextSelection = computed(() => {
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
   readonly drift = computed(() => {
      this.store.elements();
      const slide = this.driftSlide();
      const d = slide ? placeholderDrift(this.store, slide) : null;
      return d && (d.changed.length || d.missing.length || d.objects.length) ? d : null;
   });
   /** Selected placeholders that drifted (reset just those). */
   readonly selectedDrifted = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      const d = this.drift();
      return d ? [...d.changed, ...d.objects].filter((c) => ids.has(c.id)) : [];
   });
   driftLabel(d: PlaceholderDrift): string {
      const parts = [
         d.changed.length ? `${d.changed.length} placeholder${d.changed.length > 1 ? 's' : ''} changed` : '',
         d.missing.length ? `${d.missing.length} deleted` : '',
         d.objects.length ? `${d.objects.length} object${d.objects.length > 1 ? 's' : ''} changed` : '',
      ].filter(Boolean);
      return parts.join(', ') + ' from the layout';
   }
   resetSlide(selectedOnly: boolean): void {
      const slide = this.driftSlide();
      if (!slide) return;
      const only = selectedOnly ? new Set(this.selectedDrifted().map((c) => c.id)) : undefined;
      void this.store.batchHistory(() => resetSlideToLayout(this.store, slide, only));
   }
   /** Master items the shown slide or layout replaced with its own (double-click to make). */
   readonly standIns = computed(() => {
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
   readonly selectedStandIns = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.standIns().filter((e) => ids.has(e.id));
   });
   resetMaster(selectedOnly: boolean): void {
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
   setPlaceholder(on: boolean): void {
      this.editPlaceholders((e) => (on ? (e.placeholder ?? {}) : null));
   }
   setRole(role: string): void {
      this.editPlaceholders((e) => {
         const { role: _old, ...rest } = e.placeholder ?? {};
         return role ? { ...rest, role: role as PlaceholderRole } : rest;
      });
   }
   /** The New button's layout menu is open. */
   readonly newMenu = signal(false);
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
   addWithLayout(layoutId: string | null): void {
      this.newMenu.set(false);
      this.command.emit({ kind: 'add', layoutId });
   }
   /** Layout thumbnails for the list panel's New menu (rendered here, the settings panel has its own). */
   readonly layoutThumbs = signal<ReadonlyMap<string, string>>(new Map());
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
   readonly playable = computed(() => this.frames().some((f) => !f.slide?.hidden));
   /** The single selected frame, when it is not part of the sequence yet. */
   readonly selectedLoose = computed<CanvasElementModel | null>(() => {
      const ids = this.store.selectedElementIds();
      if (ids.length !== 1) {
         return null;
      }
      const e = this.store.elements().find((x) => x.id === ids[0]);
      return e && e.type === 'frame' && !e.slide ? e : null;
   });
   readonly overIndex = signal<number | null>(null);
   /** The detail tabs of the settings panel. */
   /** Settings tab; shared with focus mode so the choice survives going in and out of it. */
   readonly tab = inject(FocusUiState).canvasTab;

   pick(tab: SettingsTab): void {
      this.tab.set(tab);
   }

   private readonly applyRequestedTab = effect(() => {
      const r = this.requestTab();
      if (r) untracked(() => this.tab.set(r.tab));
   });

   /** The selected slides (the details edit all of them at once). */
   readonly activeSlides = computed<CanvasElementModel[]>(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.frames().filter((f) => ids.has(f.id));
   });
   readonly selectedCount = computed(() => this.activeSlides().length);
   /** The slide the details show: the first selected one, else the slide on the canvas. */
   readonly active = computed<CanvasElementModel | null>(
      () => this.activeSlides()[0] ?? this.frames().find((f) => f.id === this.active_()) ?? null
   );
   readonly activeId = computed(() => this.active()?.id ?? null);
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
   readonly activeNumber = computed(() => {
      const id = this.activeId();
      return id ? this.frames().findIndex((f) => f.id === id) + 1 : 0;
   });
   /** False when the only slide in play is the first (nothing transitions into it). */
   /** On the first slide: there is a next slide whose transition can be mapped. */
   readonly morphRelevantNext = computed(() => this.frames().length > 1 && this.activeSlides().length <= 1);

   readonly hasTransitionTarget = computed(() => {
      const first = this.frames()[0]?.id;
      const targets = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
      return targets.some((f) => f.id !== first);
   });

   readonly sizeOptions = computed<SelectOption<string>[]>(() => {
      const opts = FRAME_PRESETS.map((p) => ({
         value: p.id,
         label: `${p.label} (${p.width} × ${p.height})`,
      }));
      return this.sizeValue() === 'custom' ? [{ value: 'custom', label: 'Custom / mixed' }, ...opts] : opts;
   });
   /** The preset every slide matches, or 'custom'. */
   readonly sizeValue = computed(() => {
      // Every slide of a presentation shares one size.
      const slides = this.frames();
      const hit = FRAME_PRESETS.find((p) =>
         slides.every((f) => Math.round(f.width) === p.width && Math.round(f.height) === p.height)
      );
      return slides.length && hit ? hit.id : 'custom';
   });
   readonly transition = computed<SlideTransition>(() =>
      effectiveTransition((this.activeSlides().find((f) => f.id !== this.frames()[0]?.id) ?? this.active())?.slide)
   );

   /** True when a morph is involved: the transition into this slide or into the one before it. */
   readonly morphRelevant = computed(() => {
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
         !!f && transitionMorphs(effectiveTransition(f.slide));
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
   readonly tagCount = computed(() => this.tagTargets().length);
   /** The single selected element, with its split in / out tags (split = either is set). */
   readonly splitTarget = computed(() => {
      const t = this.tagTargets();
      if (t.length !== 1 || t[0].kind !== 'element') return null;
      const e = this.store.elements().find((x) => x.id === t[0].id);
      if (!e) return null;
      const split = e.morphIn != null || e.morphOut != null;
      return { id: e.id, split, in: e.morphIn ?? e.morphId, out: e.morphOut ?? e.morphId };
   });
   tagText(key: string | undefined): string {
      const t = morphTagOf(key);
      return t && !t.startsWith('solo-') ? t : '';
   }
   /** Split: start both sides from the shared tag. Join: drop both (the shared tag applies). */
   toggleSplit(st: { id: string; split: boolean; in?: string; out?: string }): void {
      const e = this.store.elements().find((x) => x.id === st.id);
      if (!e) return;
      const base = e.morphId ?? `tag:solo-${e.id.slice(0, 8)}`;
      void this.store.updateElement(
         e.id,
         st.split ? { morphIn: null, morphOut: null } : { morphIn: base, morphOut: base }
      );
   }
   setSplitTag(side: 'in' | 'out', value: string): void {
      const st = this.splitTarget();
      if (!st) return;
      const key = morphIdForTag(value) ?? `tag:solo-${side}-${st.id.slice(0, 8)}`;
      void this.store.updateElement(st.id, side === 'in' ? { morphIn: key } : { morphOut: key });
   }
   /** Tags other objects on this slide already carry: one tag names one object per slide. */
   readonly takenTags = computed(() => {
      const targets = this.tagTargets();
      const slideId = targets.find((e) => e.slideId)?.slideId ?? this.store.activeSlideId();
      return this.tagSuggestions.tagsTakenOn(slideId, new Set(targets.map((t) => t.id)));
   });
   /** The morph tag shared by the selection ('' when none or they differ). */
   readonly morphTag = computed(() => {
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
   readonly morphTagSuggestions = computed(() =>
      this.tagSuggestions.previousSlideTags(
         this.tagTargets().find((e) => e.slideId)?.slideId ?? this.store.activeSlideId()
      )
   );
   /** How many selected non-frame elements could be linked as one object (2+). */
   readonly pairable = computed(() => {
      const n = this.selectedObjects().length;
      return n >= 2 ? n : 0;
   });

   // ---- Focus mode views ----
   /** Focus settings dock: Slide or Notes (Transition / Animations open their own screens). */
   /** Focus dock tab; kept outside this panel so it survives trips to the other focus screens. */
   readonly ftab = inject(FocusUiState).tab;
   /** The custom theme / design being renamed in a focus menu or card. */
   readonly renaming = signal<string | null>(null);
   finishRename(id: string, value: string): void {
      if (this.renaming() !== id) return;
      this.renaming.set(null);
      const name = value.trim();
      if (name) void this.renameRecord(id, name);
   }
   /** Themes for the focus menus and cards: built-in, then custom ("My themes"). */
   readonly themeGroups = computed(() => {
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
   readonly designGroups = computed(() => {
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
   readonly bgTokens = ['background', 'heading', 'accent1', 'surface'] as const;
   token(k: ThemeColorToken): string {
      return themeToken(k);
   }
   setBackground(color: string): void {
      const a = this.active();
      if (!a || !this.canEdit()) return;
      void this.store.updateElement(a.id, { backgroundColor: color, fillStyle: 'solid' });
   }
   /** Animation build steps on a slide (badge ▶ N). */
   animCount(f: CanvasElementModel): number {
      const steps = new Set<number>();
      for (const e of this.store.elements()) if (e.slideId === f.id && e.step) steps.add(e.step);
      return steps.size;
   }
   readonly transitionLabel = computed(() => {
      const t = this.active()?.slide?.transition?.type ?? 'none';
      return t === 'none' ? 'None' : t === 'morph' ? 'Auto' : t.charAt(0).toUpperCase() + t.slice(1);
   });
   readonly focusTypes: { value: SlideTransitionType; label: string }[] = [
      { value: 'morph', label: 'Auto' },
      { value: 'fade', label: 'Fade' },
      { value: 'slide', label: 'Slide' },
      { value: 'zoom', label: 'Zoom' },
      { value: 'none', label: 'None' },
   ];
   readonly focusMorphBy: { value: MorphBy; label: string }[] = [
      { value: 'character', label: 'Char' },
      { value: 'word', label: 'Word' },
      { value: 'object', label: 'Object' },
   ];
   /** Slides of this deck that use a layout (DeckDesign "N slides"). */
   usage(layoutId: string): number {
      return this.frames().filter((f) => f.slide?.layoutId === layoutId).length;
   }
   /** Theme cards for the design screen: built-in themes, then custom ones. */
   readonly themeCards = computed(() => [
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

   // ---- Thumbnails (SlideThumbnailsService, shared by every mounted part) ----
   private readonly thumbnails = inject(SlideThumbnailsService);
   readonly thumbs = this.thumbnails.thumbs;
   /** Frames this part shows thumbnails of: slides, or the master and layouts; none for menus. */
   private readonly thumbFrames = computed<readonly CanvasElementModel[]>(() => {
      const part = this.part();
      if (part === 'list' || part === 'focus-list') return this.frames();
      if (part === 'settings' || part === 'focus-settings' || part === 'design-layouts') {
         const master = this.master();
         return [...(master ? [master] : []), ...this.layouts()];
      }
      return [];
   });

   constructor() {
      this.destroyRef.onDestroy(this.thumbnails.register(this.thumbFrames));
   }

   // ---- edits ----

   toggleHidden(f: CanvasElementModel): void {
      if (!f.slide) {
         return;
      }
      void this.store.updateElement(f.id, { slide: { ...f.slide, hidden: !f.slide.hidden } });
   }

   removeFromSequence(f: CanvasElementModel): void {
      void this.store.updateElement(f.id, { slide: null });
   }

   /** Change the transition of the selected slides (the first slide has none). */
   setTransition(patch: Partial<SlideTransition>): void {
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

   /** The transition morphs shared objects (morph type, or morph switched on for another type). */
   readonly morphs = computed(() => transitionMorphs(this.transition()));
   /** Map pairs' selection, shown in the Transition tab. */
   readonly compareUi = inject(CompareUiState);
   readonly pairAnimateBy = [
      { value: 'default', label: 'Default' },
      { value: 'character', label: 'Char' },
      { value: 'word', label: 'Word' },
      { value: 'object', label: 'Object' },
   ];

   readonly itemMorphByOptions: SelectOption<string>[] = [
      { value: 'default', label: 'Slide default' },
      ...MORPH_BY_SELECT,
   ];

   /** One selected object on the active slide: its own "animate by" (or the slide default). */
   readonly itemMorphTarget = computed<{ id: string; by: string } | null>(() => {
      const objs = this.selectedObjects();
      const f = this.active();
      if (objs.length !== 1 || !f?.slide || objs[0].slideId !== f.id || !this.morphs()) return null;
      return { id: objs[0].id, by: effectiveTransition(f.slide).morphByItems?.[objs[0].id] ?? 'default' };
   });

   /** Set (or with 'default', clear) one object's "animate by" on the active slide. */
   setItemMorphBy(id: string, by: string): void {
      const f = this.active();
      if (!f?.slide) return;
      const t = effectiveTransition(f.slide);
      const { [id]: _old, ...rest } = t.morphByItems ?? {};
      const items = by === 'default' ? rest : { ...rest, [id]: by as MorphBy };
      void this.store.updateElement(f.id, {
         slide: { ...f.slide, transition: { ...t, morphByItems: Object.keys(items).length ? items : undefined } },
      });
   }

   setDuration(raw: string): void {
      const ms = Math.min(5000, Math.max(100, Math.round(Number(raw)) || 600));
      this.setTransition({ duration: ms });
   }

   setNotes(value: string): void {
      const a = this.active();
      if (!a?.slide || (a.slide.notes ?? '') === value) {
         return;
      }
      void this.store.updateElement(a.id, { slide: { ...a.slide, notes: value || undefined } });
   }

   applyToAll(): void {
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

   readonly colorTokens = THEME_COLOR_TOKENS;
   readonly accentTokens = ['heading', 'accent1', 'accent2', 'accent3', 'accent4'] as const;
   readonly colorLabels = THEME_COLOR_LABELS;
   readonly css = themeSwatchCss;
   /** The follow-light/dark-mode choice for a theme color: the surface for fills, text otherwise. */
   followValue(token: ThemeColorToken): string {
      return token === 'background' || token === 'surface' ? THEME_FILL : THEME_STROKE;
   }
   isFollow(color: string): boolean {
      return color === THEME_FILL || color === THEME_STROKE;
   }
   readonly fontOptions: SelectOption[] = FONT_OPTIONS.map((f) => ({ ...f, font: fontStack(f.value) }));
   stackOf(key: string): string {
      return fontStack(key);
   }

   // ---- Designs: one layout set plus a selected theme (DeckLayoutSyncService) ----
   // Built-in themes, layout sets and designs never change: editing one saves a custom copy.
   // Custom records live in the project (shared with collaborators) and in My designs.

   private readonly decks = inject(DeckLayoutSyncService);
   /** This deck's designs, theme and layout sync, shared by every mounted part of the deck. */
   private readonly deck = computed(() => this.decks.deck(this.presentation()));
   /** Watch this deck's layouts (once per deck, however many parts are mounted). */
   private readonly attachDeck = effect((onCleanup) => {
      const name = this.presentation();
      onCleanup(untracked(() => this.decks.attach(name)));
   });
   private readonly loadMyThemes = effect(() => {
      const part = this.part();
      if (this.tab() === 'design' || part === 'design-theme' || part === 'theme-menu' || part === 'design-menu')
         untracked(() => this.decks.loadLibrary());
   });
   /** Every custom record: the project's, then the rest of My designs. */
   readonly library = this.decks.library;
   readonly designOptions = this.decks.designOptions;
   readonly design = computed(() => this.deck().design());
   readonly designIsCustom = computed(() => this.deck().designIsCustom());
   readonly layoutSetId = computed(() => this.deck().layoutSetId());
   readonly deckTheme = computed(() => this.deck().deckTheme());
   readonly themeIsCustom = computed(() => this.deck().themeIsCustom());
   readonly themeOptions = computed(() => this.deck().themeOptions());
   /** Feedback from design, theme and layout actions. */
   readonly themeNote = computed(() => this.deck().themeNote());
   /** Shown after a switch that kept layouts slides still use. */
   readonly relayoutNote = computed(() => this.deck().relayoutNote());

   /** Design tab sub-tab: the design's layouts, or its theme. */
   readonly designTab = signal<'layouts' | 'theme'>('layouts');
   readonly designTabOptions: SegmentedOption<'layouts' | 'theme'>[] = [
      { value: 'layouts', label: 'Layouts' },
      { value: 'theme', label: 'Theme' },
   ];
   /** Which part the next imported file is used as. */
   readonly importPart = signal<ThemeFilePart>('design');

   /** A layout from a layout set the deck no longer uses, kept because slides still use it. */
   foreign(l: CanvasElementModel): boolean {
      return this.deck().foreign(l);
   }
   /** A slide whose layout is not one of the design's layouts. */
   slideForeign(f: CanvasElementModel): boolean {
      const l = layoutOf(f, this.store.slideFrames());
      return !!l && this.foreign(l);
   }

   /** Keep editing the layout that was on the canvas when a design switch replaced it. */
   private focusIf(id: string | null): void {
      if (id) this.command.emit({ kind: 'focus', id });
   }
   async pickDesign(id: string): Promise<void> {
      this.focusIf(await this.deck().pickDesign(id, this.shownLayoutId()));
   }
   newDesign(): Promise<void> {
      return this.deck().newDesign();
   }
   async deleteDesign(): Promise<void> {
      this.focusIf(await this.deck().deleteDesign(this.shownLayoutId()));
   }
   async deleteDesignById(id: string): Promise<void> {
      this.focusIf(await this.deck().deleteDesignById(id, this.shownLayoutId()));
   }
   pickTheme(id: string): Promise<void> {
      return this.deck().pickTheme(id);
   }
   deleteTheme(): Promise<void> {
      return this.deck().deleteTheme();
   }
   deleteThemeById(id: string): Promise<void> {
      return this.deck().deleteThemeById(id);
   }
   setThemeColor(token: ThemeColorToken, color: string): void {
      void this.deck().setThemeColor(token, color);
   }
   setThemeFont(token: ThemeFontToken, font: string): void {
      void this.deck().setThemeFont(token, font);
   }
   renameRecord(id: string, name: string): Promise<void> {
      return this.deck().renameRecord(id, name);
   }
   exportDesign(part: ThemeFilePart): void {
      this.deck().exportDesign(part);
   }
   /** Use the picked file as a design, this design's layouts, or a theme (per `importPart`). */
   async importDesign(input: HTMLInputElement): Promise<void> {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      this.focusIf(await this.deck().importDesign(file, this.importPart(), this.shownLayoutId()));
   }

   isSelected(id: string): boolean {
      return this.activeSlides().some((f) => f.id === id);
   }

   selectAll(): void {
      this.store.setSelection(
         [],
         [],
         this.frames().map((f) => f.id)
      );
   }

   /** Up/Down arrows move to the previous/next slide. */
   stepSlide(delta: number, event: Event): void {
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
   onRowClick(f: CanvasElementModel, event: Event): void {
      if (this.suppressClick || f.id === this.pendingCloneId) {
         return;
      }
      // A click or an Enter / Space press: both carry the modifier keys.
      const { ctrlKey, metaKey, shiftKey } = event as MouseEvent | KeyboardEvent;
      if (ctrlKey || metaKey || shiftKey) {
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
   setSize(presetId: string): void {
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

   readonly draggingIndex = signal<number | null>(null);
   private suppressClick = false;
   private readonly host = inject(ElementRef<HTMLElement>);

   /** Pointer travel of the dragged card (px), in list coordinates. */
   readonly dragDy = signal(0);
   /** How far the cards between the pick-up and drop slots move: dragged height + gap. */
   private readonly dragStep = signal(0);
   /** The dragged card is gliding into its slot after release. */
   readonly settling = signal(false);
   /** Alt is down mid-drag: the pointer carries a copy instead of moving the slide. */
   readonly cloning = signal(false);
   /** Floating copy shown while cloning, laid over the original's slot. */
   readonly cloneGhost = signal<{
      id: string;
      top: number;
      height: number;
      fw: number;
      fh: number;
      count: number;
   } | null>(null);

   /** Transform for a card during a drag: the preview follows the pointer, the rest make room. */
   cardTransform(i: number): string | null {
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
   onCardDown(index: number, event: PointerEvent): void {
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
      // The deck panel's list and focus mode's slide rail drag the same way.
      const focus = this.part() === 'focus-list';
      const root = this.host.nativeElement as HTMLElement;
      const scroller = root.querySelector<HTMLElement>(focus ? '.f-cards' : '.cards');
      const startScroll = scroller?.scrollTop ?? 0;
      // Slot geometry in scroll-content coordinates, captured before anything moves.
      const cards = Array.from(root.querySelectorAll<HTMLElement>(focus ? '.fs:not(.ghost)' : 'li.card:not(.ghost)'));
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
   setMorphTag(value: string): void {
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
   pairSelected(): void {
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
