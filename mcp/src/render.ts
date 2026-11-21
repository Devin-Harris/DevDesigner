// A lightweight preview renderer: draws the project graph (or a region / one slide) to
// SVG so an agent can SEE its layout. It approximates the editor's look - tables with
// header + rows, shapes, text, code cards, images, lines/arrows, relationships and
// sequence diagrams - using the same size estimators as layout. Rasterised to PNG by
// the caller. Not a pixel-exact export (the app's SVG export does that).

import {
  TABLE_HEADER_H,
  TABLE_ROW_H,
  edgePoint,
  elementRect,
  gridEdges,
  gridMergeAt,
  gridSizes,
  parseGrid,
  readableTextOn,
  tableRect,
  type CanvasElementModel,
  type PointModel,
  type SchemaModel,
  type TableModel,
  resolveThemedElements,
  resolveThemedSequences,
} from '@devdesigner/shared';
import { collectItems, unionOf } from './layout';
import { formatDataType } from './model';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderOptions {
  /** World region to draw; default = bounds of everything drawn, plus a margin. */
  region?: Rect;
  /** Only draw items owned by this slide (frame id) plus the frame itself. */
  slideId?: string;
  /** fileId -> data: URI for image elements (missing ones draw as placeholders). */
  images?: ReadonlyMap<string, string>;
  /** Background color of the canvas (default white). */
  background?: string;
  /** Draw a faint label with each item's id (helps the agent map picture -> ids). */
  showIds?: boolean;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = 'Segoe UI, Helvetica, Arial, sans-serif';
const MONO = 'Consolas, Menlo, monospace';

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function dash(style: string | undefined, w: number): string {
  if (style === 'dashed') return ` stroke-dasharray="${w * 4} ${w * 3}"`;
  if (style === 'dotted') return ` stroke-dasharray="${w} ${w * 2}"`;
  return '';
}

/** Wrap text into lines that fit `width` at `size` (rough average glyph width). */
function wrapLines(text: string, width: number, size: number, mono = false): string[] {
  const per = Math.max(1, Math.floor(width / (size * (mono ? 0.6 : 0.52))));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (mono || para.length <= per) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && (line + ' ' + word).length > per) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

function textBlock(
  lines: string[],
  x: number,
  y: number,
  size: number,
  color: string,
  opts: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; italic?: boolean; mono?: boolean; lineHeight?: number } = {},
): string {
  const lh = size * (opts.lineHeight ?? 1.25);
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + size + i * lh}" font-family="${opts.mono ? MONO : FONT}" font-size="${size}" fill="${color}"` +
        `${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.bold ? ' font-weight="bold"' : ''}${opts.italic ? ' font-style="italic"' : ''}>${esc(l)}</text>`,
    )
    .join('');
}

function arrowHead(from: PointModel, to: PointModel, color: string, size: number): string {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const a1 = ang + Math.PI - 0.45;
  const a2 = ang + Math.PI + 0.45;
  return `<polyline points="${to.x + Math.cos(a1) * size},${to.y + Math.sin(a1) * size} ${to.x},${to.y} ${to.x + Math.cos(a2) * size},${to.y + Math.sin(a2) * size}" fill="none" stroke="${color}" stroke-width="2"/>`;
}

function drawTable(t: TableModel): string {
  const r = tableRect(t);
  const s = r.w > 0 ? (t.scale && t.scale > 0 ? t.scale : 1) : 1;
  const head = t.color || '#475569';
  const ink = readableTextOn(head);
  const hh = TABLE_HEADER_H * s;
  const rh = TABLE_ROW_H * s;
  let out = `<g><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${6 * s}" fill="#ffffff" stroke="#cbd5e1"/>`;
  out += `<path d="M${r.x} ${r.y + hh} V${r.y + 6 * s} Q${r.x} ${r.y} ${r.x + 6 * s} ${r.y} H${r.x + r.w - 6 * s} Q${r.x + r.w} ${r.y} ${r.x + r.w} ${r.y + 6 * s} V${r.y + hh} Z" fill="${head}"/>`;
  out += textBlock([t.name], r.x + 12 * s, r.y + (hh - 15 * s) / 2 - 2 * s, 15 * s, ink, { bold: true });
  t.columns.forEach((c, i) => {
    const y = r.y + hh + i * rh;
    if (i > 0) out += `<line x1="${r.x}" y1="${y}" x2="${r.x + r.w}" y2="${y}" stroke="#eef2f7"/>`;
    const key = c.isPrimaryKey ? 'PK ' : '';
    out += textBlock([`${key}${c.name}`], r.x + 12 * s, y + (rh - 13 * s) / 2 - 2 * s, 13 * s, '#0f172a', { bold: c.isPrimaryKey });
    out += textBlock([formatDataType(c.dataType).toLowerCase()], r.x + r.w - 12 * s, y + (rh - 12 * s) / 2 - 2 * s, 12 * s, '#64748b', { anchor: 'end' });
  });
  return `${out}</g>`;
}

