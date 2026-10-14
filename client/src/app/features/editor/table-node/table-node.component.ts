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
  isNumericType,
  type ColumnModel,
  type IndexModel,
  type TableModel,
  type UpdateColumnDto,
  HEADER_SWATCHES,
  SOFT_SWATCHES,
  isLightFill,
  isSwatchColor,
} from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import { ProjectStore } from '../../../stores/project.store';
import {
  HEADER_H,
  MAX_TABLE_SCALE,
  MIN_TABLE_SCALE,
  ROW_H,
} from '../canvas/constants/canvas.constants';
import {
  nodeHeight,
  tableBaseWidth,
  tableScale,
} from '../canvas/helpers/node-metrics.helper';

export interface HandleEvent {
  event: PointerEvent;
  columnId: string;
  /** Which edge handle was used; new and re-pointed lines attach there. */
  side: 'left' | 'right';
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
    '[style.transform]': 'transform()',
    '[style.--inv-scale]': 'inverseScale()',
    '[class.selected]': 'selected()',
    '(pointerdown)': 'nodePointerDown.emit($event)',
    '(dblclick)': 'onDblClick($event)',
  },
})
export class TableNodeComponent {
  private readonly store = inject(ProjectStore);

  /** True for custom pale header colors, which take dark text instead of white. Stock swatches use the theme text. */
  protected readonly isLight = (c: string | undefined | null): boolean => !isSwatchColor(c) && isLightFill(c);
  protected readonly isSwatch = isSwatchColor;

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

  /** Natural width: grows to fit the widest name; the scale is applied as a transform. */
  protected readonly nodeWidth = computed(() => tableBaseWidth(this.table()));
  private readonly scale = computed(() => tableScale(this.table()));
  protected readonly transform = computed(() =>
    this.scale() === 1 ? null : `scale(${this.scale()})`,
  );
  /** Counter-scale so the corner handles keep a constant on-screen size. */
  protected readonly inverseScale = computed(() => 1 / this.scale());
  protected readonly headerH = HEADER_H;
  protected readonly rowH = ROW_H;
  protected readonly dataTypeNames = DATA_TYPE_NAMES;
  protected readonly isNumeric = isNumericType;

  // --- unique keys ---

  /** The table's unique indexes (single- or multi-column). */
  protected readonly uniqueIndexes = computed(() =>
    (this.table().indexes ?? []).filter((ix) => ix.isUnique),
  );

  /** Column id -> the unique indexes it belongs to. */
  protected readonly uniqueSets = computed(() => {
    const map = new Map<string, IndexModel[]>();
    for (const ix of this.uniqueIndexes()) {
      for (const id of ix.columnIds) {
        map.set(id, [...(map.get(id) ?? []), ix]);
      }
    }
    return map;
  });

  /** Column whose unique key is hovered: its sets' members light up. */
  protected readonly hoverUnique = signal<string | null>(null);

  private readonly hoveredSets = computed(() => {
    const id = this.hoverUnique();
    return id ? (this.uniqueSets().get(id) ?? []) : [];
  });

  protected readonly uniqueHighlight = computed(
    () => new Set(this.hoveredSets().flatMap((ix) => ix.columnIds)),
  );

  /**
   * One bracket per hovered multi-column set, each in its own lane in the left
   * gutter so a column in several sets shows every grouping without overlap.
   */
  protected readonly uniqueBrackets = computed(() => {
    const order = new Map(this.table().columns.map((c, i) => [c.id, i] as const));
    return this.hoveredSets()
      .filter((ix) => ix.columnIds.length > 1)
      .map((ix, lane) => {
        const rows = ix.columnIds
          .map((id) => order.get(id))
          .filter((i): i is number => i !== undefined)
          .sort((p, q) => p - q);
        const first = rows[0] ?? 0;
        const top = HEADER_H + first * ROW_H + ROW_H / 2;
        return {
          id: ix.id,
          name: `${ix.name}: ${this.indexColumnNames(ix)}`,
          top,
          height: ((rows[rows.length - 1] ?? first) - first) * ROW_H,
          left: 2 + lane * 5,
          dots: rows.map((i) => (i - first) * ROW_H),
        };
      });
  });

  /** Tooltip for the red unique key, or null when the column isn't unique. */
  protected uniqueTitle(column: ColumnModel): string | null {
    const sets = this.uniqueSets().get(column.id) ?? [];
    const lines = sets.map((ix) => `Unique ${ix.name}: ${this.indexColumnNames(ix)}`);
    if (column.isUnique && !column.isPrimaryKey) {
      lines.unshift('Unique');
    }
    return lines.length ? lines.join('\n') : null;
  }

