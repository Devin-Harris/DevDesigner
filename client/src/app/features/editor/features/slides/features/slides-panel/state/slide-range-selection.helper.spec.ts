import { nextSlideSelection } from './slide-range-selection.helper';

describe('nextSlideSelection', () => {
   const order = ['a', 'b', 'c', 'd', 'e'];

   it('Shift-click selects the range from the anchor down', () => {
      expect(nextSlideSelection(order, ['b'], 'b', 'e', 'range')).toEqual({ ids: ['b', 'c', 'd', 'e'], anchor: 'b' });
   });

   it('Shift-click selects the range from the anchor up', () => {
      expect(nextSlideSelection(order, ['d'], 'd', 'a', 'range')).toEqual({ ids: ['a', 'b', 'c', 'd'], anchor: 'd' });
   });

   it('successive Shift-clicks re-span from the same anchor', () => {
      const first = nextSlideSelection(order, ['b'], 'b', 'e', 'range');
      expect(nextSlideSelection(order, first.ids, first.anchor, 'c', 'range').ids).toEqual(['b', 'c']);
   });

   it('Shift-click without an anchor selects only the clicked slide', () => {
      expect(nextSlideSelection(order, [], null, 'c', 'range')).toEqual({ ids: ['c'], anchor: 'c' });
   });

   it('Ctrl-click toggles the clicked slide and moves the anchor', () => {
      expect(nextSlideSelection(order, ['a', 'c'], 'a', 'd', 'toggle')).toEqual({ ids: ['a', 'c', 'd'], anchor: 'd' });
      expect(nextSlideSelection(order, ['a', 'c'], 'a', 'c', 'toggle')).toEqual({ ids: ['a'], anchor: 'c' });
   });
});
