import type { CanvasElementModel } from '@devdesigner/shared';
import type { GridTableView, TextBlockView } from '../../models/shape-view.model';
import { GRID_CELL_PAD, cellKey, edges, gridSizes, mergeAt, parseGrid, type GridData } from '../grid-table.helper';
import { LruCache } from '../../../../shared/helpers/lru';
import { fontStack } from './fonts';
import { SURFACE_FILL, contrastSafe, type ThemeColors } from './theme-colors';
import { LINE_HEIGHT, layoutTextBlock, measureWidth, wrapParagraph } from './text-layout';
import { clipKey } from './shape-primitives';

/** Grid text -> parsed grid, for drawing only (never mutate the result). */
const gridCache = new LruCache<string, GridData>(300);

/** Typography shared by grid cells (renderer, auto-grow and the cell editor). */
export function gridFont(element: CanvasElementModel): {
   fontSize: number;
   family: string;
   lineHeight: number;
} {
   const fontSize = element.fontSize ?? 14;
   return {
      fontSize,
      family: fontStack(element.fontFamily),
      lineHeight: fontSize * (element.lineHeight ?? LINE_HEIGHT),
   };
}

/**
 * Height each row needs so its tallest cell's wrapped text fits (world px).
 * Used to grow rows while typing; rows never shrink automatically.
 */
export function gridRowNeeds(element: CanvasElementModel, g: GridData, colPx: number[]): number[] {
   const f = gridFont(element);
   const textHeight = (r: number, c: number, width: number): number => {
      const text = g.cells[r][c];
      const st = g.styles?.[cellKey(r, c)] ?? {};
      const bold = st.bold ?? (g.header && r === 0 ? true : !!element.bold);
      const italic = st.italic ?? !!element.italic;
      const css = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${f.fontSize}px ${f.family}`;
      const max = Math.max(8, width - GRID_CELL_PAD * 2);
      const n = text.split('\n').reduce((acc, para) => acc + wrapParagraph(para, max, css).length, 0);
      return Math.max(1, n) * f.lineHeight + GRID_CELL_PAD * 2;
   };
   const needs = g.cells.map((row, r) => {
      let need = f.lineHeight + GRID_CELL_PAD * 2;
      row.forEach((_, c) => {
         const m = mergeAt(g, r, c);
         if (m && (m.r !== r || m.c !== c || m.rs > 1)) {
            return; // covered cells, and tall merges (handled below)
         }
         const width = m ? colPx.slice(c, c + m.cs).reduce((a, b) => a + b, 0) : (colPx[c] ?? 0);
         need = Math.max(need, textHeight(r, c, width));
      });
      return need;
   });
   // A merge spanning rows: whatever its text needs beyond its other rows goes on its last row.
   for (const m of g.merges ?? []) {
      if (m.rs < 2) continue;
      const width = colPx.slice(m.c, m.c + m.cs).reduce((a, b) => a + b, 0);
      const others = g.rows.slice(m.r, m.r + m.rs - 1).reduce((a, b) => a + b, 0);
      const last = m.r + m.rs - 1;
      needs[last] = Math.max(needs[last], textHeight(m.r, m.c, width) - others);
   }
   return needs;
}

/**
 * Width column `col` needs so none of its cells wraps (world px): the widest line of
 * any cell that sits in that column alone. Merged blocks spanning it don't count.
 */
export function gridColNeed(element: CanvasElementModel, g: GridData, col: number): number {
   const f = gridFont(element);
   let need = 0;
   g.cells.forEach((row, r) => {
      const m = mergeAt(g, r, col);
      if (m && (m.cs > 1 || m.r !== r || m.c !== col)) return;
      const st = g.styles?.[cellKey(r, col)] ?? {};
      const bold = st.bold ?? (g.header && r === 0 ? true : !!element.bold);
      const italic = st.italic ?? !!element.italic;
      const css = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${f.fontSize}px ${f.family}`;
      for (const line of (row[col] ?? '').split('\n')) need = Math.max(need, measureWidth(line, css));
   });
   return Math.ceil(need) + GRID_CELL_PAD * 2 + 2;
}

