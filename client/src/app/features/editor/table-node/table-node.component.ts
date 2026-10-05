import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  DATA_TYPE_NAMES,
  type ColumnModel,
  type TableModel,
  type UpdateColumnDto,
} from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import { ProjectStore } from '../../../stores/project.store';
import {
  HEADER_H,
  MAX_TABLE_WIDTH,
  MIN_TABLE_WIDTH,
  ROW_H,
} from '../canvas/constants/canvas.constants';
import { tableWidth } from '../canvas/helpers/node-metrics.helper';

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
  imports: [AutofocusDirective, IconComponent, PopoverTriggerDirective],
  templateUrl: './table-node.component.html',
  styleUrl: './table-node.component.scss',
  host: {
    '[style.left.px]': 'table().x',
    '[style.top.px]': 'table().y',
    '[style.width.px]': 'nodeWidth()',
    '[class.selected]': 'selected()',
    '(pointerdown)': 'nodePointerDown.emit($event)',
    '(dblclick)': 'onDblClick($event)',
  },
})
export class TableNodeComponent {
  private readonly store = inject(ProjectStore);

  readonly table = input.required<TableModel>();
  readonly selected = input<boolean>(false);
  readonly editable = input<boolean>(false);
  /** Column ids that are relationship endpoints; a non-PK one renders an FK glyph. */
  readonly fkColumnIds = input<ReadonlySet<string>>(new Set<string>());

  /** Snap a world coordinate to the grid (identity/null when grid-snap is off). */
  readonly snap = input<((n: number) => number) | null>(null);

  readonly nodePointerDown = output<PointerEvent>();
  readonly handleDown = output<HandleEvent>();
  readonly handleUp = output<HandleEvent>();

  /** Width grows to fit the widest name, matching the connector geometry. */
  protected readonly nodeWidth = computed(() => tableWidth(this.table()));
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

  // --- width resize (drag the right edge; double-click resets to auto-fit) ---

  protected onResizeDown(event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.editable() || event.button !== 0) {
      return;
    }
    const table = this.table();
    const startX = event.clientX;
    const startWidth = tableWidth(table);
    const hadWidth = table.width;
    const zoom = this.store.viewport().zoom;
    let latest = startWidth;
    const move = (e: PointerEvent): void => {
      let right = table.x + startWidth + (e.clientX - startX) / zoom;
      const snap = this.snap();
      if (snap && !e.altKey) {
        right = snap(right);
      }
      latest = Math.round(Math.min(MAX_TABLE_WIDTH, Math.max(MIN_TABLE_WIDTH, right - table.x)));
      this.store.setTableWidthLocal(table.id, latest);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (latest !== startWidth) {
        void this.store.updateTable(table.id, { width: latest });
      } else {
        this.store.setTableWidthLocal(table.id, hadWidth);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  protected resetWidth(event: Event): void {
    event.stopPropagation();
    if (!this.editable() || !this.table().width) {
      return;
    }
    this.store.setTableWidthLocal(this.table().id, undefined);
    void this.store.updateTable(this.table().id, { width: 0 });
  }

  // --- connect handles (delegated to the parent canvas) ---

  protected onHandleDown(event: PointerEvent, columnId: string): void {
    event.stopPropagation();
    this.handleDown.emit({ event, columnId });
  }

  protected onHandleUp(event: PointerEvent, columnId: string): void {
    this.handleUp.emit({ event, columnId });
  }

  // --- inline table name ---

  /**
   * Double-clicking a grouped table that isn't yet "entered" steps into its group
   * (selecting just this table) instead of starting an edit. True when it did.
   */
  private enterGroupInstead(event: Event): boolean {
    event.stopPropagation();
    const gid = this.store.groupIdOf(this.table().id);
    if (!gid || gid === this.store.enteredGroupId()) {
      return false;
    }
    this.store.enterGroup('table', this.table().id);
    return true;
  }

  protected onDblClick(event: Event): void {
    this.enterGroupInstead(event);
  }

  protected startEditName(event: Event): void {
    if (this.enterGroupInstead(event) || !this.editable()) {
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
    if (this.enterGroupInstead(event) || !this.editable()) {
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
