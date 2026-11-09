import { Injectable, computed, inject, signal } from '@angular/core';
import { ProjectStore } from '../../stores/project.store';
import {
  type CellStyle,
  type GridData,
  type GridEdit,
  cellKey,
  cellOrigin,
  deleteCol,
  expandToMerges,
  mergeAt,
  mergeBlock,
  unmergeBlock,
  deleteRow,
  dragBorder,
  gridInPixels,
  gridSizes,
  insertCol,
  insertRow,
  parseGrid,
  serializeGrid,
} from '../../features/editor/canvas/helpers/grid-table.helper';
import type { GridBorders } from '@devdesigner/shared';
import { gridRowNeeds } from '../../features/editor/canvas/helpers/shape-render.helper';

export interface GridCellRef {
  id: string;
  row: number;
  col: number;
}

/** A rectangular block of selected cells (inclusive, normalized). */
export interface GridRange {
  id: string;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export type GridStructureAction = 'addCol' | 'delCol' | 'addRow' | 'delRow';

/**
 * State + actions for spreadsheet-style `grid` elements, shared by the canvas
 * layer (border drags, +/- controls, cell highlight), the editor (cell selection
 * and editing) and the floating toolbar (cell styling).
 */
@Injectable({ providedIn: 'root' })
export class GridTableService {
  private readonly store = inject(ProjectStore);

  /** Cell selection: the anchor (first clicked) and the cell the range extends to. */
  private readonly anchor = signal<GridCellRef | null>(null);
  private readonly focus = signal<GridCellRef | null>(null);

  /** The selected cell block, while its table is the sole selection. */
  readonly range = computed<GridRange | null>(() => {
    const a = this.anchor();
    const f = this.focus();
    const ids = this.store.selectedElementIds();
    if (!a || !f || a.id !== f.id || ids.length !== 1 || ids[0] !== a.id) {
      return null;
    }
    const el = this.grid(a.id);
    if (!el) {
      return null;
    }
    const g = parseGrid(el.text);
    const clampR = (n: number): number => Math.max(0, Math.min(n, g.rows.length - 1));
    const clampC = (n: number): number => Math.max(0, Math.min(n, g.cols.length - 1));
    // A selection always covers whole merged blocks.
    const block = expandToMerges(g, {
      r0: clampR(Math.min(a.row, f.row)),
      r1: clampR(Math.max(a.row, f.row)),
      c0: clampC(Math.min(a.col, f.col)),
      c1: clampC(Math.max(a.col, f.col)),
    });
    return { id: a.id, ...block };
  });

  /** The selection spans more than one (unmerged) cell, so it can be merged. */
  readonly canMerge = computed(() => {
    const r = this.range();
    const el = r && this.grid(r.id);
    if (!r || !el) return false;
    const m = mergeAt(parseGrid(el.text), r.r0, r.c0);
    const whole = !!m && m.rs === r.r1 - r.r0 + 1 && m.cs === r.c1 - r.c0 + 1;
    return (r.r1 > r.r0 || r.c1 > r.c0) && !whole;
  });

  /** The selection contains a merged block that can be split. */
  readonly canUnmerge = computed(() => {
    const r = this.range();
    const el = r && this.grid(r.id);
    if (!r || !el) return false;
    const g = parseGrid(el.text);
    return (g.merges ?? []).some(
      (m) => m.r >= r.r0 && m.r <= r.r1 && m.c >= r.c0 && m.c <= r.c1,
    );
  });

  /** The anchor cell's style (what the toolbar shows while cells are selected). */
  readonly anchorStyle = computed<CellStyle | null>(() => {
    const r = this.range();
    const a = this.anchor();
    const el = r && this.grid(r.id);
    if (!r || !a || !el) {
      return null;
    }
    const g = parseGrid(el.text);
    const st = g.styles?.[cellKey(a.row, a.col)] ?? {};
    // A header cell is bold unless overridden.
    return g.header && a.row === 0 && st.bold === undefined ? { ...st, bold: true } : st;
  });

  /** The cell open in the inline editor. */
  readonly editingCell = signal<GridCellRef | null>(null);
  /** The element's state before the edit (for revert on Escape and undo). */
  private editOriginal: { text: string; width: number; height: number } | null = null;

  private grid(id: string) {
    const el = this.store.elements().find((e) => e.id === id && e.type === 'grid');
    return el ?? null;
  }

  // --- cell selection ---

