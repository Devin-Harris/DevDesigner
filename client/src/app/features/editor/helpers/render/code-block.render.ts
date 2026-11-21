import type { CanvasElementModel, CodeLanguage } from '@devdesigner/shared';
import type { CodeBlockView, CodeDotAction, CodeLineView } from '../../models/shape-view.model';
import {
   CODE_LANGUAGE_EXTENSIONS,
   TAB_SIZE,
   codePalette,
   expandTabs,
   isElisionLine,
   tokenColor,
   tokenizeCode,
   type CodeToken,
   type CodePalette,
} from '../code-highlight.helper';
import { changedSpan, diffLines, splitLines, splitRows } from '../code-diff.helper';
import { fontStack } from './fonts';
import { isDarkColor, sentinelColor, type ThemeColors } from './theme-colors';
import { measureWidth } from './text-layout';
import { clipKey } from './shape-primitives';

// --- code blocks ---

export const CODE_FONT_SIZE = 14;
/** Inner padding of a code card and the gap between the line-number gutter and the code. */
export const CODE_PADDING = 12;
const CODE_GUTTER_GAP = 14;
const CODE_LINE_HEIGHT = 1.5;

/** Window-style dots on a title bar: close deletes, minimize collapses, zoom fits to content. */
const TRAFFIC_LIGHT_GAP = 18;
const TRAFFIC_LIGHTS: { color: string; action: CodeDotAction }[] = [
   { color: '#ff5f57', action: 'delete' },
   { color: '#febc2e', action: 'collapse' },
   { color: '#28c840', action: 'fit' },
];
/** How much a card's title bar chrome (dots, title, bar) scales with its code font size. */
function codeChromeScale(fontSize: number): number {
   return fontSize / CODE_FONT_SIZE;
}

/** Width of the dot cluster from the card's left edge (used to keep the title clear of it). */
export function codeDotsWidth(fontSize: number): number {
   return (CODE_PADDING + 2 + TRAFFIC_LIGHT_GAP * 3) * codeChromeScale(fontSize);
}

/** Font size of the file name in a code card's title bar. */
export function codeTitleSize(fontSize: number): number {
   return 12 * codeChromeScale(fontSize);
}

/** Height of a code card's title bar (35 at the default size, scaling with the font). */
export function codeHeaderHeight(fontSize: number): number {
   return Math.round(fontSize * 2.5);
}

/**
 * The title shown in a code card's bar: the file name, with the language's extension
 * appended when it has none. Empty when no file name is set.
 */
export function codeTitle(el: { fileName?: string; language?: CodeLanguage }): string {
   const name = el.fileName?.trim();
   if (!name) {
      return '';
   }
   if (/\.[A-Za-z0-9]+$/.test(name)) {
      return name;
   }
   return `${name}.${CODE_LANGUAGE_EXTENSIONS[el.language ?? 'typescript']}`;
}

/** Baseline offset inside a code line box; matches how a textarea centers a line. */
function codeBaseline(fontSize: number): number {
   return (fontSize * CODE_LINE_HEIGHT) / 2 + fontSize * 0.36;
}

function codeCharWidth(fontSize: number): number {
   return measureWidth('0'.repeat(20), `400 ${fontSize}px ${fontStack('code')}`) / 20;
}

/** Geometry shared by the SVG renderer and the inline editor so the two line up exactly. */
export function codeLayoutMetrics(
   fontSize: number,
   lineCount: number
): { charWidth: number; lineHeight: number; textOffset: number } {
   const charWidth = codeCharWidth(fontSize);
   const digits = Math.max(2, String(lineCount).length);
   return {
      charWidth,
      lineHeight: fontSize * CODE_LINE_HEIGHT,
      textOffset: CODE_PADDING + digits * charWidth + CODE_GUTTER_GAP,
   };
}

/** Number of numbered lines in a code block (elision rows like `...` are not numbered). */
export function codeLineCount(text: string): number {
   const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
   return Math.max(1, lines.filter((l) => !isElisionLine(l)).length);
}

/** One drawn row of a code block: a line or an elision gap. */
interface CodeRow {
   tokens: CodeToken[];
   /** Line number, '' for gaps. */
   number: string;
   gap: boolean;
}

