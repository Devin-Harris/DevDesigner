import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommandPaletteComponent } from './features/command-palette/command-palette.component';
import { AutofocusDirective } from './shared/ui/directives/autofocus.directive';
import { ShortcutsSheetComponent } from './features/shortcuts/shortcuts-sheet.component';
import { ToolbarPrefsService } from './features/editor/shape-toolbar/toolbar-prefs.service';
import { ToolbarCustomizePanelComponent } from './features/editor/shape-toolbar/toolbar-customize-panel.component';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService } from './core/services/theme.service';
import { AuthService } from './core/services/auth.service';
import { EditorActionsService } from './core/services/editor-actions.service';
import { ProjectsApiService } from './core/services/projects-api.service';
import { ProjectFileService } from './core/services/project-file.service';
import { RealtimeService } from './core/services/realtime.service';
import { ProjectsStore } from './stores/projects.store';
import { ProjectStore } from './stores/project.store';
import { AuthDialogComponent } from './features/auth/auth-dialog.component';
import {
   ConfirmDialogComponent,
   type ConfirmDialogData,
} from './shared/ui/components/confirm-dialog/confirm-dialog.component';
import { ApiTokensDialogComponent } from './features/auth/api-tokens-dialog.component';
import { ProjectsOverlayService } from './features/workspace/projects-overlay/projects-overlay.service';
import { IconComponent } from './shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from './shared/ui/directives/popover-trigger.directive';
import type { ExportImageFormat } from './features/editor/canvas/models/toolbar-actions';

/**
 * Application shell: a single unified top bar (brand, breadcrumb → projects
 * overlay, and — while an editor is mounted — undo/redo, Export, Share and
 * presence avatars, plus account + theme) over the routed view.
 */
