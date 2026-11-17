import { embedLabel, isEmbedUrl, isLocalEmbedUrl, normalizeEmbedUrl } from './index';

describe('live frame urls', () => {
  it('accepts only http(s)', () => {
    expect(isEmbedUrl('https://example.com')).toBe(true);
    expect(isEmbedUrl('http://localhost:4200/x')).toBe(true);
    expect(isEmbedUrl('javascript:alert(1)')).toBe(false);
    expect(isEmbedUrl('data:text/html,hi')).toBe(false);
    expect(isEmbedUrl('https://a b')).toBe(false);
  });
  it('adds a scheme to bare hosts', () => {
    expect(normalizeEmbedUrl('localhost:4200')).toBe('http://localhost:4200');
    expect(normalizeEmbedUrl('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app');
    expect(normalizeEmbedUrl('example.com')).toBe('https://example.com');
    expect(normalizeEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeEmbedUrl('')).toBeNull();
  });
  it('spots local addresses and labels urls', () => {
    expect(isLocalEmbedUrl('http://192.168.1.4:8080')).toBe(true);
    expect(isLocalEmbedUrl('https://example.com')).toBe(false);
    expect(embedLabel('http://localhost:4200/')).toBe('localhost:4200');
  });
});
