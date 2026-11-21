/**
 * Slide-list selection for a click: Shift selects the whole range from the anchor to the
 * clicked slide (in list order), Ctrl/Cmd toggles just the clicked slide.
 * Returns the new selection and the anchor to keep for the next Shift-click.
 */
export function nextSlideSelection(
   order: readonly string[],
   selected: readonly string[],
   anchor: string | null,
   clicked: string,
   mode: 'range' | 'toggle'
): { ids: string[]; anchor: string } {
   if (mode === 'range') {
      const from = anchor ? order.indexOf(anchor) : -1;
      const to = order.indexOf(clicked);
      if (from >= 0 && to >= 0) {
         const [a, b] = from <= to ? [from, to] : [to, from];
         // The anchor stays put so successive Shift-clicks re-span from it.
         return { ids: order.slice(a, b + 1), anchor: anchor as string };
      }
      // No usable anchor: behave like selecting just the clicked slide.
      return { ids: [clicked], anchor: clicked };
   }
   const ids = new Set(selected);
   if (ids.has(clicked)) {
      ids.delete(clicked);
   } else {
      ids.add(clicked);
   }
   return { ids: order.filter((id) => ids.has(id)), anchor: clicked };
}
