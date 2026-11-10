import { InspectorPanelService } from '../inspector-panel.service';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { TableModel } from '@devdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { EditorActionsService } from '../../../core/services/editor-actions.service';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';

/**
 * Floating action bar shown above the selected table (mirrors the shape/connector
 * toolbars): add column, header color, note, duplicate, delete. Writes straight to
 * the store; the parent positions the host via left/top style bindings.
 */
@Component({
   selector: 'app-table-toolbar',
   standalone: true,
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ColorSwatchesComponent, MatTooltipModule, IconComponent, PopoverTriggerDirective],
   template: `
      <div class="bar">
         <button class="add" (click)="addColumn()" [disabled]="!store.canEdit()"><dd-icon name="add" />Column</button>

         <span class="sep"></span>

         <button
            class="tb"
            [ddPopoverTrigger]="colorMenu"
            placement="below-start"
            matTooltip="Header color"
            [disabled]="!store.canEdit()"
         >
            <span class="dot" [style.background]="table().color || 'var(--dd-handle)'"></span>
         </button>
         <ng-template #colorMenu let-close>
            <div class="color-grid">
               <dd-color-swatches [value]="table().color" themeValue="surface" (pick)="setColor($event); close()" />
            </div>
         </ng-template>

         <button
            class="tb"
            [ddPopoverTrigger]="noteMenu"
            placement="below-start"
            matTooltip="Note"
            [disabled]="!store.canEdit()"
         >
            <dd-icon name="edit_note" />
         </button>
         <ng-template #noteMenu>
            <div class="note-pop">
               <textarea
                  class="note"
                  rows="3"
                  placeholder="Add a note…"
                  [value]="table().note ?? ''"
                  (change)="setNote($any($event.target).value)"
               ></textarea>
            </div>
         </ng-template>

         <button class="tb txt" (click)="inspector.toggle()" matTooltip="Indexes (in Details)">
            Indexes · {{ table().indexes?.length ?? 0 }}
         </button>
         <button class="tb txt" (click)="actions.exportSql()" matTooltip="SQL for the selected tables">SQL</button>

         <button class="tb" (click)="duplicate()" matTooltip="Duplicate table" [disabled]="!store.canEdit()">
            <dd-icon name="content_copy" />
         </button>

         <span class="sep"></span>

         <button
            type="button"
            class="tb details"
            [class.on]="inspector.shown()"
            (click)="inspector.toggle()"
            title="Details"
            aria-label="Details"
         >
            <dd-icon name="tune" />
         </button>
         <button class="tb del" (click)="remove()" matTooltip="Delete table" [disabled]="!store.canEdit()">
            <dd-icon name="delete" />
         </button>
      </div>
   `,
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
