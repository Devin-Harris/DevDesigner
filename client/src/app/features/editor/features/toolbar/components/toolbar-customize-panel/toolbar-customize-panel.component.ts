import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { DockPosition, DockPreset, DockToolId, ToolbarPrefsService } from '../../services/toolbar-prefs.service';

/**
 * Customize toolbar panel: presets, drag-to-reorder tool list, a drop zone that
 * hides tools, dock position and dock behaviour. Opened from the dock's "…"
 * button or the main menu; everything saves as it changes.
 */
@Component({
   selector: 'dd-toolbar-customize-panel',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './toolbar-customize-panel.component.html',
   styleUrl: './toolbar-customize-panel.component.scss',
})
export class ToolbarCustomizePanelComponent {
   protected readonly prefs = inject(ToolbarPrefsService);

   protected readonly positions: { id: DockPosition; label: string }[] = [
      { id: 'left', label: 'Left' },
      { id: 'top', label: 'Top' },
      { id: 'bottom', label: 'Bottom' },
      { id: 'right', label: 'Right' },
   ];

   protected readonly shown = () => this.prefs.allTools().filter((t) => t.visible);
   protected readonly hiddenList = () => this.prefs.hiddenTools();

   protected dragId: DockToolId | null = null;
   protected readonly overId = signal<DockToolId | null>(null);
   protected readonly overHidden = signal(false);

   @HostListener('document:keydown.escape')
   protected close(): void {
      this.prefs.panelOpen.set(false);
   }

   protected pickPreset(id: string): void {
      if (id) this.prefs.applyPreset(id as DockPreset);
   }

   protected dragStart(event: DragEvent, id: DockToolId): void {
      this.dragId = id;
      event.dataTransfer?.setData('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
   }

   protected allowDrop(event: DragEvent): void {
      if (this.dragId) event.preventDefault();
   }

   protected dropShown(event: DragEvent, before: DockToolId | null): void {
      event.preventDefault();
      event.stopPropagation();
      const id = this.dragId;
      this.dragId = null;
      this.overId.set(null);
      if (!id) return;
      this.prefs.setVisible(id, true);
      this.prefs.moveBefore(id, before);
   }

   protected dropHidden(event: DragEvent): void {
      event.preventDefault();
      const id = this.dragId;
      this.dragId = null;
      this.overHidden.set(false);
      if (id) this.prefs.setVisible(id, false);
   }
}
