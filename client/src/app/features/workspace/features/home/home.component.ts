import {
   afterNextRender,
   ChangeDetectionStrategy,
   Component,
   computed,
   DestroyRef,
   effect,
   ElementRef,
   inject,
   signal,
   untracked,
   viewChild,
   viewChildren,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { generateSql, type SequenceMessageModel } from '@devdesigner/shared';
import {
   CompareUiState,
   codePalette,
   DeckCompareComponent,
   EditorComponent,
   ProjectStore,
   tokenColor,
   tokenizeCode,
} from '../../../editor';
import { ColorSwatchesComponent } from '../../../../shared/ui/components/color-swatches/color-swatches.component';
import { SandboxBackendService } from '../../../../core/sandbox/sandbox-backend.service';
import { prepareSandbox } from '../../../../core/sandbox/sandbox-seeds.helper';
import { playBuild, type Box, type CursorFn } from './helpers/showcase-player';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../shared/ui/directives/popover-trigger.directive';
import { ThemeService } from '../../../../core/theme/theme.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ProjectsStore } from '../../../../shared/state/projects/projects.store';
import { ProjectsOverlayService } from '../../../../shared/features/projects-overlay/projects-overlay.service';
import { AuthDialogComponent } from '../../../../shared/features/auth-dialogs/auth-dialog/auth-dialog.component';
import { ApiTokensDialogComponent } from '../../../../shared/features/auth-dialogs/api-tokens-dialog/api-tokens-dialog.component';
import {
   HOME_FEATURES,
   HOME_SHOWCASE,
   HOME_USES,
   MCP_COMMAND,
   MCP_CONFIG,
   SHOWCASE_SEEDS,
   SHOWCASE_VERSION,
} from './helpers/home-content';

/**
 * Landing page shown at `/` when no project is open: what DevDesigner is, quick
 * ways to start, and the user's most recent projects.
 */
@Component({
   selector: 'dd-home',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      IconComponent,
      PopoverTriggerDirective,
      DatePipe,
      RouterLink,
      EditorComponent,
      DeckCompareComponent,
      ColorSwatchesComponent,
   ],
   templateUrl: './home.component.html',
   styleUrl: './home.component.scss',
})
export class HomeComponent {
   protected readonly theme = inject(ThemeService);
   protected readonly auth = inject(AuthService);
   protected readonly projects = inject(ProjectsStore);
   private readonly overlay = inject(ProjectsOverlayService);
   private readonly dialog = inject(MatDialog);
   private readonly snackBar = inject(MatSnackBar);

