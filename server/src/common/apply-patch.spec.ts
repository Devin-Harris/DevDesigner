import { applyDefined } from './apply-patch';

describe('applyDefined', () => {
  it('copies only the listed keys that were sent, nulls included', () => {
    const row = { a: 1, b: 'x', c: true as boolean | null, d: 4 };
    applyDefined(row, { a: 2, b: undefined, c: null, d: 9 } as Partial<typeof row>, ['a', 'b', 'c']);
    expect(row).toEqual({ a: 2, b: 'x', c: null, d: 4 });
  });
});
