import { SlideshowService } from './slideshow.service';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { computed, inject, signal, Injectable, effect, untracked, linkedSignal } from '@angular/core';
import { presentationOf, presentationSlides } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import type { SlidesCommand } from '../features/slides-panel/models/slides-command.model';
import { FocusUiState } from '../features/slides-panel/services/focus-ui-state.service';
import { CompareUiState } from '../features/deck-compare/services/compare-ui-state.service';
/** What deck focus reaches in the editor entry; the entry wires it with `connect`. */
export interface DeckFocusHost {
   onSlidesCommand(cmd: SlidesCommand, presentation: string): void;
   selectSlideSet(name: string): void;
}

/** Deck focus mode: one deck fitted between the docks, its design / transition / animation screens. */
@Injectable()
export class DeckFocusService {
   private readonly store = inject(ProjectStore);
   private readonly focusUi = inject(FocusUiState);
   private readonly compareUi = inject(CompareUiState);
   private readonly viewport = inject(EditorViewportService);
   private readonly slideshow = inject(SlideshowService);
   private host!: DeckFocusHost;

   constructor() {
      // The transition screen shows its own preview: hide the canvas's floating toolbars.
      effect(() => {
         document.body.classList.toggle('dd-focus-morph', !!this.focusedDeck() && this.focusScreen() === 'morph');
      });
      // Focus mode keeps its slide fitted between the docks (screen, slide or window changes).
      effect(() => {
         if (!this.focusedDeck()) return;
         this.focusScreen();
         const f = this.focusShown();
         this.viewport.canvasSize();
         if (!f) return;
         void [f.x, f.y, f.width, f.height];
         untracked(() => this.fitFocus(true));
      });
   }

   connect(host: DeckFocusHost): void {
      this.host = host;
   }

   /** The settings panel is folded to a narrow strip (it folds sideways, toward the frame's edge). */
   readonly settingsFolded = signal(false);

   /** The deck header asks a deck's settings panel to show a tab. */
   readonly deckTabRequest = signal<{ name: string; tab: 'design' | 'size' | 'notes' } | null>(null);

   openDeckTab(name: string, tab: 'design' | 'size' | 'notes'): void {
      this.host.selectSlideSet(name);
      this.settingsFolded.set(false);
      this.deckTabRequest.set({ name, tab });
   }

   /** Slides in a presentation (deck header count). */
   deckSlideCount(name: string): number {
      return presentationSlides(this.store.slideFrames(), name).length;
   }

   /** 1-based position of the deck's shown slide among its slides (0 when unknown). */
   deckSlideIndex(name: string, frameId: string): number {
      return presentationSlides(this.store.slideFrames(), name).findIndex((f) => f.id === frameId) + 1;
   }

   /** Aspect label of a deck's slides ("16:9", "4:3", ...), for the deck header and focus bar. */
   deckRatioLabel(frameId: string): string {
      const f = this.store.slideFrames().find((x) => x.id === frameId);
      if (!f || !f.height) return 'Size';
      const r = f.width / f.height;
      const known: [number, string][] = [
         [16 / 9, '16:9'],
         [4 / 3, '4:3'],
         [1, '1:1'],
         [9 / 16, '9:16'],
         [16 / 10, '16:10'],
         [1 / Math.SQRT2, 'A4'],
         [Math.SQRT2, 'A4'],
      ];
      return known.find(([v]) => Math.abs(v - r) < 0.02)?.[1] ?? `${Math.round(f.width)}×${Math.round(f.height)}`;
   }

   // ---- Deck focus mode ----------------------------------------------------
   /** The presentation being edited in focus mode (the rest of the canvas dimmed), or null. */
   readonly focusedDeck = linkedSignal<readonly string[], string | null>({
      source: () => this.store.presentations(),
      // Focus mode ends when its deck is gone.
      computation: (decks, previous) => {
         const name = previous?.value ?? null;
         return name && decks.includes(name) ? name : null;
      },
   });

   /** The view before focus mode, restored when it ends. */
   private viewBeforeFocus: { x: number; y: number; zoom: number } | null = null;

   /** Which focus-mode screen is open: the deck (DeckFocus), design, transition or animations. */
   readonly focusScreen = signal<'main' | 'design' | 'morph' | 'anim'>('main');

   /** Screen-space frame of each focus screen's docks (left dock clears the tool dock). */
   private focusArea(): { left: number; right: number; top: number; bottom: number } {
      const rect = this.viewport.canvasRect();
      const screen = this.focusScreen();
      const leftDock = screen === 'main' || screen === 'design' ? 76 + 196 + 32 : 84;
      const rightW = screen === 'anim' ? 360 : 344;
      return { left: leftDock, right: rect.width - (16 + rightW + 32), top: 72 + 24, bottom: rect.height - 40 };
   }

