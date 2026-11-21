import { type ColumnModel, type TableModel, isNumericType, isSwatchColor, readableTextOn } from '@devdesigner/shared';
import { HEADER_H, ROW_H } from '../../shared/constants/canvas.constants';
import { nodeHeight, tableBaseWidth, tableScale } from '../node-metrics.helper';
import {
   CW_11,
   CW_13,
   FONT,
   PK_BG,
   PK_TEXT,
   RADIUS,
   type Theme,
   UQ_BG,
   UQ_TEXT,
   attr,
   esc,
   themed,
   truncate,
} from './diagram-svg-base.helper';

/**
 * The type-pill label, matching the canvas exactly: the type name, plus the
 * length only for VARCHAR (other args are not shown on the node).
 */
export function typeLabel(column: ColumnModel): string {
   const name = column.dataType.name;
   if (name === 'VARCHAR' && column.dataType.length) {
      return `${name}(${column.dataType.length})`;
   }
   // The canvas shows UNSIGNED as a chip; the static export folds it into the label.
   return column.isUnsigned && isNumericType(name) ? `${name} UNSIGNED` : name;
}

export interface Chip {
   label: string;
   active: boolean;
   bg: string;
   text: string;
}

/** The four constraint chips for a column, mirroring the on-canvas chip styling. */
export function columnChips(column: ColumnModel, theme: Theme): Chip[] {
   const inactive = { bg: theme.chipBg, text: theme.textMuted };
   return [
      {
         label: 'PK',
         active: column.isPrimaryKey,
         bg: column.isPrimaryKey ? PK_BG : inactive.bg,
         text: column.isPrimaryKey ? PK_TEXT : inactive.text,
      },
      {
         label: 'NN',
         active: !column.isNullable,
         bg: !column.isNullable ? theme.chipActive : inactive.bg,
         text: !column.isNullable ? theme.primary : inactive.text,
      },
      {
         label: 'UQ',
         active: column.isUnique,
         bg: column.isUnique ? UQ_BG : inactive.bg,
         text: column.isUnique ? UQ_TEXT : inactive.text,
      },
      {
         label: 'AI',
         active: column.isAutoIncrement,
         bg: column.isAutoIncrement ? theme.chipActive : inactive.bg,
         text: column.isAutoIncrement ? theme.primary : inactive.text,
      },
   ];
}

export const CHIP_W = 20;

export const CHIP_H = 16;

export const CHIP_GAP = 3;

export const CHIPS_BLOCK_W = 4 * CHIP_W + 3 * CHIP_GAP;

