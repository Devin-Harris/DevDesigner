import type { CanvasElementModel } from '@devdesigner/shared';
import { frameScrollExtents, overflows } from './frame-scroll.helper';
import { buildShapeViews } from './shape-views';

const el = (id: string, over: Partial<CanvasElementModel> = {}): CanvasElementModel =>
   ({
      id,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      angle: 0,
      strokeColor: '#000000',
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 100,
      zIndex: 0,
      ...over,
   }) as CanvasElementModel;

describe('frameScrollExtents', () => {
   const frame = el('f', { type: 'frame', width: 200, height: 200, scrollable: true });

   it('measures how far overflowing content scrolls', () => {
      const tall = el('t', { x: 10, y: 150, height: 150 });
      const ext = frameScrollExtents([frame, tall]).get('f')!;
      expect(ext.members).toEqual(['t']);
      expect(ext.maxScroll).toBe(100);
      expect(ext.minScroll).toBe(0);
      expect(ext.maxScrollX).toBe(0);
   });

   it('scrolls sideways when content runs past the right edge', () => {
      const wide = el('w', { x: 150, y: 10, width: 150 });
      expect(frameScrollExtents([frame, wide]).get('f')!.maxScrollX).toBe(100);
   });

   it('does not scroll content that fits, nor hold items of another slide', () => {
      const fits = el('a', { x: 10, y: 10 });
      const other = el('b', { x: 10, y: 150, height: 300, slideId: 's2' });
      const ext = frameScrollExtents([frame, fits, other]).get('f')!;
      expect(ext.members).toEqual(['a']);
      expect(overflows(ext)).toBe(false);
   });

   it('keeps the padding on every side reachable', () => {
      const padded = { ...frame, scrollPadding: 20 };
      const tall = el('t', { x: 10, y: 10, height: 290 });
      const ext = frameScrollExtents([padded, tall]).get('f')!;
      expect(ext.minScroll).toBe(-10);
      expect(ext.maxScroll).toBe(120);
      expect(ext.minScrollX).toBe(-10);
   });

   it('tags held views with the frame so the layer can shift them', () => {
      const views = buildShapeViews([frame, el('t', { x: 10, y: 150, height: 150 })], [], new Set());
      const v = views.find((x) => x.id === 't')!;
      expect(v.frameScroll).toBe('f');
      expect(v.frameClip).toEqual({ x: 0, y: 0, width: 200, height: 200 });
   });
});