   /** The shown slide (or layout) of the focused deck. */
   readonly focusShown = computed(() => {
      const name = this.focusedDeck();
      const id = name ? this.store.shownByPresentation().get(name) : undefined;
      return id ? (this.store.slideFrames().find((f) => f.id === id) ?? null) : null;
   });

   /** The focused slide with its number and the slide before it (transition screens). */
   readonly focusSlide = computed(() => {
      const frame = this.focusShown();
      const name = this.focusedDeck();
      if (!frame || !name || frame.slide?.layout)
         return frame ? { frame, index: 0, prev: null, prev2: null, next: null } : null;
      const slides = presentationSlides(this.store.slideFrames(), name);
      const i = slides.findIndex((f) => f.id === frame.id);
      return {
         frame,
         index: i + 1,
         prev: i > 0 ? slides[i - 1] : null,
         prev2: i > 1 ? slides[i - 2] : null,
         next: i >= 0 && i < slides.length - 1 ? slides[i + 1] : null,
      };
   });

   /** Staging area around the slide on screen (dashed in the mock): the hole in the dim. */
   readonly focusStage = computed(() => {
      const f = this.focusShown();
      if (!f) return null;
      const v = this.store.viewport();
      const pad = 40;
      return {
         left: f.x * v.zoom + v.x - pad,
         top: f.y * v.zoom + v.y - pad,
         width: f.width * v.zoom + pad * 2,
         height: f.height * v.zoom + pad * 2,
      };
   });

   /** clip-path for the dim layer: the whole canvas minus the staging area. */
   readonly focusDimClip = computed(() => {
      // The hole is the slide itself: nothing else on the canvas shows in focus mode.
      const st = this.focusStage();
      const h = st ? { left: st.left + 40, top: st.top + 40, width: st.width - 80, height: st.height - 80 } : null;
      const { width, height } = this.viewport.canvasSize();
      if (!h) return 'none';
      const W = Math.max(width, 1) + 4000;
      const H = Math.max(height, 1) + 4000;
      const x1 = h.left + h.width;
      const y1 = h.top + h.height;
      return `path(evenodd, 'M-2000 -2000 H${W} V${H} H-2000 Z M${h.left} ${h.top} H${x1} V${y1} H${h.left} Z')`;
   });

   /** The layout or master shown in the design screen, with how many slides use it. */
   readonly focusLayoutInfo = computed(() => {
      const f = this.focusShown();
      const name = this.focusedDeck();
      if (!f?.slide?.layout || !name) return null;
      const used = presentationSlides(this.store.slideFrames(), name).filter((s) => s.slide?.layoutId === f.id).length;
      return { master: !!f.slide.master, name: f.slide.layoutName ?? 'Layout', used };
   });

   /** Theme name for the focus bar ("Theme: Harbor"). */
   deckThemeName(frameId: string): string {
      const f = this.store.slideFrames().find((x) => x.id === frameId);
      return f?.slide?.theme?.name ?? 'Default';
   }

   /** Edit one presentation on its own: the view locks onto its slide between the focus docks. */
   enterDeckFocus(name: string, screen: 'main' | 'morph' | 'anim' = 'main'): void {
      if (!this.store.presentations().includes(name)) return;
      if (!this.focusedDeck()) this.viewBeforeFocus = { ...this.store.viewport() };
      this.focusFromCanvas.set(false);
      this.focusScreen.set(screen);
      if (!this.focusedDeck()) this.focusUi.toFocus();
      this.focusedDeck.set(name);
      this.store.selectPresentation(name);
      // A layout left open goes back to its slide.
      const shown = this.focusShown();
      if (shown?.slide?.layout) {
         const back = this.slideshow.lastSlides().get(name);
         if (back) this.focusFrame_(back);
      }
      this.fitFocus(true);
   }

   /** Leave focus mode and go back to the view from before it. */
   exitDeckFocus(): void {
      if (!this.focusedDeck()) return;
      const name = this.focusedDeck()!;
      if (this.focusScreen() === 'design') this.closeFocusDesign(name);
      this.focusUi.fromFocus();
      this.focusFromCanvas.set(false);
      this.focusedDeck.set(null);
      this.focusScreen.set('main');
      const v = this.viewBeforeFocus;
      this.viewBeforeFocus = null;
      if (v) this.viewport.animateViewport(v.x, v.y, v.zoom);
   }

   /** Fit the focused slide (plus staging room) into the space between the docks. */
   fitFocus(animate: boolean): void {
      const f = this.focusShown();
      if (!f || this.focusScreen() === 'morph') return;
      const a = this.focusArea();
      const pad = 40;
      const availW = Math.max(100, a.right - a.left);
      const availH = Math.max(100, a.bottom - a.top);
      const zoom = Math.max(0.05, Math.min((availW - pad * 2) / f.width, (availH - pad * 2) / f.height, 2));
      const x = a.left + (availW - f.width * zoom) / 2 - f.x * zoom;
      const y = a.top + (availH - f.height * zoom) / 2 - f.y * zoom;
      if (animate) this.viewport.animateViewport(x, y, zoom);
      else this.store.setViewport(x, y, zoom);
   }

