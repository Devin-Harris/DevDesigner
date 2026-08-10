import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  DATA_TYPE_NAMES,
  type ColumnModel,
  type TableModel,
  type UpdateColumnDto,
} from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';

/**
 * Optional side panel for the selected table. Everything here is also editable
 * inline on the canvas; the panel adds drag-to-reorder columns and color/note
 * editing for when they are handy.
 */
@Component({
  selector: 'app-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DragDropModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './inspector.component.html',
  styleUrl: './inspector.component.scss',
})
export class InspectorComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly dataTypeNames = DATA_TYPE_NAMES;
  protected readonly swatches = ['', '#fee4e2', '#fce7f6', '#dcfae6', '#d1e9ff', '#fef7c3'];

  readonly table = input.required<TableModel>();

  protected renameTable(event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name) {
      void this.store.updateTable(this.table().id, { name });
    }
  }

  protected setColor(color: string): void {
    void this.store.updateTable(this.table().id, { color });
  }

  protected setNote(event: Event): void {
    void this.store.updateTable(this.table().id, {
      note: (event.target as HTMLTextAreaElement).value,
    });
  }

  protected deleteTable(): void {
    void this.store.deleteTable(this.table().id);
  }

  protected addColumn(): void {
    const names = new Set(this.table().columns.map((c) => c.name));
    let i = this.table().columns.length + 1;
    let name = `column_${i}`;
    while (names.has(name)) {
      i += 1;
      name = `column_${i}`;
    }
    void this.store.addColumn(this.table().id, { name, dataType: { name: 'INT' } });
  }

  protected renameColumn(column: ColumnModel, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name) {
      void this.store.updateColumn(this.table().id, column.id, { name });
    }
  }

  protected setType(column: ColumnModel, name: string): void {
    const length = name === 'VARCHAR' ? (column.dataType.length ?? 255) : undefined;
    void this.store.updateColumn(this.table().id, column.id, { dataType: { name, length } });
  }

  protected setLength(column: ColumnModel, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const length = Number.isFinite(raw) && raw > 0 ? raw : undefined;
    void this.store.updateColumn(this.table().id, column.id, {
      dataType: { name: column.dataType.name, length },
    });
  }

  protected setFlag(
    column: ColumnModel,
    flag: 'isPrimaryKey' | 'isUnique' | 'isAutoIncrement',
    value: boolean,
  ): void {
    const patch: UpdateColumnDto = {};
    patch[flag] = value;
    void this.store.updateColumn(this.table().id, column.id, patch);
  }

  protected setNotNull(column: ColumnModel, notNull: boolean): void {
    void this.store.updateColumn(this.table().id, column.id, { isNullable: !notNull });
  }

  protected deleteColumn(column: ColumnModel): void {
    void this.store.deleteColumn(this.table().id, column.id);
  }

  protected onReorder(event: CdkDragDrop<ColumnModel[]>): void {
    const ids = this.table().columns.map((c) => c.id);
    moveItemInArray(ids, event.previousIndex, event.currentIndex);
    this.store.reorderColumns(this.table().id, ids);
  }
}