   /** Six most recently updated projects. */
   protected readonly recent = computed(() =>
      [...this.projects.projects()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
   );

   protected readonly features = HOME_FEATURES;
   protected readonly uses = HOME_USES;
   protected readonly showcase = HOME_SHOWCASE;
   protected readonly mcpConfig = MCP_CONFIG;
   protected readonly mcpCommand = MCP_COMMAND;
   protected readonly mcpCopied = signal<'config' | 'command' | null>(null);

   protected async copyMcp(which: 'config' | 'command'): Promise<void> {
      try {
         await navigator.clipboard.writeText(which === 'config' ? this.mcpConfig : this.mcpCommand);
         this.mcpCopied.set(which);
         setTimeout(() => this.mcpCopied.set(null), 1600);
      } catch {
         /* clipboard unavailable */
      }
   }

   protected readonly active = signal(0);
   protected readonly paused = signal(false);
   private readonly sandboxes = inject(SandboxBackendService);
   /** Sandbox project behind the current showcase tab (the guide's seeded examples). */
   protected readonly sandboxId = signal<string | null>(null);
   protected readonly mountKey = computed(() => `${this.active()}:${this.sandboxId()}`);
   private readonly store = inject(ProjectStore);
   /** Hides the example until the player has cleared it (it loads finished). */
   protected readonly prepping = signal(true);
   /** Guiding cursor, in world coordinates. */
   private readonly cursorAt = signal<{
      x: number;
      y: number;
      label?: string;
      box?: Box;
      caret?: boolean;
      h?: number;
   } | null>(null);
   protected readonly cursor = computed(() => {
      const c = this.cursorAt();
      if (!c) return null;
      const v = this.store.viewport();
      const z = v.zoom;
      return {
         left: c.x * z + v.x,
         top: c.y * z + v.y,
         label: c.label,
         caret: !!c.caret,
         caretH: Math.max(10, (c.h ?? 22) * z),
         box: c.box
            ? {
                 left: c.box.x * z + v.x - 4,
                 top: c.box.y * z + v.y - 4,
                 width: c.box.w * z + 8,
                 height: c.box.h * z + 8,
              }
            : null,
      };
   });
   /** The slides tab's transition screen is open: show the editor's own panels for it. */
   protected readonly morphing = signal(false);
   protected readonly compareUi = inject(CompareUiState);
   /** Slides tab: the real transition UI (map pairs / preview) for these two slides. */
   private readonly transitionIds = signal<{ from: string; to: string } | null>(null);
   /** Pointer drawn over the transition UI (screen px inside it) and the pairing drag line. */
   protected readonly moCursor = signal<{ x: number; y: number; label?: string } | null>(null);
   /** "And more": one live cursor per person, each with its own typing box / caret. */
   protected readonly lanePeople = [
      { name: 'Devin', color: 'var(--home-red)' },
      { name: 'Emily', color: 'var(--home-violet)' },
      { name: 'Sam', color: 'var(--home-teal)' },
      { name: 'Priya', color: 'var(--home-amber)' },
      { name: 'Marco', color: '#2f6bff' },
      { name: 'Ana', color: '#ec4899' },
      { name: 'Leo', color: '#0ea5e9' },
      { name: 'Mia', color: '#f97316' },
      { name: 'Kai', color: '#12b76a' },
   ];
   private readonly laneAt = signal<
      ({ x: number; y: number; label?: string; box?: Box; caret?: boolean; h?: number } | null)[]
   >([]);
   protected readonly laneCursors = computed(() => {
      const v = this.store.viewport();
      const z = v.zoom;
      return this.laneAt().map((c, i) =>
         c
            ? {
                 ...this.lanePeople[i],
                 left: c.x * z + v.x,
                 top: c.y * z + v.y,
                 label: c.label,
                 caret: !!c.caret,
                 caretH: Math.max(10, (c.h ?? 22) * z),
                 box: c.box
                    ? {
                         left: c.box.x * z + v.x - 4,
                         top: c.box.y * z + v.y - 4,
                         width: c.box.w * z + 8,
                         height: c.box.h * z + 8,
                      }
                    : null,
              }
            : null
      );
   });
   /** True while the pointer is being moved every frame (a drag): it then tracks without easing. */
   protected readonly cursorFast = signal(false);
   private lastCursorAt = 0;
   private markCursor(): void {
      const now = performance.now();
      this.cursorFast.set(now - this.lastCursorAt < 90);
      this.lastCursorAt = now;
   }
   protected readonly moLine = signal<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
   protected readonly transition = computed(() => {
      const ids = this.transitionIds();
      if (!ids) return null;
      const els = this.store.elements();
      const from = els.find((e) => e.id === ids.from);
      const to = els.find((e) => e.id === ids.to);
      return from && to ? { from, to } : null;
   });
   /** Slides tab: simplified slide panel (thumbnails of the deck being built). */
   protected readonly slidePanel = signal<{ frames: string[]; active: number } | null>(null);
   /** Live thumbnails of the listed slides, drawn from what is on each slide right now. */
   protected readonly slideThumbs = computed(() => {
      const panel = this.slidePanel();
      if (!panel) return null;
      const els = this.store.elements();
      const slides = panel.frames.map((id) => {
         const f = els.find((e) => e.id === id);
         if (!f || !f.width || !f.height) return { background: '#1e293b', items: [] };
         const pct = (v: number, of: number) => (v / of) * 100;
         const items = els
            .filter((e) => e.slideId === id && (e.opacity ?? 100) > 5)
            .map((e) => {
               const text = e.type === 'text';
               const fs = e.fontSize ?? 20;
               const lines = (e.text ?? '').split('\n');
               const w = text ? Math.min(e.width, Math.max(0, ...lines.map((l) => l.length)) * fs * 0.52) : e.width;
               return {
                  left: pct(e.x - f.x, f.width),
                  top: pct(e.y - f.y, f.height),
                  width: pct(w, f.width),
                  height: pct(text ? Math.min(e.height, fs * 1.25 * lines.length) : e.height, f.height),
                  kind: text ? 'text' : 'box',
                  color: text ? (e.strokeColor ?? '#ffffff') : (e.backgroundColor ?? '#ede9fe'),
                  opacity: (e.opacity ?? 100) / 100,
               };
            });
         return { background: f.backgroundColor ?? '#1e293b', items };
      });
      return { slides, active: panel.active };
   });
   private readonly editor = viewChild(EditorComponent);
   private readonly showcaseSeen = signal(false);
   private run?: AbortController;
   private readonly demo = viewChild<ElementRef<HTMLElement>>('demo');
   private readonly reveals = viewChildren<ElementRef<HTMLElement>>('reveal');

   constructor() {
      const destroyRef = inject(DestroyRef);
      effect(() => {
         const id = this.sandboxId();
         if (!id || !this.showcaseSeen()) return;
         this.run?.abort();
         const run = new AbortController();
         this.run = run;
         untracked(() => void this.playCycle(id, run.signal));
      });
      destroyRef.onDestroy(() => this.run?.abort());
      effect(() => {
         const seed = this.showcase[this.active()].seed;
         this.sandboxId.set(null);
         this.prepping.set(true);
         this.cursorAt.set(null);
         this.slidePanel.set(null);
         this.transitionIds.set(null);
         this.sqlPanel.set(null);
         this.ctxMenu.set(null);
         this.swatches.set(null);
         this.canvasBadge.set(null);
         this.laneAt.set([]);
         prepareSandbox(this.sandboxes, `home-v${SHOWCASE_VERSION}-${seed}`, SHOWCASE_SEEDS[seed], true)
            .then((id) => {
               if (this.showcase[this.active()].seed === seed) this.sandboxId.set(id);
            })
            .catch((err) => console.error('Could not load showcase example', err));
      });

      afterNextRender(() => {
         const els = this.reveals().map((r) => r.nativeElement);
         if (typeof IntersectionObserver === 'undefined') {
            els.forEach((el) => el.classList.add('in'));
            return;
         }
         const io = new IntersectionObserver(
            (entries) => {
               for (const e of entries) {
                  if (e.isIntersecting) {
                     e.target.classList.add('in');
                     if (e.target.classList.contains('showcase')) this.showcaseSeen.set(true);
                     io.unobserve(e.target);
                  }
               }
            },
            { threshold: 0.12 }
         );
         els.forEach((el) => io.observe(el));
         destroyRef.onDestroy(() => io.disconnect());
      });
   }

   /**
    * One showcase tab: wait for the real editor to load and frame the finished
    * example, rebuild it step by step, hold, then move on to the next tab.
    */
   private async playCycle(id: string, abort: AbortSignal): Promise<void> {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 100; i++) {
         if (abort.aborted) return;
         if (this.store.projectId() === id && !this.store.loading() && this.store.schema()) break;
         await sleep(50);
      }
      await sleep(450); // the editor frames the finished example first
      if (abort.aborted || this.store.projectId() !== id) return;
      this.fillBox();
      await sleep(60);
      if (abort.aborted) return;
      if (this.showcase[this.active()].id === 'more') {
         await this.playLanes(abort);
         for (let held = 0; held < 3000 || this.paused(); held += 100) {
            if (abort.aborted) return;
            await sleep(100);
         }
         this.laneAt.set([]);
         if (!abort.aborted) this.active.update((i) => (i + 1) % this.showcase.length);
         return;
      }
      const done = playBuild(this.store, abort, (c) => (this.markCursor(), this.cursorAt.set(c)), {
         frame: (b) => this.glideTo(b, abort),
         panel: (p) => this.slidePanel.set(p),
         transition: (from, to, pairs) => this.playTransition(from, to, pairs, abort),
         sqlExport: () => this.showSqlExport(abort),
         menu: (at, items, pick) => this.contextMenu(at, items, pick, abort),
         duplicateSlide: () => this.duplicateSlide(abort),
         messageStyle: (m) => this.styleMessage(m, abort),
         dom: {
            caret: (b, t) => this.caretIn(b, t),
            message: (i) => this.messageAt(i),
            revealLabels: () =>
               this.demo()
                  ?.nativeElement.querySelectorAll<HTMLElement>('dd-sequence-diagram > .msg-label-wrap')
                  .forEach((w) => (w.style.visibility = 'visible')),
         },
      });
      this.prepping.set(false); // cleared synchronously by playBuild
      await done;
      // Slides end on the played transition, so move straight on; the others hold their result.
      const hold = this.showcase[this.active()].id === 'slides' ? 300 : 3500;
      for (let held = 0; held < hold || this.paused(); held += 100) {
         if (abort.aborted) return;
         await sleep(100);
      }
      if (!abort.aborted) this.active.update((i) => (i + 1) % this.showcase.length);
   }

