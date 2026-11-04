import { isNumericType, isSwatchColor, messageLabelLines, readableTextOn, THEME_FILL, THEME_STROKE } from '@dbdesigner/shared';
import type {
  CanvasElementModel,
  ColumnModel,
  LifelineModel,
  RelationshipModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '@dbdesigner/shared';
import { contrastText } from '../sequence-diagram/contrast';
import { HEADER_H, ROW_H } from '../canvas/constants/canvas.constants';
import { nodeHeight, tableBaseWidth, tableBox, tableScale } from '../canvas/helpers/node-metrics.helper';
import { computeConnectors } from '../canvas/helpers/connectors.helper';
import { messageLabelBoxes } from '../canvas/helpers/message-box.helper';
import { buildShapeViews } from '../canvas/helpers/shape-render.helper';
import { elementBox } from '../canvas/helpers/element-geometry.helper';
import type { CodeBlockView, ShapeView, TextBlockView } from '../canvas/models/shape-view.model';

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
const FONT = "'IBM Plex Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Mono', Menlo, monospace";

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
    surface: resolve('var(--dbd-surface)', FALLBACK_THEME.surface),
    borderStrong: resolve('var(--dbd-border-strong)', FALLBACK_THEME.borderStrong),
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

  const parts: string[] = [`<g transform="translate(${table.x}, ${table.y})${scale === 1 ? '' : ` scale(${scale})`}">`];

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
function renderShape(view: ShapeView, imageData: ReadonlyMap<string, string>): string {
  const dash = view.dash ? ` stroke-dasharray="${view.dash}"` : '';
  const open = `<g${view.transform ? ` transform="${esc(view.transform)}"` : ''} opacity="${view.opacity}">`;
  const stroke = `stroke="${view.stroke}" stroke-width="${view.strokeWidth}"${dash}`;
  const body: string[] = [];
  if (view.code) {
    body.push(renderCodeBlock(view.code, stroke));
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
          ? `<rect x="${c.rect.x}" y="${c.rect.y}" width="${c.rect.width}" height="${c.rect.height}" rx="${c.rect.rx}" />`
          : c.ellipse
            ? `<ellipse cx="${c.ellipse.cx}" cy="${c.ellipse.cy}" rx="${c.ellipse.rx}" ry="${c.ellipse.ry}" />`
            : `<polygon points="${c.polygon}" />`;
        body.push(`<clipPath id="${esc(c.id)}">${outline}</clipPath>`);
        clip = ` clip-path="url(#${esc(c.id)})"`;
      }
      body.push(
        `<image href="${esc(href)}" x="${img.src.x}" y="${img.src.y}" ` +
          `width="${img.src.width}" height="${img.src.height}" preserveAspectRatio="none"${clip} />`,
      );
    }
  } else if (view.rect) {
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

/** Render a spreadsheet-style grid table: surface, header tint, cell borders and text. */
function renderGridTable(view: ShapeView, dash: string): string {
  const g = view.grid!;
  const { rect } = g;
  const out: string[] = [
    `<clipPath id="${esc(g.clipId)}"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" ` +
      `height="${rect.height}" rx="${rect.rx}" /></clipPath>`,
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rect.rx}" ` +
      `fill="${esc(g.background)}" fill-opacity="${view.fillOpacity}" stroke="none" />`,
    `<g clip-path="url(#${esc(g.clipId)})">`,
  ];
  if (g.header) {
    const h = g.header;
    out.push(
      `<rect x="${h.x}" y="${h.y}" width="${h.width}" height="${h.height}" fill="${esc(h.fill)}" fill-opacity="0.12" />`,
    );
  }
  for (const f of g.fills) {
    out.push(
      `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" fill="${esc(f.fill)}" />`,
    );
  }
  for (const l of g.lines) {
    out.push(
      `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${view.stroke}" ` +
        `stroke-width="${view.strokeWidth * 0.75}" stroke-opacity="0.55"${dash} />`,
    );
  }
  for (const t of g.cells) {
    out.push(renderTextBlock(t));
  }
  out.push(
    '</g>',
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rect.rx}" ` +
      `fill="none" stroke="${view.stroke}" stroke-width="${view.strokeWidth}"${dash} />`,
  );
  return out.join('');
}

