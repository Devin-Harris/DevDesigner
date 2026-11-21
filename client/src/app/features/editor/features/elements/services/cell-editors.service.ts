import { type ElementRef, computed, effect, inject, Injectable, type Signal } from '@angular/core';
import { themeColorCss } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import { CodeActionsService } from '../../../services/code-actions.service';
import { GridTableService } from '../../../services/grid-table.service';
import { GRID_CELL_PAD, edges as gridEdges, gridSizes, mergeAt, parseGrid } from '../../../helpers/grid-table.helper';
import { CODE_FONT_SIZE, codeDotsWidth, codeHeaderHeight, codeTitleSize, gridFont, SURFACE_FILL } from '../../../helpers/render';
import { CanvasViewService } from '../../../services/canvas-view.service';
/** What the cell editors read from the editor entry; the entry wires it with `connect`. */
export interface CellEditorsHost {
   /** The grid cell editor's textarea, while it is open. */
   readonly gridCellArea: Signal<ElementRef<HTMLTextAreaElement> | undefined>;
}

/** The grid-table cell editor and the code block's file-name editor overlays. */
@Injectable()
export class CellEditorsService {
   private readonly store = inject(ProjectStore);
   private readonly codeActions = inject(CodeActionsService);
   private readonly grids = inject(GridTableService);
   private readonly canvasView = inject(CanvasViewService);
   private host!: CellEditorsHost;

   connect(host: CellEditorsHost): void {
      this.host = host;
   }

   /** Screen-space placement of the inline editor over a grid table's cell. */
   readonly gridCellEditor$ = computed(() => {
      const cell = this.grids.editingCell();
      const el = cell ? this.store.elements().find((e) => e.id === cell.id && e.type === 'grid') : null;
      if (!cell || !el) {
         return null;
      }
      const g = parseGrid(el.text);
      if (cell.row >= g.rows.length || cell.col >= g.cols.length) {
         return null;
      }
      const { cols, rows } = gridSizes(g, el.width, el.height);
      const ce = gridEdges(cols);
      const re = gridEdges(rows);
      const v = this.canvasView.viewportFor(el.id);
      const z = v.zoom;
      const f = gridFont(el);
      const isHeader = g.header && cell.row === 0;
      const span = mergeAt(g, cell.row, cell.col);
      const st = g.styles?.[`${cell.row},${cell.col}`] ?? {};
      const bg =
         (st.fill === SURFACE_FILL ? undefined : st.fill) ??
         this.canvasView.shapeViews().find((s) => s.id === el.id)?.grid?.background;
      return {
         key: `${cell.id}:${cell.row}:${cell.col}`,
         left: (el.x + ce[cell.col]) * z + v.x,
         top: (el.y + re[cell.row]) * z + v.y,
         width: (ce[cell.col + (span?.cs ?? 1)] - ce[cell.col]) * z,
         height: (re[cell.row + (span?.rs ?? 1)] - re[cell.row]) * z,
         fontSize: f.fontSize * z,
         fontFamily: f.family,
         fontWeight: (st.bold ?? (isHeader || !!el.bold)) ? 700 : 400,
         italic: st.italic ?? !!el.italic,
         lineHeight: f.lineHeight * z,
         padding: GRID_CELL_PAD * z,
         color: st.color ?? themeColorCss(el.strokeColor) ?? el.strokeColor,
         align: st.align ?? el.textAlign ?? 'left',
         vAlign: st.vAlign ?? el.verticalAlign ?? 'top',
         background: bg && bg !== 'none' && !bg.startsWith('url(') ? bg : 'var(--dd-surface)',
         value: g.cells[cell.row][cell.col],
      };
   });

   private gridCellKey: string | null = null;

   /** Load the cell's text into the (reused) editor and focus it whenever the edited cell changes. */
   private readonly gridCellFocus = effect(() => this.syncGridCellArea());

   private syncGridCellArea(): void {
      const gc = this.gridCellEditor$();
      const area = this.host.gridCellArea()?.nativeElement;
      if (!gc || !area) {
         this.gridCellKey = null;
         return;
      }
      if (gc.key === this.gridCellKey) {
         this.alignGridCellArea();
         return;
      }
      this.gridCellKey = gc.key;
      area.value = gc.value;
      this.alignGridCellArea();
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
   }