   /** Zoom the finished example so it fills the showcase box (up to 160%). */
   private fillBox(): void {
      const box = this.demo()?.nativeElement;
      if (!box) return;
      const r0 = box.getBoundingClientRect();
      let l = Infinity,
         t = Infinity,
         r = -Infinity,
         b = -Infinity;
      box.querySelectorAll(
         '.world dd-table-node, .world dd-sequence-diagram > *, .world .slide-zoom, .world svg.layer > g > *'
      ).forEach((el) => {
         const rc = el.getBoundingClientRect();
         if (!rc.width || !rc.height) return;
         l = Math.min(l, rc.left - r0.left);
         t = Math.min(t, rc.top - r0.top);
         r = Math.max(r, rc.right - r0.left);
         b = Math.max(b, rc.bottom - r0.top);
      });
      if (!isFinite(l)) return;
      const v = this.store.viewport();
      const wx = (l - v.x) / v.zoom,
         wy = (t - v.y) / v.zoom;
      const ww = (r - l) / v.zoom,
         wh = (b - t) / v.zoom;
      const pad = 36;
      const left = this.showcase[this.active()].id === 'slides' ? 150 : 0; // room for the slide panel
      const w = r0.width - left;
      const zoom = Math.min((w - pad * 2) / ww, (r0.height - pad * 2) / wh, 1.6);
      this.store.setViewport(left + w / 2 - (wx + ww / 2) * zoom, r0.height / 2 - (wy + wh / 2) * zoom, zoom);
   }

   /** Screen rect (client) → world box. */
   private toWorld(r: DOMRect): Box {
      const box = this.demo()!.nativeElement.getBoundingClientRect();
      const v = this.store.viewport();
      return {
         x: (r.left - box.left - v.x) / v.zoom,
         y: (r.top - box.top - v.y) / v.zoom,
         w: r.width / v.zoom,
         h: r.height / v.zoom,
      };
   }

   /** Caret after the rendered text inside `box` (SVG text is drawn in world units). */
   private caretIn(b: Box, typed: string): { x: number; y: number; h: number } | null {
      const root = this.demo()?.nativeElement;
      if (!root || !typed.trim()) return null;
      const want = typed.replace(/\s+/g, '');
      for (const t of Array.from(root.querySelectorAll<SVGTextElement>('.world svg text'))) {
         if ((t.textContent ?? '').replace(/\s+/g, '') !== want) continue;
         const lines = t.querySelectorAll<SVGTSpanElement>('tspan');
         const last = (lines.length ? lines[lines.length - 1] : t) as SVGGraphicsElement;
         const r = this.toWorld(last.getBoundingClientRect());
         if (r.x < b.x - 40 || r.x > b.x + b.w + 40 || r.y < b.y - 40 || r.y > b.y + b.h + 40) continue;
         return { x: r.x + r.w + 1, y: r.y, h: r.h };
      }
      return null;
   }

   /** The index-th message line (top to bottom) of the shown sequence diagram. */
   private messageAt(index: number) {
      const root = this.demo()?.nativeElement;
      const diagram = root?.querySelector('dd-sequence-diagram');
      if (!diagram) return null;
      const kids = Array.from(diagram.children) as HTMLElement[];
      const lines = kids
         .filter((k) => k.classList.contains('msg-line'))
         .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      const line = lines[index];
      if (!line) return null;
      const ly = line.getBoundingClientRect().top;
      const near = (k: HTMLElement) =>
         Math.abs(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2 - ly) < 30;
      const head = kids.find((k) => k.classList.contains('msg-head') && near(k));
      const wrap = kids
         .filter((k) => k.classList.contains('msg-label-wrap'))
         .sort(
            (a, b) => Math.abs(a.getBoundingClientRect().bottom - ly) - Math.abs(b.getBoundingClientRect().bottom - ly)
         )[0];
      const parts = [line, head, wrap].filter((x): x is HTMLElement => !!x);
      return {
         line: this.toWorld(line.getBoundingClientRect()),
         label: () => {
            const span = wrap?.querySelector('.msg-label');
            return span && span.getBoundingClientRect().width ? this.toWorld(span.getBoundingClientRect()) : null;
         },
         // New message parts start hidden (CSS on the sequence tab); this reveals them once drawn.
         hide: (h: boolean) => parts.forEach((p) => (p.style.visibility = h ? 'hidden' : 'visible')),
      };
   }

