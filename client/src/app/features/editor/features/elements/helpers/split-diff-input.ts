import { diffEditValue, paddedToReal, realToPadded, stripDiffSpacers } from '../../../helpers/code-diff-edit.helper';

/**
 * Typing in either pane of a split diff edited in place: the textarea holds that side's
 * lines on the split view's rows (spacer lines in the gaps). Returns the side's real code
 * after the keystroke and re-pads both panes for the new diff, keeping each caret on the
 * same code. A delete that only removed a spacer (or the newline next to one) changes no
 * code, so it is carried on to the real character and the key still does something.
 */
export function applySplitDiffInput(
   event: Event,
   side: 'original' | 'modified',
   code: { text: string; diffText: string },
   ignoreWhitespace: boolean
): string {
   const area = event.target as HTMLTextAreaElement;
   const before = side === 'original' ? code.text : code.diffText;
   let real = stripDiffSpacers(area.value);
   let start = paddedToReal(area.value, area.selectionStart);
   let end = paddedToReal(area.value, area.selectionEnd);
   const kind = (event as InputEvent).inputType;
   if (real === before && start === end) {
      if (kind === 'deleteContentBackward' && start > 0) {
         real = real.slice(0, start - 1) + real.slice(start);
         start = end = start - 1;
      } else if (kind === 'deleteContentForward' && start < real.length) {
         real = real.slice(0, start) + real.slice(start + 1);
      }
   }
   const next = side === 'original' ? { ...code, text: real } : { ...code, diffText: real };
   repad(area, diffEditValue(next.text, next.diffText, side, ignoreWhitespace), start, end);
   // The other pane's rows may have shifted too.
   const other = document.querySelector(
      side === 'original' ? 'textarea.diff-pane' : 'textarea.code-pane:not(.diff-pane)'
   ) as HTMLTextAreaElement | null;
   if (other) {
      const otherSide = side === 'original' ? 'modified' : 'original';
      repad(
         other,
         diffEditValue(next.text, next.diffText, otherSide, ignoreWhitespace),
         paddedToReal(other.value, other.selectionStart),
         paddedToReal(other.value, other.selectionEnd)
      );
   }
   return real;
}

/** Give a pane its new padded value with the selection on the same real code offsets. */
function repad(area: HTMLTextAreaElement, padded: string, start: number, end: number): void {
   if (area.value !== padded) {
      area.value = padded;
   }
   area.setSelectionRange(realToPadded(padded, start), realToPadded(padded, end));
}
