import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, ElementRef, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ProjectSummary } from '@devdesigner/shared';
import { ProjectFileService } from '../../services/project-file.service';
import { AutofocusDirective } from '../../ui/directives/autofocus.directive';
import { IconComponent } from '../../ui/components/icon/icon.component';
import { InputComponent } from '../../ui/components/input/input.component';
import { PopoverTriggerDirective } from '../../ui/directives/popover-trigger.directive';
import { ToggleComponent } from '../../ui/components/toggle/toggle.component';
import { ProjectsStore } from '../../state/projects/projects.store';
import {
   ConfirmDialogComponent,
   type ConfirmDialogData,
} from '../../ui/components/confirm-dialog/confirm-dialog.component';
import { ProjectThumbnailService } from './services/project-thumbnail.service';
import { PROJECT_TEMPLATES, type ProjectTemplate } from './models/project-templates';
import { TemplatesService } from './services/templates.service';

type OverlayView = 'projects' | 'templates';

/**
 * The full-screen projects browser, opened from the breadcrumb (or the empty
 * state) as a Material dialog. Replaces the old left sidebar panel. Hosts two
 * views: the project grid (search / new / cards / show-archived) and the
 * templates gallery. Selecting or creating a project closes the overlay so the
 * editor takes over. No type-filter pills (removed by request).
 */
@Component({
   selector: 'dd-projects-overlay',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      ReactiveFormsModule,
      AutofocusDirective,
      IconComponent,
      InputComponent,
      ToggleComponent,
      PopoverTriggerDirective,
   ],
   templateUrl: './projects-overlay.component.html',
   styleUrl: './projects-overlay.component.scss',
})
export class ProjectsOverlayComponent {
   protected readonly store = inject(ProjectsStore);
   protected readonly thumbs = inject(ProjectThumbnailService);
   private readonly templates = inject(TemplatesService);
   private readonly dialog = inject(MatDialog);
   private readonly dialogRef = inject(MatDialogRef<ProjectsOverlayComponent>);
   private readonly snackBar = inject(MatSnackBar);
   private readonly projectFile = inject(ProjectFileService);

   protected readonly view = signal<OverlayView>('projects');
   protected readonly editingId = signal<string | null>(null);
   protected readonly editName = new FormControl('', { nonNullable: true });
   /** Search box and show-archived toggle; they write through to the projects store. */
   protected readonly filters = new FormGroup({
      search: new FormControl(this.store.search(), { nonNullable: true }),
      showArchived: new FormControl(this.store.showArchived(), { nonNullable: true }),
   });
   protected readonly busy = signal(false);
   protected readonly templateDefs: ProjectTemplate[] = PROJECT_TEMPLATES;
   /** Projects ticked for a bulk action. */
   protected readonly checked = signal<ReadonlySet<string>>(new Set());
   /** Keyboard cursor (arrow keys move it; Delete/Enter act on it). */
   protected readonly cursorId = signal<string | null>(null);
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

