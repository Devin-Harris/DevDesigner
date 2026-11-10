import { InspectorPanelService } from '../../../../services/inspector-panel.service';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { TableModel } from '@devdesigner/shared';
import { ProjectStore } from '../../../../state/project/project.store';
import { EditorActionsService } from '../../../../../../core/editor-bridge/editor-actions.service';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { ColorSwatchesComponent } from '../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../../../../shared/ui/directives/popover-trigger.directive';

/**
 * Floating action bar shown above the selected table (mirrors the shape/connector
 * toolbars): add column, header color, note, duplicate, delete. Writes straight to
 * the store; the parent positions the host via left/top style bindings.
 */
@Component({
   selector: 'dd-table-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ColorSwatchesComponent, MatTooltipModule, IconComponent, PopoverTriggerDirective],
   templateUrl: './table-toolbar.component.html',
   styleUrl: './table-toolbar.component.scss',
})
export class TableToolbarComponent {
   protected readonly inspector = inject(InspectorPanelService);
   protected readonly store = inject(ProjectStore);
   protected readonly actions = inject(EditorActionsService);
   readonly table = input.required<TableModel>();

   protected addColumn(): void {
      if (!this.store.canEdit()) return;
      const names = new Set(this.table().columns.map((c) => c.name));
      let i = this.table().columns.length + 1;
      let name = `column_${i}`;
      while (names.has(name)) {
         i += 1;
         name = `column_${i}`;
      }
      void this.store.addColumn(this.table().id, { name, dataType: { name: 'INT' } });
   }

   protected setColor(color: string): void {
      void this.store.updateTable(this.table().id, { color });
   }

   protected setNote(note: string): void {
      void this.store.updateTable(this.table().id, { note });
   }

   protected duplicate(): void {
      void this.store.duplicateTable(this.table().id);
   }

   protected remove(): void {
      void this.store.deleteTable(this.table().id);
   }
}