/** Bound connectors are re-routed by the editor: run them edge to edge between their targets. */
function boundPoints(e: CanvasElementModel, schema: SchemaModel): PointModel[] | null {
  const rectOf = (b: CanvasElementModel['startBinding']): Rect | null => {
    if (!b) return null;
    if (b.targetKind === 'table') {
      const t = schema.tables.find((x) => x.id === b.targetId);
      return t ? tableRect(t) : null;
    }
    const el = schema.elements.find((x) => x.id === b.targetId);
    return el ? elementRect(el) : null;
  };
  const a = rectOf(e.startBinding);
  const b = rectOf(e.endBinding);
  if (!a && !b) return null;
  const pts = (e.points ?? []).map((p) => ({ x: e.x + p.x, y: e.y + p.y }));
  const first = pts[0] ?? { x: e.x, y: e.y };
  const last = pts[pts.length - 1] ?? first;
  const pt = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: 0, h: 0 });
  const from = a ?? { ...first, w: 0, h: 0 };
  const to = b ?? { ...last, w: 0, h: 0 };
  return [a ? edgePoint(a, b ?? pt(to)) : first, b ? edgePoint(b, a ?? pt(from)) : last];
}

function drawElement(
  e: CanvasElementModel,
  images: ReadonlyMap<string, string> | undefined,
  schema?: SchemaModel,
): string {
  const op = e.opacity !== undefined && e.opacity < 100 ? ` opacity="${e.opacity / 100}"` : '';
  const stroke = !e.strokeColor || e.strokeColor === 'theme' ? '#1e1e1e' : e.strokeColor;
  const sw = e.strokeWidth ?? 2;
  const fill = e.fillStyle && e.fillStyle !== 'none' && e.backgroundColor ? e.backgroundColor : 'none';
  const ds = dash(e.strokeStyle, sw);
  const label = (): string => {
    if (!e.text) return '';
    const size = e.fontSize ?? 20;
    const lines = wrapLines(e.text, Math.max(10, e.width - 16), size);
    const lh = size * (e.lineHeight ?? 1.25);
    const total = lines.length * lh;
    const va = e.verticalAlign ?? 'middle';
    const ta = e.textAlign ?? 'center';
    const y = va === 'top' ? e.y + 8 : va === 'bottom' ? e.y + e.height - total - 8 : e.y + (e.height - total) / 2;
    const x = ta === 'left' ? e.x + 8 : ta === 'right' ? e.x + e.width - 8 : e.x + e.width / 2;
    return textBlock(lines, x, y - size * 0.15, size, stroke, {
      anchor: ta === 'left' ? 'start' : ta === 'right' ? 'end' : 'middle',
      bold: !!e.bold,
      italic: !!e.italic,
      lineHeight: e.lineHeight,
    });
  };
  switch (e.type) {
    case 'frame': {
      const bg = e.fillStyle !== 'none' && e.backgroundColor ? e.backgroundColor : '#ffffff';
      return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${bg}" stroke="#94a3b8" stroke-dasharray="6 4"/>`;
    }
    case 'rectangle': {
      const rx = e.ellipticCorners ? (e.cornerRadius ?? 0) : Math.min(e.cornerRadius ?? 0, e.width / 2, e.height / 2);
      return `<g${op}><rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${ds}/>${label()}</g>`;
    }
    case 'ellipse':
      return `<g${op}><ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${ds}/>${label()}</g>`;
    case 'triangle':
      return `<g${op}><polygon points="${e.x + e.width / 2},${e.y} ${e.x + e.width},${e.y + e.height} ${e.x},${e.y + e.height}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${ds}/>${label()}</g>`;
    case 'diamond': {
      const cx = e.x + e.width / 2;
      const cy = e.y + e.height / 2;
      return `<g${op}><polygon points="${cx},${e.y} ${e.x + e.width},${cy} ${cx},${e.y + e.height} ${e.x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${ds}/>${label()}</g>`;
    }
    case 'text': {
      const size = e.fontSize ?? 20;
      const ta = e.textAlign ?? 'left';
      const x = ta === 'center' ? e.x + e.width / 2 : ta === 'right' ? e.x + e.width : e.x;
      const runsText = e.runs?.length ? e.runs.map((r) => r.text).join('') : (e.text ?? '');
      const lines = e.wrap === false ? runsText.split('\n') : wrapLines(runsText, Math.max(10, e.width), size);
      return `<g${op}>${textBlock(lines, x, e.y - size * 0.15, size, stroke, {
        anchor: ta === 'center' ? 'middle' : ta === 'right' ? 'end' : 'start',
        bold: !!e.bold,
        italic: !!e.italic,
        lineHeight: e.lineHeight,
      })}</g>`;
    }
    case 'code': {
      const bg = e.fillStyle !== 'none' && e.backgroundColor ? e.backgroundColor : '#1e293b';
      const ink = readableTextOn(bg);
      const size = e.fontSize ?? 14;
      const bar = 28;
      const lines = (e.text ?? '').split('\n');
      const max = Math.max(0, Math.floor((e.height - bar - 12) / (size * 1.45)));
      return `<g${op}><rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="8" fill="${bg}"/>` +
        `<circle cx="${e.x + 14}" cy="${e.y + 14}" r="4" fill="#ef4444"/><circle cx="${e.x + 28}" cy="${e.y + 14}" r="4" fill="#f59e0b"/><circle cx="${e.x + 42}" cy="${e.y + 14}" r="4" fill="#22c55e"/>` +
        (e.fileName ? textBlock([e.fileName], e.x + e.width / 2, e.y + 4, 12, ink, { anchor: 'middle' }) : '') +
        textBlock(lines.slice(0, max), e.x + 14, e.y + bar + 2, size, ink, { mono: true, lineHeight: 1.45 }) +
        `</g>`;
    }
    case 'grid': {
      const g = parseGrid(e.text);
      const { cols, rows } = gridSizes(g, e.width, e.height);
      const ce = gridEdges(cols).map((v) => e.x + v);
      const re = gridEdges(rows).map((v) => e.y + v);
      const bg = e.fillStyle !== 'none' && e.backgroundColor && e.backgroundColor !== 'surface' ? e.backgroundColor : '#ffffff';
      const size = e.fontSize ?? 14;
      let out = `<g${op}><rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${bg}"/>`;
      g.cells.forEach((row, r) =>
        row.forEach((txt, c) => {
          const m = gridMergeAt(g, r, c);
          if (m && (m.r !== r || m.c !== c)) return;
          const x0 = ce[c];
          const x1 = ce[c + (m?.cs ?? 1)];
          const y0 = re[r];
          const y1 = re[r + (m?.rs ?? 1)];
          const st = g.styles?.[`${r},${c}`] ?? {};
          if (st.fill) out += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${st.fill === 'surface' ? '#ffffff' : st.fill}"/>`;
          out += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${stroke}" stroke-opacity="0.55" stroke-width="${sw * 0.75}"/>`;
          if (!txt) return;
          const ta = st.align ?? e.textAlign ?? 'left';
          const tx = ta === 'center' ? (x0 + x1) / 2 : ta === 'right' ? x1 - 8 : x0 + 8;
          const lines = wrapLines(txt, Math.max(10, x1 - x0 - 16), size);
          out += textBlock(lines, tx, y0 + 8 - size * 0.15, size, st.color ?? stroke, {
            anchor: ta === 'center' ? 'middle' : ta === 'right' ? 'end' : 'start',
            bold: st.bold ?? ((g.header && r === 0) || !!e.bold),
            italic: st.italic ?? !!e.italic,
            lineHeight: e.lineHeight,
          });
        }),
      );
      return `${out}<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.cornerRadius ?? 4}" fill="none" stroke="${stroke}" stroke-width="${sw}"${ds}/></g>`;
    }
    case 'embed': {
      // A live frame (an iframe in the app): previews show its card and address.
      const host = (e.text ?? '').replace(/^https?:\/\//i, '') || 'no URL yet';
      return `<g${op}><rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.cornerRadius ?? 8}" fill="#f8fafc" stroke="#94a3b8"/>${textBlock(['Live frame', host], e.x + e.width / 2, e.y + e.height / 2 - 10, 14, '#475569', { anchor: 'middle' })}</g>`;
    }
    case 'image': {
      const uri = e.fileId ? images?.get(e.fileId) : undefined;
      if (uri) {
        return `<image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${uri}" preserveAspectRatio="xMidYMid meet"${op}/>`;
      }
      return `<g><rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="4 4"/>${textBlock(['image'], e.x + e.width / 2, e.y + e.height / 2 - 10, 14, '#64748b', { anchor: 'middle' })}</g>`;
    }
    case 'line':
    case 'arrow':
    case 'freedraw': {
      const pts = (schema && boundPoints(e, schema)) || (e.points ?? []).map((p) => ({ x: e.x + p.x, y: e.y + p.y }));
      if (pts.length < 2) return '';
      let out = `<g${op}><polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"${ds}/>`;
      if (e.type === 'arrow') {
        if ((e.endArrowhead ?? 'arrow') !== 'none') out += arrowHead(pts[pts.length - 2], pts[pts.length - 1], stroke, 12);
        if (e.startArrowhead && e.startArrowhead !== 'none') out += arrowHead(pts[1], pts[0], stroke, 12);
      }
      if (e.text) {
        const mid = pts[Math.floor(pts.length / 2) - (pts.length % 2 === 0 ? 1 : 0)];
        const nxt = pts[Math.min(pts.length - 1, pts.indexOf(mid) + 1)];
        const cx = (mid.x + nxt.x) / 2;
        const cy = (mid.y + nxt.y) / 2;
        out += textBlock([e.text], cx, cy - 18, e.fontSize ?? 16, stroke, { anchor: 'middle' });
      }
      return `${out}</g>`;
    }
    default:
      return '';
  }
}

function drawRelationships(schema: SchemaModel, visible: Set<string>): string {
  const tableOf = new Map<string, TableModel>();
  for (const t of schema.tables) for (const c of t.columns) tableOf.set(c.id, t);
  let out = '';
  for (const r of schema.relationships) {
    const a = tableOf.get(r.sourceColumnId);
    const b = tableOf.get(r.targetColumnId);
    if (!a || !b || !visible.has(a.id) || !visible.has(b.id)) continue;
    const ra = tableRect(a);
    const rb = tableRect(b);
    const rowY = (t: TableModel, colId: string, rect: Rect): number => {
      const s = t.scale && t.scale > 0 ? t.scale : 1;
      const i = t.columns.findIndex((c) => c.id === colId);
      return rect.y + (TABLE_HEADER_H + (i + 0.5) * TABLE_ROW_H) * s;
    };
    const ya = rowY(a, r.sourceColumnId, ra);
    const yb = rowY(b, r.targetColumnId, rb);
    const aRight = ra.x + ra.w <= rb.x;
    const xa = aRight ? ra.x + ra.w : ra.x;
    const xb = aRight ? rb.x : rb.x + rb.w;
    const pts: PointModel[] = [{ x: xa, y: ya }, ...(r.waypoints ?? []), { x: xb, y: yb }];
    if (!r.waypoints?.length) {
      const mx = (xa + xb) / 2;
      pts.splice(1, 0, { x: mx, y: ya }, { x: mx, y: yb });
    }
    out += `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#64748b" stroke-width="1.5"/>`;
    // crow's foot on the many side
    const end = pts[pts.length - 1];
    const dir = aRight ? -1 : 1;
    out += `<line x1="${end.x + dir * 12}" y1="${end.y}" x2="${end.x}" y2="${end.y - 7}" stroke="#64748b" stroke-width="1.5"/><line x1="${end.x + dir * 12}" y1="${end.y}" x2="${end.x}" y2="${end.y + 7}" stroke="#64748b" stroke-width="1.5"/>`;
  }
  return out;
}

function drawSequence(schema: SchemaModel, diagramId: string): string {
  const d = schema.sequenceDiagrams.find((x) => x.id === diagramId);
  if (!d) return '';
  const lanes = schema.lifelines.filter((l) => l.diagramId === diagramId);
  if (!lanes.length) return '';
  const msgs = schema.sequenceMessages.filter((m) => m.diagramId === diagramId);
  const left = Math.min(...lanes.map((l) => l.x - l.width / 2));
  const right = Math.max(...lanes.map((l) => l.x + l.width / 2));
  const bottom = Math.max(d.originY + d.headerHeight + d.rowSpacing, ...msgs.map((m) => m.y + d.rowSpacing));
  const pad = 26;
  let out = `<g><rect x="${left - pad}" y="${d.originY - pad}" width="${right - left + pad * 2}" height="${bottom - d.originY + pad * 2}" rx="10" fill="${d.backgroundColor ?? '#f8fafc'}" stroke="#e2e8f0"/>`;
  if (d.title) out += textBlock([d.title], left - pad + 12, d.originY - pad + 2, 13, '#334155', { bold: true });
  for (const l of lanes) {
    const head = l.color || '#e2e8f0';
    out += `<line x1="${l.x}" y1="${d.originY + d.headerHeight}" x2="${l.x}" y2="${bottom}" stroke="${l.lineColor ?? '#94a3b8'}" stroke-dasharray="6 5"/>`;
    out += `<rect x="${l.x - l.width / 2}" y="${d.originY}" width="${l.width}" height="${d.headerHeight}" rx="6" fill="${head}" stroke="${l.strokeColor ?? (l.color ? 'none' : '#94a3b8')}"/>`;
    out += textBlock([l.label], l.x, d.originY + d.headerHeight / 2 - 9, 14, l.textColor ?? readableTextOn(head), { anchor: 'middle', bold: true });
  }
  const laneX = new Map(lanes.map((l) => [l.id, l.x]));
  for (const m of msgs) {
    const color = m.color ?? '#334155';
    if (m.style === 'break') {
      out += `<line x1="${left}" y1="${m.y}" x2="${right}" y2="${m.y}" stroke="${color}" stroke-dasharray="2 4"/>`;
      if (m.label) out += textBlock([m.label], (left + right) / 2, m.y - 9, 12, color, { anchor: 'middle', italic: true });
      continue;
    }
    const x1 = laneX.get(m.fromLifelineId);
    const x2 = laneX.get(m.toLifelineId);
    if (x1 === undefined || x2 === undefined) continue;
    out += `<line x1="${x1}" y1="${m.y}" x2="${x2}" y2="${m.y}" stroke="${color}" stroke-width="1.6"${m.style === 'dashed' ? ' stroke-dasharray="6 4"' : ''}/>`;
    out += arrowHead({ x: x1, y: m.y }, { x: x2, y: m.y }, color, 10);
    if (m.label) {
      const lines = wrapLines(m.label, Math.max(60, Math.abs(x2 - x1) - 16), 12);
      out += textBlock(lines, (x1 + x2) / 2, m.y - 6 - lines.length * 15, 12, color, { anchor: 'middle' });
    }
  }
  return `${out}</g>`;
}

/** Render to an SVG string. Returns the world region drawn too. */
export function renderSvg(
  stored: SchemaModel,
  options: RenderOptions = {},
): { svg: string; region: Rect; drawn: number; hiddenSlides: number } {
  // Draw deck theme tokens as their concrete colors.
  const sequences = resolveThemedSequences(
    { diagrams: stored.sequenceDiagrams, lifelines: stored.lifelines, messages: stored.sequenceMessages },
    stored.elements,
  );
  const schema: SchemaModel = {
    ...stored,
    elements: resolveThemedElements(stored.elements),
    sequenceDiagrams: sequences.diagrams,
    lifelines: sequences.lifelines,
    sequenceMessages: sequences.messages,
  };
  const frame = options.slideId ? schema.elements.find((e) => e.id === options.slideId) : undefined;
  let items = collectItems(schema, { lines: 'all' });
  // Slides of a presentation are stacked on one spot: on the canvas view draw only the
  // first slide of each, so later slides do not paint over it.
  const stacked = new Set<string>();
  if (!options.slideId) {
    const first = new Map<string, CanvasElementModel>();
    for (const f of schema.elements) {
      if (f.type !== 'frame' || !f.slide) continue;
      const key = `${f.slide.presentation ?? ''}|${Math.round(f.x)}|${Math.round(f.y)}`;
      const cur = first.get(key);
      if (!cur || (f.slide.order ?? 0) < (cur.slide?.order ?? 0)) {
        if (cur) stacked.add(cur.id);
        first.set(key, f);
      } else stacked.add(f.id);
    }
    items = items.filter((i) => !i.slideId || !stacked.has(i.slideId));
  } else items = items.filter((i) => i.slideId === options.slideId);
  const frames = schema.elements.filter(
    (e) => e.type === 'frame' && (options.slideId ? e.id === options.slideId : !stacked.has(e.id)),
  );
  const all: Rect[] = [...items.map((i) => i.rect), ...frames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height }))];
  const bounds = unionOf(all) ?? { x: 0, y: 0, w: 800, h: 600 };
  const margin = frame ? 0 : 40;
  const region = options.region ??
    (frame
      ? { x: frame.x, y: frame.y, w: frame.width, h: frame.height }
      : { x: bounds.x - margin, y: bounds.y - margin, w: bounds.w + margin * 2, h: bounds.h + margin * 2 });

  const keys = new Set(items.filter((i) => intersects(i.rect, region)).map((i) => i.key));
  const visibleTables = new Set(schema.tables.filter((t) => keys.has(`table:${t.id}`)).map((t) => t.id));

  // Paint order like the editor: frames, shapes/diagrams by zIndex, tables, then lines on top.
  type Paint = { z: number; svg: string };
  const below: Paint[] = [];
  for (const f of frames) if (intersects({ x: f.x, y: f.y, w: f.width, h: f.height }, region)) below.push({ z: -1e9 + f.zIndex, svg: drawElement(f, options.images) });
  const lines: string[] = [];
  for (const e of schema.elements) {
    if (e.type === 'frame' || !keys.has(`element:${e.id}`)) continue;
    if (e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw') lines.push(drawElement(e, options.images, schema));
    else below.push({ z: e.zIndex, svg: drawElement(e, options.images) });
  }
  for (const d of schema.sequenceDiagrams) {
    if (keys.has(`diagram:${d.id}`)) below.push({ z: d.zIndex ?? -1, svg: drawSequence(schema, d.id) });
  }
  below.sort((a, b) => a.z - b.z);
  const tables = schema.tables.filter((t) => visibleTables.has(t.id)).map(drawTable);
  let ids = '';
  if (options.showIds) {
    for (const i of items) {
      if (!keys.has(i.key)) continue;
      const tag = i.kind === 'table' ? i.label : i.id.slice(0, 8);
      ids += `<text x="${i.rect.x}" y="${i.rect.y - 3}" font-family="${MONO}" font-size="10" fill="#e11d48">${esc(tag)}</text>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${region.x} ${region.y} ${region.w} ${region.h}" width="${Math.round(region.w)}" height="${Math.round(region.h)}">` +
    `<rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" fill="${options.background ?? '#ffffff'}"/>` +
    below.map((p) => p.svg).join('') +
    drawRelationships(schema, visibleTables) +
    tables.join('') +
    lines.join('') +
    ids +
    `</svg>`;
  return { svg, region, drawn: keys.size, hiddenSlides: stacked.size };
}
