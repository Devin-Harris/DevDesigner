import type { CanvasElementModel } from '@devdesigner/shared';
import { bindingBoxResolver, freezeLinePatch, linesBoundTo } from './bound-lines.helper';
import { absolutePoints } from './element-geometry.helper';
import { lineEnds } from './render/shape-primitives';
import { elbowLineRoute } from './route.helper';

function element(overrides: Partial<CanvasElementModel>): CanvasElementModel {
   return {
      id: 'el',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      angle: 0,
      strokeColor: '#131720',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 100,
      zIndex: 1,
      ...overrides,
   };
}

const a = element({ id: 'a', x: 0, y: 0 });
const b = element({ id: 'b', x: 400, y: 200 });
const line = element({
   id: 'l',
   type: 'arrow',
   elbow: true,
   x: 0,
   y: 0,
   width: 0,
   height: 0,
   // Stale stored ends far from where the line is drawn, plus one bend.
   points: [
      { x: 0, y: 0 },
      { x: 250, y: 100 },
      { x: 999, y: 999 },
   ],
   startBinding: { targetKind: 'element', targetId: 'a' },
   endBinding: { targetKind: 'element', targetId: 'b' },
});

function drawnRoute(l: CanvasElementModel, els: CanvasElementModel[]): { x: number; y: number }[] {
   const resolve = bindingBoxResolver(els, []);
   const ends = lineEnds(l, resolve);
   return elbowLineRoute(ends[0], ends[ends.length - 1], absolutePoints(l).slice(1, -1));
}

describe('bound-lines helper', () => {
   it('finds lines bound to a target', () => {
      expect(linesBoundTo([a, b, line], 'b').map((e) => e.id)).toEqual(['l']);
      expect(linesBoundTo([a, b, line], 'x')).toEqual([]);
   });

   it('keeps an elbow line where it is drawn when its end target is removed', () => {
      const before = drawnRoute(line, [a, b, line]);
      const patch = freezeLinePatch(line, 'b', bindingBoxResolver([a, b, line], []));
      expect(patch.endBinding).toBeNull();
      const after = drawnRoute({ ...line, ...patch, endBinding: undefined } as CanvasElementModel, [a, line]);
      expect(after.length).toBe(before.length);
      after.forEach((p, i) => {
         expect(p.x).toBeCloseTo(before[i].x, 0);
         expect(p.y).toBeCloseTo(before[i].y, 0);
      });
   });

   it('rebinds to a replacement instead of dropping the binding', () => {
      const patch = freezeLinePatch(line, 'b', bindingBoxResolver([a, b, line], []), 'img');
      expect(patch.endBinding).toEqual({ targetKind: 'element', targetId: 'img' });
   });
});
