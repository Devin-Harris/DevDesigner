import { applyModelPatch, diffModel } from './index';

describe('diffModel / applyModelPatch', () => {
  const before = { id: 'e1', x: 1, y: 2, text: 'hi', runs: [{ text: 'a' }], fontSize: 12 as number | undefined };

  it('returns only the changed fields, by value', () => {
    const after = { ...before, x: 5, runs: [{ text: 'a' }] };
    expect(diffModel(before, after)).toEqual({ patch: { x: 5 } });
    expect(diffModel(before, { ...before })).toBeNull();
  });

  it('lists optional fields that became absent', () => {
    const { fontSize: _f, ...after } = { ...before, text: 'yo' };
    const change = diffModel(before, after as typeof before);
    expect(change).toEqual({ patch: { text: 'yo' }, unset: ['fontSize'] });
    expect(applyModelPatch(before, change!)).toEqual(after);
  });

  it('round-trips: applying the diff to the old model gives the new one', () => {
    const after = { ...before, y: 9, runs: [{ text: 'b' }], fontSize: 20 };
    expect(applyModelPatch(before, diffModel(before, after)!)).toEqual(after);
  });

  it('never carries the id', () => {
    expect(diffModel(before, { ...before, id: 'other' })).toBeNull();
  });
});
