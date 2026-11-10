import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RELATIONSHIP_TYPES, type RelationshipModel, type RelationshipType } from '@devdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/components/select/select.component';

const REFERENTIAL_ACTIONS = ['', 'NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'];

const TYPE_LABELS: Record<RelationshipType, string> = {
   ONE_TO_ONE: 'One to one',
   ONE_TO_MANY: 'One to many',
   MANY_TO_MANY: 'Many to many',
};

/**
 * Optional side panel for the selected relationship. Type + delete are also
 * available inline on the canvas; this panel adds endpoint re-pointing via
 * dropdowns and the referential actions. Built from the bespoke form primitives.
 */
@Component({
   selector: 'dd-relationship-inspector',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [FormsModule, IconComponent, SelectComponent],
   templateUrl: './relationship-inspector.component.html',
   styleUrl: './relationship-inspector.component.scss',
})
export class RelationshipInspectorComponent {
   protected readonly store = inject(ProjectStore);

   readonly relationship = input.required<RelationshipModel>();

   /** All columns as "table.column" options for the endpoint selects. */
   protected readonly columnOptions = computed<SelectOption[]>(() =>
      this.store.tables().flatMap((t) => t.columns.map((c) => ({ value: c.id, label: `${t.name}.${c.name}` })))
   );
   protected readonly typeOptions: SelectOption[] = RELATIONSHIP_TYPES.map((t) => ({
      value: t,
      label: TYPE_LABELS[t],
   }));
   protected readonly actionOptions: SelectOption[] = REFERENTIAL_ACTIONS.map((a) => ({
      value: a,
      label: a || 'Default',
   }));

   protected setSource(columnId: string): void {
      if (columnId === this.relationship().targetColumnId) {
         return;
      }
      void this.store.updateRelationship(this.relationship().id, { sourceColumnId: columnId });
   }

   protected setTarget(columnId: string): void {
      if (columnId === this.relationship().sourceColumnId) {
         return;
      }
      void this.store.updateRelationship(this.relationship().id, { targetColumnId: columnId });
   }

   protected setType(type: string): void {
      void this.store.updateRelationship(this.relationship().id, { type: type as RelationshipType });
   }

   protected setOnDelete(onDelete: string): void {
      void this.store.updateRelationship(this.relationship().id, { onDelete });
   }

   protected setOnUpdate(onUpdate: string): void {
      void this.store.updateRelationship(this.relationship().id, { onUpdate });
   }

   protected remove(): void {
      void this.store.deleteRelationship(this.relationship().id);
   }
}