   /**
    * Slides: the editor's own transition components, trimmed to the stage and the
    * pairs list — Map pairs first (which object becomes which), then Preview, played
    * with its own button.
    */
   private async playTransition(
      from: string,
      to: string,
      pairs: [string, string][],
      abort: AbortSignal
   ): Promise<void> {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const go = () =>
         this.demo()?.nativeElement.querySelector<HTMLButtonElement>('.sc-morph dd-deck-compare button.go');
      this.compareUi.view.set('map');
      this.transitionIds.set({ from, to });
      try {
         // Map pairs: wire each object on slide 1 to its new place on slide 2.
         await sleep(700);
         // The purple squares first, slowly, so the outline highlighting shows; then the rest quickly.
         const all = this.store.elements();
         const isPurple = (id: string) =>
            (all.find((e) => e.id === id)?.backgroundColor ?? '').toLowerCase() === '#7c5cff';
         const ordered = [...pairs.filter(([a]) => isPurple(a)), ...pairs.filter(([a]) => !isPurple(a))];
         for (const [i, [a, b]] of ordered.entries()) {
            if (abort.aborted) return;
            const slow = isPurple(a);
            // Dropped: both share a morph tag now, so the real map draws the pair.
            const pair = () => {
               const els = this.store.elements();
               const ea = els.find((e) => e.id === a);
               const eb = els.find((e) => e.id === b);
               if (ea && eb)
                  this.store.applyRemoteBatch([
                     { kind: 'element.updated', element: { ...ea, morphId: `tag:p${i}` } },
                     { kind: 'element.updated', element: { ...eb, morphId: `tag:p${i}` } },
                  ]);
            };
            await this.dragPairById(from, a, to, b, i === 0 ? 'Drag to pair' : undefined, abort, slow, pair);
            await sleep(40);
         }
         this.moCursor.set(null);
         await sleep(500);
         if (abort.aborted) return;
         // Preview: scrub back and forth, then play it.
         this.compareUi.view.set('preview');
         await sleep(600);
         await this.scrubPreview([0, 1, 0.3, 1], abort);
         await sleep(200);
         go()?.click();
         await sleep(1100);
      } finally {
         this.moCursor.set(null);
         this.moLine.set(null);
         this.transitionIds.set(null);
         this.compareUi.view.set('map');
      }
   }

   /** A right-click menu over the canvas (screen px in the showcase box). */
   protected readonly ctxMenu = signal<{
      left: number;
      top: number;
      items: { label: string; kbd?: string }[];
      hot: number | null;
   } | null>(null);
   /** The colour swatches opened from the message toolbar's colour button. */
   protected readonly swatches = signal<{ left: number; top: number; value: string | null } | null>(null);

   private toScreen(p: { x: number; y: number }): { x: number; y: number } {
      const v = this.store.viewport();
      return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
   }

   /** Move the guiding cursor onto an element on the page (it is placed in world units). */
   private async pointAt(
      el: Element | null | undefined,
      label: string | undefined,
      ms: number,
      box?: Box
   ): Promise<void> {
      if (!el) return;
      const w = this.toWorld(el.getBoundingClientRect());
      this.cursorAt.set({ x: w.x + Math.min(w.w / 2, 26), y: w.y + w.h / 2, label, box });
      await new Promise((r) => setTimeout(r, ms));
   }

   /** Right-click → menu → choose an item (the app's menu styling). */
   private async contextMenu(
      at: { x: number; y: number },
      items: { label: string; kbd?: string }[],
      pick: string,
      abort: AbortSignal
   ): Promise<void> {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Whatever is selected (its outline rides on the cursor state) stays selected through the menu.
      const selection = this.cursorAt()?.box;
      this.cursorAt.set({ ...at, label: 'Right-click', box: selection });
      await sleep(500);
      if (abort.aborted) return;
      const p = this.toScreen(at);
      // Keep the whole menu inside the showcase box (flip left / up near the edges).
      const box = this.demo()?.nativeElement;
      const mw = 220;
      const mh = items.length * 33 + 12;
      const left = box && p.x + 4 + mw > box.clientWidth - 8 ? p.x - mw - 4 : p.x + 4;
      const top = box && p.y + 4 + mh > box.clientHeight - 8 ? Math.max(8, p.y - mh - 4) : p.y + 4;
      this.ctxMenu.set({ left, top, items, hot: null });
      this.cursorAt.set({ ...at, box: selection });
      await sleep(380);
      const i = items.findIndex((x) => x.label === pick);
      const row = this.demo()?.nativeElement.querySelectorAll('.sc-ctx .dd-menu-item')[i];
      await this.pointAt(row, undefined, 420, selection);
      this.ctxMenu.update((m) => (m ? { ...m, hot: i } : m));
      await sleep(320);
      this.ctxMenu.set(null);
      this.cursorAt.update((c) => (selection && c ? { ...c, label: undefined, box: selection } : null));
   }

   /** Short label over the canvas (e.g. "Slide 2 · copy of slide 1"). */
   protected readonly canvasBadge = signal<string | null>(null);

