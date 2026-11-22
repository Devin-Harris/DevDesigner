import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   afterNextRender,
   computed,
   effect,
   inject,
   signal,
   untracked,
   viewChild,
   viewChildren,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { generateSql } from '@devdesigner/shared';
import {
   CompareUiState,
   DeckCompareComponent,
   EditorComponent,
   type EditorHostOptions,
   ProjectStore,
   codePalette,
   tokenColor,
   tokenizeCode,
} from '../../../editor';
import { ColorSwatchesComponent } from '../../../../shared/ui/components/color-swatches/color-swatches.component';
import { SandboxBackendService } from '../../../../core/sandbox/sandbox-backend.service';
import { prepareSandbox } from '../../../../core/sandbox/sandbox-seeds.helper';
import { type Box } from './helpers/showcase-player';
import { RouterLink } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import { LogoDrawComponent } from '../../../../shared/ui/components/logo/logo-draw.component';
import { LogoComponent } from '../../../../shared/ui/components/logo/logo.component';
import { PopoverTriggerDirective } from '../../../../shared/ui/directives/popover-trigger.directive';
import { ThemeService } from '../../../../core/theme/theme.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { ProjectsStore } from '../../../../shared/state/projects/projects.store';
import { ProjectsOverlayService } from '../../../../shared/features/projects-overlay/projects-overlay.service';
import { AccountDialogsService } from '../../../../shared/features/auth-dialogs/account-dialogs.service';
import {
   HOME_FEATURES,
   HOME_SHOWCASE,
   HOME_USES,
   MCP_COMMAND,
   MCP_CONFIG,
   SHOWCASE_SEEDS,
   SHOWCASE_VERSION,
} from './helpers/home-content';
import { DESKTOP_DOWNLOADS, DESKTOP_RELEASES_URL, detectPlatform, sleep } from './home.helpers';
import { HomeShowcaseScript } from './home-showcase-script';

/**
 * Landing page shown at `/` when no project is open: what DevDesigner is, quick
 * ways to start, and the user's most recent projects.
 */
