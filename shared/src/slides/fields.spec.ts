import { fieldContext, fillFieldText, hasFields, resolveFields } from './fields';

describe('fields', () => {
  const ctx = fieldContext('b', ['a', 'b', 'c'], 'Deck', new Date(2026, 0, 2));

  it('numbers a slide among the shown slides', () => {
    expect(ctx.slide).toBe('2');
    expect(ctx.total).toBe('3');
    expect(fieldContext('x', ['a'], 'Deck').slide).toBe('');
  });

  it('fills tokens and leaves other braces alone', () => {
    expect(fillFieldText('Slide {{slide}} of {{total}} · {{title}}', ctx)).toBe('Slide 2 of 3 · Deck');
    expect(fillFieldText('{{nope}}', ctx)).toBe('{{nope}}');
    expect(hasFields('{{nope}}')).toBe(false);
  });

  it('returns the same element without fields and fills runs', () => {
    const plain = { text: 'hi' };
    expect(resolveFields(plain, ctx)).toBe(plain);
    const r = resolveFields({ text: 'p {{slide}}', runs: [{ text: 'p ' }, { text: '{{slide}}', bold: true }] }, ctx);
    expect(r.text).toBe('p 2');
    expect(r.runs![1]).toEqual({ text: '2', bold: true });
  });
});