/** Render a code card: surface, line-number gutter and colored tokens, clipped to the card. */
function renderCodeBlock(c: CodeBlockView, stroke: string): string {
  const { rect } = c;
  const font = `font-size="${c.fontSize}" font-family="${esc(c.fontFamily)}"`;
  const out: string[] = [
    `<clipPath id="${esc(c.clipId)}"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" ` +
      `height="${rect.height}" rx="${rect.rx}" /></clipPath>`,
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ` +
      `rx="${rect.rx}" fill="${esc(c.background)}" ${stroke} />`,
    `<g clip-path="url(#${esc(c.clipId)})">`,
  ];
  {
    const h = c.header;
    out.push(
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${h.height}" ` +
        `fill="${h.tint}" fill-opacity="0.14" />`,
      `<line x1="${rect.x}" y1="${rect.y + h.height}" x2="${rect.x + rect.width}" ` +
        `y2="${rect.y + h.height}" stroke="${h.tint}" stroke-opacity="0.35" />`,
      `<text x="${h.x}" y="${h.y}" text-anchor="middle" font-size="12" ` +
        `font-family="${esc(c.fontFamily)}" fill="${h.color}">${esc(h.text)}</text>`,
    );
    for (const d of h.dots) {
      out.push(`<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.color}" />`);
    }
  }
  for (const line of c.lines) {
    out.push(
      `<text x="${c.numberX}" y="${line.y}" text-anchor="end" ${font} fill="${c.numberColor}">${line.number}</text>`,
    );
    const runs = line.tokens
      .map(
        (t) =>
          `<tspan fill="${t.color}"${t.italic ? ' font-style="italic"' : ''}>${esc(t.text)}</tspan>`,
      )
      .join('');
    out.push(
      `<text x="${c.textX}" y="${line.y}" xml:space="preserve" style="white-space:pre" ${font}>${runs}</text>`,
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
                `<tspan font-weight="${sp.fontWeight}" font-style="${sp.fontStyle}" fill="${sp.color}"` +
                `${sp.underline ? ' text-decoration="underline"' : ''}` +
                `${sp.morph ? ` data-morph="${esc(sp.morph)}"` : ''}>${esc(sp.text)}</tspan>`,
            )
            .join('')
        : esc(l.text);
      return `<tspan x="${l.x}" y="${l.y}" style="white-space:pre">${inner}</tspan>`;
    })
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
  smooth = false,
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
      smooth
        ? Math.max(1, (m.y - headerBottom) / gap)
        : Math.max(1, Math.round((m.y - headerBottom) / gap)),
    );
  const maxRow = rows.length ? Math.max(...rows) : 0;
  return {
    x0: Math.min(...lls.map((l) => l.x - l.width / 2)) - SEQ_BOX_PAD,
    x1: Math.max(...lls.map((l) => l.x + l.width / 2)) + SEQ_BOX_PAD,
    y0: diagram.originY - SEQ_BOX_PAD,
    y1: headerBottom + gap * (maxRow + 1) + SEQ_BOX_PAD,
  };
}

const SEQ_BOX_PAD = 26;
const SEQ_LINE_H = 15;