@Component({
   selector: 'dd-root',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      CommandPaletteComponent,
      ShortcutsSheetComponent,
      AutofocusDirective,
      RouterLink,
      RouterOutlet,
      MatToolbarModule,
      MatTooltipModule,
      IconComponent,
      PopoverTriggerDirective,
      ToolbarCustomizePanelComponent,
   ],
   templateUrl: './app.component.html',
   styleUrl: './app.component.scss',
})
export class AppComponent {
   protected readonly theme = inject(ThemeService);
   protected readonly auth = inject(AuthService);
   private readonly dialog = inject(MatDialog);
   protected readonly projects = inject(ProjectsStore);
   protected readonly editorStore = inject(ProjectStore);
   protected readonly editorActions = inject(EditorActionsService);
   private readonly router = inject(Router);
   private readonly routeUrl = toSignal(
      this.router.events.pipe(
         filter((e): e is NavigationEnd => e instanceof NavigationEnd),
         map((e) => e.urlAfterRedirects)
      ),
      { initialValue: this.router.url }
   );
   /**
    * The canvas guide and the home page embed sandbox editors in their own layout: no floating islands there.
    * The workspace swaps between home and a project with location.replaceState (no router navigation), so the
    * home check keys off the selected project rather than the URL.
    */
   protected readonly onGuide = computed(() => {
      const path = this.routeUrl().split(/[?#]/)[0];
      if (path.startsWith('/guide')) return true;
      const onWorkspace = path === '/' || path === '' || path.startsWith('/projects/');
      return onWorkspace && !this.projects.selectedId();
   });
   protected readonly realtime = inject(RealtimeService);
   private readonly overlay = inject(ProjectsOverlayService);
   private readonly projectFile = inject(ProjectFileService);
   private readonly snackBar = inject(MatSnackBar);
   private readonly projectsApi = inject(ProjectsApiService);

   protected readonly toolbarPrefs = inject(ToolbarPrefsService);

   /** Ctrl/Cmd+K command palette. */
   protected readonly paletteOpen = signal(false);
   /** Keyboard shortcuts sheet (?). */
   protected readonly shortcutsOpen = signal(false);
   /** The project name in the top-left island is being edited. */
   protected readonly renaming = signal(false);

   constructor() {
      void this.auth.loadMe();
   }

   @HostListener('window:keydown', ['$event'])
   protected onKeydown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
         // Presenting owns the keyboard.
         if (document.querySelector('dd-present-mode')) return;
         event.preventDefault();
         this.paletteOpen.update((v) => !v);
         return;
      }
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
         const t = event.target as HTMLElement | null;
         const typing =
            !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
         if (typing || document.querySelector('dd-present-mode')) return;
         event.preventDefault();
         this.shortcutsOpen.update((v) => !v);
      }
   }

   // ---- this project (main menu) ----
   private nameClickTimer: ReturnType<typeof setTimeout> | null = null;

   /** Single click opens the project switcher, but waits briefly so a double-click can rename instead. */
   protected onNameClick(event: MouseEvent): void {
      if (event.detail > 1) return;
      if (this.nameClickTimer) clearTimeout(this.nameClickTimer);
      this.nameClickTimer = setTimeout(() => {
         this.nameClickTimer = null;
         this.openProjects();
      }, 250);
   }

   protected onNameDblClick(): void {
      if (this.nameClickTimer) {
         clearTimeout(this.nameClickTimer);
         this.nameClickTimer = null;
      }
      if (this.editorStore.accessMode() === 'OWNER') this.startRename();
   }

   protected startRename(): void {
      this.renaming.set(true);
   }
   protected async commitRename(value: string): Promise<void> {
      if (!this.renaming()) return;
      this.renaming.set(false);
      const project = this.projects.selected();
      const name = value.trim();
      if (!project || !name || name === project.name) return;
      try {
         await this.projects.rename(project.id, { name });
      } catch (err) {
         console.error('Could not rename project', err);
         this.snackBar.open('Could not rename project', 'Dismiss', { duration: 5000 });
      }
   }
   protected async duplicateProject(): Promise<void> {
      const project = this.projects.selected();
      if (!project) return;
      try {
         await this.projects.duplicate(project.id);
         this.snackBar.open(`Duplicated “${project.name}” (find it in All projects)`, undefined, { duration: 3000 });
      } catch (err) {
         console.error('Could not duplicate project', err);
         this.snackBar.open('Could not duplicate project', 'Dismiss', { duration: 5000 });
      }
   }
   protected async archiveProject(): Promise<void> {
      const project = this.projects.selected();
      if (!project) return;
      const archived = !project.archived;
      try {
         await this.projects.setArchived(project.id, archived);
         this.snackBar.open(archived ? `Archived “${project.name}”` : `Unarchived “${project.name}”`, undefined, {
            duration: 3000,
         });
      } catch (err) {
         console.error('Could not archive project', err);
         this.snackBar.open('Could not change archive state', 'Dismiss', { duration: 5000 });
      }
   }

   protected openProjects(): void {
      this.overlay.open();
   }

   /** Leave the editor for the landing page. */
   protected goHome(): void {
      this.projects.select(null);
   }

   // ---- editor actions bridged to the top bar ----
   protected undo(): void {
      this.editorStore.undoElement();
   }
   protected redo(): void {
      this.editorStore.redoElement();
   }
   protected exportSql(): void {
      this.editorActions.exportSql();
   }
   protected exportImage(format: ExportImageFormat): void {
      this.editorActions.exportImage(format);
   }
   protected exportFramesPdf(): void {
      this.editorActions.exportFramesPdf();
   }
   protected exportSlidesPdf(): void {
      this.editorActions.exportSlidesPdf();
   }
   protected exportProjectFile(): void {
      const id = this.editorStore.projectId();
      if (id) {
         void this.projectFile.download(id, this.projects.selected()?.name ?? 'project');
      }
   }
   /** Merge a chosen `.devdesigner.json` file into the open project. */
   protected async importProjectFile(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // allow re-selecting the same file
      if (!file) return;
      try {
         let parsed: unknown;
         try {
            parsed = JSON.parse(await file.text());
         } catch {
            throw new Error('That file is not valid JSON.');
         }
         const count = await this.editorActions.importFile(parsed);
         this.snackBar.open(`Imported ${count} item${count === 1 ? '' : 's'}`, undefined, {
            duration: 2500,
         });
      } catch (err) {
         const detail = err instanceof HttpErrorResponse ? err.error?.message : (err as Error).message;
         // eslint-disable-next-line no-console
         console.error('Could not import file', err);
         this.snackBar.open(`Could not import file${detail ? `: ${detail}` : ''}`, 'Dismiss', {
            duration: 5000,
         });
      }
   }
   protected exportSelectionFile(): void {
      this.editorActions.exportSelectionFile();
   }
   protected share(): void {
      this.editorActions.share();
   }

   protected openAuth(): void {
      const ref = this.dialog.open(AuthDialogComponent, { width: '420px', maxWidth: '92vw' });
      ref.afterClosed().subscribe(async (signedIn) => {
         if (signedIn) {
            await this.offerGuestProjectClaim();
            this.refreshForIdentity();
         }
      });
   }

   /** After sign-in, offer to move this browser's guest projects into the account. */
   private async offerGuestProjectClaim(): Promise<void> {
      try {
         const { count } = await firstValueFrom(this.projectsApi.guestCount());
         if (count === 0) {
            return;
         }
         const plural = count === 1 ? 'project' : 'projects';
         const data: ConfirmDialogData = {
            title: 'Move guest projects?',
            message:
               `You have ${count} ${plural} made in this browser without an account. ` +
               `Move ${count === 1 ? 'it' : 'them'} into your account? If you don't, ` +
               `${count === 1 ? 'it stays' : 'they stay'} available here only while signed out.`,
            confirmLabel: `Move ${plural}`,
         };
         const confirmed = await firstValueFrom(
            this.dialog.open(ConfirmDialogComponent, { data, width: '420px' }).afterClosed()
         );
         if (!confirmed) {
            return;
         }
         const moved = await firstValueFrom(this.projectsApi.claimGuest());
         this.snackBar.open(
            `Moved ${moved.count} ${moved.count === 1 ? 'project' : 'projects'} to your account`,
            undefined,
            { duration: 3000 }
         );
      } catch (err) {
         console.error('Could not move guest projects', err);
         this.snackBar.open('Could not move guest projects', 'Dismiss', { duration: 5000 });
      }
   }

   protected openApiTokens(): void {
      this.dialog.open(ApiTokensDialogComponent, { width: '560px', maxWidth: '94vw' });
   }

   protected async signOut(): Promise<void> {
      await this.auth.logout();
      this.refreshForIdentity();
   }

   private refreshForIdentity(): void {
      this.projects.select(null);
      this.projects.loadProjects();
   }
}
