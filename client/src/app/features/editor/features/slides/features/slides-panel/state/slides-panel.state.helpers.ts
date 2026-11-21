import type { MorphBy, SlideDirection, SlideEasing, SlideTransitionType } from '@devdesigner/shared';
import type { SelectOption } from '../../../../../../../shared/ui/components/select/select.component';

/** Module-level pieces of slides-panel.state. */

export const TYPE_OPTIONS: SelectOption<SlideTransitionType>[] = [
   { value: 'none', label: 'None' },
   { value: 'fade', label: 'Fade' },
   { value: 'slide', label: 'Slide' },
   { value: 'zoom', label: 'Zoom' },
   // Stored as 'morph': objects on both slides morph, the rest cross-fades.
   { value: 'morph', label: 'Auto' },
];

export const DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
   { value: 'left', label: 'To the left' },
   { value: 'right', label: 'To the right' },
   { value: 'up', label: 'Upwards' },
   { value: 'down', label: 'Downwards' },
];

export const MORPH_BY_SELECT: SelectOption<MorphBy>[] = [
   { value: 'character', label: 'Characters' },
   { value: 'word', label: 'Words' },
   { value: 'object', label: 'Objects' },
];

export const EASING_OPTIONS: SelectOption<SlideEasing>[] = [
   { value: 'ease-in-out', label: 'Ease in-out' },
   { value: 'ease', label: 'Ease' },
   { value: 'ease-in', label: 'Ease in' },
   { value: 'ease-out', label: 'Ease out' },
   { value: 'linear', label: 'Linear' },
];

/**
 * Scroll a slide card into view inside its own scrolling list only. `scrollIntoView`
 * would also scroll the canvas when the panel is panned off screen, dragging the
 * toolbars and minimap away with it.
 */
export function revealCard(card: Element | undefined, within: HTMLElement | null): void {
   let list = card?.parentElement ?? null;
   while (list && list !== within && !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) {
      list = list.parentElement;
   }
   if (!card || !list || !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) {
      return;
   }
   const box = list.getBoundingClientRect();
   const r = card.getBoundingClientRect();
   // The panel is scaled with the canvas zoom; scrollTop is in unscaled px.
   const scale = box.height / (list.offsetHeight || 1) || 1;
   if (r.top < box.top) {
      list.scrollTop -= (box.top - r.top) / scale;
   } else if (r.bottom > box.bottom) {
      list.scrollTop += (r.bottom - box.bottom) / scale;
   }
}