/** Expand tabs across a line's tokens (column-aware, so rendered and typed columns agree). */
function expandTokenTabs(tokens: CodeToken[]): CodeToken[] {
   let col = 0;
   return tokens.map((t) => {
      let text = '';
      for (const ch of t.text) {
         if (ch === '\t') {
            const n = TAB_SIZE - (col % TAB_SIZE);
            text += ' '.repeat(n);
            col += n;
         } else {
            text += ch;
            col += 1;
         }
      }
      return { text, kind: t.kind };
   });
}

/** How many characters fit across a code card of `width`. */
export function codeColumns(width: number, textOffset: number, charWidth: number): number {
   return Math.max(4, Math.floor((width - textOffset - CODE_PADDING) / charWidth + 1e-6));
}

/**
 * Lay a code block out into drawn rows: tokenized, tab-expanded, elision lines as
 * gaps (unnumbered).
 */
function layoutCodeRows(
   text: string,
   language: string,
   fontSize: number
): { rows: CodeRow[]; metrics: ReturnType<typeof codeLayoutMetrics>; digits: number } {
   const raw = (text || '').replace(/\r\n?/g, '\n').split('\n');
   const tokenLines = tokenizeCode(text || '', language);
   const realCount = Math.max(1, raw.filter((l) => !isElisionLine(l)).length);
   const metrics = codeLayoutMetrics(fontSize, realCount);
   const rows: CodeRow[] = [];
   let n = 0;
   raw.forEach((line, i) => {
      if (isElisionLine(line)) {
         const indent = /^\s*/.exec(expandTabs(line))?.[0] ?? '';
         const tokens: CodeToken[] = [];
         if (indent) {
            tokens.push({ text: indent, kind: 'plain' });
         }
         tokens.push({ text: '...', kind: 'elision' });
         rows.push({ tokens, number: '', gap: true });
         return;
      }
      n += 1;
      const tokens = expandTokenTabs(tokenLines[i] ?? []);
      rows.push({ tokens, number: String(n), gap: false });
   });
   return { rows, metrics, digits: Math.max(2, String(realCount).length) };
}

// --- code diffs ---

/** The original (left) side's share of a split diff's width, clamped to keep both panes usable. */
export function codeDiffSplit(el: Pick<CanvasElementModel, 'diffSplit'>): number {
   return Math.min(0.85, Math.max(0.15, el.diffSplit ?? 0.5));
}

/** True when a code block shows a diff (it has a changed side and the view isn't off). */
export function codeDiffActive(el: Pick<CanvasElementModel, 'diffText' | 'diffView'>): boolean {
   return el.diffText != null && !!el.diffView && el.diffView !== 'off';
}

interface DiffColors {
   removed: string;
   added: string;
   removedStrong: string;
   addedStrong: string;
   removedSign: string;
   addedSign: string;
   filler: string;
   divider: string;
}

function diffColors(dark: boolean, palette: CodePalette): DiffColors {
   return {
      removed: dark ? 'rgba(248,81,73,0.16)' : 'rgba(255,129,130,0.22)',
      added: dark ? 'rgba(46,160,67,0.18)' : 'rgba(74,194,107,0.22)',
      removedStrong: dark ? 'rgba(248,81,73,0.4)' : 'rgba(255,129,130,0.5)',
      addedStrong: dark ? 'rgba(46,160,67,0.45)' : 'rgba(74,194,107,0.5)',
      removedSign: dark ? '#ff7b72' : '#cf222e',
      addedSign: dark ? '#56d364' : '#1a7f37',
      filler: dark ? 'rgba(110,118,129,0.12)' : 'rgba(175,184,193,0.18)',
      divider: palette.muted,
   };
}

function codeTokenViews(tokens: CodeToken[], palette: CodePalette): CodeLineView['tokens'] {
   return tokens.map((t) => ({
      // An elision reads as a muted "···" (same width as the "..." typed).
      text: t.kind === 'elision' ? '···' : t.text,
      color: tokenColor(palette, t.kind),
      italic: t.kind === 'comment',
   }));
}

