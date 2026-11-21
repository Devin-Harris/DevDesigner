import {
   type LifelineModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
   isSwatchColor,
   messageLabelLines,
   readableTextOn,
   readableTextSet,
} from '@devdesigner/shared';
import { CW_11, FONT, type Theme, attr, esc, themed, truncate } from './diagram-svg-base.helper';

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
   return withSeqBounds(diagram, {
      x0: Math.min(...lls.map((l) => l.x - l.width / 2)) - SEQ_BOX_PAD,
      x1: Math.max(...lls.map((l) => l.x + l.width / 2)) + SEQ_BOX_PAD,
      y0: diagram.originY - SEQ_BOX_PAD - SEQ_TITLE_ROOM,
      y1: headerBottom + gap * (maxRow + 1) + SEQ_BOX_PAD,
   });
}

/** The content box grown by the diagram's stored bounds (mirrors frame-contents applySequenceBounds). */
export function withSeqBounds(diagram: SequenceDiagramModel, c: SequenceBox): SequenceBox {
   const x0 = c.x0 - (diagram.padLeft ?? 0);
   const y0 = c.y0 - (diagram.padTop ?? 0);
   return {
      x0,
      y0,
      x1: Math.max(c.x1, x0 + (diagram.boxWidth ?? 0)),
      y1: Math.max(c.y1, y0 + (diagram.boxHeight ?? 0)),
   };
}

export const SEQ_BOX_PAD = 26;

/** Extra room above the participants so the title (or "Add title") never crowds them. */
export const SEQ_TITLE_ROOM = 10;

export const SEQ_LINE_H = 15;

/** Multi-line, horizontally centered text block whose vertical middle sits on `cy`. */
export function seqText(cx: number, cy: number, lines: readonly string[], attrs: string, k = 1): string {
   const lh = SEQ_LINE_H * k;
   const first = cy - ((lines.length - 1) * lh) / 2 + 4 * k;
   const spans = lines.map((s, i) => `<tspan x="${attr(cx)}" y="${attr(first + i * lh)}">${esc(s)}</tspan>`).join('');
   return `<text text-anchor="middle" font-family="${attr(FONT)}" font-size="${attr(11 * k)}" ${attrs}>${spans}</text>`;
}

export const CW_12 = 7.2;

/**
 * Lay out and render one sequence diagram, mirroring sequence-diagram.component:
 * rounded box, participant headers, dashed spines, arrows (rows snapped to the
 * diagram's row grid) and break dividers. Null when it has no participants.
 */
export function renderSequence(
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
   const box =
      data.boxes?.get(diagram.id) ??
      withSeqBounds(diagram, {
         x0: Math.min(...lls.map((l) => l.x - l.width / 2)) - SEQ_BOX_PAD,
         x1: Math.max(...lls.map((l) => l.x + l.width / 2)) + SEQ_BOX_PAD,
         y0: diagram.originY - SEQ_BOX_PAD - SEQ_TITLE_ROOM,
         y1: headerBottom + gap * (maxRow + 1) + SEQ_BOX_PAD,
      });
   // Spines run to the bottom of the box (which may be taller than the content).
   const spineEnd = box.y1 - SEQ_BOX_PAD;
   const { x0, x1, y0 } = box;
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
   /** Group a message's pieces (from `index` on) so slide animations can reveal it on its own. */
   const tagMessage = (index: number, id: string): void => {
      if (out.length <= index) return;
      const parts = out.splice(index);
      out.push(`<g data-msg="${esc(id)}">${parts.join('\n')}</g>`);
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
         tagMessage(at, m.id);
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
      tagMessage(at, m.id);
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
