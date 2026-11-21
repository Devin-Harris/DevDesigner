import { slideMorphKey } from './index';

describe('slideMorphKey with layout placeholder tags', () => {
  const slots: Record<string, { morphId?: string }> = { slot: { morphId: 'tag:title' }, bare: {} };
  const slot = (id: string): { morphId?: string } | undefined => slots[id];

  it('takes the layout tag when the copy has no morph id', () => {
    expect(slideMorphKey({ id: 'c', placeholder: { of: 'slot' } }, slot)).toBe('tag:title');
  });

  it('takes the layout tag over lineage ids from a duplicated slide', () => {
    expect(slideMorphKey({ id: 'c', morphId: 'other-el', placeholder: { of: 'slot' } }, slot)).toBe('tag:title');
  });

  it('keeps a tag of its own', () => {
    expect(slideMorphKey({ id: 'c', morphId: 'tag:mine', placeholder: { of: 'slot' } }, slot)).toBe('tag:mine');
  });

  it('keeps an opt-out (own id)', () => {
    expect(slideMorphKey({ id: 'c', morphId: 'c', placeholder: { of: 'slot' } }, slot)).toBe('c');
  });

  it('falls back to the shared placeholder key when the slot is untagged', () => {
    expect(slideMorphKey({ id: 'c', placeholder: { of: 'bare' } }, slot)).toBe('placeholder:bare');
  });
});