/** Cut a line's tokens to its first `cols` characters (split halves can't overflow each other). */
function truncateTokens(tokens: CodeToken[], cols: number): CodeToken[] {
   const out: CodeToken[] = [];
   let left = cols;
   for (const t of tokens) {
      if (left <= 0) break;
      out.push(t.text.length > left ? { ...t, text: t.text.slice(0, left) } : t);
      left -= t.text.length;
   }
   return out;
}

const rowText = (tokens: CodeToken[]): string => tokens.map((t) => t.text).join('');

/** Both sides of a diff laid out (tokenized rows) and aligned. */
function codeDiffModel(element: CanvasElementModel, language: string, fontSize: number) {
   const a = layoutCodeRows(element.text ?? '', language, fontSize);
   const b = layoutCodeRows(element.diffText ?? '', language, fontSize);
   const unified = diffLines(
      splitLines(element.text ?? ''),
      splitLines(element.diffText ?? ''),
      !element.diffShowWhitespace
   );
   const digits = Math.max(a.digits, b.digits);
   const cw = a.metrics.charWidth;
   return { a, b, unified, digits, cw, lineHeight: a.metrics.lineHeight };
}

/** Gutter width of a diff pane: one number column plus a sign column. */
function diffGutters(digits: number, cw: number): { inline: number; split: number } {
   return {
      inline: CODE_PADDING + digits * cw + 3 * cw,
      split: CODE_PADDING + digits * cw + 3 * cw,
   };
}

