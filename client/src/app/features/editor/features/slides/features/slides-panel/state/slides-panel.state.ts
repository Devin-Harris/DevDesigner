import { CompareUiState } from '../../deck-compare/services/compare-ui-state.service';
import { DestroyRef, ElementRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
   BUILT_IN_THEMES,
   type CanvasElementModel,
   LAYOUT_KINDS,
   LAYOUT_KIND_LABELS,
   type MorphBy,
   PLACEHOLDER_ROLES,
   type SlideTheme,
   type SlideTransition,
   type SlideTransitionType,
   THEME_COLOR_LABELS,
   THEME_COLOR_TOKENS,
   THEME_FILL,
   THEME_STROKE,
   type ThemeColorToken,
   type ThemeFilePart,
   type ThemeFontToken,
   effectiveTransition,
   isBuiltInRecord,
   layoutNameOf,
   layoutOf,
   inheritedSlotTag,
   morphTagOf,
   presentationLayouts,
   presentationMaster,
   presentationSlides,
   recordKind,
   themeSwatchCss,
   themeToken,
   transitionMorphs,
} from '@devdesigner/shared';
import { ThemeService } from '../../../../../../../core/theme/theme.service';
import type { SegmentedOption } from '../../../../../../../shared/ui/components/segmented/segmented.component';
import type { SelectOption } from '../../../../../../../shared/ui/components/select/select.component';
import { ProjectStore } from '../../../../../state/project/project.store';
import { FRAME_PRESETS } from '../../../../../shared/constants/frame-presets';
import { FONT_OPTIONS, fontStack } from '../../../../../helpers/render';
import { type PlaceholderDrift, placeholderDrift } from '../../../../../helpers/layout-placeholders';
import { MorphTagSuggestions } from '../services/morph-tag-suggestions.service';
import { SlideRenderService } from '../../../services/slide-render.service';
import { SlideThumbnailsService } from '../../../services/slide-thumbnails.service';
import { DeckLayoutSyncService } from '../../../services/deck-layout-sync.service';
import type { SlidesCommand } from '../models/slides-command.model';
import type { SettingsTab, SlidesPanelBindings } from '../models/slides-panel.model';
import { FocusUiState } from '../services/focus-ui-state.service';
import {
   DIRECTION_OPTIONS,
   EASING_OPTIONS,
   MORPH_BY_SELECT,
   TYPE_OPTIONS,
   revealCard,
} from './slides-panel.state.helpers';
import { SlideCardDrag } from './slide-card-drag';
import { SlideLayoutEditing } from './slide-layout-editing';
import { SlideMorphSettings } from './slide-morph-settings';
import { SlideLayoutViews } from './slide-layout-views';

/**
 * State and actions of one mounted slides panel (component-scoped: provided by
 * SlidesPanelComponent, injected by its part components). The host binds its inputs
 * and output in with `bind`; deck-wide work lives in DeckLayoutSyncService and
 * SlideThumbnailsService.
 */
@Injectable()
export class SlidesPanelState {
   /** Methods moved to slide-layout-views.ts. */
   readonly slideLayoutViews = new SlideLayoutViews(this);

   /** Methods moved to slide-morph-settings.ts. */
   readonly slideMorphSettings = new SlideMorphSettings(this);

   /** Methods moved to slide-layout-editing.ts. */
   readonly slideLayoutEditing = new SlideLayoutEditing(this);

   /** Methods moved to slide-card-drag.ts. */
   readonly slideCardDrag = new SlideCardDrag(this);

   /** The host SlidesPanelComponent's inputs and output (see `bind`). */
   private bindings!: SlidesPanelBindings;
   readonly command = { emit: (command: SlidesCommand): void => this.bindings.command.emit(command) };
   readonly part$ = computed(() => this.bindings.part$());
   readonly folded$ = computed(() => this.bindings.folded());
   readonly active_$ = computed(() => this.bindings.active_());
   readonly presentation$ = computed(() => this.bindings.presentation());
   readonly lastSlide$ = computed(() => this.bindings.lastSlide());
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

   readonly canEdit$ = this.store.canEdit;
   /** Slides of this presentation, in order (skipped ones included). */
   readonly frames$ = computed(() => presentationSlides(this.store.slideFrames(), this.presentation$()));

