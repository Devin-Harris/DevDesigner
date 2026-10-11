// Sequence-diagram message label layout, shared by the canvas, the SVG export and
// the connector anchoring so a label wraps identically everywhere. Pure and
// render-agnostic: callers pass the horizontal span the label may use.

/** Glyph width of the 11px monospace message label font. */
export const SEQ_LABEL_CHAR_W = 6.6;
/** Horizontal padding of a label pill (both sides together). */
export const SEQ_LABEL_PAD_X = 20;
/** Arrow shaft that must stay visible at each end of a message, beside its label. */
export const SEQ_ARROW_MIN_VISIBLE = 24;
/** Never wrap narrower than this many characters per line. */
const MIN_CHARS = 8;

/**
 * How many characters of label fit on one line of a message that spans `span` px
 * between its two lifelines, leaving some of the arrow visible on both sides of
 * the (centered) label so a long label can never hide the arrow.
 */
export function messageLabelMaxChars(span: number): number {
  const usable = span - 2 * SEQ_ARROW_MIN_VISIBLE - SEQ_LABEL_PAD_X;
  return Math.max(MIN_CHARS, Math.floor(usable / SEQ_LABEL_CHAR_W));
}

/** Characters per line of a break (divider) label across `span` px. */
export function breakLabelMaxChars(span: number): number {
  return Math.max(MIN_CHARS, Math.floor((span - 30) / (SEQ_LABEL_CHAR_W + 0.44)));
}

/**
 * Greedy word-wrap of `label` to at most `maxChars` per line. Explicit line
 * breaks are kept; words longer than a line are broken. Returns the lines (at
 * least one, possibly empty).
 */
export function wrapLabelLines(label: string, maxChars: number): string[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const out: string[] = [];
  for (const paragraph of label.split(/\r?\n/)) {
    if (paragraph.length <= limit) {
      out.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      let rest = word;
      while (rest.length > limit) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      if (!line) {
        line = rest;
      } else if (line.length + 1 + rest.length <= limit) {
        line += ` ${rest}`;
      } else {
        out.push(line);
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * The lines a message label is drawn with when it spans `span` px. With `wrap`
 * off the label keeps only its explicit line breaks, however long it is.
 */
export function messageLabelLines(
  label: string,
  span: number,
  isBreak = false,
  wrap = true,
): string[] {
  if (!wrap) return label.split(/\r?\n/);
  return wrapLabelLines(label, isBreak ? breakLabelMaxChars(span) : messageLabelMaxChars(span));
}
