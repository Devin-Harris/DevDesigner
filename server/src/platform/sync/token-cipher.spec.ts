import { TokenCipher } from './token-cipher';

describe('TokenCipher', () => {
  it('round-trips and never stores the plain token', () => {
    const c = new TokenCipher('k'.repeat(40));
    const stored = c.encrypt('dd_secret_token');
    expect(stored).not.toContain('dd_secret_token');
    expect(TokenCipher.isEncrypted(stored)).toBe(true);
    expect(c.decrypt(stored)).toBe('dd_secret_token');
  });

  it('passes legacy plain tokens through', () => {
    expect(new TokenCipher('k'.repeat(40)).decrypt('plain')).toBe('plain');
  });

  it('rejects a different key', () => {
    const stored = new TokenCipher('a'.repeat(40)).encrypt('x');
    expect(() => new TokenCipher('b'.repeat(40)).decrypt(stored)).toThrow();
  });

  it('without a key stores tokens unchanged', () => {
    const c = new TokenCipher('');
    expect(c.active).toBe(false);
    expect(c.encrypt('t')).toBe('t');
  });
});