   /** Put the saved name back (Escape, or a name that is empty or already taken). */
   cancelRename(input: HTMLInputElement): void {
      input.value = this.presentation$();
      input.blur();
   }
   /** Ids in the order just dropped, held until the store has caught up with the writes. */
   readonly pendingOrder = signal<string[] | null>(null);
   /** The slides as listed: the store order, or the just-dropped order while it persists. */
   readonly shown$ = computed(() => {
      const frames = this.frames$();
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
   readonly pendingClone = signal<{ srcId: string; to: number; known: Set<string> } | null>(null);
   private readonly dropWatch = effect(() => {
      const clone = this.pendingClone();
      const frames = this.frames$();
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
   readonly layouts$ = computed(() => presentationLayouts(this.store.slideFrames(), this.presentation$()));
   /** The layouts shown in the Layout tab: the built-in Blank one is not edited. */
   /** The presentation's master (drawn under every slide and layout). */
   readonly master$ = computed(() => presentationMaster(this.store.slideFrames(), this.presentation$()) ?? null);
   readonly editableLayouts = computed(() => this.layouts$().filter((l) => !l.slide?.defaultLayout));
   /** The Layouts tab's cards: the design's own layouts (not ones kept from another design). */
   readonly designLayouts$ = computed(() => this.editableLayouts().filter((l) => !this.foreign(l)));
   readonly standardKinds = LAYOUT_KINDS.filter((k) => k !== 'blank');
   readonly kindLabels = LAYOUT_KIND_LABELS;

   // ---- Layout cards: drag to reorder, Alt-drag to duplicate ----
   readonly lyDrag$ = signal<{ from: number; to: number; alt: boolean } | null>(null);
   lySuppress = false;
   /** The layout on the canvas right now (being edited), if one is. */
   readonly shownLayout$ = computed(
      () =>
         this.layouts$().find((l) => l.id === this.active_$()) ??
         (this.master$()?.id === this.active_$() ? this.master$() : null)
   );
   /** Showing a layout opens this tab, so its editing tools are at hand. */
   readonly shownLayoutId = computed(() => this.shownLayout$()?.id ?? null);
   layoutName(l: CanvasElementModel): string {
      return layoutNameOf(l, this.store.slideFrames());
   }
   /** The selected slides' common layout ('' = none; first slide's when they differ). */
   readonly activeLayoutValue$ = computed(() => {
      const a = this.active$();
      return (a && layoutOf(a, this.store.slideFrames())?.id) ?? '';
   });

   readonly roleOptions: SelectOption<string>[] = [
      { value: '', label: 'None' },
      ...PLACEHOLDER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
   ];
   /** Selected text boxes on the shown layout (they can be made placeholders). */
   readonly layoutTextSelection$ = computed(() => {
      const l = this.shownLayout$();
      const ids = new Set(this.store.selectedElementIds());
      return l ? this.store.elements().filter((e) => ids.has(e.id) && e.slideId === l.id && e.type === 'text') : [];
   });
   /** The shown slide (not a layout) when exactly it is what the tab edits. */
   readonly driftSlide = computed(() => {
      const a = this.active$();
      return a && !a.slide?.layout && this.activeSlides$().length <= 1 ? a : null;
   });
   /** Placeholders on the slide moved/restyled or deleted away from its layout; null = none. */
   readonly drift$ = computed(() => {
      this.store.elements();
      const slide = this.driftSlide();
      const d = slide ? placeholderDrift(this.store, slide) : null;
      return d && (d.changed.length || d.missing.length || d.objects.length) ? d : null;
   });
   /** Selected placeholders that drifted (reset just those). */
   readonly selectedDrifted$ = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      const d = this.drift$();
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
   /** The New button's layout menu is open. */
   readonly newMenu$ = signal(false);
   private readonly closeNewMenu = (): void => this.newMenu$.set(false);
   private readonly newMenuWatch = effect((onCleanup) => {
      if (!this.newMenu$()) return;
      // Any press outside the menu closes it.
      const t = setTimeout(() => document.addEventListener('pointerdown', this.closeNewMenu));
      onCleanup(() => {
         clearTimeout(t);
         document.removeEventListener('pointerdown', this.closeNewMenu);
      });
   });
   addWithLayout(layoutId: string | null): void {
      this.newMenu$.set(false);
      this.command.emit({ kind: 'add', layoutId });
   }
   /** Layout thumbnails for the list panel's New menu (rendered here, the settings panel has its own). */
   readonly layoutThumbs$ = signal<ReadonlyMap<string, string>>(new Map());
   private readonly layoutThumbWatch = effect((onCleanup) => {
      // The list panel renders on opening its New menu; the focus filmstrip's popover can't signal open, so it renders up front.
      const part = this.part$();
      if (!(part === 'list' && this.newMenu$()) && part !== 'focus-list') return;
      const layouts = [...this.layouts$()];
      this.theme.dark$();
      let live = true;
      void this.render.render(layouts, { fonts: false }).then((rs) => {
         if (live) this.layoutThumbs$.set(new Map(rs.map((r) => [r.id, SlideRenderService.dataUrl(r.svg)])));
      });
      onCleanup(() => (live = false));
   });
   readonly playable$ = computed(() => this.frames$().some((f) => !f.slide?.hidden));
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
   readonly tab$ = inject(FocusUiState).canvasTab;

   pick(tab: SettingsTab): void {
      this.tab$.set(tab);
   }

   private readonly applyRequestedTab = effect(() => {
      const r = this.requestTab();
      if (r) untracked(() => this.tab$.set(r.tab));
   });

   /** The selected slides (the details edit all of them at once). */
   readonly activeSlides$ = computed<CanvasElementModel[]>(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.frames$().filter((f) => ids.has(f.id));
   });
   readonly selectedCount$ = computed(() => this.activeSlides$().length);
   /** The slide the details show: the first selected one, else the slide on the canvas. */
   readonly active$ = computed<CanvasElementModel | null>(
      () => this.activeSlides$()[0] ?? this.frames$().find((f) => f.id === this.active_$()) ?? null
   );
   readonly activeId = computed(() => this.active$()?.id ?? null);
   /** Keep the active slide's card in view (e.g. after leaving the presenter on another slide). */
   private readonly revealActive = effect(() => {
      const id = this.activeId();
      if (this.part$() !== 'list' || !id) {
         return;
      }
      const index = this.shown$().findIndex((f) => f.id === id);
      requestAnimationFrame(() => {
         const host = this.host.nativeElement as HTMLElement;
         revealCard(host.querySelectorAll('li.card')[index], host);
      });
   });
   readonly activeNumber$ = computed(() => {
      const id = this.activeId();
      return id ? this.frames$().findIndex((f) => f.id === id) + 1 : 0;
   });
   /** False when the only slide in play is the first (nothing transitions into it). */
   /** On the first slide: there is a next slide whose transition can be mapped. */
   readonly morphRelevantNext$ = computed(() => this.frames$().length > 1 && this.activeSlides$().length <= 1);

   readonly hasTransitionTarget$ = computed(() => {
      const first = this.frames$()[0]?.id;
      const targets = this.activeSlides$().length ? this.activeSlides$() : this.active$() ? [this.active$()!] : [];
      return targets.some((f) => f.id !== first);
   });

   readonly sizeOptions$ = computed<SelectOption<string>[]>(() => {
      const opts = FRAME_PRESETS.map((p) => ({
         value: p.id,
         label: `${p.label} (${p.width} × ${p.height})`,
      }));
      return this.sizeValue$() === 'custom' ? [{ value: 'custom', label: 'Custom / mixed' }, ...opts] : opts;
   });
   /** The preset every slide matches, or 'custom'. */
   readonly sizeValue$ = computed(() => {
      // Every slide of a presentation shares one size.
      const slides = this.frames$();
      const hit = FRAME_PRESETS.find((p) =>
         slides.every((f) => Math.round(f.width) === p.width && Math.round(f.height) === p.height)
      );
      return slides.length && hit ? hit.id : 'custom';
   });
   readonly transition$ = computed<SlideTransition>(() =>
      effectiveTransition((this.activeSlides$().find((f) => f.id !== this.frames$()[0]?.id) ?? this.active$())?.slide)
   );

   /** True when a morph is involved: the transition into this slide or into the one before it. */
   readonly morphRelevant$ = computed(() => {
      const frames = this.frames$();
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
      // Tags matter when this slide morphs in from the one before or out into the next.
      return (i > 0 && isMorph(frames[i])) || isMorph(frames[i + 1]);
   });
   /** Selected non-frame elements (what a morph tag or pairing applies to). */
   readonly selectedObjects = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
   });
   readonly tagCount$ = computed(() => this.slideMorphSettings.tagTargets().length);
   /** The single selected element, with its split in / out tags (split = either is set). */
   readonly splitTarget$ = computed(() => {
      const t = this.slideMorphSettings.tagTargets();
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
   /** Tags other objects on this slide already carry: one tag names one object per slide. */
   readonly takenTags$ = computed(() => {
      const targets = this.slideMorphSettings.tagTargets();
      const slideId = targets.find((e) => e.slideId)?.slideId ?? this.store.activeSlideId();
      return this.tagSuggestions.tagsTakenOn(slideId, new Set(targets.map((t) => t.id)));
   });
   /** The morph tag shared by the selection ('' when none or they differ). */
   readonly morphTag$ = computed(() => {
      // A slide's placeholder copy without its own tag shows the one set on the layout's placeholder.
      const byId = new Map(this.selectedObjects().map((e) => [e.id, e] as const));
      const slot = (id: string): CanvasElementModel | undefined => this.store.elements().find((p) => p.id === id);
      const inherited = (id: string): string | undefined => {
         const e = byId.get(id);
         return e ? inheritedSlotTag(e, slot) : undefined;
      };
      const tags = new Set(
         this.slideMorphSettings.tagTargets().map((e) => morphTagOf(inherited(e.id) ?? e.morphId) ?? '')
      );
      return tags.size === 1 ? [...tags][0] : '';
   });
   /** Tags used on the slide before the selection's, offered while typing a tag. */
   readonly morphTagSuggestions$ = computed(() =>
      this.tagSuggestions.previousSlideTags(
         this.slideMorphSettings.tagTargets().find((e) => e.slideId)?.slideId ?? this.store.activeSlideId()
      )
   );
   /** How many selected non-frame elements could be linked as one object (2+). */
   readonly pairable$ = computed(() => {
      const n = this.selectedObjects().length;
      return n >= 2 ? n : 0;
   });

   // ---- Focus mode views ----
   /** Focus settings dock: Slide or Notes (Transition / Animations open their own screens). */
   /** Focus dock tab; kept outside this panel so it survives trips to the other focus screens. */
   readonly ftab$ = inject(FocusUiState).tab;
   /** The custom theme / design being renamed in a focus menu or card. */
   readonly renaming$ = signal<string | null>(null);
   finishRename(id: string, value: string): void {
      if (this.renaming$() !== id) return;
      this.renaming$.set(null);
      const name = value.trim();
      if (name) void this.renameRecord(id, name);
   }
   /** Themes for the focus menus and cards: built-in, then custom ("My themes"). */
   readonly themeGroups$ = computed(() => {
      const cur = this.deckTheme$().id ?? 'default';
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
   readonly designGroups$ = computed(() => {
      const cur = this.design$().id;
      const groups = new Map<
         string,
         { id: string; name: string; custom: boolean; on: boolean; theme: SlideTheme | null }[]
      >();
      for (const o of this.designOptions$()) {
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
      const a = this.active$();
      if (!a || !this.canEdit$()) return;
      void this.store.updateElement(a.id, { backgroundColor: color, fillStyle: 'solid' });
   }
   /** Animation build steps on a slide (badge ▶ N). */
   animCount(f: CanvasElementModel): number {
      const steps = new Set<number>();
      for (const e of this.store.elements()) if (e.slideId === f.id && e.step) steps.add(e.step);
      return steps.size;
   }
   readonly transitionLabel = computed(() => {
      const t = this.active$()?.slide?.transition?.type ?? 'none';
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
      return this.frames$().filter((f) => f.slide?.layoutId === layoutId).length;
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
      if (this.part$() !== 'focus-list') return;
      this.active_$();
      this.shown$();
      setTimeout(() => {
         const el = (this.hostEl.nativeElement as HTMLElement).querySelector('.fs.on');
         el?.scrollIntoView({ block: 'nearest' });
      }, 60);
   });

   // ---- Thumbnails (SlideThumbnailsService, shared by every mounted part) ----
   private readonly thumbnails = inject(SlideThumbnailsService);
   readonly thumbs$ = this.thumbnails.thumbs;
   /** Frames this part shows thumbnails of: slides, or the master and layouts; none for menus. */
   private readonly thumbFrames = computed<readonly CanvasElementModel[]>(() => {
      const part = this.part$();
      if (part === 'list' || part === 'focus-list') return this.frames$();
      if (part === 'settings' || part === 'focus-settings' || part === 'design-layouts') {
         const master = this.master$();
         return [...(master ? [master] : []), ...this.layouts$()];
      }
      return [];
   });

   constructor() {
      this.destroyRef.onDestroy(this.thumbnails.register(this.thumbFrames));
   }

   /** The transition morphs shared objects (morph type, or morph switched on for another type). */
   readonly morphs$ = computed(() => transitionMorphs(this.transition$()));
   /** Map pairs' selection, shown in the Transition tab. */
   readonly compareUi = inject(CompareUiState);

   readonly itemMorphByOptions: SelectOption<string>[] = [
      { value: 'default', label: 'Slide default' },
      ...MORPH_BY_SELECT,
   ];

   /** One selected object on the active slide: its own "animate by" (or the slide default). */
   readonly itemMorphTarget$ = computed<{ id: string; by: string } | null>(() => {
      const objs = this.selectedObjects();
      const f = this.active$();
      if (objs.length !== 1 || !f?.slide || objs[0].slideId !== f.id || !this.morphs$()) return null;
      return { id: objs[0].id, by: effectiveTransition(f.slide).morphByItems?.[objs[0].id] ?? 'default' };
   });

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
   private readonly deck = computed(() => this.decks.deck(this.presentation$()));
   /** Watch this deck's layouts (once per deck, however many parts are mounted). */
   private readonly attachDeck = effect((onCleanup) => {
      const name = this.presentation$();
      onCleanup(untracked(() => this.decks.attach(name)));
   });
   private readonly loadMyThemes = effect(() => {
      const part = this.part$();
      if (this.tab$() === 'design' || part === 'design-theme' || part === 'theme-menu' || part === 'design-menu')
         untracked(() => this.decks.loadLibrary());
   });
   /** Every custom record: the project's, then the rest of My designs. */
   readonly library = this.decks.library;
   readonly designOptions$ = this.decks.designOptions;
   readonly design$ = computed(() => this.deck().design());
   readonly designIsCustom$ = computed(() => this.deck().designIsCustom());
   readonly layoutSetId = computed(() => this.deck().layoutSetId());
   readonly deckTheme$ = computed(() => this.deck().deckTheme());
   readonly themeIsCustom$ = computed(() => this.deck().themeIsCustom());
   readonly themeOptions$ = computed(() => this.deck().themeOptions());
   /** Feedback from design, theme and layout actions. */
   readonly themeNote$ = computed(() => this.deck().themeNote());
   /** Shown after a switch that kept layouts slides still use. */
   readonly relayoutNote$ = computed(() => this.deck().relayoutNote());

   /** Design tab sub-tab: the design's layouts, or its theme. */
   readonly designTab$ = signal<'layouts' | 'theme'>('layouts');
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

   // ---- Lookups the part templates read (template/no-call-expression) ----
   /** Display name of every slide frame of this deck, by id (layouts and master included). */
   readonly layoutNames$ = computed(() => {
      const frames = this.store.slideFrames();
      return new Map(frames.map((f) => [f.id, layoutNameOf(f, frames)] as const));
   });
   /** Ids of the selected slides. */
   readonly activeSlideIds$ = computed(() => new Set(this.activeSlides$().map((f) => f.id)));
   /** Drag transform of each listed card, by index (null when it stays put). */
   readonly cardTransforms$ = computed(() => this.shown$().map((_, i) => this.slideCardDrag.cardTransform(i)));
   /** Thumbnail of each listed card (a pending copy borrows its source's picture). */
   readonly shownThumbs$ = computed(() => {
      const thumbs = this.thumbs$();
      return new Map(this.shown$().map((f) => [f.id, thumbs.get(this.thumbId(f))] as const));
   });
   /** Slides whose layout is not one of the design's layouts. */
   readonly foreignSlideIds$ = computed(
      () =>
         new Set(
            this.frames$()
               .filter((f) => this.slideForeign(f))
               .map((f) => f.id)
         )
   );
   /** Animation build steps per slide id (badge ▶ N). */
   readonly animCounts$ = computed(() => {
      const steps = new Map<string, Set<number>>();
      for (const e of this.store.elements()) {
         if (!e.slideId || !e.step) continue;
         const s = steps.get(e.slideId) ?? new Set<number>();
         s.add(e.step);
         steps.set(e.slideId, s);
      }
      return new Map([...steps].map(([id, s]) => [id, s.size] as const));
   });

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
      return this.activeSlides$().some((f) => f.id === id);
   }

   readonly draggingIndex$ = signal<number | null>(null);
   suppressClick = false;
   readonly host = inject(ElementRef<HTMLElement>);

   /** Pointer travel of the dragged card (px), in list coordinates. */
   readonly dragDy$ = signal(0);
   /** How far the cards between the pick-up and drop slots move: dragged height + gap. */
   readonly dragStep = signal(0);
   /** The dragged card is gliding into its slot after release. */
   readonly settling$ = signal(false);
   /** Alt is down mid-drag: the pointer carries a copy instead of moving the slide. */
   readonly cloning$ = signal(false);
   /** Floating copy shown while cloning, laid over the original's slot. */
   readonly cloneGhost$ = signal<{
      id: string;
      top: number;
      height: number;
      fw: number;
      fh: number;
      count: number;
   } | null>(null);
}