/** The rows of a diff view (inline or split), with highlight bands and the split divider. */
function codeDiffLines(
   element: CanvasElementModel,
   palette: CodePalette,
   dark: boolean,
   language: string,
   fontSize: number,
   firstBaseline: number,
   editing = false
): {
   lines: CodeLineView[];
   bands: NonNullable<CodeBlockView['bands']>;
   divider?: CodeBlockView['divider'];
} {
   const { a, b, unified, digits, cw, lineHeight } = codeDiffModel(element, language, fontSize);
   const colors = diffColors(dark, palette);
   const gut = diffGutters(digits, cw);
   const lines: CodeLineView[] = [];
   const bands: NonNullable<CodeBlockView['bands']> = [];
   const rowTop = (i: number): number => firstBaseline - codeBaseline(fontSize) + i * lineHeight;
   const band = (i: number, x: number, width: number, fill: string): void => {
      if (width > 0) bands.push({ x, y: rowTop(i), width, height: lineHeight, fill });
   };
   const spanBand = (i: number, textX: number, span: [number, number], fill: string): void =>
      band(i, textX + span[0] * cw, (span[1] - span[0]) * cw, fill);

   if (editing) {
      // Each side keeps its own rows (so they stay under its textarea), still styled as a
      // diff: removed lines red on the left, added green on the right, changed words marked.
      const ed = codeDiffEditLayout(element);
      const cols = Math.max(1, Math.floor((ed.left - ed.textOffset - CODE_PADDING / 2) / cw));
      const changedA = new Set(unified.filter((d) => d.op === 'removed').map((d) => d.a));
      const changedB = new Set(unified.filter((d) => d.op === 'added').map((d) => d.b));
      const spansA = new Map<number, [number, number]>();
      const spansB = new Map<number, [number, number]>();
      for (const r of splitRows(unified)) {
         if (r.op !== 'change' || r.a < 0 || r.b < 0) continue;
         const sp = changedSpan(rowText(a.rows[r.a].tokens), rowText(b.rows[r.b].tokens), !element.diffShowWhitespace);
         if (sp) {
            spansA.set(r.a, sp.a);
            spansB.set(r.b, sp.b);
         }
      }
      const sides = [
         {
            side: a,
            changed: changedA,
            spans: spansA,
            sign: '-',
            signColor: colors.removedSign,
            fill: colors.removed,
            strong: colors.removedStrong,
         },
         {
            side: b,
            changed: changedB,
            spans: spansB,
            sign: '+',
            signColor: colors.addedSign,
            fill: colors.added,
            strong: colors.addedStrong,
         },
      ];
      sides.forEach((s, k) => {
         const x0 = element.x + k * ed.left;
         const w = k === 0 ? ed.left : element.width - ed.left;
         const numberX = x0 + CODE_PADDING + digits * cw;
         const textX = x0 + ed.textOffset;
         s.side.rows.forEach((row, i) => {
            const changed = s.changed.has(i);
            lines.push({
               y: firstBaseline + i * lineHeight,
               number: row.number,
               numberX,
               textX,
               sign: changed ? { x: numberX + cw, text: s.sign, color: s.signColor } : undefined,
               // The right pane is clipped by the card; the left must not run into it.
               tokens: codeTokenViews(k === 0 ? truncateTokens(row.tokens, cols) : row.tokens, palette),
            });
            if (changed) {
               band(i, x0, w, s.fill);
               const sp = s.spans.get(i);
               const end = sp ? (k === 0 ? Math.min(sp[1], cols) : sp[1]) : 0;
               if (sp && end > sp[0]) spanBand(i, textX, [sp[0], end], s.strong);
            }
         });
      });
      return {
         lines,
         bands,
         divider: {
            x: element.x + ed.left,
            y1: element.y + codeHeaderHeight(fontSize),
            y2: element.y + element.height,
            color: colors.divider,
         },
      };
   }

   if (element.diffView === 'inline') {
      // One number column: a removed line shows its original number, the rest their new one.
      const numberX = element.x + CODE_PADDING + digits * cw;
      const signX = numberX + cw;
      const textX = element.x + gut.inline;
      unified.forEach((d, i) => {
         const ra = d.a >= 0 ? a.rows[d.a] : null;
         const rb = d.b >= 0 ? b.rows[d.b] : null;
         const row = (rb ?? ra)!;
         lines.push({
            y: firstBaseline + i * lineHeight,
            number: rb?.number ?? ra?.number ?? '',
            numberX,
            textX,
            sign:
               d.op === 'equal'
                  ? undefined
                  : d.op === 'added'
                    ? { x: signX, text: '+', color: colors.addedSign }
                    : { x: signX, text: '-', color: colors.removedSign },
            tokens: codeTokenViews(row.tokens, palette),
         });
         if (d.op !== 'equal') {
            band(i, element.x, element.width, d.op === 'added' ? colors.added : colors.removed);
         }
      });
      // Word-level emphasis where removed lines are directly followed by their replacements.
      for (let i = 0; i < unified.length; i++) {
         if (unified[i].op !== 'removed') continue;
         let j = i;
         while (j < unified.length && unified[j].op === 'removed') j++;
         for (let k = 0; k < j - i && unified[j + k]?.op === 'added'; k++) {
            const span = changedSpan(
               rowText(a.rows[unified[i + k].a].tokens),
               rowText(b.rows[unified[j + k].b].tokens),
               !element.diffShowWhitespace
            );
            if (span) {
               spanBand(i + k, textX, span.a, colors.removedStrong);
               spanBand(j + k, textX, span.b, colors.addedStrong);
            }
         }
         i = j - 1;
      }
      return { lines, bands };
   }

   // Split: original on the left half, changed on the right, change blocks paired row by row.
   const left = element.width * codeDiffSplit(element);
   const cols = Math.max(1, Math.floor((left - gut.split - CODE_PADDING / 2) / cw));
   splitRows(unified).forEach((r, i) => {
      const ra = r.a >= 0 ? a.rows[r.a] : null;
      const rb = r.b >= 0 ? b.rows[r.b] : null;
      const sides = [
         { row: ra, x0: element.x, w: left, sign: '-', signColor: colors.removedSign, fill: colors.removed },
         {
            row: rb,
            x0: element.x + left,
            w: element.width - left,
            sign: '+',
            signColor: colors.addedSign,
            fill: colors.added,
         },
      ];
      const span =
         r.op === 'change' && ra && rb
            ? changedSpan(rowText(ra.tokens), rowText(rb.tokens), !element.diffShowWhitespace)
            : null;
      sides.forEach((s, k) => {
         const numberX = s.x0 + CODE_PADDING + digits * cw;
         const textX = s.x0 + gut.split;
         if (!s.row) {
            band(i, s.x0, s.w, colors.filler);
            return;
         }
         lines.push({
            y: firstBaseline + i * lineHeight,
            number: s.row.number,
            numberX,
            textX,
            sign: r.op === 'change' ? { x: numberX + cw, text: s.sign, color: s.signColor } : undefined,
            // The right pane is clipped by the card; the left must not run into it.
            tokens: codeTokenViews(k === 0 ? truncateTokens(s.row.tokens, cols) : s.row.tokens, palette),
         });
         if (r.op === 'change') {
            band(i, s.x0, s.w, s.fill);
            const sp = span ? (k === 0 ? span.a : span.b) : null;
            if (sp) {
               const end = k === 0 ? Math.min(sp[1], cols) : sp[1];
               if (end > sp[0]) {
                  spanBand(i, textX, [sp[0], end], k === 0 ? colors.removedStrong : colors.addedStrong);
               }
            }
         }
      });
   });
   return {
      lines,
      bands,
      divider: {
         x: element.x + left,
         y1: element.y + codeHeaderHeight(fontSize),
         y2: element.y + element.height,
         color: colors.divider,
      },
   };
}