   constructor() {
      // Project content can change while the dialog is closed; rebuild previews
      // (the cached pictures keep showing until the fresh ones arrive).
      this.thumbs.invalidate();
      // Arrow keys start from the project that's open in the editor.
      this.cursorId.set(this.store.selectedId());
      this.resetAnchor(this.store.selectedId());
      // While projects are selected, Escape clears the selection instead of
      // closing the dialog (handled in onKeydown).
      effect(() => {
         this.dialogRef.disableClose = this.checked().size > 0;
      });
      this.filters.controls.search.valueChanges
         .pipe(takeUntilDestroyed())
         .subscribe((value) => this.store.setSearch(String(value)));
      this.filters.controls.showArchived.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
         if (value !== this.store.showArchived()) this.store.toggleArchived();
      });
   }

   /** Deterministic accent per project so a card keeps its thumbnail color. */
   private static readonly ACCENTS = ['#6f8bff', '#34d0c0', '#f0b45e', '#e06b8b', '#8b7bff', '#7ac98a'];
   protected accent(id: string): string {
      let hash = 0;
      for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
      return ProjectsOverlayComponent.ACCENTS[hash % ProjectsOverlayComponent.ACCENTS.length];
   }

   /** "Edited 3h ago" style relative time from an ISO timestamp. */
   protected edited(iso: string): string {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return '';
      const s = Math.max(0, Math.round((Date.now() - then) / 1000));
      if (s < 60) return 'Edited just now';
      const m = Math.round(s / 60);
      if (m < 60) return `Edited ${m}m ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `Edited ${h}h ago`;
      const d = Math.round(h / 24);
      if (d < 30) return `Edited ${d}d ago`;
      return `Edited ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
   }

   private openTimer: ReturnType<typeof setTimeout> | null = null;

   /**
    * Card click. A click on the name waits briefly so a double-click (rename)
    * can cancel the open; clicks elsewhere on the card open immediately.
    */
   protected onCardClick(project: ProjectSummary, event: MouseEvent): void {
      this.cancelPendingOpen();
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
         event.preventDefault();
         this.toggleCheck(project, event);
         return;
      }
      // Plain click opens. On the name, wait briefly so a double-click can
      // rename instead (startRename cancels the pending open).
      if (!(event.target as HTMLElement).closest('.name-row')) {
         this.select(project);
         return;
      }
      this.openTimer = setTimeout(() => {
         this.openTimer = null;
         this.select(project);
      }, 250);
   }

   private cancelPendingOpen(): void {
      if (this.openTimer !== null) {
         clearTimeout(this.openTimer);
         this.openTimer = null;
      }
   }

   protected select(project: ProjectSummary): void {
      if (this.editingId() === project.id) return;
      this.store.select(project.id);
      this.dialogRef.close();
   }

   /** Create a blank project (the server assigns the default type). */
   protected async addProject(): Promise<void> {
      try {
         const created = await this.store.create({ name: 'Untitled' });
         this.store.select(created.id);
         this.dialogRef.close();
      } catch (err) {
         this.notifyError('Could not add project', err);
      }
   }

   protected async useTemplate(template: ProjectTemplate): Promise<void> {
      if (this.busy()) return;
      this.busy.set(true);
      try {
         await this.templates.createFromTemplate(template);
         this.dialogRef.close();
      } catch (err) {
         this.notifyError('Could not create from template', err);
      } finally {
         this.busy.set(false);
      }
   }

   /** Download the project as a `.devdesigner.json` file that can be imported elsewhere. */
   protected exportProject(project: ProjectSummary): Promise<void> {
      return this.projectFile.download(project.id, project.name);
   }

   /** Import a project file chosen via the hidden file input, then open it. */
   protected async importFile(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // allow re-selecting the same file
      if (!file || this.busy()) return;
      this.busy.set(true);
      try {
         let parsed: unknown;
         try {
            parsed = JSON.parse(await file.text());
         } catch {
            throw new Error('That file is not valid JSON.');
         }
         const created = await this.store.importProject(parsed);
         this.store.select(created.id);
         this.dialogRef.close();
         this.notify(`Imported "${created.name}"`);
      } catch (err) {
         const detail = err instanceof HttpErrorResponse ? err.error?.message : (err as Error).message;
         this.notifyError(`Could not import project${detail ? `: ${detail}` : ''}`, err);
      } finally {
         this.busy.set(false);
      }
   }

   protected startRename(project: ProjectSummary): void {
      this.cancelPendingOpen();
      this.editingId.set(project.id);
      this.editName.setValue(project.name);
   }
   protected cancelRename(): void {
      this.editingId.set(null);
   }
   protected async commitRename(project: ProjectSummary): Promise<void> {
      if (this.editingId() !== project.id) return;
      const name = this.editName.value.trim();
      this.editingId.set(null);
      if (!name || name === project.name) return;
      try {
         await this.store.rename(project.id, { name });
      } catch (err) {
         this.notifyError('Could not rename project', err);
      }
   }

   protected async duplicate(project: ProjectSummary): Promise<void> {
      try {
         await this.store.duplicate(project.id);
         this.notify('Project duplicated');
      } catch (err) {
         this.notifyError('Could not duplicate project', err);
      }
   }

   protected async toggleArchive(project: ProjectSummary): Promise<void> {
      try {
         await this.store.setArchived(project.id, !project.archived);
         this.notify(project.archived ? 'Project unarchived' : 'Project archived');
      } catch (err) {
         this.notifyError('Could not update project', err);
      }
   }

   // ---- selection & keyboard -------------------------------------------

   protected toggleCheck(project: ProjectSummary, event?: MouseEvent): void {
      if (event?.shiftKey && this.cursorId()) {
         this.extendRange(project.id);
      } else {
         const next = new Set(this.checked());
         if (next.has(project.id)) next.delete(project.id);
         else next.add(project.id);
         this.checked.set(next);
         this.resetAnchor(project.id);
      }
      this.cursorId.set(project.id);
   }

   /**
    * Shift-range state: the anchor where the range started and the selection
    * that existed before it. Each shift move recomputes base ∪ anchor..target,
    * so moving back toward the anchor un-selects cards again.
    */
   private anchorId: string | null = null;
   private rangeBase: ReadonlySet<string> = new Set();

   private resetAnchor(id: string | null): void {
      this.anchorId = id;
      this.rangeBase = this.checked();
   }

   private extendRange(toId: string): void {
      const list = this.store.visibleProjects();
      if (!this.anchorId || !list.some((p) => p.id === this.anchorId)) {
         this.resetAnchor(this.cursorId() ?? toId);
      }
      const a = list.findIndex((p) => p.id === this.anchorId);
      const b = list.findIndex((p) => p.id === toId);
      if (a < 0 || b < 0) return;
      const next = new Set(this.rangeBase);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(list[i].id);
      this.checked.set(next);
   }

   /** Click on empty space in the list (not on a card) drops the selection. */
   protected onListClick(event: MouseEvent): void {
      if ((event.target as HTMLElement).closest('.card')) return;
      // Drop the highlight too, so no card keeps a ring after deselecting.
      this.cursorId.set(null);
      this.clearChecked();
   }

   protected selectAll(): void {
      this.checked.set(new Set(this.store.visibleProjects().map((p) => p.id)));
   }
   protected clearChecked(): void {
      this.checked.set(new Set());
      this.resetAnchor(this.cursorId());
   }

   @HostListener('document:keydown', ['$event'])
   protected onKeydown(event: KeyboardEvent): void {
      // Only when this overlay is the top-most dialog (not while confirming).
      const open = this.dialog.openDialogs;
      if (open[open.length - 1] !== this.dialogRef) return;
      if (this.view() !== 'projects' || this.editingId()) return;
      if (event.key === 'Escape' && this.checked().size > 0) {
         event.preventDefault();
         this.clearChecked();
         return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      const list = this.store.visibleProjects();
      if (list.length === 0) return;
      const idx = list.findIndex((p) => p.id === this.cursorId());
      const current = idx >= 0 ? list[idx] : null;

      switch (event.key) {
         case 'ArrowDown':
         case 'ArrowUp': {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const nextIdx =
               idx < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, idx + step));
            const next = list[nextIdx];
            if (event.shiftKey) {
               this.extendRange(next.id);
            } else {
               // A plain arrow (Shift released) drops the multi-selection.
               this.checked.set(new Set());
               this.resetAnchor(next.id);
            }
            this.moveCursor(next.id);
            break;
         }
         case ' ':
            if (current) {
               event.preventDefault();
               this.toggleCheck(current);
            }
            break;
         case 'Delete':
         case 'Backspace':
            if (this.checked().size > 0) {
               event.preventDefault();
               this.removeChecked(event.shiftKey);
            } else if (current) {
               event.preventDefault();
               this.removeOne(current, event.shiftKey);
            }
            break;
         case 'Enter':
            // Skip only when a button was tabbed to (Enter should press it);
            // a mouse-focused button (e.g. after the confirm dialog) doesn't count.
            if (current && !target?.closest('button:focus-visible, a:focus-visible')) {
               event.preventDefault();
               this.select(current);
            }
            break;
         case 'a':
            if (event.ctrlKey || event.metaKey) {
               event.preventDefault();
               this.selectAll();
            }
            break;
      }
   }

   private moveCursor(id: string | null): void {
      this.cursorId.set(id);
      if (!id) return;
      requestAnimationFrame(() =>
         this.host.nativeElement
            .querySelector(`.card[data-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ block: 'nearest' })
      );
   }

   // ---- deletion -------------------------------------------------------

   protected removeOne(project: ProjectSummary, skipConfirm = false): void {
      this.confirmThenDelete([project], skipConfirm);
   }

   protected removeChecked(skipConfirm = false): void {
      const ids = this.checked();
      const projects = this.store.visibleProjects().filter((p) => ids.has(p.id));
      if (projects.length) this.confirmThenDelete(projects, skipConfirm);
   }

   private confirmThenDelete(projects: ProjectSummary[], skipConfirm: boolean): void {
      if (skipConfirm) {
         void this.doRemove(projects);
         return;
      }
      const single = projects.length === 1;
      const data: ConfirmDialogData = {
         title: single ? 'Delete project' : `Delete ${projects.length} projects`,
         message: single
            ? `Delete "${projects[0].name}"? This cannot be undone.`
            : `Delete ${projects.length} projects? This cannot be undone.`,
         confirmLabel: 'Delete',
      };
      this.dialog
         .open(ConfirmDialogComponent, { data, width: '420px' })
         .afterClosed()
         .subscribe((confirmed) => {
            if (confirmed) void this.doRemove(projects);
         });
   }

   private async doRemove(projects: ProjectSummary[]): Promise<void> {
      // Remember where the cursor should land: the next surviving project.
      const before = this.store.visibleProjects();
      const doomed = new Set(projects.map((p) => p.id));
      const anchor = Math.max(
         0,
         before.findIndex((p) => doomed.has(p.id))
      );
      const results = await Promise.allSettled(projects.map((p) => this.store.remove(p.id)));
      const failed = results.filter((r) => r.status === 'rejected').length;

      const left = new Set(this.checked());
      doomed.forEach((id) => left.delete(id));
      this.checked.set(left);
      const after = this.store.visibleProjects();
      this.moveCursor(after.length ? after[Math.min(anchor, after.length - 1)].id : null);

      if (failed) {
         this.notifyError(`Could not delete ${failed} project${failed === 1 ? '' : 's'}`, results);
      } else {
         this.notify(projects.length === 1 ? `Deleted "${projects[0].name}"` : `Deleted ${projects.length} projects`);
      }
   }

   protected close(): void {
      this.dialogRef.close();
   }

   private notify(message: string): void {
      this.snackBar.open(message, undefined, { duration: 2500 });
   }
   private notifyError(message: string, err: unknown): void {
      // eslint-disable-next-line no-console
      console.error(message, err);
      this.snackBar.open(message, 'Dismiss', { duration: 5000 });
   }
}