   /**
    * A textarea always lays text out from the top, so mimic the cell's vertical
    * alignment (middle / bottom) by growing the top padding to the leftover space.
    * Re-run on every keystroke so the text stays where the rendered cell shows it.
    */
   alignGridCellArea(): void {
      const gc = this.gridCellEditor$();
      const area = this.host.gridCellArea()?.nativeElement;
      if (!gc || !area) {
         return;
      }
      area.style.paddingTop = `${gc.padding}px`;
      if (gc.vAlign === 'top') {
         return;
      }
      // Collapse the box for a moment: scrollHeight is never less than the box height,
      // so this is the only way to read the text's own height (+ both paddings).
      const boxHeight = area.style.height;
      area.style.height = '0px';
      const text = area.scrollHeight - gc.padding * 2;
      area.style.height = boxHeight;
      const free = Math.max(0, gc.height - gc.padding * 2 - text);
      const extra = gc.vAlign === 'middle' ? free / 2 : free;
      area.style.paddingTop = `${gc.padding + extra}px`;
   }

   /** Keys inside a grid cell editor: Tab/Shift+Tab move across, Enter moves down (Shift+Enter = newline), Esc reverts. */
   onGridCellKeydown(event: KeyboardEvent): void {
      if (event.isComposing) {
         return;
      }
      if (event.key === 'Escape') {
         event.preventDefault();
         this.grids.endEdit(true);
      } else if (event.key === 'Tab') {
         event.preventDefault();
         // Swap the editor's text right away so keys typed before the next render land in the new cell.
         void this.grids.moveEdit(0, event.shiftKey ? -1 : 1).then(() => this.syncGridCellArea());
         this.syncGridCellArea();
      } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
         event.preventDefault();
         void this.grids.moveEdit(1, 0).then(() => this.syncGridCellArea());
         this.syncGridCellArea();
      }
   }

   onGridCellBlur(key: string): void {
      const cell = this.grids.editingCell();
      // Moving to another cell re-creates the editor; only a real blur of this cell ends it.
      if (cell && `${cell.id}:${cell.row}:${cell.col}` === key && document.hasFocus()) {
         this.grids.endEdit();
      }
   }

   /** Screen-space placement of the inline file-name input over a code block's title bar. */
   readonly fileNameEditor$ = computed(() => {
      const id = this.codeActions.fileNameEditId();
      const el = id ? this.store.elements().find((e) => e.id === id && e.type === 'code') : null;
      if (!el || !this.store.canEdit()) {
         return null;
      }
      const v = this.store.viewport();
      const z = v.zoom;
      const fontSize = el.fontSize ?? CODE_FONT_SIZE;
      // With no name yet there is no bar; the input shows where it will appear.
      const height = codeHeaderHeight(fontSize);
      const dots = codeDotsWidth(fontSize);
      const view = this.canvasView.shapeViews().find((s) => s.id === el.id)?.code;
      return {
         id: el.id,
         value: el.fileName ?? '',
         // Inset from both sides by the dot cluster's width: the dots stay visible and
         // the centered title keeps its place.
         left: (el.x + dots) * z + v.x,
         top: el.y * z + v.y,
         width: Math.max(40, el.width - dots * 2) * z,
         height: height * z,
         fontSize: codeTitleSize(fontSize) * z,
         // The card's own surface, so the title beneath doesn't show through the input.
         background: view?.background ?? null,
         color: view?.header.color ?? null,
      };
   });

   onFileNameKeydown(event: KeyboardEvent, id: string): void {
      const input = event.target as HTMLInputElement;
      if (event.key === 'Enter') {
         event.preventDefault();
         input.blur();
      } else if (event.key === 'Escape') {
         event.preventDefault();
         // Revert so the blur below commits nothing.
         input.value = this.store.elements().find((e) => e.id === id)?.fileName ?? '';
         input.blur();
      }
      event.stopPropagation();
   }

   commitFileName(id: string, value: string): void {
      this.codeActions.fileNameEditId.set(null);
      void this.codeActions.setFileName(id, value);
   }
}
