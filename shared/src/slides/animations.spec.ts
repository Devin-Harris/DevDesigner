import type { SlideAnimation } from '../models';
import {
  hiddenAtStep,
  legacyAnimations,
  newAnimation,
  normalizeAnimations,
  planAnimations,
  remapAnimations,
  slideAnimations,
} from './animations';

const anim = (
  target: string,
  patch: Partial<Omit<SlideAnimation, 'id' | 'target'>> = {},
): SlideAnimation => ({ ...newAnimation(target, { duration: 500, ...patch }), id: `a-${target}` });

describe('planAnimations', () => {
  it('opens a group at each click', () => {
    const plan = planAnimations([anim('a'), anim('b'), anim('c', { trigger: 'with' })]);
    expect(plan.groups.map((g) => g.entries.map((e) => e.animation.target))).toEqual([
      ['a'],
      ['b', 'c'],
    ]);
    expect(plan.groups.every((g) => !g.auto)).toBe(true);
  });

  it('times with-previous and after-previous relative to the entry before', () => {
    const plan = planAnimations([
      anim('a', { duration: 400 }),
      anim('b', { trigger: 'with', delay: 100, duration: 200 }),
      anim('c', { trigger: 'after', duration: 300 }),
      anim('d', { trigger: 'after', delay: 50, duration: 100 }),
    ]);
    const [g] = plan.groups;
    expect(g.entries.map((e) => [e.start, e.end])).toEqual([
      [0, 400],
      [100, 300],
      [300, 600],
      [650, 750],
    ]);
    expect(g.duration).toBe(750);
  });

  it('plays leading with/after animations on their own, before any click', () => {
    const plan = planAnimations([anim('a', { trigger: 'after' }), anim('b')]);
    expect(plan.groups.map((g) => g.auto)).toEqual([true, false]);
  });

  it('skips targets that are not on the slide and counts appear as instant', () => {
    const plan = planAnimations(
      [anim('a', { effect: 'appear', duration: 900 }), anim('gone')],
      new Set(['a']),
    );
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].duration).toBe(0);
  });
});

describe('hiddenAtStep', () => {
  const plan = planAnimations([
    anim('a'),
    anim('b', { kind: 'exit' }),
    anim('c', { kind: 'emphasis', effect: 'pulse' }),
    anim('a', { kind: 'exit' }),
  ]);

  it('hides entrance targets until they play and keeps exit targets until they leave', () => {
    expect([...hiddenAtStep(plan, 0)]).toEqual(['a']);
    expect([...hiddenAtStep(plan, 1)]).toEqual([]);
    expect([...hiddenAtStep(plan, 2)]).toEqual(['b']);
    expect([...hiddenAtStep(plan, 4)].sort()).toEqual(['a', 'b']);
  });

  it('clamps the step', () => {
    expect([...hiddenAtStep(plan, 99)].sort()).toEqual(['a', 'b']);
    expect([...hiddenAtStep(plan, -1)]).toEqual(['a']);
  });
});

describe('legacyAnimations / slideAnimations', () => {
  const items = [
    { id: 'x', step: 2, x: 0, y: 0 },
    { id: 'y', step: 1, x: 50, y: 0 },
    { id: 'z', step: 1, x: 0, y: 0 },
    { id: 'plain', x: 0, y: 0 },
  ];

  it('turns build steps into clicks, with same-step items together', () => {
    const list = legacyAnimations(items);
    expect(list.map((a) => [a.target, a.trigger])).toEqual([
      ['z', 'click'],
      ['y', 'with'],
      ['x', 'click'],
    ]);
  });

  it('prefers a slide that has its own list, even an empty one', () => {
    expect(slideAnimations({ order: 0, animations: [] }, items)).toEqual([]);
    expect(slideAnimations({ order: 0 }, items)).toHaveLength(3);
  });
});

describe('remapAnimations / normalizeAnimations', () => {
  it('re-points copied targets and drops the rest', () => {
    const out = remapAnimations([anim('a'), anim('b')], new Map([['a', 'a2']]));
    expect(out.map((a) => a.target)).toEqual(['a2']);
  });

  it('clamps timings and keeps a direction only where it applies', () => {
    const [fly, fade] = normalizeAnimations([
      anim('a', { effect: 'fly', duration: 99_999, delay: -5 }),
      anim('b', { effect: 'fade', direction: 'up' }),
    ]);
    expect(fly).toMatchObject({ duration: 10_000, delay: 0, direction: 'left' });
    expect(fade.direction).toBeUndefined();
  });

  it('swaps an effect the kind does not offer', () => {
    const [a] = normalizeAnimations([anim('a', { kind: 'emphasis', effect: 'fly' })]);
    expect(a.effect).toBe('pulse');
  });
});