/** Multi-line, horizontally centered text block whose vertical middle sits on `cy`. */
function seqText(cx: number, cy: number, lines: readonly string[], attrs: string): string {
  const first = cy - ((lines.length - 1) * SEQ_LINE_H) / 2 + 4;
  const spans = lines
    .map((s, i) => `<tspan x="${cx}" y="${first + i * SEQ_LINE_H}">${esc(s)}</tspan>`)
    .join('');
  return `<text text-anchor="middle" font-family="${FONT}" font-size="11" ${attrs}>${spans}</text>`;
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
  data: SequenceExportData,
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
  const y0 = override ? override.y0 : diagram.originY - SEQ_BOX_PAD;
  const y1 = spineEnd + SEQ_BOX_PAD;
  const minX = Math.min(...lls.map((l) => l.x));
  const maxX = Math.max(...lls.map((l) => l.x));
  const byId = new Map(lls.map((l) => [l.id, l] as const));

  const bg = diagram.backgroundColor || theme.surface;
  const fg = contrastText(diagram.backgroundColor);
  const labelText = fg?.text ?? theme.text;
  const labelMuted = fg?.muted ?? theme.textMuted;
  const out: string[] = [];
  /** Group everything pushed since `index` under one opacity (a faded message). */
  const wrapFrom = (index: number, opacity: number | undefined): void => {
    if (opacity === undefined || opacity >= 1 || out.length <= index) return;
    const parts = out.splice(index);
    out.push(`<g opacity="${Math.max(0, opacity)}">${parts.join('\n')}</g>`);
  };
  out.push(
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="16" ry="16" ` +
      `fill="${bg}" stroke="${themed(diagram.borderColor, theme) || theme.border}" stroke-width="1.5" />`,
  );
  if (diagram.title && !data.hideText?.titles?.has(diagram.id)) {
    out.push(
      `<text data-seq-title="${esc(diagram.id)}" x="${x0 + 14}" y="${y0 + 19}" font-family="${FONT}" font-size="12" font-weight="700" fill="${labelText}">` +
        `${esc(truncate(diagram.title, Math.floor((x1 - x0 - 28) / CW_12)))}</text>`,
    );
  }
  /** Wrap `parts` in a group with the given opacity (no wrapper at full opacity). */
  const faded = (opacity: number | undefined, ...parts: string[]): string =>
    opacity === undefined || opacity >= 1
      ? parts.join('\n')
      : `<g opacity="${Math.max(0, opacity)}">${parts.join('\n')}</g>`;

  for (const l of lls) {
    out.push(
      faded(
        fade?.lifelines?.get(l.id),
        `<line x1="${l.x}" y1="${headerBottom}" x2="${l.x}" y2="${spineEnd}" stroke="${l.lineColor || fg?.muted || theme.border}"${l.lineColor || !fg ? '' : ' stroke-opacity="0.55"'} ` +
          `stroke-width="1.4" stroke-dasharray="4 4" />`,
      ),
    );
  }

  for (const m of msgs) {
    const at = out.length;
    const isBreak = m.style === 'break';
    const f = byId.get(m.fromLifelineId);
    const t = byId.get(m.toLifelineId);
    const y = headerBottom + gap * rowIndex(m.y);
    const label = m.label ?? '';
    const stroke =
      m.color || (m.style === 'dashed' ? fg?.soft ?? theme.textMuted : fg?.text ?? theme.connector);
    if (isBreak) {
      out.push(
        `<line x1="${minX}" y1="${y}" x2="${Math.max(maxX, minX + 1)}" y2="${y}" stroke="${m.color || fg?.soft || theme.textMuted}" ` +
          `stroke-width="1.4" stroke-dasharray="5 4" />`,
      );
      if (label) {
        const lines = messageLabelLines(label.toUpperCase(), maxX - minX, true, m.wrap !== false);
        const w = Math.ceil(Math.max(...lines.map((s) => s.length)) * (CW_11 + 0.44)) + 30;
        const h = lines.length * SEQ_LINE_H + 14;
        const mid = (minX + maxX) / 2;
        out.push(
          `<rect x="${mid - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${Math.min(11, h / 2)}" ry="${Math.min(11, h / 2)}" ` +
            `fill="${bg}" stroke="${theme.border}" stroke-width="1" />`,
          ...(data.hideText?.messages?.has(m.id)
            ? []
            : [
                seqText(
                  mid,
                  y,
                  lines,
                  `data-mid="${esc(m.id)}" font-weight="600" letter-spacing="0.44" fill="${labelMuted}"`,
                ),
              ]),
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
    const dir = headX >= otherX ? -8 : 8;
    const left = Math.min(fx, tx);
    const dash = m.style === 'dashed' ? ' stroke-dasharray="6 4"' : '';
    out.push(
      `<line x1="${left}" y1="${y}" x2="${Math.max(fx, tx, left + 1)}" y2="${y}" ` +
        `stroke="${stroke}" stroke-width="1.6"${dash} />`,
      `<path d="M${headX + dir} ${y - 4} L${headX} ${y} L${headX + dir} ${y + 4}" fill="none" ` +
        `stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />`,
    );
    if (label) {
      const lines = messageLabelLines(label, Math.abs(tx - fx), false, m.wrap !== false);
      const mid = (fx + tx) / 2;
      const w = Math.ceil(Math.max(...lines.map((s) => s.length)) * CW_11) + 20;
      const h = lines.length * SEQ_LINE_H + 8;
      out.push(
        `<rect x="${mid - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="4" ry="4" fill="${bg}" />`,
        ...(data.hideText?.messages?.has(m.id)
          ? []
          : [seqText(mid, y, lines, `data-mid="${esc(m.id)}" fill="${labelText}"`)]),
      );
    }
    wrapFrom(at, fade?.messages?.get(m.id));
  }

  for (const l of lls) {
    const colored = !!l.color;
    const maxChars = Math.floor((l.width - 16) / CW_12);
    out.push(
      faded(
        fade?.lifelines?.get(l.id),
        `<rect x="${l.x - l.width / 2 + 0.5}" y="${diagram.originY + 0.5}" width="${l.width - 1}" height="${diagram.headerHeight - 1}" ` +
          `rx="9" ry="9" fill="${l.color || theme.nodeHeader}" stroke="${l.strokeColor || (colored ? 'none' : theme.nodeBorder)}" stroke-width="1" />`,
        data.hideText?.lifelines?.has(l.id)
          ? ''
          : `<text data-lid="${esc(l.id)}" x="${l.x}" y="${diagram.originY + diagram.headerHeight / 2 + 4}" text-anchor="middle" font-family="${FONT}" ` +
            `font-size="12" font-weight="600" fill="${l.textColor ? l.textColor : colored && !isSwatchColor(l.color) && !data.themeHeaderText?.has(l.id) ? readableTextOn(l.color!) : theme.text}">${esc(truncate(l.label, maxChars))}</text>`,
      ),
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
  imageData: ReadonlyMap<string, string> = new Map(),
): DiagramSvg {
  const { theme, dispose } = readTheme();
  try {
    const frameBoxes = elements.filter((e) => e.type === 'frame').map(elementBox);
    // The frame being exported: its fill is the page's background, so it is drawn
    // (without outline or name) even though the frame itself is not content.
    const pageFrame = crop
      ? elements.find((e) =>
          crop.frameId
            ? e.id === crop.frameId
            : e.type === 'frame' && e.x === crop.x && e.y === crop.y,
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
        ? `<rect x="${pageView.rect.x}" y="${pageView.rect.y}" width="${pageView.rect.width}" ` +
          `height="${pageView.rect.height}" fill="${pageView.fill}" fill-opacity="${pageView.fillOpacity}" ` +
          `opacity="${pageView.opacity}" />`
        : '';
    // Frames are gone from `elements` by now, so tell the contrast guard what the items
    // sit on: the page's fill, not the app's canvas (dark text must not flip on a white
    // slide in dark mode).
    const pageColor = crop?.pageColor ?? (pageView?.rect && pageView.fill !== 'none' ? pageView.fill : undefined);
    const connectors = computeConnectors(tables, relationships, new Set<string>(), frameBoxes);
    const shapeViews = buildShapeViews(elements, tables, new Set<string>(), {
      canvasBg: pageColor ?? theme.canvasBg,
      text: theme.text,
      surface: theme.surface,
    }, messageLabelBoxes(sequences.diagrams, sequences.lifelines, sequences.messages));

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
      const laid = renderSequence(
        diagram,
        sequences.lifelines,
        sequences.messages,
        theme,
        sequences,
      );
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
          `<path data-rid="${esc(c.id)}" d="${c.d}" fill="none" stroke="${theme.connector}" stroke-width="1.75" ` +
          `marker-start="${c.markerStart}" marker-end="${c.markerEnd}" />`,
      )
      .join('\n');

    // Each table / element sits in a tagged group so presentation mode can pick
    // items out of a slide's SVG and animate them (the morph transition).
    const nodes = tables
      .map((t) => `<g data-tid="${esc(t.id)}">${renderTable(t, theme)}</g>`)
      .join('\n');
    // Stacking mirrors the canvas: connectors, frames, then drawing elements with
    // sequence diagrams interleaved by zIndex, table nodes, any diagram above
    // every element, and finally lines/arrows.
    const elementZ = new Map(elements.map((e) => [e.id, e.zIndex]));
    const maxZ = elements.reduce(
      (m, e) => (e.type === 'frame' ? m : Math.max(m, e.zIndex)),
      -Infinity,
    );
    const shapeSvg = (v: (typeof shapeViews)[number]): string =>
      `<g data-eid="${esc(v.id)}">${renderShape(v, imageData)}</g>`;
    const isLine = (v: (typeof shapeViews)[number]): boolean =>
      v.type === 'line' || v.type === 'arrow';
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
          `patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${v.hatch!.color}" stroke-width="1.3" /></pattern>`,
      )
      .join('');

    const body = stack;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
  <pattern id="dbd-export-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(${shiftX % 24}, ${shiftY % 24})">
    <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${theme.gridLine}" stroke-width="1" />
  </pattern>
  ${markerDefs(theme)}
  ${arrowheadDef(theme)}
  ${hatchDefs}
</defs>
<rect x="0" y="0" width="${width}" height="${height}" fill="${theme.canvasBg}" />
<rect x="0" y="0" width="${width}" height="${height}" fill="url(#dbd-export-grid)" />
<g transform="translate(${shiftX}, ${shiftY})">
${stack}
</g>
</svg>`;

    return { svg, width, height, background: theme.canvasBg, body, pageColor };
  } finally {
    dispose();
  }
}
