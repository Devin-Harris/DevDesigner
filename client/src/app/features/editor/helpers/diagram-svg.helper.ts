import {
   isNumericType,
   isSwatchColor,
   messageLabelLines,
   readableTextOn,
   readableTextSet,
   THEME_FILL,
   THEME_STROKE,
} from '@devdesigner/shared';
import type {
   CanvasElementModel,
   ColumnModel,
   LifelineModel,
   RelationshipModel,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
} from '@devdesigner/shared';
import { HEADER_H, ROW_H } from '../shared/constants/canvas.constants';
import { nodeHeight, tableBaseWidth, tableBox, tableScale } from './node-metrics.helper';
import { computeConnectors } from './connectors.helper';
import { messageLabelBoxes } from './message-box.helper';
import { buildShapeViews } from './render';
import { elementBox } from './element-geometry.helper';
import type { CodeBlockView, ShapeView, TextBlockView } from '../models/shape-view.model';

/**
 * Build a standalone vector SVG of the diagram that mirrors the on-screen canvas
 * exactly: it reads the app's live theme tokens (the --dd-* CSS custom
 * properties) so the export matches the active light or dark scheme, and it
 * reproduces the real node, chip, type-pill, connector, and grid styling. Table
 * geometry and connector routing reuse the same canvas helpers, so the export
 * lines up pixel-for-pixel with what the user sees.
 */

const PADDING = 48;
const RADIUS = 14; // --dd-radius-lg
const FONT = "'IBM Plex Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Mono', Menlo, monospace";

// Approximate monospace advance widths, used only for placing/truncating text.
const CW_13 = 7.8;
const CW_11 = 6.6;

/** Resolved theme colors for one export pass. */
interface Theme {
   canvasBg: string;
   gridLine: string;
   nodeSurface: string;
   nodeHeader: string;
   nodeBorder: string;
   rowBorder: string;
   text: string;
   textMuted: string;
   primary: string;
   connector: string;
   border: string;
   chipBg: string;
   chipActive: string;
   surface: string;
   borderStrong: string;
}

// Light-theme fallback (matches styles.scss :root) for environments without a
// DOM, e.g. unit tests.
const FALLBACK_THEME: Theme = {
   canvasBg: '#f2f5f9',
   gridLine: 'rgba(16, 24, 40, 0.05)',
   nodeSurface: '#ffffff',
   nodeHeader: '#f6f8fb',
   nodeBorder: '#e6e9ef',
   rowBorder: '#f0f2f6',
   text: '#131720',
   textMuted: '#667085',
   primary: '#2f6bff',
   connector: '#9aa4b2',
   border: '#e6e9ef',
   chipBg: '#eef1f6',
   chipActive: '#e0ebff',
   surface: '#ffffff',
   borderStrong: '#d0d5dd',
};

// Fixed chip colors that are hard-coded in table-node.component.scss (they do
// not vary with the theme).
const PK_BG = '#f5a623';
const PK_TEXT = '#3a2a00';
const UQ_BG = '#2f6bff';
const UQ_TEXT = '#ffffff';

/**
 * Resolve a `var(--token)` expression (including aliases like --dd-handle that
 * point at another token) to a concrete rgb() color via a probe element. Returns
 * the fallback if the DOM is unavailable or resolution yields nothing.
 */
function makeResolver(): (expr: string, fallback: string) => string {
   if (typeof document === 'undefined') {
      return (_expr, fallback) => fallback;
   }
   const probe = document.createElement('span');
   probe.style.position = 'absolute';
   probe.style.visibility = 'hidden';
   probe.style.pointerEvents = 'none';
   document.body.appendChild(probe);
   return (expr: string, fallback: string): string => {
      try {
         probe.style.color = '';
         probe.style.color = expr;
         const value = getComputedStyle(probe).color;
         return value && value !== 'rgba(0, 0, 0, 0)' ? value : fallback;
      } catch {
         return fallback;
      }
   };
}

/** Read the current theme from the live document, falling back to light values. */
function readTheme(): { theme: Theme; dispose: () => void } {
   if (typeof document === 'undefined') {
      return { theme: FALLBACK_THEME, dispose: () => undefined };
   }
   const resolve = makeResolver();
   const t: Theme = {
      canvasBg: resolve('var(--dd-canvas-bg)', FALLBACK_THEME.canvasBg),
      gridLine: resolve('var(--dd-grid-line)', FALLBACK_THEME.gridLine),
      nodeSurface: resolve('var(--dd-node-surface)', FALLBACK_THEME.nodeSurface),
      nodeHeader: resolve('var(--dd-node-header)', FALLBACK_THEME.nodeHeader),
      nodeBorder: resolve('var(--dd-node-border)', FALLBACK_THEME.nodeBorder),
      rowBorder: resolve('var(--dd-node-row-border)', FALLBACK_THEME.rowBorder),
      text: resolve('var(--dd-text)', FALLBACK_THEME.text),
      textMuted: resolve('var(--dd-text-muted)', FALLBACK_THEME.textMuted),
      primary: resolve('var(--dd-primary)', FALLBACK_THEME.primary),
      connector: resolve('var(--dd-connector)', FALLBACK_THEME.connector),
      border: resolve('var(--dd-border)', FALLBACK_THEME.border),
      chipBg: resolve('var(--dd-chip-bg)', FALLBACK_THEME.chipBg),
      chipActive: resolve('var(--dd-chip-active)', FALLBACK_THEME.chipActive),
      surface: resolve('var(--dd-surface)', FALLBACK_THEME.surface),
      borderStrong: resolve('var(--dd-border-strong)', FALLBACK_THEME.borderStrong),
   };
   return {
      theme: t,
      dispose: () => {
         // Remove any probe elements we appended.
         document.querySelectorAll('span[style*="visibility: hidden"]').forEach((el) => {
            if (el instanceof HTMLElement && el.style.pointerEvents === 'none' && !el.textContent) {
               el.remove();
            }
         });
      },
   };
}