  /** Select one cell, or with `extend` grow the selection from the anchor to it. */
  selectCell(cell: GridCellRef, extend = false): void {
    const a = this.anchor();
    if (!extend || !a || a.id !== cell.id) {
      this.anchor.set(cell);
    }
    this.focus.set(cell);
  }

  clearCellSelection(): void {
    this.anchor.set(null);
    this.focus.set(null);
  }

  /** Merge the selected cells into one (their texts are joined). */
  async mergeSelected(): Promise<void> {
    const r = this.range();
    const el = r && this.grid(r.id);
    if (!r || !el || !this.store.canEdit()) return;
    const g = parseGrid(el.text);
    await this.store.updateElement(r.id, { text: serializeGrid(mergeBlock(g, r)) });
    this.selectCell({ id: r.id, row: r.r0, col: r.c0 });
  }

  /** Split merged cells in the selection back into single cells. */
  async unmergeSelected(): Promise<void> {
    const r = this.range();
    const el = r && this.grid(r.id);
    if (!r || !el || !this.store.canEdit()) return;
    const g = parseGrid(el.text);
    await this.store.updateElement(r.id, { text: serializeGrid(unmergeBlock(g, r)) });
  }

  /** Clear the text of every selected cell (Delete/Backspace on a cell selection). */
  async clearSelectedText(): Promise<void> {
    const r = this.range();
    const el = r && this.grid(r.id);
    if (!r || !el || !this.store.canEdit()) return;
    const g = parseGrid(el.text);
    for (let row = r.r0; row <= r.r1; row += 1) {
      for (let col = r.c0; col <= r.c1; col += 1) {
        g.cells[row][col] = '';
      }
    }
    await this.store.updateElement(r.id, { text: serializeGrid(g) });
  }

  /** Apply a style override to every selected cell (undefined values clear that override). */
  async styleSelected(patch: Partial<CellStyle>): Promise<boolean> {
    const r = this.range();
    const el = r && this.grid(r.id);
    if (!r || !el) return false;
    if (!this.store.canEdit()) return true;
    const g = parseGrid(el.text);
    const styles = { ...(g.styles ?? {}) };
    for (let row = r.r0; row <= r.r1; row += 1) {
      for (let col = r.c0; col <= r.c1; col += 1) {
        const k = cellKey(row, col);
        const next: CellStyle = { ...styles[k], ...patch };
        for (const key of Object.keys(next) as (keyof CellStyle)[]) {
          if (next[key] === undefined) delete next[key];
        }
        if (Object.keys(next).length) styles[k] = next;
        else delete styles[k];
      }
    }
    await this.store.updateElement(r.id, { text: serializeGrid({ ...g, styles }) });
    return true;
  }

  // --- structure ---

  /** Insert at / delete a column or row by index (the +/- controls on the table's edges). */
  async structure(id: string, action: GridStructureAction, index: number): Promise<void> {
    if (this.editingCell()) {
      this.endEdit();
    }
    const el = this.grid(id);
    if (!el || !this.store.canEdit()) return;
    const edit: GridEdit | null =
      action === 'addCol'
        ? insertCol(el, index)
        : action === 'addRow'
          ? insertRow(el, index)
          : action === 'delCol'
            ? deleteCol(el, index)
            : deleteRow(el, index);
    if (!edit) return;
    // Inserting on the left/top edge grows the table outward there; the other edge stays put.
    const shift =
      index === 0 && action === 'addCol'
        ? { x: el.x - (edit.width - el.width) }
        : index === 0 && action === 'addRow'
          ? { y: el.y - (edit.height - el.height) }
          : {};
    this.clearCellSelection();
    await this.store.updateElement(id, {
      ...shift,
      text: serializeGrid(edit.grid),
      width: edit.width,
      height: edit.height,
    });
  }

  async toggleHeader(ids: string[]): Promise<void> {
    await this.store.batchHistory(async () => {
      for (const id of ids) {
        const el = this.grid(id);
        if (!el) continue;
        const g = parseGrid(el.text);
        await this.store.updateElement(id, { text: serializeGrid({ ...g, header: !g.header }) });
      }
    });
  }

  /** Choose which borders the selected grids draw (one undo step). */
  async setBorders(ids: string[], borders: GridBorders): Promise<void> {
    await this.store.batchHistory(async () => {
      for (const id of ids) {
        const el = this.grid(id);
        if (!el) continue;
        const g = parseGrid(el.text);
        await this.store.updateElement(id, { text: serializeGrid({ ...g, borders }) });
      }
    });
  }