export function gridTableView(
   element: CanvasElementModel,
   theme: ThemeColors | undefined,
   stroke: string,
   fill: string
): GridTableView {
   const text = element.text ?? '';
   const g = gridCache.getOrSet(text, () => parseGrid(text));
   const { cols, rows } = gridSizes(g, element.width, element.height);
   const colEdges = edges(cols).map((e) => element.x + e);
   const rowEdges = edges(rows).map((e) => element.y + e);
   const x0 = element.x;
   const y0 = element.y;
   // Inner borders, broken where a merged block spans across them.
   const lines: GridTableView['lines'] = [];
   const inMerge = (r: number, c: number): ReturnType<typeof mergeAt> => mergeAt(g, r, c);
   for (let i = 1; i < colEdges.length - 1; i += 1) {
      let start: number | null = null;
      for (let r = 0; r <= rows.length; r += 1) {
         const m = r < rows.length ? inMerge(r, i - 1) : null;
         const open = r < rows.length && !(m && m.c + m.cs - 1 >= i);
         if (open && start === null) start = r;
         if (!open && start !== null) {
            lines.push({ x1: colEdges[i], y1: rowEdges[start], x2: colEdges[i], y2: rowEdges[r] });
            start = null;
         }
      }
   }
   for (let i = 1; i < rowEdges.length - 1; i += 1) {
      let start: number | null = null;
      for (let c = 0; c <= cols.length; c += 1) {
         const m = c < cols.length ? inMerge(i - 1, c) : null;
         const open = c < cols.length && !(m && m.r + m.rs - 1 >= i);
         if (open && start === null) start = c;
         if (!open && start !== null) {
            lines.push({ x1: colEdges[start], y1: rowEdges[i], x2: colEdges[c], y2: rowEdges[i] });
            start = null;
         }
      }
   }
   const textColor = contrastSafe(element.strokeColor, theme);
   const cells: TextBlockView[] = [];
   const fills: GridTableView['fills'] = [];
   g.cells.forEach((row, r) =>
      row.forEach((text, c) => {
         const m = mergeAt(g, r, c);
         if (m && (m.r !== r || m.c !== c)) {
            return; // covered by a merge: the origin draws for the whole block
         }
         const rEnd = m ? r + m.rs : r + 1;
         const cEnd = m ? c + m.cs : c + 1;
         const st = g.styles?.[cellKey(r, c)] ?? {};
         const box = {
            x: colEdges[c],
            y: rowEdges[r],
            width: colEdges[cEnd] - colEdges[c],
            height: rowEdges[rEnd] - rowEdges[r],
         };
         if (st.fill) {
            fills.push({ ...box, fill: st.fill === SURFACE_FILL ? (theme?.surface ?? '#ffffff') : st.fill });
         }
         if (!text) {
            return;
         }
         const isHeader = g.header && r === 0;
         cells.push(
            layoutTextBlock(text, box, {
               fontSize: element.fontSize ?? 14,
               fontFamilyKey: element.fontFamily,
               fontWeight: (st.bold ?? (isHeader || !!element.bold)) ? 700 : 400,
               italic: st.italic ?? element.italic,
               color: st.color ? contrastSafe(st.color, theme) : textColor,
               align: st.align ?? element.textAlign ?? 'left',
               vAlign: st.vAlign ?? element.verticalAlign ?? 'top',
               padding: GRID_CELL_PAD,
               wrap: true,
               lineHeight: element.lineHeight,
            })
         );
      })
   );
   const mode = g.borders ?? 'all';
   const shownLines =
      mode === 'all' || mode === 'inner' ? lines : mode === 'rows' ? lines.filter((l) => l.y1 === l.y2) : [];
   return {
      rect: { x: x0, y: y0, width: element.width, height: element.height, rx: element.cornerRadius ?? 4 },
      background: fill,
      // The header row is marked by bold text only, no tinted band.
      header: null,
      lines: shownLines,
      outline: mode === 'all' || mode === 'outer' || mode === 'rows',
      cells,
      fills,
      clipId: `grid-clip-${element.id}-${clipKey(element)}`,
      colEdges,
      rowEdges,
   };
}
