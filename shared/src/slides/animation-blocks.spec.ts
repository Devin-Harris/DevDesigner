import type { SlideAnimation } from '../models';
import { newAnimation } from './animations';
import { fromBlocks, moveAnimationBlock, moveAnimationCard, toBlocks } from './animation-blocks';

const a = (id: string, trigger: SlideAnimation['trigger'] = 'click'): SlideAnimation => ({
  ...newAnimation(id, { trigger }),
  id,
});
const shape = (list: SlideAnimation[]): string =>
  list.map((x) => `${x.trigger === 'click' ? '|' : '+'}${x.id}`).join('');

describe('animation blocks', () => {
  it('groups by click and keeps a leading automatic block', () => {
    const blocks = toBlocks([a('x', 'with'), a('y'), a('z', 'after')]);
    expect(blocks.map((b) => [b.auto, b.items.map((i) => i.id)])).toEqual([
      [true, ['x']],
      [false, ['y', 'z']],
    ]);
    expect(shape(fromBlocks(blocks))).toBe('+x|y+z');
  });

  it('moves a card into another block', () => {
    const list = [a('p'), a('q'), a('r', 'with')];
    expect(shape(moveAnimationCard(list, 'p', { block: 1, index: 2 }))).toBe('|q+r+p');
    expect(shape(moveAnimationCard(list, 'r', { block: 0, index: 0 }))).toBe('|r+p|q');
  });

  it('moves a card out into a block of its own', () => {
    const list = [a('p'), a('q', 'with')];
    expect(shape(moveAnimationCard(list, 'q', { newBlock: 1 }))).toBe('|p|q');
  });

  it('moves whole blocks', () => {
    const list = [a('p'), a('q'), a('r', 'with'), a('s')];
    expect(shape(moveAnimationBlock(list, 1, 0))).toBe('|q+r|p|s');
    expect(shape(moveAnimationBlock(list, 0, 3))).toBe('|q+r|s|p');
  });
});