   /** Slides: right-click slide 1 in the slide panel → Duplicate slide. */
   private async duplicateSlide(abort: AbortSignal): Promise<void> {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const root = this.demo()?.nativeElement;
      const thumb = root?.querySelector('.sc-slides .sp-row:last-of-type .sp-thumb');
      if (!root || !thumb) return;
      await this.pointAt(thumb, 'Right-click', 600);
      if (abort.aborted) return;
      const box = root.getBoundingClientRect();
      const r = thumb.getBoundingClientRect();
      const items = [
         { label: 'New slide' },
         { label: 'Duplicate slide', kbd: 'Ctrl+D' },
         { label: 'Delete slide', kbd: 'Del' },
      ];
      this.ctxMenu.set({ left: r.right - box.left - 6, top: r.top - box.top + r.height / 2, items, hot: null });
      await sleep(380);
      const row = root.querySelectorAll('.sc-ctx .dd-menu-item')[1];
      await this.pointAt(row, undefined, 420);
      this.ctxMenu.update((m) => (m ? { ...m, hot: 1 } : m));
      await sleep(320);
      this.ctxMenu.set(null);
      this.cursorAt.set(null);
      this.canvasBadge.set('Slide 2 · copy of slide 1');
      setTimeout(() => this.canvasBadge.set(null), 2200);
   }

   /** Select a message, then use the editor's own message toolbar to set its style and colour. */
   private async styleMessage(m: SequenceMessageModel, abort: AbortSignal): Promise<void> {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const root = this.demo()?.nativeElement;
      const update = (patch: Partial<SequenceMessageModel>) => {
         const cur = this.store.schema()?.sequenceMessages.find((x) => x.id === m.id);
         if (cur) this.store.applyRemoteBatch([{ kind: 'message.updated', message: { ...cur, ...patch } }]);
      };
      this.store.selectMessage(m.id);
      await sleep(450);
      if (abort.aborted || !root) return;
      const bar = root.querySelector('dd-sequence-message-toolbar');
      const names: Record<string, string> = { solid: 'Sync', dashed: 'Return', break: 'Break' };
      if (m.style !== 'solid') {
         const seg = Array.from(bar?.querySelectorAll('button.seg') ?? []).find(
            (b) => b.textContent?.trim() === names[m.style]
         );
         await this.pointAt(seg, names[m.style], 520);
         update({ style: m.style });
         await sleep(450);
      }
      if (m.color && !abort.aborted) {
         const btn = root.querySelector('dd-sequence-message-toolbar button[aria-label="Line color"]');
         await this.pointAt(btn, 'Line color', 450);
         if (btn) {
            const box = root.getBoundingClientRect();
            const r = btn.getBoundingClientRect();
            this.swatches.set({ left: r.left - box.left - 8, top: r.bottom - box.top + 6, value: null });
            await sleep(400);
            const sw = Array.from(root.querySelectorAll('.sc-swatches button')).find(
               (b) => (b.getAttribute('aria-label') ?? '').toLowerCase() === m.color!.toLowerCase()
            );
            await this.pointAt(sw ?? root.querySelector('.sc-swatches button'), undefined, 450);
            update({ color: m.color });
            this.swatches.update((x) => (x ? { ...x, value: m.color! } : x));
            await sleep(300);
            this.swatches.set(null);
         }
      }
      await sleep(250);
      this.store.clearSelection();
   }

   /** Drag the real preview's scrubber through these points (0 – 1), with the cursor on its thumb. */
   private async scrubPreview(points: number[], abort: AbortSignal): Promise<void> {
      const host = this.demo()?.nativeElement.querySelector<HTMLElement>('.sc-morph');
      const input = host?.querySelector<HTMLInputElement>('input.scrub');
      if (!host || !input) return;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const h = host.getBoundingClientRect();
      const r = input.getBoundingClientRect();
      const thumb = 12;
      const at = (v: number) => ({
         x: r.left - h.left + thumb / 2 + (r.width - thumb) * v,
         y: r.top - h.top + r.height / 2,
      });
      let v = Number(input.value) / 1000 || 0;
      this.moCursor.set({ ...at(v), label: 'Scrub' });
      await sleep(350);
      for (const target of points) {
         const from = v;
         const steps = Math.max(8, Math.round(Math.abs(target - from) * 26));
         for (let i = 1; i <= steps; i++) {
            if (abort.aborted) return;
            const t = i / steps;
            v = from + (target - from) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
            input.value = String(Math.round(v * 1000));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            this.markCursor();
            this.moCursor.set({ ...at(v), label: 'Scrub' });
            await sleep(28);
         }
         await sleep(260);
      }
      this.moCursor.set(null);
   }

   /** Data model: the SQL export of the schema just built, from the app's own generator. */
   protected readonly sqlPanel = signal<{ text: string; shown: number } | null>(null);
   /** The typed-so-far SQL as highlighted lines, with the code blocks' own tokenizer and palette. */
   protected readonly sqlLines = computed(() => {
      const q = this.sqlPanel();
      if (!q) return [];
      const palette = codePalette(this.theme.dark());
      return tokenizeCode(q.text.slice(0, q.shown), 'sql').map((line) =>
         line.map((t) => ({ text: t.text, color: tokenColor(palette, t.kind) }))
      );
   });
   private async showSqlExport(abort: AbortSignal): Promise<void> {
      const schema = this.store.schema();
      if (!schema) return;
      let sql = '';
      try {
         sql = generateSql(schema, { dialect: 'mysql' });
      } catch {
         return;
      }
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Stays on screen with the model through the end of the tab (cleared when the tab changes).
      this.sqlPanel.set({ text: sql, shown: 0 });
      await sleep(350);
      const steps = 50;
      for (let i = 1; i <= steps && !abort.aborted; i++) {
         this.sqlPanel.set({ text: sql, shown: Math.round((sql.length * i) / steps) });
         await sleep(36);
      }
      await sleep(800);
   }

