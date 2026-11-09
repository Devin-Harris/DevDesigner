import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  DATA_TYPE_NAMES,
  generateSql,
  type ColumnModel,
  type IndexModel,
  type TableModel,
  type UpdateColumnDto,
} from '@devdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
import { InputComponent } from '../../../shared/ui/input/input.component';
import { CheckboxComponent } from '../../../shared/ui/checkbox/checkbox.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';

type InspectorTab = 'columns' | 'indexes' | 'sql';

/**
 * Optional side panel for the selected table. Everything here is also editable
 * inline on the canvas; the panel adds drag-to-reorder columns, header color and
 * note editing. Built from the bespoke form primitives (no Angular Material).
 */
@Component({
  selector: 'app-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColorSwatchesComponent, 
    FormsModule,
    DragDropModule,
    IconComponent,
    InputComponent,
    CheckboxComponent,
    SelectComponent,
  ],
  templateUrl: './inspector.component.html',
  styleUrl: './inspector.component.scss',
})
export class InspectorComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly typeOptions: SelectOption[] = DATA_TYPE_NAMES.map((n) => ({ value: n, label: n }));
  // Saturated category tints (shared look with the table node + floating toolbar).

  readonly table = input.required<TableModel>();

  protected readonly tab = signal<InspectorTab>('columns');

  /** Generated MySQL for this table alone (plus its internal relationships). */
  protected readonly tableSql = computed(() => {
    const table = this.table();
    const relationships = this.store.relationships().filter((rel) => {
      const ids = new Set(table.columns.map((c) => c.id));
      return ids.has(rel.sourceColumnId) && ids.has(rel.targetColumnId);
    });
    try {
      return generateSql(
        {
          tables: [table],
          relationships,
          notes: [],
          elements: [],
          sequenceDiagrams: [],
          lifelines: [],
          sequenceMessages: [],
          viewport: this.store.viewport(),
        },
        { dialect: 'mysql' },
      );
    } catch {
      return '-- Could not generate SQL for this table.';
    }
  });

  protected renameTable(name: string | number): void {
    const trimmed = String(name).trim();
    if (trimmed) void this.store.updateTable(this.table().id, { name: trimmed });
  }

  protected setColor(color: string): void {
    void this.store.updateTable(this.table().id, { color });
  }

  protected setNote(note: string): void {
    void this.store.updateTable(this.table().id, { note });
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

  protected renameColumn(column: ColumnModel, name: string | number): void {
    const trimmed = String(name).trim();
    if (trimmed) void this.store.updateColumn(this.table().id, column.id, { name: trimmed });
  }

  protected setType(column: ColumnModel, name: string): void {
    const length = name === 'VARCHAR' ? (column.dataType.length ?? 255) : undefined;
    void this.store.updateColumn(this.table().id, column.id, { dataType: { name, length } });
  }

  protected setLength(column: ColumnModel, value: string | number): void {
    const raw = Number(value);
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

  // --- Indexes ---

  protected addIndex(): void {
    const names = new Set((this.table().indexes ?? []).map((i) => i.name));
    let n = (this.table().indexes ?? []).length + 1;
    let name = `idx_${this.table().name}_${n}`;
    while (names.has(name)) {
      n += 1;
      name = `idx_${this.table().name}_${n}`;
    }
    const firstColumn = this.table().columns[0];
    void this.store.addIndex(this.table().id, {
      name,
      columnIds: firstColumn ? [firstColumn.id] : [],
      isUnique: false,
    });
  }

  protected renameIndex(index: IndexModel, name: string | number): void {
    const trimmed = String(name).trim();
    if (trimmed) void this.store.updateIndex(this.table().id, index.id, { name: trimmed });
  }

  protected setIndexUnique(index: IndexModel, isUnique: boolean): void {
    void this.store.updateIndex(this.table().id, index.id, { isUnique });
  }

  protected indexHasColumn(index: IndexModel, columnId: string): boolean {
    return index.columnIds.includes(columnId);
  }

  protected toggleIndexColumn(index: IndexModel, columnId: string, on: boolean): void {
    const columnIds = on
      ? [...index.columnIds, columnId]
      : index.columnIds.filter((id) => id !== columnId);
    void this.store.updateIndex(this.table().id, index.id, { columnIds });
  }

  protected deleteIndex(index: IndexModel): void {
    void this.store.deleteIndex(this.table().id, index.id);
  }
}
