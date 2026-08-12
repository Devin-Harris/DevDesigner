import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import {
  DATA_TYPE_NAMES,
  type ColumnModel,
  type TableModel,
  type UpdateColumnDto,
} from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { ProjectStore } from '../../../stores/project.store';
import { HEADER_H, NODE_WIDTH, ROW_H } from '../canvas/constants/canvas.constants';

export interface HandleEvent {
  event: PointerEvent;
  columnId: string;
}

/**
 * A single table node on the canvas. Fully self-editing: table name, column
 * name, data type, length and constraints are all edited inline via the store.
 * Emits low-level pointer intents (node drag start, connect-handle down/up) so
 * the parent canvas can coordinate dragging and relationship linking.
 */
@Component({
  selector: 'app-table-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AutofocusDirective, MatIconModule, MatMenuModule],
  templateUrl: './table-node.component.html',
  styleUrl: './table-node.component.scss',
  host: {
    '[style.left.px]': 'table().x',
    '[style.top.px]': 'table().y',
    '[style.width.px]': 'nodeWidth',
    '[class.selected]': 'selected()',
    '(pointerdown)': 'nodePointerDown.emit($event)',
    '(dblclick)': '$event.stopPropagation()',
  },
})
export class TableNodeComponent {
  private readonly store = inject(ProjectStore);

  readonly table = input.required<TableModel>();
  readonly selected = input<boolean>(false);
  readonly editable = input<boolean>(false);

  readonly nodePointerDown = output<PointerEvent>();
  readonly handleDown = output<HandleEvent>();
  readonly handleUp = output<HandleEvent>();

  protected readonly nodeWidth = NODE_WIDTH;
  protected readonly headerH = HEADER_H;
  protected readonly rowH = ROW_H;
  protected readonly dataTypeNames = DATA_TYPE_NAMES;
  protected readonly headerColors = [
    '#e5484d',
    '#f5a623',
    '#12b76a',
    '#0ea5e9',
    '#2f6bff',
    '#7c5cff',
    '#ec4899',
    '#64748b',
  ];

  protected setColor(color: string): void {
    if (!this.editable()) {
      return;
    }
    void this.store.updateTable(this.table().id, { color });
  }

  protected readonly editingName = signal(false);
  protected readonly editingColumnId = signal<string | null>(null);

  // --- connect handles (delegated to the parent canvas) ---

  protected onHandleDown(event: PointerEvent, columnId: string): void {
    event.stopPropagation();
    this.handleDown.emit({ event, columnId });
  }

  protected onHandleUp(event: PointerEvent, columnId: string): void {
    this.handleUp.emit({ event, columnId });
  }

  // --- inline table name ---

  protected startEditName(event: Event): void {
    event.stopPropagation();
    if (!this.editable()) {
      return;
    }
    this.editingColumnId.set(null);
    this.editingName.set(true);
  }

  protected commitName(event: Event): void {
    if (!this.editingName()) {
      return;
    }
    this.editingName.set(false);
    const name = (event.target as HTMLInputElement).value.trim();
    if (name && name !== this.table().name) {
      void this.store.updateTable(this.table().id, { name });
    }
  }

  // --- inline column name ---

  protected startEditColumn(event: Event, column: ColumnModel): void {
    event.stopPropagation();
    if (!this.editable()) {
      return;
    }
    this.editingName.set(false);
    this.editingColumnId.set(column.id);
  }

  protected commitColumn(column: ColumnModel, event: Event): void {
    if (this.editingColumnId() !== column.id) {
      return;
    }
    this.editingColumnId.set(null);
    const name = (event.target as HTMLInputElement).value.trim();
    if (name && name !== column.name) {
      void this.store.updateColumn(this.table().id, column.id, { name });
    }
  }

  protected cancelInline(): void {
    this.editingName.set(false);
    this.editingColumnId.set(null);
  }

  // --- data type + constraints ---

  protected setType(column: ColumnModel, name: string): void {
    if (!this.editable()) {
      return;
    }
    const length = name === 'VARCHAR' ? (column.dataType.length ?? 255) : undefined;
    void this.store.updateColumn(this.table().id, column.id, { dataType: { name, length } });
  }

  protected setLength(column: ColumnModel, event: Event): void {
    if (!this.editable()) {
      return;
    }
    const raw = Number((event.target as HTMLInputElement).value);
    const length = Number.isFinite(raw) && raw > 0 ? raw : undefined;
    void this.store.updateColumn(this.table().id, column.id, {
      dataType: { name: column.dataType.name, length },
    });
  }

  protected togglePk(column: ColumnModel): void {
    this.editColumn(column, { isPrimaryKey: !column.isPrimaryKey });
  }

  protected toggleNotNull(column: ColumnModel): void {
    this.editColumn(column, { isNullable: !column.isNullable });
  }

  protected toggleUnique(column: ColumnModel): void {
    this.editColumn(column, { isUnique: !column.isUnique });
  }

  protected toggleAuto(column: ColumnModel): void {
    this.editColumn(column, { isAutoIncrement: !column.isAutoIncrement });
  }

  private editColumn(column: ColumnModel, patch: UpdateColumnDto): void {
    if (!this.editable()) {
      return;
    }
    void this.store.updateColumn(this.table().id, column.id, patch);
  }

  // --- add / delete ---

  protected addColumn(): void {
    if (!this.editable()) {
      return;
    }
    const names = new Set(this.table().columns.map((c) => c.name));
    let i = this.table().columns.length + 1;
    let name = `column_${i}`;
    while (names.has(name)) {
      i += 1;
      name = `column_${i}`;
    }
    void this.store.addColumn(this.table().id, { name, dataType: { name: 'INT' } });
  }

  protected deleteColumn(column: ColumnModel): void {
    if (!this.editable()) {
      return;
    }
    void this.store.deleteColumn(this.table().id, column.id);
  }

  protected deleteTable(): void {
    if (!this.editable()) {
      return;
    }
    void this.store.deleteTable(this.table().id);
  }
}