/**
 * Geometry of a diff card while both sides are edited: two halves, each a plain code
 * pane with a shared gutter width (shared by the renderer and the two textareas).
 */
export function codeDiffEditLayout(el: CanvasElementModel): {
   /** Width of the left (original) pane; the right pane takes the rest. */
   left: number;
   textOffset: number;
   lineHeight: number;
   rows: number;
} {
   const fontSize = el.fontSize ?? CODE_FONT_SIZE;
   if (el.diffView !== 'inline') {
      // Split: the textareas sit exactly over the split view's two halves and rows.
      const model = codeDiffModel(el, 'plaintext', fontSize);
      return {
         left: el.width * codeDiffSplit(el),
         textOffset: diffGutters(model.digits, model.cw).split,
         lineHeight: model.lineHeight,
         rows: splitRows(model.unified).length,
      };
   }
   const count = Math.max(codeLineCount(el.text ?? ''), codeLineCount(el.diffText ?? ''));
   const m = codeLayoutMetrics(fontSize, count);
   // Same gutter as the split view (numbers + a sign column), so code doesn't jump on commit.
   const digits = Math.max(2, String(count).length);
   const textOffset = diffGutters(digits, m.charWidth).split;
   const rows = Math.max(splitLines(el.text ?? '').length, splitLines(el.diffText ?? '').length);
   return { left: el.width * codeDiffSplit(el), textOffset, lineHeight: m.lineHeight, rows };
}

/**
 * The smallest card that shows both sides of a diff while they are edited (two plain
 * panes at the current split): the textareas must never need to scroll, or the caret
 * would drift away from the highlighted code drawn beneath them.
 */
export function codeDiffEditSize(el: CanvasElementModel): { width: number; height: number } {
   const fontSize = el.fontSize ?? CODE_FONT_SIZE;
   const d = codeDiffEditLayout(el);
   const cw = codeCharWidth(fontSize);
   const longest = (text: string): number =>
      Math.max(1, ...splitLines(text).map((l) => expandTabs(l).length));
   // One spare column so a caret at the end of the longest line still fits.
   const pane = (n: number): number => d.textOffset + (n + 1) * cw + CODE_PADDING;
   const r = codeDiffSplit(el);
   const width = Math.max(pane(longest(el.text ?? '')) / r, pane(longest(el.diffText ?? '')) / (1 - r));
   return {
      width: Math.ceil(width),
      height: Math.ceil(codeHeaderHeight(fontSize) + d.rows * d.lineHeight + CODE_PADDING * 2),
   };
}

/** Diff-aware content size: the plain size, or the inline/split diff's when a diff is shown. */
export function codeElementContentSize(el: CanvasElementModel): { width: number; height: number } {
   const fontSize = el.fontSize ?? CODE_FONT_SIZE;
   const title = codeTitle(el);
   if (!codeDiffActive(el)) {
      return codeContentSize(el.text ?? '', fontSize, title);
   }
   const { a, b, unified, digits, cw, lineHeight } = codeDiffModel(el, 'plaintext', fontSize);
   const gut = diffGutters(digits, cw);
   const longestOf = (rows: CodeRow[]): number => Math.max(1, ...rows.map((r) => rowText(r.tokens).length));
   const longest = Math.max(longestOf(a.rows), longestOf(b.rows));
   // Each split pane must fit its own side at the divider's position.
   const pane = (n: number): number => gut.split + n * cw + CODE_PADDING / 2 + 1;
   const r = codeDiffSplit(el);
   const header = codeHeaderHeight(fontSize);
   const nameWidth = 2 * codeDotsWidth(fontSize) + title.length * codeTitleSize(fontSize) * 0.62 + 8;
   const inline = el.diffView === 'inline';
   const width = inline
      ? gut.inline + longest * cw + CODE_PADDING
      : Math.max(pane(longestOf(a.rows)) / r, pane(longestOf(b.rows)) / (1 - r));
   const rows = inline ? unified.length : splitRows(unified).length;
   return {
      width: Math.ceil(Math.max(width, nameWidth)),
      height: Math.ceil(header + rows * lineHeight + CODE_PADDING * 2),
   };
}

