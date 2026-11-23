import { runtimeConfig } from '../../core/config/runtime-config';
import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { ThemeService } from '../../core/theme/theme.service';
import { EditorActionsService, type CanvasItemRef } from '../../core/editor-bridge/editor-actions.service';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
// Deep import on purpose: the palette is eager (app shell) and the editor barrel would pull the whole
// editor into the initial bundle. Pass 3 moves this onto core/editor-bridge (§4.1 #1).
import { ProjectsOverlayService } from '../../shared/features/projects-overlay/projects-overlay.service';

interface PaletteEntry {
   group: 'Projects' | 'Presentations' | 'On this canvas' | 'Commands';
   icon: string;
   label: string;
   sub?: string;
   key?: string;
   run: () => void;
}

const TOOL_COMMANDS: { tool: string; label: string; key: string; icon: string }[] = [
   { tool: 'select', label: 'Select tool', key: 'V', icon: 'near_me' },
   { tool: 'hand', label: 'Hand tool', key: 'H', icon: 'pan' },
   { tool: 'rectangle', label: 'Rectangle', key: 'R', icon: 'crop_square' },
   { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: 'circle' },
   { tool: 'diamond', label: 'Diamond', key: 'D', icon: 'diamond' },
   { tool: 'triangle', label: 'Triangle', key: 'D D', icon: 'triangle' },
   { tool: 'arrow', label: 'Arrow', key: 'A', icon: 'arrow_tool' },
   { tool: 'line', label: 'Line', key: 'L', icon: 'line_tool' },
   { tool: 'freedraw', label: 'Draw', key: 'P', icon: 'pen' },
   { tool: 'text', label: 'Text', key: 'T', icon: 'text_tool' },
   { tool: 'table', label: 'ERD table', key: 'E', icon: 'table_chart' },
   { tool: 'sequence', label: 'Sequence diagram', key: 'Q', icon: 'timeline' },
   { tool: 'grid', label: 'Grid table', key: 'G', icon: 'table_chart' },
   { tool: 'code', label: 'Code block', key: 'C', icon: 'code' },
   { tool: 'frame', label: 'Frame', key: 'F', icon: 'crop' },
   { tool: 'laser', label: 'Laser pointer', key: 'K', icon: 'cursor' },
];

const KIND_ICON: Record<CanvasItemRef['kind'], string> = {
   table: 'table_chart',
   code: 'code',
   text: 'text_tool',
   frame: 'crop',
   sequence: 'timeline',
};

/**
 * Ctrl+K command palette: one search box over projects, the open project's
 * presentations and canvas items, and app commands. Arrow keys move, Enter runs.
 */
@Component({
   selector: 'dd-command-palette',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './command-palette.component.html',
   styleUrl: './command-palette.component.scss',
})
export class CommandPaletteComponent {
   readonly closed = output<void>();

   private readonly theme = inject(ThemeService);
   private readonly actions = inject(EditorActionsService);
   private readonly projects = inject(ProjectsStore);
   private readonly overlay = inject(ProjectsOverlayService);

   private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('search');
   private readonly list = viewChild<ElementRef<HTMLElement>>('list');

   protected readonly query$ = signal('');
   protected readonly active$ = signal(0);

   /** Canvas items are read once when the palette opens (cheap snapshot). */
   private readonly canvasItems = this.actions.active$() ? this.actions.canvasItems() : [];