   /** Drag from one element's outline (slide `fa`) to another's (slide `fb`) in the real map view. */
   private async dragPairById(
      fa: string,
      a: string,
      fb: string,
      b: string,
      label: string | undefined,
      abort: AbortSignal,
      slow = false,
      onDrop?: () => void
   ): Promise<void> {
      const host = this.demo()?.nativeElement.querySelector<HTMLElement>('.sc-morph');
      if (!host) return;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const els = this.store.elements();
      // Outlines are placed in percent of their slide: find the one nearest each element's centre.
      const hitFor = (frameId: string, id: string, side: string): HTMLElement | undefined => {
         const f = els.find((e) => e.id === frameId);
         const e = els.find((x) => x.id === id);
         if (!f || !e) return undefined;
         const cx = ((e.x - f.x + e.width / 2) / f.width) * 100;
         const cy = ((e.y - f.y + e.height / 2) / f.height) * 100;
         let best: HTMLElement | undefined;
         let bestD = Infinity;
         host.querySelectorAll<HTMLElement>(`.mo-stage .pairview ${side} button.hit`).forEach((btn) => {
            const l = parseFloat(btn.style.left) + parseFloat(btn.style.width) / 2;
            const t = parseFloat(btn.style.top) + parseFloat(btn.style.height) / 2;
            const d = (l - cx) ** 2 + (t - cy) ** 2;
            if (d < bestD) {
               bestD = d;
               best = btn;
            }
         });
         return best;
      };
      const ha = hitFor(fa, a, '.sl:not(.b)');
      const hb = hitFor(fb, b, '.sl.b');
      if (!ha || !hb) return;
      const h = host.getBoundingClientRect();
      const centre = (el: HTMLElement) => {
         const r = el.getBoundingClientRect();
         return { x: r.left + r.width / 2 - h.left, y: r.top + r.height / 2 - h.top };
      };
      const p = centre(ha);
      const q = centre(hb);
      // Hovering an outline lights it (and its partner) in the real map: trigger that as the cursor passes.
      // The map's own focus state: the lit outline and its partner stay bright, everything else dims.
      const hover = (el: HTMLElement, on: boolean) => this.compareUi.lit.set(on ? (el.dataset['key'] ?? null) : null);
      this.moCursor.set({ x: p.x, y: p.y, label });
      if (slow) hover(ha, true);
      await sleep(slow ? 520 : label ? 380 : 120);
      const steps = slow ? 16 : 6;
      for (let i = 1; i <= steps; i++) {
         if (abort.aborted) return;
         const k = 1 - Math.pow(1 - i / steps, 2);
         const x = p.x + (q.x - p.x) * k;
         const y = p.y + (q.y - p.y) * k;
         this.moLine.set({ x1: p.x, y1: p.y, x2: x, y2: y });
         this.markCursor();
         this.moCursor.set({ x, y, label });
         await sleep(slow ? 30 : 16);
      }
      this.moLine.set(null);
      onDrop?.();
      if (slow) {
         hover(ha, false);
         await sleep(30);
         // Re-find the partner outline (the map re-renders on pairing) and light the new pair.
         const lit = hitFor(fb, b, '.sl.b');
         if (lit) hover(lit, true);
         await sleep(520);
         if (lit) hover(lit, false);
      } else {
         await sleep(40);
      }
   }

   /** Drag from an object on the left slide to one on the right in the real map view. */
   private async dragPair(fromLabel: string, toLabel: string, abort: AbortSignal): Promise<void> {
      const host = this.demo()?.nativeElement.querySelector<HTMLElement>('.sc-morph');
      if (!host) return;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const find = (side: string, label: string) =>
         Array.from(host.querySelectorAll<HTMLElement>(`.mo-stage .pairview ${side} button.hit`)).find((b) =>
            (b.getAttribute('aria-label') ?? '').startsWith(label)
         );
      const a = find('.sl:not(.b)', fromLabel);
      const b = find('.sl.b', toLabel);
      if (!a || !b) return;
      const h = host.getBoundingClientRect();
      const centre = (el: HTMLElement) => {
         const r = el.getBoundingClientRect();
         return { x: r.left + r.width / 2 - h.left, y: r.top + r.height / 2 - h.top };
      };
      const p = centre(a);
      const q = centre(b);
      this.moCursor.set({ x: p.x - 60, y: p.y + 50 });
      await sleep(80);
      this.moCursor.set({ x: p.x, y: p.y, label: 'Drag to pair' });
      await sleep(420);
      const steps = 16;
      for (let i = 1; i <= steps; i++) {
         if (abort.aborted) return;
         const k = 1 - Math.pow(1 - i / steps, 2);
         const x = p.x + (q.x - p.x) * k;
         const y = p.y + (q.y - p.y) * k;
         this.moLine.set({ x1: p.x, y1: p.y, x2: x, y2: y });
         this.moCursor.set({ x, y, label: 'Drag to pair' });
         await sleep(32);
      }
      await sleep(250);
      this.moLine.set(null);
   }