/** The smallest box that shows all of `text` without clipping. */
export function codeContentSize(text: string, fontSize: number, title = ''): { width: number; height: number } {
   const { rows, metrics } = layoutCodeRows(text, 'plaintext', fontSize);
   const longest = Math.max(1, ...rows.map((r) => r.tokens.reduce((c, t) => c + t.text.length, 0)));
   const header = codeHeaderHeight(fontSize);
   // The title bar needs room for the centered title between its dot cluster and an
   // equal margin on the right, as well as the code.
   const nameWidth = 2 * codeDotsWidth(fontSize) + title.length * codeTitleSize(fontSize) * 0.62 + 8;
   return {
      width: Math.ceil(Math.max(metrics.textOffset + longest * metrics.charWidth + CODE_PADDING, nameWidth)),
      height: Math.ceil(header + rows.length * metrics.lineHeight + CODE_PADDING * 2),
   };
}

/**
 * The Prettier print width that matches a code card's current width, so formatting
 * re-flows the code to the card's bounds (taller, not wider).
 */
export function codePrintWidth(element: CanvasElementModel): number {
   const fontSize = element.fontSize ?? CODE_FONT_SIZE;
   const m = codeLayoutMetrics(fontSize, codeLineCount(element.text ?? ''));
   return Math.max(20, codeColumns(element.width, m.textOffset, m.charWidth));
}

/**
 * Print widths that fit each side of a diff to its share of the card as currently shown
 * (half a split, or the whole inline view), so Format re-flows taller rather than wider.
 */
export function codeDiffPrintWidths(element: CanvasElementModel): { original: number; modified: number } {
   if (!codeDiffActive(element)) {
      const w = codePrintWidth(element);
      return { original: w, modified: w };
   }
   const fontSize = element.fontSize ?? CODE_FONT_SIZE;
   const count = Math.max(codeLineCount(element.text ?? ''), codeLineCount(element.diffText ?? ''));
   const cw = codeCharWidth(fontSize);
   const gut = diffGutters(Math.max(2, String(count).length), cw);
   const fit = (width: number, gutter: number, pad: number): number =>
      Math.max(20, Math.floor((width - gutter - pad) / cw + 1e-6));
   if (element.diffView === 'inline') {
      const w = fit(element.width, gut.inline, CODE_PADDING);
      return { original: w, modified: w };
   }
   const left = element.width * codeDiffSplit(element);
   return {
      original: fit(left, gut.split, CODE_PADDING / 2 + 1),
      modified: fit(element.width - left, gut.split, CODE_PADDING / 2 + 1),
   };
}

/**
 * Where a 1-based line/column of one side sits on the card as drawn now (plain, split or
 * inline diff): the start x, the row's baseline and the width to underline (to the end of
 * the line). Null when the line is not shown (collapsed, or out of range).
 */