   private readonly entries = computed<PaletteEntry[]>(() => {
      const out: PaletteEntry[] = [];
      const inEditor = this.actions.active$();
      const openId = this.projects.selectedId();

      for (const p of this.projects.projects()) {
         out.push({
            group: 'Projects',
            icon: 'schema',
            label: p.name,
            sub: p.id === openId ? 'Open now' : (p.description ?? undefined),
            run: () => this.projects.select(p.id),
         });
      }

      if (inEditor) {
         for (const d of this.actions.decks$()) {
            out.push({
               group: 'Presentations',
               icon: 'slideshow',
               label: d.name,
               sub: `${d.slides} slide${d.slides === 1 ? '' : 's'} · Enter to present`,
               run: () => this.actions.presentDeck(d.name),
            });
         }
         for (const item of this.canvasItems) {
            out.push({
               group: 'On this canvas',
               icon: KIND_ICON[item.kind],
               label: item.label,
               sub: item.kind === 'sequence' ? 'sequence' : item.kind,
               run: () => this.actions.jumpTo(item),
            });
         }
      }

      const cmd = (icon: string, label: string, run: () => void, key?: string): void => {
         out.push({ group: 'Commands', icon, label, run, key });
      };
      cmd('table_chart', 'All projects…', () => this.overlay.open());
      cmd(
         this.theme.dark$() ? 'light_mode' : 'dark_mode',
         this.theme.dark$() ? 'Switch to light theme' : 'Switch to dark theme',
         () => this.theme.toggle()
      );
      if (inEditor) {
         const canEdit = this.actions.canEdit$();
         cmd('home', 'Go to home view', () => this.actions.resetView(), 'Home');
         if (canEdit) {
            cmd('center_focus_strong', 'Set current view as home', () => this.actions.setHome());
            cmd('slideshow', 'New presentation', () => this.actions.newDeck(), 'S');
            for (const t of TOOL_COMMANDS) cmd(t.icon, t.label, () => this.actions.setTool(t.tool), t.key);
         } else {
            cmd('cursor', 'Laser pointer', () => this.actions.setTool('laser'), 'K');
         }
         cmd('data_object', 'Export SQL…', () => this.actions.exportSql());
         cmd('photo', 'Export image (PNG)', () => this.actions.exportImage('png'));
         cmd('image', 'Export image (SVG)', () => this.actions.exportImage('svg'));
         cmd('picture_as_pdf', 'Export image (PDF)', () => this.actions.exportImage('pdf'));
         if (this.actions.accessMode$() === 'OWNER' && !runtimeConfig.desktop)
            cmd('share', 'Share…', () => this.actions.share());
         cmd('home', 'Back to the home page', () => this.projects.select(null));
      }
      return out;
   });

   /** Matching entries, grouped in display order. Empty query: no canvas items (too noisy). */
   protected readonly results$ = computed(() => {
      const q = this.query$().trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const match = (e: PaletteEntry) => {
         const hay = `${e.label} ${e.sub ?? ''}`.toLowerCase();
         return words.every((w) => hay.includes(w));
      };
      const all = this.entries().filter((e) => (q ? match(e) : e.group !== 'On this canvas'));
      const order: PaletteEntry['group'][] = ['Projects', 'Presentations', 'On this canvas', 'Commands'];
      const groups = order
         .map((g) => ({ name: g, items: all.filter((e) => e.group === g).slice(0, q ? 8 : g === 'Projects' ? 5 : 12) }))
         .filter((g) => g.items.length);
      let i = 0;
      return groups.map((g) => ({ ...g, items: g.items.map((e) => ({ entry: e, index: i++ })) }));
   });

   private readonly flat = computed(() => this.results$().flatMap((g) => g.items.map((x) => x.entry)));

   constructor() {
      afterNextRender(() => this.input().nativeElement.focus());
   }

   protected onInput(value: string): void {
      this.query$.set(value);
      this.active$.set(0);
   }

   protected onKey(event: KeyboardEvent): void {
      const n = this.flat().length;
      if (event.key === 'ArrowDown' && n) {
         event.preventDefault();
         this.active$.set((this.active$() + 1) % n);
         this.scrollActive();
      } else if (event.key === 'ArrowUp' && n) {
         event.preventDefault();
         this.active$.set((this.active$() - 1 + n) % n);
         this.scrollActive();
      } else if (event.key === 'Enter') {
         event.preventDefault();
         const e = this.flat()[this.active$()];
         if (e) this.run(e);
      } else if (event.key === 'Escape') {
         event.preventDefault();
         this.closed.emit();
      }
   }

   protected run(entry: PaletteEntry): void {
      this.closed.emit();
      entry.run();
   }

   private scrollActive(): void {
      queueMicrotask(() => this.list()?.nativeElement.querySelector('.row.on')?.scrollIntoView({ block: 'nearest' }));
   }
}
