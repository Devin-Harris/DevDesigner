import {
   ChangeDetectionStrategy,
   Component,
   computed,
   effect,
   ElementRef,
   untracked,
   viewChild,
   inject,
   signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { map } from 'rxjs';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { ThemeService } from '../../core/services/theme.service';
import { SandboxBackendService } from '../../core/sandbox/sandbox-backend.service';
import { EditorActionsService } from '../../core/services/editor-actions.service';
import { EditorComponent } from '../editor/editor.component';
import { GUIDE_GROUPS, GUIDE_TOOLS, type GuideTool } from './guide-tools';
import { prepareSandbox, SEEDS, writeStored } from './helpers/guide-sandbox.helper';

function readFlag(key: string): boolean {
   try {
      return localStorage.getItem(key) === '1';
   } catch {
      return false;
   }
}

/**
 * Canvas guide (/guide/:tool): a left rail of tools, and for each one a full page
 * explaining it next to a live sandbox — the real editor running on a scratch
 * project seeded from seeds/<seed>.json. Sandboxes never touch the API: the
 * sandbox interceptor serves them from the browser, and they last for the browser
 * session (sessionStorage). Reset rebuilds one from its seed.
 */
@Component({
   selector: 'dd-guide',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, RouterLink, EditorComponent],
   templateUrl: './guide.component.html',
   styleUrl: './guide.component.scss',
})
export class GuideComponent {
   protected readonly theme = inject(ThemeService);
   private readonly sandboxes = inject(SandboxBackendService);
   private readonly router = inject(Router);
   private readonly snackBar = inject(MatSnackBar);
   protected readonly actions = inject(EditorActionsService);

   protected readonly tools = GUIDE_TOOLS;
   protected readonly groups = GUIDE_GROUPS.map((g) => ({
      name: g,
      tools: GUIDE_TOOLS.filter((t) => t.group === g),
   }));

   private readonly toolParam = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('tool'))), {
      initialValue: null,
   });

   protected readonly tool = computed<GuideTool>(
      () => this.tools.find((t) => t.id === this.toolParam()) ?? this.tools[0]
   );
   private readonly seed = computed(() => this.tool().seed ?? this.tool().id);

   protected readonly index = computed(() => this.tools.indexOf(this.tool()));
   protected readonly prev = computed(() => this.tools[this.index() - 1] ?? null);
   protected readonly next = computed(() => this.tools[this.index() + 1] ?? null);

   /** Sandbox project for the current tool; null while it is being prepared. */
   protected readonly sandboxId = signal<string | null>(null);
   /** Remounts the editor per tab (tabs sharing a seed still get their own tool + fit). */
   protected readonly mountKey = computed(() => `${this.tool().id}:${this.sandboxId()}`);
   protected readonly sandboxError = signal<string | null>(null);
   protected readonly expanded = signal(false);
   /** Desktop: tool rail collapsed to icons (remembered per browser). */
   protected readonly railCollapsed = signal(readFlag('dd-guide-rail-collapsed'));
   /** Mobile: tool rail collapsed into a dropdown. */
   protected readonly navOpen = signal(false);

   private readonly page = viewChild<ElementRef<HTMLElement>>('page');

   constructor() {
      // New tool → start at the top (the page scrolls; on narrow screens the window does).
      effect(() => {
         this.tool();
         untracked(() => {
            this.page()?.nativeElement.scrollTo({ top: 0 });
            window.scrollTo({ top: 0 });
         });
      });
      effect(() => {
         void this.loadSandbox(this.seed());
      });
   }

   protected toggleRail(): void {
      this.railCollapsed.update((v) => !v);
      try {
         localStorage.setItem('dd-guide-rail-collapsed', this.railCollapsed() ? '1' : '0');
      } catch {
         /* not remembered */
      }
   }

   protected go(tool: GuideTool): void {
      this.navOpen.set(false);
      void this.router.navigate(['/guide', tool.id]);
   }

   protected async reset(): Promise<void> {
      const seed = this.seed();
      const old = this.sandboxId();
      this.sandboxId.set(null);
      writeStored(seed, null);
      if (old) this.sandboxes.delete(old);
      await this.loadSandbox(seed);
   }

   /** Merge a chosen project / selection file into the sandbox (same as the main menu's Import). */
   protected async importFile(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
         const added = await this.actions.importFile(JSON.parse(await file.text()));
         this.snackBar.open(`Imported ${added} item${added === 1 ? '' : 's'}`, undefined, { duration: 2500 });
      } catch (err) {
         console.error('Import failed', err);
         this.snackBar.open('That file could not be imported', 'Dismiss', { duration: 4000 });
      }
   }

   private async loadSandbox(seed: string): Promise<void> {
      this.sandboxId.set(null);
      this.sandboxError.set(null);
      const current = (): boolean => this.seed() === seed;
      try {
         const id = await prepareSandbox(this.sandboxes, seed, SEEDS[seed]);
         if (current()) this.sandboxId.set(id);
      } catch (err) {
         console.error('Could not prepare guide sandbox', err);
         if (current()) this.sandboxError.set('Could not load the sandbox examples.');
      }
   }
}