  protected indexColumnNames(ix: IndexModel): string {
    const byId = new Map(this.table().columns.map((c) => [c.id, c.name] as const));
    return ix.columnIds.map((id) => byId.get(id) ?? '?').join(', ');
  }

  protected toggleIndexMember(ix: IndexModel, column: ColumnModel): void {
    if (!this.editable()) {
      return;
    }
    const tableId = this.table().id;
    const columnIds = ix.columnIds.includes(column.id)
      ? ix.columnIds.filter((id) => id !== column.id)
      : [...ix.columnIds, column.id];
    if (columnIds.length === 0) {
      void this.store.deleteIndex(tableId, ix.id);
    } else {
      void this.store.updateIndex(tableId, ix.id, { columnIds });
    }
  }

  /** Start a new unique set with this column; add the others from their UQ menus. */
  protected newUniqueIndex(column: ColumnModel): void {
    if (!this.editable()) {
      return;
    }
    const table = this.table();
    const taken = new Set((table.indexes ?? []).map((ix) => ix.name));
    let name = `uq_${table.name}_${column.name}`;
    for (let i = 2; taken.has(name); i += 1) {
      name = `uq_${table.name}_${column.name}_${i}`;
    }
    void this.store.addIndex(table.id, { name, columnIds: [column.id], isUnique: true });
  }
  /** Saturated header colors, then pale tints (the shared palette the MCP server also uses). */
  protected readonly headerColors = [...HEADER_SWATCHES, ...SOFT_SWATCHES];

  protected setColor(color: string): void {
    if (!this.editable()) {
      return;
    }
    void this.store.updateTable(this.table().id, { color });
  }

  protected readonly editingName = signal(false);
  protected readonly editingColumnId = signal<string | null>(null);

  // --- scale (drag a corner of the selection box; the opposite corner stays put) ---

  protected readonly corners = ['nw', 'ne', 'sw', 'se'] as const;

  protected onScaleDown(event: PointerEvent, corner: 'nw' | 'ne' | 'sw' | 'se'): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.editable() || event.button !== 0) {
      return;
    }
    const table = this.table();
    const startScale = tableScale(table);
    const baseW = tableBaseWidth(table);
    const baseH = nodeHeight(table.columns.length);
    const west = corner === 'nw' || corner === 'sw';
    const north = corner === 'nw' || corner === 'ne';
    // World position of the fixed (opposite) corner and the grabbed corner.
    const fx = west ? table.x + baseW * startScale : table.x;
    const fy = north ? table.y + baseH * startScale : table.y;
    const gx = west ? table.x : table.x + baseW * startScale;
    const gy = north ? table.y : table.y + baseH * startScale;
    const vx = gx - fx;
    const vy = gy - fy;
    const len2 = vx * vx + vy * vy;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const zoom = this.store.viewport().zoom;
    let latest = startScale;
    const move = (e: PointerEvent): void => {
      const px = gx + (e.clientX - startClientX) / zoom - fx;
      const py = gy + (e.clientY - startClientY) / zoom - fy;
      // Project onto the box diagonal so proportions are always preserved.
      const raw = startScale * ((px * vx + py * vy) / len2);
      latest = Math.round(Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, raw)) * 100) / 100;
      const x = west ? fx - baseW * latest : fx;
      const y = north ? fy - baseH * latest : fy;
      this.store.setTableScaleLocal(table.id, latest);
      this.store.moveTable(table.id, Math.round(x), Math.round(y));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (latest !== startScale) {
        void this.store.updateTable(table.id, { scale: latest });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Double-click a corner handle to return to natural size. */
  protected resetScale(event: Event): void {
    event.stopPropagation();
    const table = this.table();
    if (!this.editable() || tableScale(table) === 1) {
      return;
    }
    this.store.setTableScaleLocal(table.id, undefined);
    void this.store.updateTable(table.id, { scale: 1 });
  }

  // --- connect handles (delegated to the parent canvas) ---

  protected onHandleDown(event: PointerEvent, columnId: string, side: 'left' | 'right'): void {
    event.stopPropagation();
    this.handleDown.emit({ event, columnId, side });
  }

  protected onHandleUp(event: PointerEvent, columnId: string, side: 'left' | 'right'): void {
    this.handleUp.emit({ event, columnId, side });
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
    void this.store.updateColumn(this.table().id, column.id, {
      dataType: { name, length },
      ...(column.isUnsigned && !isNumericType(name) ? { isUnsigned: false } : {}),
    });
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

  protected toggleUnsigned(column: ColumnModel): void {
    this.editColumn(column, { isUnsigned: !column.isUnsigned });
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