/** Escape the five XML special characters for safe attribute/text content. */
function esc(value: string): string {
   return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

/** Escape any interpolated attribute value (colors, ids, transforms, numbers...). */
function attr(value: unknown): string {
   return esc(String(value));
}

/** Truncate a label to a character budget, adding an ellipsis when cut. */
function truncate(text: string, maxChars: number): string {
   if (maxChars <= 0) {
      return '';
   }
   return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
}

/**
 * The type-pill label, matching the canvas exactly: the type name, plus the
 * length only for VARCHAR (other args are not shown on the node).
 */
function typeLabel(column: ColumnModel): string {
   const name = column.dataType.name;
   if (name === 'VARCHAR' && column.dataType.length) {
      return `${name}(${column.dataType.length})`;
   }
   // The canvas shows UNSIGNED as a chip; the static export folds it into the label.
   return column.isUnsigned && isNumericType(name) ? `${name} UNSIGNED` : name;
}

interface Chip {
   label: string;
   active: boolean;
   bg: string;
   text: string;
}

/** The four constraint chips for a column, mirroring the on-canvas chip styling. */
function columnChips(column: ColumnModel, theme: Theme): Chip[] {
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

const CHIP_W = 20;
const CHIP_H = 16;
const CHIP_GAP = 3;
const CHIPS_BLOCK_W = 4 * CHIP_W + 3 * CHIP_GAP;

/** Resolve the theme color sentinels (surface fill, theme stroke) to this theme's colors. */
function themed(color: string | undefined, theme: Theme): string | undefined {
   return color === THEME_FILL ? theme.surface : color === THEME_STROKE ? theme.text : color;
}

/** Render one table node as an SVG group at its world coordinates. */
function renderTable(table: TableModel, theme: Theme): string {
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

/** Crow's-foot marker defs, colored with the theme connector color. */
function markerDefs(theme: Theme): string {
   return `<marker id="dd-one" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M11 3 L11 15" fill="none" stroke="${attr(theme.connector)}" stroke-width="1.5" />
  </marker>
  <marker id="dd-many" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M3 9 L17 3 M3 9 L17 9 M3 9 L17 15" fill="none" stroke="${attr(theme.connector)}" stroke-width="1.5" />
  </marker>`;
}

/** Render one drawing element (shape/arrow/freehand/text) as SVG. */
function renderShape(view: ShapeView, imageData: ReadonlyMap<string, string>): string {
   const dash = view.dash ? ` stroke-dasharray="${attr(view.dash)}"` : '';
   const open = `<g${view.transform ? ` transform="${esc(view.transform)}"` : ''} opacity="${attr(view.opacity)}">`;
   const strokeOp = view.strokeOpacity < 1 ? ` stroke-opacity="${attr(view.strokeOpacity)}"` : '';
   const stroke = `stroke="${attr(view.stroke)}" stroke-width="${attr(view.strokeWidth)}"${strokeOp}${dash}`;
   const body: string[] = [];
   if (view.code) {
      body.push(renderCodeBlock(view.code, `fill-opacity="${attr(view.fillOpacity)}" ${stroke}`));
   } else if (view.grid) {
      body.push(renderGridTable(view, dash));
   } else if (view.image) {
      // Embedded as a data: URI so the exported file is self-contained.
      const img = view.image;
      const href = imageData.get(img.fileId);
      if (href) {
         let clip = '';
         if (img.clip) {
            const c = img.clip;
            const outline = c.rect
               ? `<rect x="${attr(c.rect.x)}" y="${attr(c.rect.y)}" width="${attr(c.rect.width)}" height="${attr(c.rect.height)}" rx="${attr(c.rect.rx)}" />`
               : c.ellipse
                 ? `<ellipse cx="${attr(c.ellipse.cx)}" cy="${attr(c.ellipse.cy)}" rx="${attr(c.ellipse.rx)}" ry="${attr(c.ellipse.ry)}" />`
                 : `<polygon points="${attr(c.polygon)}" />`;
            body.push(`<clipPath id="${esc(c.id)}">${outline}</clipPath>`);
            clip = ` clip-path="url(#${esc(c.id)})"`;
         }
         body.push(
            `<image href="${esc(href)}" x="${attr(img.src.x)}" y="${attr(img.src.y)}" ` +
               `width="${attr(img.src.width)}" height="${attr(img.src.height)}" preserveAspectRatio="none"${clip} />`
         );
      }
   } else if (view.rect) {
      body.push(
         `<rect x="${attr(view.rect.x)}" y="${attr(view.rect.y)}" width="${attr(view.rect.width)}" height="${attr(view.rect.height)}" ` +
            `rx="${attr(view.rect.rx)}" fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} />`
      );
   } else if (view.ellipse) {
      body.push(
         `<ellipse cx="${attr(view.ellipse.cx)}" cy="${attr(view.ellipse.cy)}" rx="${attr(view.ellipse.rx)}" ry="${attr(view.ellipse.ry)}" ` +
            `fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} />`
      );
   } else if (view.polygon) {
      body.push(
         `<polygon points="${attr(view.polygon)}" fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} stroke-linejoin="round" />`
      );
   } else if (view.freehand && view.path) {
      body.push(`<path d="${attr(view.path)}" fill="${attr(view.fill)}"${view.strokeOpacity < 1 ? ` fill-opacity="${attr(view.strokeOpacity)}"` : ''} stroke="none" />`);
   } else if (view.path) {
      // Arrowheads are tinted per stroke color (a shared theme-colored marker flashed
      // white on colored arrows during morphs and in exports).
      const ms =
         view.markerStart !== 'none'
            ? ` marker-start="url(#${arrowheadId(view.markerStart, view.markerColor)})"`
            : '';
      const me =
         view.markerEnd !== 'none' ? ` marker-end="url(#${arrowheadId(view.markerEnd, view.markerColor)})"` : '';
      body.push(
         `<path d="${attr(view.path)}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"${ms}${me} />`
      );
   } else if (view.text) {
      body.push(renderTextBlock(view.text));
   }
   if (view.label) {
      body.push(renderTextBlock(view.label));
   }
   return `${open}${body.join('')}</g>`;
}

/** Render a spreadsheet-style grid table: surface, header tint, cell borders and text. */
function renderGridTable(view: ShapeView, dash: string): string {
   const g = view.grid!;
   const { rect } = g;
   const out: string[] = [
      `<clipPath id="${esc(g.clipId)}"><rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" ` +
         `height="${attr(rect.height)}" rx="${attr(rect.rx)}" /></clipPath>`,
      `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(rect.height)}" rx="${attr(rect.rx)}" ` +
         `fill="${esc(g.background)}" fill-opacity="${attr(view.fillOpacity)}" stroke="none" />`,
      `<g clip-path="url(#${esc(g.clipId)})">`,
   ];
   if (g.header) {
      const h = g.header;
      out.push(
         `<rect x="${attr(h.x)}" y="${attr(h.y)}" width="${attr(h.width)}" height="${attr(h.height)}" fill="${esc(h.fill)}" fill-opacity="0.12" />`
      );
   }
   for (const f of g.fills) {
      out.push(
         `<rect x="${attr(f.x)}" y="${attr(f.y)}" width="${attr(f.width)}" height="${attr(f.height)}" fill="${esc(f.fill)}" />`
      );
   }
   for (const l of g.lines) {
      out.push(
         `<line x1="${attr(l.x1)}" y1="${attr(l.y1)}" x2="${attr(l.x2)}" y2="${attr(l.y2)}" stroke="${attr(view.stroke)}" ` +
            `stroke-width="${attr(view.strokeWidth * 0.75)}" stroke-opacity="0.55"${dash} />`
      );
   }
   for (const t of g.cells) {
      out.push(renderTextBlock(t));
   }
   out.push('</g>');
   if (g.outline) {
      out.push(
         `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(rect.height)}" rx="${attr(rect.rx)}" ` +
            `fill="none" stroke="${attr(view.stroke)}" stroke-width="${attr(view.strokeWidth)}"${view.strokeOpacity < 1 ? ` stroke-opacity="${attr(view.strokeOpacity)}"` : ''}${dash} />`
      );
   }
   return out.join('');
}

/** Render a code card: surface, line-number gutter and colored tokens, clipped to the card. */
function renderCodeBlock(c: CodeBlockView, stroke: string): string {
   const { rect } = c;
   const font = `font-size="${attr(c.fontSize)}" font-family="${esc(c.fontFamily)}"`;
   const out: string[] = [
      `<clipPath id="${esc(c.clipId)}"><rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" ` +
         `height="${attr(rect.height)}" rx="${attr(rect.rx)}" /></clipPath>`,
      `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(rect.height)}" ` +
         `rx="${attr(rect.rx)}" fill="${esc(c.background)}" ${stroke} />`,
      `<g clip-path="url(#${esc(c.clipId)})">`,
   ];
   {
      const h = c.header;
      out.push(
         `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(h.height)}" ` +
            `fill="${attr(h.tint)}" fill-opacity="0.14" />`,
         `<line x1="${attr(rect.x)}" y1="${attr(rect.y + h.height)}" x2="${attr(rect.x + rect.width)}" ` +
            `y2="${attr(rect.y + h.height)}" stroke="${attr(h.tint)}" stroke-opacity="0.35" />`,
         `<text x="${attr(h.x)}" y="${attr(h.y)}" text-anchor="middle" font-size="${attr(h.fontSize)}" ` +
            `font-family="${esc(c.fontFamily)}" fill="${attr(h.color)}">${esc(h.text)}</text>`
      );
      for (const d of h.dots) {
         out.push(`<circle cx="${attr(d.x)}" cy="${attr(d.y)}" r="${attr(d.r)}" fill="${attr(d.color)}" />`);
      }
   }
   for (const b of c.bands ?? []) {
      out.push(
         `<rect data-diff="1" x="${attr(b.x)}" y="${attr(b.y)}" width="${attr(b.width)}" height="${attr(b.height)}" fill="${attr(b.fill)}" />`
      );
   }
   if (c.divider) {
      const d = c.divider;
      out.push(
         `<line data-diff="1" x1="${attr(d.x)}" y1="${attr(d.y1)}" x2="${attr(d.x)}" y2="${attr(d.y2)}" stroke="${attr(d.color)}" stroke-opacity="0.35" />`
      );
   }
   for (const line of c.lines) {
      if (line.oldNumber) {
         out.push(
            `<text x="${attr(line.oldNumber.x)}" y="${attr(line.y)}" text-anchor="end" ${font} fill="${attr(c.numberColor)}">${esc(line.oldNumber.text)}</text>`
         );
      }
      if (line.sign) {
         out.push(
            `<text data-diff="1" x="${attr(line.sign.x)}" y="${attr(line.y)}" ${font} fill="${attr(line.sign.color)}">${esc(line.sign.text)}</text>`
         );
      }
      out.push(
         `<text x="${attr(line.numberX ?? c.numberX)}" y="${attr(line.y)}" text-anchor="end" ${font} fill="${attr(c.numberColor)}">${esc(line.number)}</text>`
      );
      const runs = line.tokens
         .map((t) => `<tspan fill="${attr(t.color)}"${t.italic ? ' font-style="italic"' : ''}>${esc(t.text)}</tspan>`)
         .join('');
      out.push(
         `<text x="${attr(line.textX ?? c.textX)}" y="${attr(line.y)}" xml:space="preserve" style="white-space:pre" ${font}>${runs}</text>`
      );
   }
   out.push('</g>');
   return out.join('');
}

/** Render a laid-out text block (text element content or a shape label). */
function renderTextBlock(t: TextBlockView): string {
   const tspans = t.lines
      .map((l) => {
         const inner = l.spans
            ? l.spans
                 .map(
                    (sp) =>
                       `<tspan font-weight="${attr(sp.fontWeight)}" font-style="${attr(sp.fontStyle)}" fill="${attr(sp.color)}"` +
                       `${sp.underline ? ' text-decoration="underline"' : ''}` +
                       `${sp.morph ? ` data-morph="${esc(sp.morph)}"` : ''}>${esc(sp.text)}</tspan>`
                 )
                 .join('')
            : esc(l.text);
         return `<tspan x="${attr(l.x)}" y="${attr(l.y)}" style="white-space:pre">${inner}</tspan>`;
      })
      .join('');
   return (
      `<text fill="${attr(t.color)}" font-size="${attr(t.fontSize)}" font-family="${esc(t.fontFamily)}" ` +
      `font-weight="${attr(t.fontWeight)}" text-anchor="${attr(t.anchor)}">${tspans}</text>`
   );
}

/** Marker id for an arrowhead type in a stroke color (deterministic, so morph sides share it). */
function arrowheadId(type: string, color: string | undefined): string {
   return color ? `dd-ah-${type}-${color.replace(/[^a-zA-Z0-9]/g, '_')}` : `dd-ah-${type}`;
}

/** Arrowhead markers: the theme-colored defaults plus one set per arrow stroke color. */
function arrowheadDefs(theme: Theme, colors: Iterable<string>): string {
   const out = [arrowheadDef(theme.text, '')];
   for (const c of new Set(colors)) {
      out.push(arrowheadDef(c, `-${c.replace(/[^a-zA-Z0-9]/g, '_')}`));
   }
   return out.join('\n');
}

function arrowheadDef(c: string, suffix: string): string {
   return `<marker id="dd-ah-arrow${suffix}" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M1 1 L9 5 L1 9" fill="none" stroke="${attr(c)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </marker>
  <marker id="dd-ah-triangle${suffix}" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M1 1 L10 5 L1 9 Z" fill="${attr(c)}" stroke="${attr(c)}" stroke-linejoin="round" />
  </marker>
  <marker id="dd-ah-dot${suffix}" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto" markerUnits="userSpaceOnUse">
    <circle cx="5" cy="5" r="3.2" fill="${attr(c)}" />
  </marker>
  <marker id="dd-ah-bar${suffix}" markerWidth="10" markerHeight="12" refX="4" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M4 1 L4 11" stroke="${attr(c)}" stroke-width="1.6" stroke-linecap="round" />
  </marker>`;
}

/** The sequence diagrams (with their participants and messages) to draw. */
export interface SequenceExportData {
   diagrams: readonly SequenceDiagramModel[];
   lifelines: readonly LifelineModel[];
   messages: readonly SequenceMessageModel[];
   /** Keep message rows fractional (no snapping to the row grid), for animated morphs. */
   smooth?: boolean;
   /**
    * Per-part opacity (0..1; absent = 1) so a morph can fade participants and messages
    * that exist on only one slide in or out while the rest glides.
    */
   fade?: {
      lifelines?: ReadonlyMap<string, number>;
      messages?: ReadonlyMap<string, number>;
   };
   /**
    * Text another layer draws (a morph's glyph animation): the backing shapes stay, the
    * text of these messages / participants / diagram titles is left out.
    */
   hideText?: {
      messages?: ReadonlySet<string>;
      lifelines?: ReadonlySet<string>;
      titles?: ReadonlySet<string>;
   };
   /**
    * Participants whose header text stays the theme text color even though their (blended)
    * fill is no longer a stock swatch, so a morph between two swatches doesn't flip it.
    */
   themeHeaderText?: ReadonlySet<string>;
   /** Box override per diagram id, so a morph can grow/shrink the box smoothly. */
   boxes?: ReadonlyMap<string, SequenceBox>;
   /**
    * World X of a message's two ends, keyed by message id, overriding the participants'
    * columns: lets a morph slide one end of an arrow (it grows toward another participant).
    */
   ends?: ReadonlyMap<string, { from: number; to: number }>;
}

/** A sequence diagram's rounded box in world coordinates. */
export interface SequenceBox {
   x0: number;
   y0: number;
   x1: number;
   y1: number;
}

/**
 * The box a sequence diagram is drawn with (same geometry as renderSequence): its
 * participants' extent padded, down to one row below the last message. Null when it
 * has no participants.
 */
export function sequenceBounds(
   diagram: SequenceDiagramModel,
   allLifelines: readonly LifelineModel[],
   allMessages: readonly SequenceMessageModel[],
   smooth = false
): SequenceBox | null {
   const lls = allLifelines.filter((l) => l.diagramId === diagram.id);
   if (!lls.length) {
      return null;
   }
   const headerBottom = diagram.originY + diagram.headerHeight;
   const gap = diagram.rowSpacing;
   const rows = allMessages
      .filter((m) => m.diagramId === diagram.id)
      .map((m) =>
         smooth ? Math.max(1, (m.y - headerBottom) / gap) : Math.max(1, Math.round((m.y - headerBottom) / gap))
      );
   const maxRow = rows.length ? Math.max(...rows) : 0;
   return {
      x0: Math.min(...lls.map((l) => l.x - l.width / 2)) - SEQ_BOX_PAD,
      x1: Math.max(...lls.map((l) => l.x + l.width / 2)) + SEQ_BOX_PAD,
      y0: diagram.originY - SEQ_BOX_PAD - SEQ_TITLE_ROOM,
      y1: headerBottom + gap * (maxRow + 1) + SEQ_BOX_PAD,
   };
}

const SEQ_BOX_PAD = 26;
/** Extra room above the participants so the title (or "Add title") never crowds them. */
const SEQ_TITLE_ROOM = 10;
const SEQ_LINE_H = 15;

/** Multi-line, horizontally centered text block whose vertical middle sits on `cy`. */
function seqText(cx: number, cy: number, lines: readonly string[], attrs: string, k = 1): string {
   const lh = SEQ_LINE_H * k;
   const first = cy - ((lines.length - 1) * lh) / 2 + 4 * k;
   const spans = lines
      .map((s, i) => `<tspan x="${attr(cx)}" y="${attr(first + i * lh)}">${esc(s)}</tspan>`)
      .join('');
   return `<text text-anchor="middle" font-family="${attr(FONT)}" font-size="${attr(11 * k)}" ${attrs}>${spans}</text>`;
}
const CW_12 = 7.2;

/**
 * Lay out and render one sequence diagram, mirroring sequence-diagram.component:
 * rounded box, participant headers, dashed spines, arrows (rows snapped to the
 * diagram's row grid) and break dividers. Null when it has no participants.
 */
function renderSequence(
   diagram: SequenceDiagramModel,
   allLifelines: readonly LifelineModel[],
   allMessages: readonly SequenceMessageModel[],
   theme: Theme,
   data: SequenceExportData
): { box: SequenceBox; svg: string } | null {
   const smooth = data.smooth === true;
   const fade = data.fade;
   const lls = allLifelines
      .filter((l) => l.diagramId === diagram.id)
      .sort((a, b) => a.x - b.x)
      .map((l) => ({
         ...l,
         color: themed(l.color, theme),
         lineColor: themed(l.lineColor, theme),
         strokeColor: themed(l.strokeColor, theme),
         textColor: themed(l.textColor, theme),
      }));
   if (!lls.length) {
      return null;
   }
   const msgs = allMessages
      .filter((m) => m.diagramId === diagram.id)
      .sort((a, b) => a.y - b.y)
      .map((m) => ({ ...m, color: themed(m.color, theme) }));
   const headerBottom = diagram.originY + diagram.headerHeight;
   const gap = diagram.rowSpacing;
   const rowIndex = (y: number): number =>
      smooth ? Math.max(1, (y - headerBottom) / gap) : Math.max(1, Math.round((y - headerBottom) / gap));
   const maxRow = msgs.length ? Math.max(...msgs.map((m) => rowIndex(m.y))) : 0;
   const override = data.boxes?.get(diagram.id);
   const spineEnd = override ? override.y1 - SEQ_BOX_PAD : headerBottom + gap * (maxRow + 1);

   const x0 = override ? override.x0 : Math.min(...lls.map((l) => l.x - l.width / 2)) - SEQ_BOX_PAD;
   const x1 = override ? override.x1 : Math.max(...lls.map((l) => l.x + l.width / 2)) + SEQ_BOX_PAD;
   const y0 = override ? override.y0 : diagram.originY - SEQ_BOX_PAD - SEQ_TITLE_ROOM;
   const y1 = spineEnd + SEQ_BOX_PAD;
   const minX = Math.min(...lls.map((l) => l.x));
   const maxX = Math.max(...lls.map((l) => l.x));
   const byId = new Map(lls.map((l) => [l.id, l] as const));

   const bg = diagram.backgroundColor || theme.surface;
   /** Text / label box / arrowhead scale (Ctrl + resize), matching the canvas's --seq-k. */
   const k = diagram.scale ?? 1;
   const fg = readableTextSet(diagram.backgroundColor);
   const labelText = fg?.text ?? theme.text;
   const labelMuted = fg?.muted ?? theme.textMuted;
   const out: string[] = [];
   /** Group everything pushed since `index` under one opacity (a faded message). */
   const wrapFrom = (index: number, opacity: number | undefined): void => {
      if (opacity === undefined || opacity >= 1 || out.length <= index) return;
      const parts = out.splice(index);
      out.push(`<g opacity="${attr(Math.max(0, opacity))}">${parts.join('\n')}</g>`);
   };
   out.push(
      `<rect x="${attr(x0)}" y="${attr(y0)}" width="${attr(x1 - x0)}" height="${attr(y1 - y0)}" rx="16" ry="16" ` +
         `fill="${attr(bg)}" stroke="${attr(themed(diagram.borderColor, theme) || theme.border)}" stroke-width="1.5" />`
   );
   if (diagram.title && !data.hideText?.titles?.has(diagram.id)) {
      out.push(
         `<text data-seq-title="${esc(diagram.id)}" x="${attr(x0 + 14)}" y="${attr(y0 + 19)}" font-family="${attr(FONT)}" font-size="${attr(12 * k)}" font-weight="700" fill="${attr(labelText)}">` +
            `${esc(truncate(diagram.title, Math.floor((x1 - x0 - 28) / (CW_12 * k))))}</text>`
      );
   }
   /** Wrap `parts` in a group with the given opacity (no wrapper at full opacity). */
   const faded = (opacity: number | undefined, ...parts: string[]): string =>
      opacity === undefined || opacity >= 1
         ? parts.join('\n')
         : `<g opacity="${attr(Math.max(0, opacity))}">${parts.join('\n')}</g>`;

   for (const l of lls) {
      out.push(
         faded(
            fade?.lifelines?.get(l.id),
            `<line x1="${attr(l.x)}" y1="${attr(headerBottom)}" x2="${attr(l.x)}" y2="${attr(spineEnd)}" stroke="${attr(l.lineColor || fg?.muted || theme.border)}"${l.lineColor || !fg ? '' : ' stroke-opacity="0.55"'} ` +
               `stroke-width="1.4" stroke-dasharray="4 4" />`
         )
      );
   }

   for (const m of msgs) {
      const at = out.length;
      const isBreak = m.style === 'break';
      const f = byId.get(m.fromLifelineId);
      const t = byId.get(m.toLifelineId);
      const y = headerBottom + gap * rowIndex(m.y);
      const label = m.label ?? '';
      const stroke = m.color || (m.style === 'dashed' ? (fg?.soft ?? theme.textMuted) : (fg?.text ?? theme.connector));
      if (isBreak) {
         out.push(
            `<line x1="${attr(minX)}" y1="${attr(y)}" x2="${attr(Math.max(maxX, minX + 1))}" y2="${attr(y)}" stroke="${attr(m.color || fg?.soft || theme.textMuted)}" ` +
               `stroke-width="1.4" stroke-dasharray="5 4" />`
         );
         if (label) {
            const lines = messageLabelLines(label.toUpperCase(), (maxX - minX) / k, true, m.wrap !== false);
            const w = (Math.ceil(Math.max(...lines.map((s) => s.length)) * (CW_11 + 0.44)) + 30) * k;
            const h = (lines.length * SEQ_LINE_H + 14) * k;
            const mid = (minX + maxX) / 2;
            out.push(
               `<rect x="${attr(mid - w / 2)}" y="${attr(y - h / 2)}" width="${attr(w)}" height="${attr(h)}" rx="${attr(Math.min(11, h / 2))}" ry="${attr(Math.min(11, h / 2))}" ` +
                  `fill="${attr(bg)}" stroke="${attr(theme.border)}" stroke-width="1" />`,
               ...(data.hideText?.messages?.has(m.id)
                  ? []
                  : [
                       seqText(
                          mid,
                          y,
                          lines,
                          `data-mid="${esc(m.id)}" font-weight="600" letter-spacing="${attr(0.44 * k)}" fill="${attr(labelMuted)}"`,
                          k
                       ),
                    ])
            );
         }
         wrapFrom(at, fade?.messages?.get(m.id));
         continue;
      }
      if (!f || !t) {
         continue;
      }
      const slid = data.ends?.get(m.id);
      const fx = slid?.from ?? f.x;
      const tx = slid?.to ?? t.x;
      const headX = m.direction === 'forward' ? tx : fx;
      const otherX = headX === fx ? tx : fx;
      const dir = (headX >= otherX ? -8 : 8) * k;
      const left = Math.min(fx, tx);
      const dash = m.style === 'dashed' ? ' stroke-dasharray="6 4"' : '';
      out.push(
         `<line x1="${attr(left)}" y1="${attr(y)}" x2="${attr(Math.max(fx, tx, left + 1))}" y2="${attr(y)}" ` +
            `stroke="${attr(stroke)}" stroke-width="1.6"${dash} />`,
         `<path d="M${attr(headX + dir)} ${attr(y - 4 * k)} L${attr(headX)} ${attr(y)} L${attr(headX + dir)} ${attr(y + 4 * k)}" fill="none" ` +
            `stroke="${attr(stroke)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />`
      );
      if (label) {
         const lines = messageLabelLines(label, Math.abs(tx - fx) / k, false, m.wrap !== false);
         const mid = (fx + tx) / 2;
         const w = (Math.ceil(Math.max(...lines.map((s) => s.length)) * CW_11) + 20) * k;
         const h = (lines.length * SEQ_LINE_H + 8) * k;
         out.push(
            `<rect x="${attr(mid - w / 2)}" y="${attr(y - h / 2)}" width="${attr(w)}" height="${attr(h)}" rx="4" ry="4" fill="${attr(bg)}" />`,
            ...(data.hideText?.messages?.has(m.id)
               ? []
               : [seqText(mid, y, lines, `data-mid="${esc(m.id)}" fill="${attr(labelText)}"`, k)])
         );
      }
      wrapFrom(at, fade?.messages?.get(m.id));
   }

   for (const l of lls) {
      const colored = !!l.color;
      const maxChars = Math.floor((l.width - 16 * k) / (CW_12 * k));
      out.push(
         faded(
            fade?.lifelines?.get(l.id),
            `<rect x="${attr(l.x - l.width / 2 + 0.5)}" y="${attr(diagram.originY + 0.5)}" width="${attr(l.width - 1)}" height="${attr(diagram.headerHeight - 1)}" ` +
               `rx="9" ry="9" fill="${attr(l.color || theme.nodeHeader)}" stroke="${attr(l.strokeColor || (colored ? 'none' : theme.nodeBorder))}" stroke-width="1" />`,
            data.hideText?.lifelines?.has(l.id)
               ? ''
               : `<text data-lid="${esc(l.id)}" x="${attr(l.x)}" y="${attr(diagram.originY + diagram.headerHeight / 2 + 4 * k)}" text-anchor="middle" font-family="${attr(FONT)}" ` +
                    `font-size="${attr(12 * k)}" font-weight="600" fill="${attr(l.textColor ? l.textColor : colored && !isSwatchColor(l.color) && !data.themeHeaderText?.has(l.id) ? readableTextOn(l.color!) : theme.text)}">${esc(truncate(l.label, maxChars))}</text>`
         )
      );
   }

   return { box: { x0, y0, x1, y1 }, svg: out.join('\n') };
}

export interface DiagramSvg {
   svg: string;
   width: number;
   height: number;
   /** Canvas background color, so PNG/PDF backgrounds match the theme. */
   background: string;
   /** The drawing alone (no defs/background), in the same coordinates as `svg`'s content group. */
   body: string;
   /** The exported frame's fill, when it has one. */
   pageColor?: string;
}

/**
 * Compose the full diagram SVG for the given tables and relationships. Pass a
 * subset (e.g. the marquee selection) to export just those; connectors are drawn
 * only when both endpoints are present. Returns the markup, pixel dimensions,
 * and background color.
 */
export function buildDiagramSvg(
   tables: readonly TableModel[],
   relationships: readonly RelationshipModel[],
   elements: readonly CanvasElementModel[] = [],
   sequences: SequenceExportData = { diagrams: [], lifelines: [], messages: [] },
   crop?: { x: number; y: number; width: number; height: number; frameId?: string; pageColor?: string },
   /** fileId -> `data:` URI for each image element (see ElementImagesService.dataUrl). */
   imageData: ReadonlyMap<string, string> = new Map()
): DiagramSvg {
   const { theme, dispose } = readTheme();
   try {
      const frameBoxes = elements.filter((e) => e.type === 'frame').map(elementBox);
      // The frame being exported: its fill is the page's background, so it is drawn
      // (without outline or name) even though the frame itself is not content.
      const pageFrame = crop
         ? elements.find((e) =>
              crop.frameId ? e.id === crop.frameId : e.type === 'frame' && e.x === crop.x && e.y === crop.y
           )
         : undefined;
      if (crop) {
         // A frame export shows exactly the frame's area; the frames themselves
         // (their outlines and names) are page furniture, not content.
         elements = elements.filter((e) => e.type !== 'frame');
      }
      const pageView = pageFrame
         ? buildShapeViews([pageFrame], [], new Set<string>(), {
              canvasBg: theme.canvasBg,
              text: theme.text,
              surface: theme.surface,
           })[0]
         : undefined;
      const pageFill =
         pageView && pageView.rect && pageView.fill !== 'none'
            ? `<rect x="${attr(pageView.rect.x)}" y="${attr(pageView.rect.y)}" width="${attr(pageView.rect.width)}" ` +
              `height="${attr(pageView.rect.height)}" fill="${attr(pageView.fill)}" fill-opacity="${attr(pageView.fillOpacity)}" ` +
              `opacity="${attr(pageView.opacity)}" />`
            : '';
      // Frames are gone from `elements` by now, so tell the contrast guard what the items
      // sit on: the page's fill, not the app's canvas (dark text must not flip on a white
      // slide in dark mode).
      const pageColor = crop?.pageColor ?? (pageView?.rect && pageView.fill !== 'none' ? pageView.fill : undefined);
      const connectors = computeConnectors(tables, relationships, new Set<string>(), frameBoxes);
      const shapeViews = buildShapeViews(
         elements,
         tables,
         new Set<string>(),
         {
            canvasBg: pageColor ?? theme.canvasBg,
            text: theme.text,
            surface: theme.surface,
         },
         messageLabelBoxes(sequences.diagrams, sequences.lifelines, sequences.messages)
      );

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const extend = (x: number, y: number): void => {
         minX = Math.min(minX, x);
         minY = Math.min(minY, y);
         maxX = Math.max(maxX, x);
         maxY = Math.max(maxY, y);
      };

      for (const table of tables) {
         const box = tableBox(table);
         extend(box.x0, box.y0);
         extend(box.x1, box.y1);
      }
      for (const connector of connectors) {
         for (const point of connector.routePoints) {
            extend(point.x, point.y);
         }
      }
      for (const element of elements) {
         const box = elementBox(element);
         extend(box.x0, box.y0);
         extend(box.x1, box.y1);
      }
      const sequenceSvgs: Array<{ z: number; svg: string }> = [];
      for (const diagram of sequences.diagrams) {
         const laid = renderSequence(diagram, sequences.lifelines, sequences.messages, theme, sequences);
         if (laid) {
            extend(laid.box.x0, laid.box.y0);
            extend(laid.box.x1, laid.box.y1);
            sequenceSvgs.push({ z: diagram.zIndex, svg: `<g data-seq="${esc(diagram.id)}">${laid.svg}</g>` });
         }
      }

      if (!Number.isFinite(minX)) {
         minX = 0;
         minY = 0;
         maxX = 400;
         maxY = 200;
      }

      // Cropped: the canvas is the frame itself (no padding), so the output keeps
      // the frame's exact size and aspect ratio. Otherwise fit the content + padding.
      const pad = crop ? 0 : PADDING;
      const originX = crop ? crop.x : minX;
      const originY = crop ? crop.y : minY;
      const width = crop ? Math.round(crop.width) : Math.ceil(maxX - minX) + PADDING * 2;
      const height = crop ? Math.round(crop.height) : Math.ceil(maxY - minY) + PADDING * 2;
      const shiftX = pad - originX;
      const shiftY = pad - originY;

      const edges = connectors
         .map(
            (c) =>
               `<path data-rid="${esc(c.id)}" d="${attr(c.d)}" fill="none" stroke="${attr(theme.connector)}" stroke-width="1.75" ` +
               `marker-start="${attr(c.markerStart)}" marker-end="${attr(c.markerEnd)}" />`
         )
         .join('\n');

      // Each table / element sits in a tagged group so presentation mode can pick
      // items out of a slide's SVG and animate them (the morph transition).
      const nodes = tables.map((t) => `<g data-tid="${esc(t.id)}">${renderTable(t, theme)}</g>`).join('\n');
      // Stacking mirrors the canvas: connectors, frames, then drawing elements with
      // sequence diagrams interleaved by zIndex, table nodes, any diagram above
      // every element, and finally lines/arrows.
      const elementZ = new Map(elements.map((e) => [e.id, e.zIndex]));
      const maxZ = elements.reduce((m, e) => (e.type === 'frame' ? m : Math.max(m, e.zIndex)), -Infinity);
      const shapeSvg = (v: (typeof shapeViews)[number]): string =>
         v.frameClip
            ? `<clipPath id="fclip-${esc(v.id)}"><rect x="${attr(v.frameClip.x)}" y="${attr(v.frameClip.y)}" width="${attr(v.frameClip.width)}" height="${attr(v.frameClip.height)}" /></clipPath>` +
              `<g data-eid="${esc(v.id)}" clip-path="url(#fclip-${esc(v.id)})">${renderShape(v, imageData)}</g>`
            : `<g data-eid="${esc(v.id)}">${renderShape(v, imageData)}</g>`;
      const isLine = (v: (typeof shapeViews)[number]): boolean => v.type === 'line' || v.type === 'arrow';
      const frameShapes = shapeViews.filter((v) => v.type === 'frame').map(shapeSvg);
      const lineShapes = shapeViews.filter(isLine).map(shapeSvg);
      const stacked: Array<{ z: number; svg: string }> = [
         ...shapeViews
            .filter((v) => v.type !== 'frame' && !isLine(v))
            .map((v) => ({ z: elementZ.get(v.id) ?? Infinity, svg: shapeSvg(v) })),
         ...sequenceSvgs.filter((d) => d.z <= maxZ),
      ].sort((a, b) => a.z - b.z);
      const topDiagrams = sequenceSvgs.filter((d) => d.z > maxZ).sort((a, b) => a.z - b.z);

      const stack = [
         pageFill,
         edges,
         frameShapes.join('\n'),
         stacked.map((i) => i.svg).join('\n'),
         nodes,
         topDiagrams.map((i) => i.svg).join('\n'),
         lineShapes.join('\n'),
      ].join('\n');

      // Hachure fills reference a per-element <pattern>; without it they render blank.
      const hatchDefs = [...shapeViews, ...(pageView ? [pageView] : [])]
         .filter((v) => v.hatch)
         .map(
            (v) =>
               `<pattern id="${esc(v.hatch!.id)}" width="7" height="7" patternUnits="userSpaceOnUse" ` +
               `patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${attr(v.hatch!.color)}" stroke-width="1.3" /></pattern>`
         )
         .join('');

      const body = stack;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${attr(width)}" height="${attr(height)}" viewBox="0 0 ${attr(width)} ${attr(height)}">
<defs>
  <pattern id="dd-export-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(${attr(shiftX % 24)}, ${attr(shiftY % 24)})">
    <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${attr(theme.gridLine)}" stroke-width="1" />
  </pattern>
  ${markerDefs(theme)}
  ${arrowheadDefs(
     theme,
     shapeViews.filter((v) => v.markerStart !== 'none' || v.markerEnd !== 'none').map((v) => v.markerColor).filter(Boolean)
  )}
  ${hatchDefs}
</defs>
<rect x="0" y="0" width="${attr(width)}" height="${attr(height)}" fill="${attr(theme.canvasBg)}" />
<rect x="0" y="0" width="${attr(width)}" height="${attr(height)}" fill="url(#dd-export-grid)" />
<g transform="translate(${attr(shiftX)}, ${attr(shiftY)})">
${stack}
</g>
</svg>`;

      return { svg, width, height, background: theme.canvasBg, body, pageColor };
   } finally {
      dispose();
   }
}