/** Render one table node as an SVG group at its world coordinates. */
export function renderTable(table: TableModel, theme: Theme): string {
   // Drawn at natural size inside a scaled group, so the whole node scales uniformly.
   const width = tableBaseWidth(table);
   const height = nodeHeight(table.columns.length);
   const scale = tableScale(table);
   const colored = !!table.color;
   const headerFill = themed(table.color, theme) || theme.nodeHeader;
   const headerText = colored && !isSwatchColor(table.color) ? readableTextOn(table.color!) : theme.text;

   const parts: string[] = [
      `<g transform="translate(${attr(table.x)}, ${attr(table.y)})${scale === 1 ? '' : ` scale(${attr(scale)})`}">`,
   ];

   // Node body: rounded surface with a 1px border ring (matches the box-shadow ring).
   parts.push(
      `<rect x="0.5" y="0.5" width="${attr(width - 1)}" height="${attr(height - 1)}" rx="${attr(RADIUS)}" ry="${attr(RADIUS)}" ` +
         `fill="${attr(theme.nodeSurface)}" stroke="${attr(theme.nodeBorder)}" stroke-width="1" />`
   );

   // Header band with only the top corners rounded.
   parts.push(
      `<path d="M0 ${attr(HEADER_H)} L0 ${attr(RADIUS)} Q0 0 ${attr(RADIUS)} 0 L${attr(width - RADIUS)} 0 Q${attr(width)} 0 ${attr(width)} ${attr(RADIUS)} L${attr(width)} ${attr(HEADER_H)} Z" ` +
         `fill="${attr(headerFill)}" />`
   );
   if (!colored) {
      parts.push(
         `<line x1="0" y1="${attr(HEADER_H)}" x2="${attr(width)}" y2="${attr(HEADER_H)}" stroke="${attr(theme.nodeBorder)}" stroke-width="1" />`
      );
   }
   const titleMax = Math.floor((width - 24) / CW_13);
   parts.push(
      `<text x="${attr(width / 2)}" y="${attr(HEADER_H / 2 + 4.5)}" text-anchor="middle" font-family="${attr(FONT)}" ` +
         `font-size="13" font-weight="600" fill="${attr(headerText)}">${esc(truncate(table.name, titleMax))}</text>`
   );

   if (table.columns.length === 0) {
      parts.push(
         `<text x="14" y="${attr(HEADER_H + ROW_H / 2 + 4)}" font-family="${attr(FONT)}" font-size="12" ` +
            `fill="${attr(theme.textMuted)}">No columns yet</text>`
      );
      parts.push('</g>');
      return parts.join('\n');
   }

   table.columns.forEach((column, index) => {
      const top = HEADER_H + index * ROW_H;
      const mid = top + ROW_H / 2;
      if (index > 0) {
         parts.push(
            `<line x1="0" y1="${attr(top)}" x2="${attr(width)}" y2="${attr(top)}" stroke="${attr(theme.rowBorder)}" stroke-width="1" />`
         );
      }

      // Right-aligned block: type pill, then the four chips to its left.
      const label = typeLabel(column);
      const maxPillChars = Math.floor((96 - 16) / CW_11);
      const shownLabel = truncate(label, maxPillChars);
      const pillW = Math.min(96, Math.ceil(shownLabel.length * CW_11) + 16);
      const pillRight = width - 8;
      const pillLeft = pillRight - pillW;
      parts.push(
         `<rect x="${attr(pillLeft)}" y="${attr(mid - 10)}" width="${attr(pillW)}" height="20" rx="6" ry="6" ` +
            `fill="${attr(theme.nodeSurface)}" stroke="${attr(theme.border)}" stroke-width="1" />`
      );
      parts.push(
         `<text x="${attr(pillLeft + 7)}" y="${attr(mid + 4)}" font-family="${attr(FONT)}" font-size="11" ` +
            `fill="${attr(theme.text)}">${esc(shownLabel)}</text>`
      );

      const chipsRight = pillLeft - 6;
      let chipX = chipsRight - CHIPS_BLOCK_W;
      for (const chip of columnChips(column, theme)) {
         const opacity = chip.active ? 1 : 0.5;
         parts.push(
            `<rect x="${attr(chipX)}" y="${attr(mid - CHIP_H / 2)}" width="${attr(CHIP_W)}" height="${attr(CHIP_H)}" rx="6" ry="6" ` +
               `fill="${attr(chip.bg)}" opacity="${attr(opacity)}" />`
         );
         parts.push(
            `<text x="${attr(chipX + CHIP_W / 2)}" y="${attr(mid + 3.5)}" text-anchor="middle" font-family="${attr(FONT)}" ` +
               `font-size="10" font-weight="600" fill="${attr(chip.text)}" opacity="${attr(opacity)}">${chip.label}</text>`
         );
         chipX += CHIP_W + CHIP_GAP;
      }

      // Column name fills the space left of the chips block.
      const nameMaxW = chipsRight - CHIPS_BLOCK_W - 6 - 12;
      const nameChars = Math.max(0, Math.floor(nameMaxW / CW_13));
      parts.push(
         `<text x="12" y="${attr(mid + 4)}" font-family="${attr(FONT)}" font-size="13" ` +
            `fill="${attr(theme.text)}">${esc(truncate(column.name, nameChars))}</text>`
      );
   });

   parts.push('</g>');
   return parts.join('\n');
}