   /**
    * "And more": a project coming together. The camera starts close on the first idea in
    * the middle and slowly pulls back while more and more people add their part around
    * the edges — notes, the data model, the request flow, code, a plan, a slide — until
    * the whole board is in view. Every lane builds from one snapshot of the finished board.
    */
   private async playLanes(abort: AbortSignal): Promise<void> {
      const source = structuredClone(this.store.schema()!);
      const finalView = { ...this.store.viewport() };
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // One shared to-do list, from the middle outward: whoever is free next takes the next
      // item, so everyone's work interleaves across the board. Estimated effort keeps the
      // load even, so the whole team finishes at about the same moment.
      const people = this.lanePeople.length;
      const bounds = this.contentBounds();
      const centre =
         this.titleCentre('DevDesigner v1') ??
         (bounds ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 } : { x: 0, y: 0 });
      const dist = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
      type Pick = (kind: 'element' | 'table' | 'diagram' | 'relationship', it: { id: string }) => boolean;
      type Job = { at: { x: number; y: number }; pick?: Pick; cost: number; after?: number };
      const all: Job[] = [];
      const els = source.elements;
      const frames = new Set(els.filter((e) => e.type === 'frame').map((e) => e.id));
      const typed = (t?: string) => Math.min(3, (t ?? '').length * 0.035);
      for (const e of els) {
         if (frames.has(e.id) || (e.slideId && frames.has(e.slideId))) continue;
         const at = { x: e.x + e.width / 2, y: e.y + e.height / 2 };
         const late = e.type === 'arrow' || e.type === 'line';
         const cost =
            e.type === 'code'
               ? 2 + typed(e.text) * 1.3
               : e.type === 'text'
                 ? 0.8 + typed(e.text)
                 : e.type === 'freedraw'
                   ? 1.4
                   : late
                     ? 0.9
                     : e.type === 'grid' || e.type === 'image'
                       ? 0.8
                       : 1.4 + typed(e.text);
         // Lines come after what they connect; pen marks after what they circle or underline.
         all.push({
            at,
            cost,
            after: late ? 260 : e.type === 'freedraw' ? 700 : 0,
            pick: (k, it) => k === 'element' && it.id === e.id,
         });
      }
      for (const f of els.filter((e) => frames.has(e.id))) {
         const kids = els.filter((e) => e.slideId === f.id);
         all.push({
            at: { x: f.x + f.width / 2, y: f.y + f.height / 2 },
            cost: 1.6 + kids.reduce((n, k) => n + 0.8 + typed(k.text), 0),
            pick: (k, it) => k === 'element' && (it.id === f.id || (it as { slideId?: string }).slideId === f.id),
         });
      }
      for (const t of source.tables)
         all.push({
            at: { x: t.x + 130, y: t.y + 60 },
            cost: 1 + t.columns.length * 0.5,
            pick: (k, it) => k === 'table' && it.id === t.id,
         });
      for (const r of source.relationships) {
         const t = source.tables.find((x) => x.columns.some((c) => c.id === r.sourceColumnId));
         if (t)
            all.push({
               at: { x: t.x + 130, y: t.y + 60 },
               cost: 1.2,
               after: 500,
               pick: (k, it) => k === 'relationship' && it.id === r.id,
            });
      }
      for (const d of source.sequenceDiagrams) {
         const ls = source.lifelines.filter((l) => l.diagramId === d.id);
         const ms = source.sequenceMessages.filter((m) => m.diagramId === d.id);
         all.push({
            at: { x: Math.min(...ls.map((l) => l.x)) + 200, y: (d.originY ?? 0) + 120 },
            cost: 1.2 + ls.length * 0.35 + ms.length * 1.5,
            pick: (k, it) => k === 'diagram' && it.id === d.id,
         });
      }
      // Arrows, lines and links come after what they connect (sorted a little further out).
      all.sort((a, b) => dist(a.at) + (a.after ?? 0) - (dist(b.at) + (b.after ?? 0)));
      // Unhurried at first, then faster and faster as the camera pulls back.
      const paceAt = (i: number) => 1 - 0.68 * Math.pow(i / Math.max(1, all.length - 1), 0.8);
      const jobs: Job[][] = Array.from({ length: people }, () => []);
      const free = Array.from({ length: people }, (_, i) => i * 0.35);
      for (const job of all) {
         const who = free.indexOf(Math.min(...free));
         jobs[who].push(job);
         free[who] += job.cost;
      }

