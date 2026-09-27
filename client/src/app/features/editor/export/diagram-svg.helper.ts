import type {
  CanvasElementModel,
  ColumnModel,
  RelationshipModel,
  TableModel,
} from '@dbdesigner/shared';
import { HEADER_H, ROW_H } from '../canvas/constants/canvas.constants';
import { nodeHeight, tableBox, tableWidth } from '../canvas/helpers/node-metrics.helper';
import { computeConnectors } from '../canvas/helpers/connectors.helper';
import { buildShapeViews } from '../canvas/helpers/shape-render.helper';
import { elementBox } from '../canvas/helpers/element-geometry.helper';
import type { ShapeView, TextBlockView } from '../canvas/models/shape-view.model';

/**
 * Build a standalone vector SVG of the diagram that mirrors the on-screen canvas
 * exactly: it reads the app's live theme tokens (the --dbd-* CSS custom
 * properties) so the export matches the active light or dark scheme, and it
 * reproduces the real node, chip, type-pill, connector, and grid styling. Table
 * geometry and connector routing reuse the same canvas helpers, so the export
 * lines up pixel-for-pixel with what the user sees.
 */

const PADDING = 48;
const RADIUS = 14; // --dbd-radius-lg
const FONT = "'SFMono-Regular', ui-monospace, 'Cascadia Mono', Menlo, monospace";

// Approximate monospace advance widths, used only for placing/truncating text.
const CW_13 = 7.8;
const CW_11 = 6.6;
const CW_10 = 6.0;

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
};

// Fixed chip colors that are hard-coded in table-node.component.scss (they do
// not vary with the theme).
const PK_BG = '#f5a623';
const PK_TEXT = '#3a2a00';
const UQ_BG = '#2f6bff';
const UQ_TEXT = '#ffffff';
const HEADER_COLORED_TEXT = '#ffffff';

