import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { map } from 'rxjs';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ThemeService } from '../../core/services/theme.service';
import { SandboxBackendService } from '../../core/sandbox/sandbox-backend.service';
import { fontStack } from '../editor/canvas/helpers/shape-render.helper';
import type { ProjectExportFile } from '@dbdesigner/shared';
import { EditorActionsService } from '../../core/services/editor-actions.service';
import { EditorComponent } from '../editor/editor.component';
import { GUIDE_GROUPS, GUIDE_TOOLS, type GuideTool } from './guide-tools';

/** Bump when the seeds change so a session picks up the new examples. */
const STORAGE_PREFIX = 'dbd-guide-sandbox:v5:';

/** Seed project files, bundled as lazy chunks (exported from real projects, see seeds/). */
const SEEDS: Record<string, () => Promise<{ default: unknown }>> = {
  select: () => import('./seeds/select.json'),
  tables: () => import('./seeds/tables.json'),
  sequence: () => import('./seeds/sequence.json'),
  shapes: () => import('./seeds/shapes.json'),
  text: () => import('./seeds/text.json'),
  draw: () => import('./seeds/draw.json'),
  code: () => import('./seeds/code.json'),
  grid: () => import('./seeds/grid.json'),
  media: () => import('./seeds/media.json'),
  frame: () => import('./seeds/frame.json'),
  laser: () => import('./seeds/laser.json'),
  presentations: () => import('./seeds/presentations.json'),
  export: () => import('./seeds/export.json'),
};

async function waitForCodeFont(): Promise<void> {
  try {
    const stack = fontStack('code');
    await Promise.race([
      Promise.all([document.fonts.load(`400 14px ${stack}`), document.fonts.ready]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* measure with whatever is available */
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function readStored(seed: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + seed);
  } catch {
    return null;
  }
}

function writeStored(seed: string, id: string | null): void {
  try {
    if (id) sessionStorage.setItem(STORAGE_PREFIX + seed, id);
    else sessionStorage.removeItem(STORAGE_PREFIX + seed);
  } catch {
    /* storage blocked: the sandbox is just re-created next time */
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
  selector: 'app-guide',
  standalone: true,
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

  private readonly toolParam = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('tool'))),
    { initialValue: null },
  );

  protected readonly tool = computed<GuideTool>(
    () => this.tools.find((t) => t.id === this.toolParam()) ?? this.tools[0],
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
  protected readonly railCollapsed = signal(readFlag('dbd-guide-rail-collapsed'));
  /** Mobile: tool rail collapsed into a dropdown. */
  protected readonly navOpen = signal(false);

  constructor() {
    effect(() => {
      void this.loadSandbox(this.seed());
    });
  }

  protected toggleRail(): void {
    this.railCollapsed.update((v) => !v);
    try {
      localStorage.setItem('dbd-guide-rail-collapsed', this.railCollapsed() ? '1' : '0');
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
    const stored = readStored(seed);
    if (stored && this.sandboxes.exists(stored)) {
      if (current()) this.sandboxId.set(stored);
      return;
    }
    try {
      const file = (await SEEDS[seed]()).default as ProjectExportFile;
      // Code blocks are sized from the measured code font: make sure it has loaded.
      await waitForCodeFont();
      const id = this.sandboxes.create(structuredClone(file), seed);
      writeStored(seed, id);
      if (current()) this.sandboxId.set(id);
    } catch (err) {
      console.error('Could not prepare guide sandbox', err);
      if (current()) this.sandboxError.set('Could not load the sandbox examples.');
    }
  }
}