      const lane =
         (i: number): CursorFn =>
         (c) =>
            this.laneAt.update((all) => {
               const next = [...all];
               next[i] = c;
               return next;
            });
      const dom = {
         caret: (b: Box, t: string) => this.caretIn(b, t),
         message: (i: number) => this.messageAt(i),
         revealLabels: () =>
            this.demo()
               ?.nativeElement.querySelectorAll<HTMLElement>('dd-sequence-diagram > .msg-label-wrap')
               .forEach((w) => (w.style.visibility = 'visible')),
      };
      // Camera: the title dead centre, then a slow pull-back that stays centred on it until the
      // whole board fits around it.
      const box = this.demo()?.nativeElement;
      const w = box ? box.clientWidth / 2 : 0;
      const h = box ? box.clientHeight / 2 : 0;
      const pad = 24;
      const endZoom = bounds
         ? Math.min(
              (w - pad) / Math.max(centre.x - bounds.x, bounds.x + bounds.w - centre.x, 1),
              (h - pad) / Math.max(centre.y - bounds.y, bounds.y + bounds.h - centre.y, 1)
           )
         : finalView.zoom;
      const startZoom = Math.min(1.1, Math.max(0.75, endZoom * 5));
      const at = (zoom: number) => this.store.setViewport(w - centre.x * zoom, h - centre.y * zoom, zoom);
      at(startZoom);
      // The pull-back lasts about as long as the team's work.
      const camera = (async () => {
         const dur = Math.max(12000, (all.reduce((n, j, i) => n + j.cost * paceAt(i), 0) / people) * 1000);
         const t0 = performance.now();
         while (!abort.aborted) {
            const t = Math.min(1, (performance.now() - t0) / dur);
            const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            // Zoom in log space so the pull-back feels even.
            at(Math.exp(Math.log(startZoom) + (Math.log(endZoom) - Math.log(startZoom)) * k));
            if (t >= 1) break;
            await sleep(30);
         }
      })();
      // One shared queue: whoever is free takes the next item, so everyone ends within one item of each other.
      const queue = [...all];
      const runs = Array.from({ length: people }, async (_, person) => {
         await sleep(person * 350);
         for (let job = queue.shift(); job && !abort.aborted; job = queue.shift()) {
            const pace = paceAt(all.indexOf(job));
            await playBuild(
               this.store,
               abort,
               lane(person),
               { dom },
               { source, pick: job.pick, clear: false, speed: pace }
            );
         }
         lane(person)(null);
      });
      // Clear the finished example once (before anyone draws), then reveal the empty board.
      await playBuild(this.store, abort, () => undefined, {}, { source, pick: () => false });
      this.prepping.set(false);
      await Promise.all([camera, ...runs]);
   }

   /** World bounds of everything the editor has rendered in the showcase. */
   private contentBounds(): Box | null {
      const box = this.demo()?.nativeElement;
      if (!box) return null;
      let l = Infinity,
         t = Infinity,
         r = -Infinity,
         b = -Infinity;
      box.querySelectorAll(
         '.world dd-table-node, .world dd-sequence-diagram > *, .world .slide-zoom, .world svg.layer > g > *'
      ).forEach((el) => {
         const rc = el.getBoundingClientRect();
         if (!rc.width || !rc.height) return;
         const wb = this.toWorld(rc);
         l = Math.min(l, wb.x);
         t = Math.min(t, wb.y);
         r = Math.max(r, wb.x + wb.w);
         b = Math.max(b, wb.y + wb.h);
      });
      return isFinite(l) ? { x: l, y: t, w: r - l, h: b - t } : null;
   }

   /** World centre of the rendered text with exactly this content. */
   private titleCentre(text: string): { x: number; y: number } | null {
      const t = Array.from(this.demo()?.nativeElement.querySelectorAll('.world svg text') ?? []).find(
         (el) => (el.textContent ?? '').trim() === text
      );
      if (!t) return null;
      const b = this.toWorld(t.getBoundingClientRect());
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
   }

   /** Glide the viewport so a world box fills the showcase (right of the slide panel when it shows). */
   private async glideTo(b: Box, abort: AbortSignal): Promise<void> {
      const el = this.demo()?.nativeElement;
      if (!el) return;
      const left = this.slidePanel() ? 150 : 0;
      const w = el.clientWidth - left;
      const h = el.clientHeight;
      const zoom = Math.min((w - 32) / b.w, (h - 32) / b.h, 1.6);
      const to = { zoom, x: left + (w - b.w * zoom) / 2 - b.x * zoom, y: (h - b.h * zoom) / 2 - b.y * zoom };
      const from = this.store.viewport();
      const steps = 22;
      for (let i = 1; i <= steps; i++) {
         if (abort.aborted) return;
         const t = i / steps;
         const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
         this.store.setViewport(
            from.x + (to.x - from.x) * k,
            from.y + (to.y - from.y) * k,
            from.zoom + (to.zoom - from.zoom) * k
         );
         await new Promise((r) => setTimeout(r, 25));
      }
   }

   /** Slides: show the deck's real transition screen — the morph pairs, then a preview. */
   private async showTransition(deck: string, slides: number, abort: AbortSignal): Promise<void> {
      const editor = this.editor();
      if (!editor) return;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      this.morphing.set(true);
      try {
         // Map pairs: which object on slide 1 becomes which on slide 2.
         editor.showTransitionScreen(deck, slides, 'map');
         await sleep(5000);
         if (abort.aborted) return;
         // Preview: play the real morph a few times with its own ▶ / ↻ button.
         editor.showTransitionScreen(deck, slides, 'preview');
         await sleep(900);
         for (let i = 0; i < 3 && !abort.aborted; i++) {
            const go = () => this.demo()?.nativeElement.querySelector<HTMLButtonElement>('dd-deck-compare button.go');
            for (let t = 0; t < 30 && /Pause/.test(go()?.textContent ?? ''); t++) await sleep(100);
            await sleep(700);
            go()?.click();
            await sleep(1500);
         }
         await sleep(800);
      } finally {
         editor.leaveDeckFocus();
         this.morphing.set(false);
      }
   }

   protected pick(i: number): void {
      if (i === this.active()) return;
      this.run?.abort();
      if (this.morphing()) {
         this.editor()?.leaveDeckFocus();
         this.morphing.set(false);
      }
      this.active.set(i);
   }

   protected open(id: string): void {
      this.projects.select(id);
   }

   protected openProjects(): void {
      this.overlay.open();
   }

   protected async newCanvas(): Promise<void> {
      try {
         const created = await this.projects.create({ name: 'Untitled' });
         this.projects.select(created.id);
      } catch (err) {
         console.error('Could not create project', err);
         this.snackBar.open('Could not create project', 'Dismiss', { duration: 4000 });
      }
   }

   protected openAuth(): void {
      this.dialog
         .open(AuthDialogComponent, { width: '420px', maxWidth: '92vw' })
         .afterClosed()
         .subscribe((signedIn) => {
            if (signedIn) this.projects.loadProjects();
         });
   }

   protected openApiTokens(): void {
      if (!this.auth.currentUser()) {
         this.openAuth();
         return;
      }
      this.dialog.open(ApiTokensDialogComponent, { width: '560px', maxWidth: '94vw' });
   }

   protected async signOut(): Promise<void> {
      await this.auth.logout();
      this.projects.select(null);
      this.projects.loadProjects();
   }
}