  // --- cell editing ---

  beginEdit(cell: GridCellRef): void {
    const el = this.grid(cell.id);
    if (!el || !this.store.canEdit()) return;
    this.editOriginal = { text: el.text ?? '', width: el.width, height: el.height };
    this.selectCell(cell);
    this.editingCell.set(cell);
  }

  /** Live-update the edited cell, growing its row when the text needs more room. */
  setEditingText(value: string): void {
    const cell = this.editingCell();
    const el = cell && this.grid(cell.id);
    if (!cell || !el) return;
    const g = gridInPixels(el);
    if (!g.cells[cell.row] || g.cells[cell.row][cell.col] === undefined) return;
    g.cells[cell.row][cell.col] = value;
    const need = gridRowNeeds(el, g, g.cols)[cell.row];
    if (need > g.rows[cell.row]) {
      g.rows[cell.row] = need;
    }
    this.store.patchElementLocal(cell.id, {
      text: serializeGrid(g),
      height: g.rows.reduce((a, b) => a + b, 0),
    });
  }

  /** Close the cell editor, persisting (or with `revert`, discarding) the edit. */
  endEdit(revert = false): void {
    const cell = this.editingCell();
    const before = this.editOriginal;
    this.editingCell.set(null);
    this.editOriginal = null;
    const el = cell && this.grid(cell.id);
    if (!cell || !el || !before) return;
    if (revert) {
      this.store.patchElementLocal(cell.id, before);
      return;
    }
    if (el.text === before.text && el.height === before.height) return;
    void this.store.commitElementGeometry(cell.id, before, {
      text: el.text ?? '',
      width: el.width,
      height: el.height,
    });
  }

  /** Move the editor to a neighbouring cell (Tab / Enter navigation), adding a row past the end. */
  async moveEdit(dRow: number, dCol: number): Promise<void> {
    const cell = this.editingCell();
    if (!cell) return;
    this.endEdit();
    let el = this.grid(cell.id);
    if (!el) return;
    let g: GridData = parseGrid(el.text);
    // Step past the whole merged block the editor is leaving.
    const here = mergeAt(g, cell.row, cell.col);
    let row = cell.row;
    let col = cell.col + (dCol > 0 ? (here?.cs ?? 1) : dCol);
    if (dRow > 0) dRow = here?.rs ?? 1;
    if (col >= g.cols.length) {
      col = 0;
      row += 1;
    } else if (col < 0) {
      col = g.cols.length - 1;
      row -= 1;
    }
    row += dRow;
    if (row < 0) return;
    if (row >= g.rows.length) {
      const edit = insertRow(el, g.rows.length);
      await this.store.updateElement(cell.id, {
        text: serializeGrid(edit.grid),
        width: edit.width,
        height: edit.height,
      });
      el = this.grid(cell.id);
      if (!el) return;
      g = parseGrid(el.text);
      row = g.rows.length - 1;
    }
    const origin = cellOrigin(g, row, col);
    this.beginEdit({ id: cell.id, ...origin });
  }

  // --- border drags ---

  /** Drag a column/row border (live), committing one undoable change on release. */
  beginBorderDrag(id: string, axis: 'col' | 'row', index: number, event: PointerEvent): void {
    if (this.editingCell()) {
      this.endEdit();
    }
    const el = this.grid(id);
    if (!el || !this.store.canEdit()) return;
    const start = gridInPixels(el);
    const before = { text: el.text ?? '', width: el.width, height: el.height };
    const origin = axis === 'col' ? event.clientX : event.clientY;
    const zoom = this.store.viewport().zoom || 1;
    const move = (e: PointerEvent): void => {
      const delta = ((axis === 'col' ? e.clientX : e.clientY) - origin) / zoom;
      const edit = dragBorder(start, axis, index, delta);
      this.store.patchElementLocal(id, {
        text: serializeGrid(edit.grid),
        width: edit.width,
        height: edit.height,
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const now = this.grid(id);
      if (
        !now ||
        (now.text === before.text && now.width === before.width && now.height === before.height)
      ) {
        return;
      }
      void this.store.commitElementGeometry(id, before, {
        text: now.text ?? '',
        width: now.width,
        height: now.height,
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Column/row pixel sizes of a grid element (for overlay placement). */
  sizes(id: string): { cols: number[]; rows: number[] } | null {
    const el = this.grid(id);
    return el ? gridSizes(parseGrid(el.text), el.width, el.height) : null;
  }
}