   /** Layouts & master / Theme: show the slide's layout (or the master) and the design screen. */
   openFocusDesign(): void {
      const f = this.focusShown();
      const name = this.focusedDeck();
      if (!f || !name) return;
      const frames = this.store.slideFrames();
      const target =
         (f.slide?.layoutId && frames.find((x) => x.id === f.slide!.layoutId)) ||
         frames.find((x) => presentationOf(x) === name && x.slide?.master);
      if (target) this.focusFrame_(target.id);
      this.focusScreen.set('design');
   }

   /** Done: back to the slide that was shown before the design screen. */
   closeFocusDesign(name: string): void {
      const back = this.slideshow.lastSlides().get(name);
      if (back && this.focusShown()?.slide?.layout) this.focusFrame_(back);
      this.focusScreen.set('main');
   }

   /** Commands from the focus docks: screen switches here, the rest as usual. */
   onFocusCommand(cmd: SlidesCommand, name: string): void {
      if (cmd.kind === 'screen') {
         if (cmd.screen === 'design') this.openFocusDesign();
         else if (cmd.screen === 'main' && this.focusScreen() !== 'main') this.stayInFocus();
         else {
            this.focusScreen.set(cmd.screen);
            if (cmd.screen === 'morph' && this.focusSlide()?.index === 1) this.goToTransition(2);
         }
         return;
      }
      this.host.onSlidesCommand(cmd, name);
   }

   /** The current focus screen was opened straight from the canvas: leaving it goes back there. */
   readonly focusFromCanvas = signal(false);

   /** "← Canvas" when the screen was opened from the canvas, else "← Slides". */
   focusBackLabel(): string {
      return this.focusFromCanvas() ? '← Canvas' : '← Slides';
   }

   /** Leave a focus sub-screen: back to the deck, or to the canvas when it was opened from there. */
   /** Back to the deck's main focus screen, staying in focus even when opened from the canvas. */
   stayInFocus(): void {
      this.focusFromCanvas.set(false);
      this.focusScreen.set('main');
   }

   leaveFocusScreen(): void {
      if (this.focusFromCanvas()) {
         this.exitDeckFocus();
         return;
      }
      this.focusScreen.set('main');
   }

   /** Transition screen: move to the previous / next pair of slides. */
   stepTransition(delta: number): void {
      const name = this.focusedDeck();
      const cur = this.focusShown();
      if (!name || !cur) return;
      const slides = presentationSlides(this.store.slideFrames(), name);
      const i = slides.findIndex((f) => f.id === cur.id);
      const next = slides[i + delta];
      if (next && i + delta >= 1) this.focusFrame_(next.id);
   }

   /** Slide numbers (2..n) that have a transition into them. */
   transitionNumbers(name: string): number[] {
      const n = presentationSlides(this.store.slideFrames(), name).length;
      return Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 2);
   }

   /** Transition screen: jump to the transition into slide `n` (1-based). */
   goToTransition(n: number): void {
      const name = this.focusedDeck();
      if (!name) return;
      const f = presentationSlides(this.store.slideFrames(), name)[n - 1];
      if (f) this.focusFrame_(f.id);
   }

   previewTransitionFor(id: string): void {
      void this.slideshow.previewTransition(id);
   }

   /**
    * Embedded use (the home page showcase): open a deck's transition screen on the
    * transition into slide `n`, optionally in its Map pairs or Preview view.
    */
   showTransitionScreen(name: string, n: number, view: 'map' | 'preview' = 'map'): void {
      if (this.focusedDeck() !== name || this.focusScreen() !== 'morph') this.enterDeckFocus(name, 'morph');
      this.goToTransition(n);
      this.compareUi.view.set(view);
   }

   /** Embedded use: leave deck focus mode if it is open. */
   leaveDeckFocus(): void {
      this.exitDeckFocus();
   }

   presentFromCurrent(name: string): void {
      this.store.selectPresentation(name);
      void this.slideshow.startPresentation('current');
   }

   private focusFrame_(id: string): void {
      this.slideshow.focusFrame(id);
   }

   /** Present a deck from its first slide. */
   presentDeck(name: string): void {
      this.store.selectPresentation(name);
      void this.slideshow.startPresentation('start');
   }

   /** Select a presentation and bring its shown slide into view. */
   focusDeck(name: string): void {
      this.store.selectPresentation(name);
      const id = this.store.shownByPresentation().get(name);
      const f = this.store.slideFrames().find((x) => x.id === id);
      if (f) {
         this.viewport.panToWorld({ x: f.x + f.width / 2, y: f.y + f.height / 2 });
      }
   }
}