/**
 * Resolve a `var(--token)` expression (including aliases like --dbd-handle that
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
    canvasBg: resolve('var(--dbd-canvas-bg)', FALLBACK_THEME.canvasBg),
    gridLine: resolve('var(--dbd-grid-line)', FALLBACK_THEME.gridLine),
    nodeSurface: resolve('var(--dbd-node-surface)', FALLBACK_THEME.nodeSurface),
    nodeHeader: resolve('var(--dbd-node-header)', FALLBACK_THEME.nodeHeader),
    nodeBorder: resolve('var(--dbd-node-border)', FALLBACK_THEME.nodeBorder),
    rowBorder: resolve('var(--dbd-node-row-border)', FALLBACK_THEME.rowBorder),
    text: resolve('var(--dbd-text)', FALLBACK_THEME.text),
    textMuted: resolve('var(--dbd-text-muted)', FALLBACK_THEME.textMuted),
    primary: resolve('var(--dbd-primary)', FALLBACK_THEME.primary),
    connector: resolve('var(--dbd-connector)', FALLBACK_THEME.connector),
    border: resolve('var(--dbd-border)', FALLBACK_THEME.border),
    chipBg: resolve('var(--dbd-chip-bg)', FALLBACK_THEME.chipBg),
    chipActive: resolve('var(--dbd-chip-active)', FALLBACK_THEME.chipActive),
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
  return name;
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

/** Render one table node as an SVG group at its world coordinates. */
function renderTable(table: TableModel, theme: Theme): string {
  const width = tableWidth(table);
  const height = nodeHeight(table.columns.length);
  const colored = !!table.color;
  const headerFill = table.color || theme.nodeHeader;
  const headerText = colored ? HEADER_COLORED_TEXT : theme.text;

  const parts: string[] = [`<g transform="translate(${table.x}, ${table.y})">`];

  // Node body: rounded surface with a 1px border ring (matches the box-shadow ring).
  parts.push(
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${RADIUS}" ry="${RADIUS}" ` +
      `fill="${theme.nodeSurface}" stroke="${theme.nodeBorder}" stroke-width="1" />`,
  );

  // Header band with only the top corners rounded.
  parts.push(
    `<path d="M0 ${HEADER_H} L0 ${RADIUS} Q0 0 ${RADIUS} 0 L${width - RADIUS} 0 Q${width} 0 ${width} ${RADIUS} L${width} ${HEADER_H} Z" ` +
      `fill="${headerFill}" />`,
  );
  if (!colored) {
    parts.push(
      `<line x1="0" y1="${HEADER_H}" x2="${width}" y2="${HEADER_H}" stroke="${theme.nodeBorder}" stroke-width="1" />`,
    );
  }
  const titleMax = Math.floor((width - 24) / CW_13);
  parts.push(
    `<text x="${width / 2}" y="${HEADER_H / 2 + 4.5}" text-anchor="middle" font-family="${FONT}" ` +
      `font-size="13" font-weight="600" fill="${headerText}">${esc(truncate(table.name, titleMax))}</text>`,
  );

  if (table.columns.length === 0) {
    parts.push(
      `<text x="14" y="${HEADER_H + ROW_H / 2 + 4}" font-family="${FONT}" font-size="12" ` +
        `fill="${theme.textMuted}">No columns yet</text>`,
    );
    parts.push('</g>');
    return parts.join('\n');
  }

  table.columns.forEach((column, index) => {
    const top = HEADER_H + index * ROW_H;
    const mid = top + ROW_H / 2;
    if (index > 0) {
      parts.push(
        `<line x1="0" y1="${top}" x2="${width}" y2="${top}" stroke="${theme.rowBorder}" stroke-width="1" />`,
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
      `<rect x="${pillLeft}" y="${mid - 10}" width="${pillW}" height="20" rx="6" ry="6" ` +
        `fill="${theme.nodeSurface}" stroke="${theme.border}" stroke-width="1" />`,
    );
    parts.push(
      `<text x="${pillLeft + 7}" y="${mid + 4}" font-family="${FONT}" font-size="11" ` +
        `fill="${theme.text}">${esc(shownLabel)}</text>`,
    );

    const chipsRight = pillLeft - 6;
    let chipX = chipsRight - CHIPS_BLOCK_W;
    for (const chip of columnChips(column, theme)) {
      const opacity = chip.active ? 1 : 0.5;
      parts.push(
        `<rect x="${chipX}" y="${mid - CHIP_H / 2}" width="${CHIP_W}" height="${CHIP_H}" rx="6" ry="6" ` +
          `fill="${chip.bg}" opacity="${opacity}" />`,
      );
      parts.push(
        `<text x="${chipX + CHIP_W / 2}" y="${mid + 3.5}" text-anchor="middle" font-family="${FONT}" ` +
          `font-size="10" font-weight="600" fill="${chip.text}" opacity="${opacity}">${chip.label}</text>`,
      );
      chipX += CHIP_W + CHIP_GAP;
    }

    // Column name fills the space left of the chips block.
    const nameMaxW = chipsRight - CHIPS_BLOCK_W - 6 - 12;
    const nameChars = Math.max(0, Math.floor(nameMaxW / CW_13));
    parts.push(
      `<text x="12" y="${mid + 4}" font-family="${FONT}" font-size="13" ` +
        `fill="${theme.text}">${esc(truncate(column.name, nameChars))}</text>`,
    );
  });

  parts.push('</g>');
  return parts.join('\n');
}

/** Crow's-foot marker defs, colored with the theme connector color. */
function markerDefs(theme: Theme): string {
  return `<marker id="dbd-one" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M11 3 L11 15" fill="none" stroke="${theme.connector}" stroke-width="1.5" />
  </marker>
  <marker id="dbd-many" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M3 9 L17 3 M3 9 L17 9 M3 9 L17 15" fill="none" stroke="${theme.connector}" stroke-width="1.5" />
  </marker>`;
}

/** Render one drawing element (shape/arrow/freehand/text) as SVG. */
function renderShape(view: ShapeView): string {
  const dash = view.dash ? ` stroke-dasharray="${view.dash}"` : '';
  const open = `<g${view.transform ? ` transform="${esc(view.transform)}"` : ''} opacity="${view.opacity}">`;
  const stroke = `stroke="${view.stroke}" stroke-width="${view.strokeWidth}"${dash}`;
  const body: string[] = [];
  if (view.rect) {
    body.push(
      `<rect x="${view.rect.x}" y="${view.rect.y}" width="${view.rect.width}" height="${view.rect.height}" ` +
        `rx="${view.rect.rx}" fill="${view.fill}" fill-opacity="${view.fillOpacity}" ${stroke} />`,
    );
  } else if (view.ellipse) {
    body.push(
      `<ellipse cx="${view.ellipse.cx}" cy="${view.ellipse.cy}" rx="${view.ellipse.rx}" ry="${view.ellipse.ry}" ` +
        `fill="${view.fill}" fill-opacity="${view.fillOpacity}" ${stroke} />`,
    );
  } else if (view.polygon) {
    body.push(
      `<polygon points="${view.polygon}" fill="${view.fill}" fill-opacity="${view.fillOpacity}" ${stroke} stroke-linejoin="round" />`,
    );
  } else if (view.freehand && view.path) {
    body.push(`<path d="${view.path}" fill="${view.fill}" stroke="none" />`);
  } else if (view.path) {
    const ms = view.markerStart !== 'none' ? ` marker-start="url(#dbd-ah-${view.markerStart})"` : '';
    const me = view.markerEnd !== 'none' ? ` marker-end="url(#dbd-ah-${view.markerEnd})"` : '';
    body.push(
      `<path d="${view.path}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"${ms}${me} />`,
    );
  } else if (view.text) {
    body.push(renderTextBlock(view.text));
  }
  if (view.label) {
    body.push(renderTextBlock(view.label));
  }
  return `${open}${body.join('')}</g>`;
}

/** Render a laid-out text block (text element content or a shape label). */
function renderTextBlock(t: TextBlockView): string {
  const tspans = t.lines
    .map((l) => `<tspan x="${l.x}" y="${l.y}">${esc(l.text)}</tspan>`)
    .join('');
  return (
    `<text fill="${t.color}" font-size="${t.fontSize}" font-family="${esc(t.fontFamily)}" ` +
    `font-weight="${t.fontWeight}" text-anchor="${t.anchor}">${tspans}</text>`
  );
}

/** Arrowhead markers for exported lines/arrows (colored with the theme text color). */
function arrowheadDef(theme: Theme): string {
  const c = theme.text;
  return `<marker id="dbd-ah-arrow" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M1 1 L9 5 L1 9" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </marker>
  <marker id="dbd-ah-triangle" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M1 1 L10 5 L1 9 Z" fill="${c}" stroke="${c}" stroke-linejoin="round" />
  </marker>
  <marker id="dbd-ah-dot" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto" markerUnits="userSpaceOnUse">
    <circle cx="5" cy="5" r="3.2" fill="${c}" />
  </marker>
  <marker id="dbd-ah-bar" markerWidth="10" markerHeight="12" refX="4" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M4 1 L4 11" stroke="${c}" stroke-width="1.6" stroke-linecap="round" />
  </marker>`;
}

export interface DiagramSvg {
  svg: string;
  width: number;
  height: number;
  /** Canvas background color, so PNG/PDF backgrounds match the theme. */
  background: string;
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
): DiagramSvg {
  const { theme, dispose } = readTheme();
  try {
    const connectors = computeConnectors(tables, relationships, new Set<string>());
    const shapeViews = buildShapeViews(elements, tables, new Set<string>());

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

    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 400;
      maxY = 200;
    }

    const width = Math.ceil(maxX - minX) + PADDING * 2;
    const height = Math.ceil(maxY - minY) + PADDING * 2;
    const shiftX = PADDING - minX;
    const shiftY = PADDING - minY;

    const edges = connectors
      .map(
        (c) =>
          `<path d="${c.d}" fill="none" stroke="${theme.connector}" stroke-width="1.75" ` +
          `marker-start="${c.markerStart}" marker-end="${c.markerEnd}" />`,
      )
      .join('\n');

    const nodes = tables.map((t) => renderTable(t, theme)).join('\n');
    // Elements render above connectors and below table nodes, matching the canvas.
    const shapes = shapeViews.map(renderShape).join('\n');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
  <pattern id="dbd-export-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(${shiftX % 24}, ${shiftY % 24})">
    <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${theme.gridLine}" stroke-width="1" />
  </pattern>
  ${markerDefs(theme)}
  ${arrowheadDef(theme)}
</defs>
<rect x="0" y="0" width="${width}" height="${height}" fill="${theme.canvasBg}" />
<rect x="0" y="0" width="${width}" height="${height}" fill="url(#dbd-export-grid)" />
<g transform="translate(${shiftX}, ${shiftY})">
${edges}
${shapes}
${nodes}
</g>
</svg>`;

    return { svg, width, height, background: theme.canvasBg };
  } finally {
    dispose();
  }
}