export function codeLineMark(
   element: CanvasElementModel,
   side: 'original' | 'modified',
   line: number,
   column = 1
): { x: number; y: number; width: number } | null {
   if (element.expandedHeight != null || line < 1) return null;
   const fontSize = element.fontSize ?? CODE_FONT_SIZE;
   const top = element.y + codeHeaderHeight(fontSize) + CODE_PADDING + codeBaseline(fontSize);
   const diff = codeDiffActive(element);
   const source = side === 'modified' && diff ? (element.diffText ?? '') : (element.text ?? '');
   const lines = splitLines(source);
   const raw = lines[line - 1];
   if (raw == null) return null;
   const cw = codeCharWidth(fontSize);
   const col = Math.min(expandTabs(raw.slice(0, Math.max(0, column - 1))).length, expandTabs(raw).length);
   const rest = Math.max(1, expandTabs(raw).length - col);
   if (!diff) {
      const m = codeLayoutMetrics(fontSize, codeLineCount(source));
      return { x: element.x + m.textOffset + col * cw, y: top + (line - 1) * m.lineHeight, width: rest * cw };
   }
   const { unified, digits, lineHeight } = codeDiffModel(element, 'plaintext', fontSize);
   const gut = diffGutters(digits, cw);
   const key = side === 'modified' ? 'b' : 'a';
   if (element.diffView === 'inline') {
      const at = unified.findIndex((d) => d[key] === line - 1);
      if (at < 0) return null;
      return { x: element.x + gut.inline + col * cw, y: top + at * lineHeight, width: rest * cw };
   }
   const at = splitRows(unified).findIndex((r) => r[key] === line - 1);
   if (at < 0) return null;
   const left = element.width * codeDiffSplit(element);
   const x0 = side === 'modified' ? element.x + left : element.x;
   const maxW = (side === 'modified' ? element.x + element.width : element.x + left) - (x0 + gut.split + col * cw);
   return { x: x0 + gut.split + col * cw, y: top + at * lineHeight, width: Math.max(cw, Math.min(rest * cw, maxW)) };
}

/** The surface a code card is drawn on: its own fill, else the theme-matched default. */
function codeBackground(element: CanvasElementModel, theme: ThemeColors | undefined): string {
   if (element.fillStyle !== 'none' && element.backgroundColor) {
      return sentinelColor(element.backgroundColor, theme);
   }
   const canvasDark = theme ? isDarkColor(theme.canvasBg) : false;
   return codePalette(canvasDark).background;
}

export function codeBlockView(
   element: CanvasElementModel,
   theme: ThemeColors | undefined,
   diffEditing = false
): CodeBlockView {
   const fontSize = element.fontSize ?? CODE_FONT_SIZE;
   const background = codeBackground(element, theme);
   const palette = codePalette(isDarkColor(background));
   const language = element.language ?? 'typescript';
   const { rows, metrics: m, digits } = layoutCodeRows(element.text ?? '', language, fontSize);
   const baseline = codeBaseline(fontSize);
   const header = codeHeaderHeight(fontSize);
   const k = codeChromeScale(fontSize);
   const collapsed = element.expandedHeight != null;
   const top = element.y + header + CODE_PADDING;
   const diff =
      !collapsed && codeDiffActive(element)
         ? codeDiffLines(
              element,
              palette,
              isDarkColor(background),
              language,
              fontSize,
              top + baseline,
              // A split diff edits in place over its own view (spacer lines keep the rows);
              // only an inline diff switches to two plain panes while edited.
              diffEditing && element.diffView === 'inline'
           )
         : null;
   const lines = collapsed
      ? []
      : (diff?.lines ??
        rows.map((row, i) => ({
           y: top + i * m.lineHeight + baseline,
           number: row.number,
           tokens: codeTokenViews(row.tokens, palette),
        })));
   return {
      ...(diff ? { bands: diff.bands, divider: diff.divider } : {}),
      rect: {
         x: element.x,
         y: element.y,
         width: element.width,
         height: element.height,
         rx: element.cornerRadius ?? 8,
      },
      background,
      fontSize,
      fontFamily: fontStack('code'),
      clipId: `code-clip-${element.id}-${clipKey(element)}`,
      numberX: element.x + CODE_PADDING + digits * m.charWidth,
      textX: element.x + m.textOffset,
      numberColor: palette.muted,
      lines,
      collapsed,
      header: {
         height: header,
         text: codeTitle({ fileName: element.fileName, language }),
         x: element.x + element.width / 2,
         y: element.y + header / 2 + 4.5 * k,
         fontSize: codeTitleSize(fontSize),
         color: palette.plain,
         tint: palette.muted,
         dots: TRAFFIC_LIGHTS.map((d, i) => ({
            x: element.x + (CODE_PADDING + 2 + i * TRAFFIC_LIGHT_GAP) * k,
            y: element.y + header / 2,
            r: 5.5 * k,
            color: d.color,
            action: d.action,
         })),
      },
   };
}