@Component({
   selector: 'dd-home',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      IconComponent,
      LogoComponent,
      LogoDrawComponent,
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
   /** Methods moved to home-showcase-script.ts. */
   private readonly homeShowcaseScript = new HomeShowcaseScript(this);

   protected readonly theme = inject(ThemeService);
   protected readonly auth = inject(AuthService);
   protected readonly projects = inject(ProjectsStore);
   private readonly overlay = inject(ProjectsOverlayService);
   private readonly accountDialogs = inject(AccountDialogsService);
   private readonly snackBar = inject(MatSnackBar);

   /** Six most recently updated projects. */
   protected readonly recent$ = computed(() =>
      [...this.projects.projects()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
   );

   protected readonly features = HOME_FEATURES;
   protected readonly uses = HOME_USES;
   readonly showcase = HOME_SHOWCASE;
   protected readonly mcpConfig = MCP_CONFIG;
   protected readonly mcpCommand = MCP_COMMAND;
   protected readonly downloads = DESKTOP_DOWNLOADS;
   protected readonly releasesUrl = DESKTOP_RELEASES_URL;
   /** The visitor's OS, to highlight its download. */
   protected readonly platform = detectPlatform(globalThis.navigator?.userAgent ?? '');
   protected readonly mcpCopied$ = signal<'config' | 'command' | null>(null);

   protected async copyMcp(which: 'config' | 'command'): Promise<void> {
      try {
         await navigator.clipboard.writeText(which === 'config' ? this.mcpConfig : this.mcpCommand);
         this.mcpCopied$.set(which);
         setTimeout(() => this.mcpCopied$.set(null), 1600);
      } catch {
         /* clipboard unavailable */
      }
   }

   readonly active$ = signal(0);
   readonly paused = signal(false);
   private readonly sandboxes = inject(SandboxBackendService);
   /** Sandbox project behind the current showcase tab (the guide's seeded examples). */
   protected readonly sandboxId$ = signal<string | null>(null);
   protected readonly mountKey$ = computed(() => `${this.active$()}:${this.sandboxId$()}`);
   readonly store = inject(ProjectStore);
   /** Hides the example until the player has cleared it (it loads finished). */
   readonly prepping$ = signal(true);
   /** Guiding cursor, in world coordinates. */
   readonly cursorAt = signal<{
      x: number;
      y: number;
      label?: string;
      box?: Box;
      caret?: boolean;
      h?: number;
   } | null>(null);
   protected readonly cursor$ = computed(() => {
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
   readonly morphing$ = signal(false);
   readonly compareUi = inject(CompareUiState);
   /** Slides tab: the real transition UI (map pairs / preview) for these two slides. */
   readonly transitionIds = signal<{ from: string; to: string } | null>(null);
   /** Pointer drawn over the transition UI (screen px inside it) and the pairing drag line. */
   readonly moCursor$ = signal<{ x: number; y: number; label?: string } | null>(null);
   /** "And more": one live cursor per person, each with its own typing box / caret. */
   readonly lanePeople = [
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
   readonly laneAt = signal<
      ({ x: number; y: number; label?: string; box?: Box; caret?: boolean; h?: number } | null)[]
   >([]);
   protected readonly laneCursors$ = computed(() => {
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
   protected readonly cursorFast$ = signal(false);
   private lastCursorAt = 0;
   markCursor(): void {
      const now = performance.now();
      this.cursorFast$.set(now - this.lastCursorAt < 90);
      this.lastCursorAt = now;
   }
   readonly moLine$ = signal<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
   protected readonly transition$ = computed(() => {
      const ids = this.transitionIds();
      if (!ids) return null;
      const els = this.store.elements();
      const from = els.find((e) => e.id === ids.from);
      const to = els.find((e) => e.id === ids.to);
      return from && to ? { from, to } : null;
   });
   /** Slides tab: simplified slide panel (thumbnails of the deck being built). */
   readonly slidePanel = signal<{ frames: string[]; active: number } | null>(null);
   /** Live thumbnails of the listed slides, drawn from what is on each slide right now. */
   protected readonly slideThumbs$ = computed(() => {
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
   readonly editor = viewChild(EditorComponent);
   /** The showcase editor is a picture; the sequence tab's player reveals messages itself. */
   protected readonly editorOptions$ = computed<EditorHostOptions>(() => {
      const id = this.showcase[this.active$()].id;
      return { chrome: 'picture', hideSequenceMessages: !this.prepping$() && (id === 'seq' || id === 'more') };
   });
   private readonly showcaseSeen = signal(false);
   private run?: AbortController;
   readonly demo = viewChild<ElementRef<HTMLElement>>('demo');
   private readonly reveals = viewChildren<ElementRef<HTMLElement>>('reveal');

   constructor() {
      const destroyRef = inject(DestroyRef);
      effect(() => {
         const id = this.sandboxId$();
         if (!id || !this.showcaseSeen()) return;
         this.run?.abort();
         const run = new AbortController();
         this.run = run;
         untracked(() => void this.playCycle(id, run.signal));
      });
      destroyRef.onDestroy(() => this.run?.abort());
      effect(() => {
         const seed = this.showcase[this.active$()].seed;
         this.sandboxId$.set(null);
         this.prepping$.set(true);
         this.cursorAt.set(null);
         this.slidePanel.set(null);
         this.transitionIds.set(null);
         this.sqlPanel$.set(null);
         this.ctxMenu$.set(null);
         this.swatches$.set(null);
         this.canvasBadge$.set(null);
         this.laneAt.set([]);
         this.finale$.set(null);
         prepareSandbox(this.sandboxes, `home-v${SHOWCASE_VERSION}-${seed}`, SHOWCASE_SEEDS[seed], true)
            .then((id) => {
               if (this.showcase[this.active$()].seed === seed) this.sandboxId$.set(id);
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

   /** Screen rect (client) → world box. */
   toWorld(r: DOMRect): Box {
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
   caretIn(b: Box, typed: string): { x: number; y: number; h: number } | null {
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

   /** A right-click menu over the canvas (screen px in the showcase box). */
   readonly ctxMenu$ = signal<{
      left: number;
      top: number;
      items: { label: string; kbd?: string }[];
      hot: number | null;
   } | null>(null);
   /** The colour swatches opened from the message toolbar's colour button. */
   readonly swatches$ = signal<{ left: number; top: number; value: string | null } | null>(null);

   toScreen(p: { x: number; y: number }): { x: number; y: number } {
      const v = this.store.viewport();
      return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
   }

   /** Move the guiding cursor onto an element on the page (it is placed in world units). */
   async pointAt(el: Element | null | undefined, label: string | undefined, ms: number, box?: Box): Promise<void> {
      if (!el) return;
      const w = this.toWorld(el.getBoundingClientRect());
      this.cursorAt.set({ x: w.x + Math.min(w.w / 2, 26), y: w.y + w.h / 2, label, box });
      await sleep(ms);
   }

   /** Short label over the canvas (e.g. "Slide 2 · copy of slide 1"). */
   readonly canvasBadge$ = signal<string | null>(null);
   /** "And more" ending: the board dims, its title lifts to the centre and the logo pops in. */
   readonly finale$ = signal<{ dx: number; dy: number; s: number; ready: boolean; on: boolean; logo: boolean } | null>(
      null
   );

   /** Data model: the SQL export of the schema just built, from the app's own generator. */
   protected readonly sqlPanel$ = signal<{ text: string; shown: number } | null>(null);
   /** The typed-so-far SQL as highlighted lines, with the code blocks' own tokenizer and palette. */
   protected readonly sqlLines$ = computed(() => {
      const q = this.sqlPanel$();
      if (!q) return [];
      const palette = codePalette(this.theme.dark$());
      return tokenizeCode(q.text.slice(0, q.shown), 'sql').map((line) =>
         line.map((t) => ({ text: t.text, color: tokenColor(palette, t.kind) }))
      );
   });
   async showSqlExport(abort: AbortSignal): Promise<void> {
      const schema = this.store.schema();
      if (!schema) return;
      let sql = '';
      try {
         sql = generateSql(schema, { dialect: 'mysql' });
      } catch {
         return;
      }
      // Stays on screen with the model through the end of the tab (cleared when the tab changes).
      this.sqlPanel$.set({ text: sql, shown: 0 });
      await sleep(350);
      const steps = 50;
      for (let i = 1; i <= steps && !abort.aborted; i++) {
         this.sqlPanel$.set({ text: sql, shown: Math.round((sql.length * i) / steps) });
         await sleep(36);
      }
      await sleep(800);
   }

   /** Box (relative to the demo) of the rendered text with exactly this content. */
   titleRect(text: string): { left: number; top: number; width: number; height: number } | null {
      const host = this.demo()?.nativeElement;
      const t = Array.from(host?.querySelectorAll('.world svg text') ?? []).find(
         (el) => (el.textContent ?? '').trim() === text
      );
      if (!host || !t) return null;
      const h = host.getBoundingClientRect();
      const r = t.getBoundingClientRect();
      return { left: r.left - h.left, top: r.top - h.top, width: r.width, height: r.height };
   }

   /** Start the (hidden, final-size) finale word scaled down over the canvas title box `r`. */
   finaleFrom(r: { left: number; top: number; width: number; height: number }): boolean {
      const host = this.demo()?.nativeElement;
      const word = host?.querySelector('.fi-word')?.getBoundingClientRect();
      if (!host || !word) return false;
      const h = host.getBoundingClientRect();
      const dx = r.left + r.width / 2 - (word.left - h.left + word.width / 2);
      const dy = r.top + r.height / 2 - (word.top - h.top + word.height / 2);
      this.finale$.set({ dx, dy, s: r.width / word.width, ready: true, on: false, logo: false });
      return true;
   }

   /** World centre of the rendered text with exactly this content. */
   titleCentre(text: string): { x: number; y: number } | null {
      const t = Array.from(this.demo()?.nativeElement.querySelectorAll('.world svg text') ?? []).find(
         (el) => (el.textContent ?? '').trim() === text
      );
      if (!t) return null;
      const b = this.toWorld(t.getBoundingClientRect());
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
   }

   protected pick(i: number): void {
      if (i === this.active$()) return;
      this.run?.abort();
      if (this.morphing$()) {
         this.editor()?.embed.leaveDeckFocus();
         this.morphing$.set(false);
      }
      this.active$.set(i);
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

   protected async openAuth(): Promise<void> {
      if (await this.accountDialogs.openAuth()) this.projects.loadProjects();
   }

   protected openApiTokens(): void {
      if (!this.auth.currentUser$()) {
         void this.openAuth();
         return;
      }
      void this.accountDialogs.openApiTokens();
   }

   protected async openAccount(): Promise<void> {
      if (await this.accountDialogs.openAccount()) {
         this.projects.select(null);
         this.projects.loadProjects();
      }
   }

   protected async signOut(): Promise<void> {
      await this.auth.logout();
      this.projects.select(null);
      this.projects.loadProjects();
   }

   // ---- delegates to home-showcase-script.ts ----
   private playCycle(id: string, abort: AbortSignal): Promise<void> {
      return this.homeShowcaseScript.playCycle(id, abort);
   }
}
