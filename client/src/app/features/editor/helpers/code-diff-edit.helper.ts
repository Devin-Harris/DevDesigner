import { diffLines, splitLines, splitRows } from './code-diff.helper';

/**
 * Editing a split diff in place: each side's textarea shows that side's lines on the same
 * rows as the split view, with an invisible spacer line wherever the view leaves a gap for
 * the other side's extra lines. So nothing moves when the editor opens, and the spacers are
 * stripped again before anything is stored.
 */
export const DIFF_SPACER = '⁠';

/** One side of a split diff as its edit textarea shows it (spacer lines in the gaps). */
export function diffEditValue(
   original: string,
   changed: string,
   side: 'original' | 'modified',
   ignoreWhitespace: boolean
): string {
   const a = splitLines(original);
   const b = splitLines(changed);
   const rows = splitRows(diffLines(a, b, ignoreWhitespace));
   return rows
      .map((r) => {
         const i = side === 'original' ? r.a : r.b;
         const src = side === 'original' ? a : b;
         return i >= 0 ? (src[i] ?? '') : DIFF_SPACER;
      })
      .join('\n');
}

/** The real code in an edit textarea: spacer-only lines dropped, stray spacers removed. */
export function stripDiffSpacers(value: string): string {
   return value
      .split('\n')
      .filter((l) => l !== DIFF_SPACER)
      .map((l) => l.split(DIFF_SPACER).join(''))
      .join('\n');
}

/** A caret offset in a padded textarea value as an offset into its stripped code. */
export function paddedToReal(padded: string, offset: number): number {
   const lines = padded.split('\n');
   let pos = 0;
   let real = 0;
   for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const end = pos + line.length;
      const spacer = line === DIFF_SPACER;
      if (offset <= end) {
         if (spacer) return real;
         return (
            real +
            line
               .slice(0, offset - pos)
               .split(DIFF_SPACER)
               .join('').length
         );
      }
      if (!spacer) real += line.split(DIFF_SPACER).join('').length + 1;
      pos = end + 1;
   }
   return Math.max(0, real - 1);
}

/** An offset into the real code as a caret offset in its padded textarea value. */
export function realToPadded(padded: string, offset: number): number {
   const lines = padded.split('\n');
   let pos = 0;
   let real = 0;
   for (const line of lines) {
      if (line !== DIFF_SPACER) {
         if (offset <= real + line.length) return pos + (offset - real);
         real += line.length + 1;
      }
      pos += line.length + 1;
   }
   return padded.length;
}
