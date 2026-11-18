import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject } from '@angular/core';
import { ProjectsStore } from '../../../shared/state/projects/projects.store';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { ThemeService } from '../../theme/theme.service';
import { SyncService } from '../../sync/sync.service';

interface DesktopWindowBridge {
   platform: string;
   showMenu(x: number, y: number): void;
   setTitleBarColors(background: string, text: string): void;
}

/** The window controls the desktop shell exposes (absent on the web). */
export function desktopWindow(): DesktopWindowBridge | null {
   return (globalThis as { devdesigner?: { window?: DesktopWindowBridge } }).devdesigner?.window ?? null;
}

/**
 * Desktop app title bar (the native one is hidden): drag area, app menu button, the
 * open project's name and where it lives. The OS draws minimize / maximize / close on
 * top of its right end (left on macOS), tinted to match through setTitleBarColors.
 */
@Component({
   selector: 'dd-title-bar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './title-bar.component.html',
   styleUrl: './title-bar.component.scss',
   host: { '[class.mac]': 'mac' },
})
export class TitleBarComponent {
   private readonly projects = inject(ProjectsStore);
   private readonly sync = inject(SyncService);
   private readonly theme = inject(ThemeService);
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
   private readonly bridge = desktopWindow();
   protected readonly mac = this.bridge?.platform === 'darwin';

   protected readonly project = computed(() => this.projects.selected());
   /** "on Team server" for a project that lives on a server. */
   protected readonly where = computed(() => {
      const project = this.project();
      const link = project ? this.sync.links().get(project.id) : undefined;
      return link ? this.sync.remoteName(link.remoteId) : null;
   });

   constructor() {
      // Tint the OS window buttons whenever the theme changes.
      afterRenderEffect(() => {
         this.theme.dark();
         const style = getComputedStyle(this.host.nativeElement);
         this.bridge?.setTitleBarColors(toHex(style.backgroundColor), toHex(style.color));
      });
   }

   protected openMenu(event: MouseEvent): void {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.bridge?.showMenu(rect.left, rect.bottom);
   }
}

/** `rgb(r, g, b)` -> `#rrggbb` (what Electron's title bar overlay accepts). */
function toHex(color: string): string {
   const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
   if (!m) return color;
   return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}
