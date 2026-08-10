import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  RELATIONSHIP_TYPES,
  type RelationshipModel,
  type RelationshipType,
} from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';

const REFERENTIAL_ACTIONS = ['', 'NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'];

const TYPE_LABELS: Record<RelationshipType, string> = {
  ONE_TO_ONE: 'One to one',
  ONE_TO_MANY: 'One to many',
  MANY_TO_MANY: 'Many to many',
};

/**
 * Optional side panel for the selected relationship. Type + delete are also
 * available inline on the canvas; this panel adds endpoint re-pointing via
 * dropdowns and the referential actions.
 */
@Component({
  selector: 'app-relationship-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './relationship-inspector.component.html',
  styleUrl: './relationship-inspector.component.scss',
})
export class RelationshipInspectorComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly types = RELATIONSHIP_TYPES;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly actions = REFERENTIAL_ACTIONS;

  readonly relationship = input.required<RelationshipModel>();

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

  protected setType(type: RelationshipType): void {
    void this.store.updateRelationship(this.relationship().id, { type });
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
