import { AnalyticsPrivacy, mcpToolOf, uaFamily, utcDay } from './privacy';

describe('AnalyticsPrivacy', () => {
  const day1 = Date.UTC(2026, 10, 10, 9);
  const day1Later = Date.UTC(2026, 10, 10, 23, 59);
  const day2 = Date.UTC(2026, 10, 11, 0, 1);

  it('hashes IPs to 16 hex chars, stable within a UTC day', () => {
    const p = new AnalyticsPrivacy('secret');
    const a = p.ipHash('203.0.113.7', day1);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(p.ipHash('203.0.113.7', day1Later)).toBe(a);
    expect(p.ipHash('::ffff:203.0.113.7', day1)).toBe(a);
    expect(p.ipHash('203.0.113.8', day1)).not.toBe(a);
    expect(a).not.toContain('203');
  });

  it('rotates the IP hash every day', () => {
    const p = new AnalyticsPrivacy('secret');
    expect(p.ipHash('203.0.113.7', day2)).not.toBe(p.ipHash('203.0.113.7', day1));
    // Same secret, same day -> same hash across processes; different secret -> different.
    expect(new AnalyticsPrivacy('secret').ipHash('203.0.113.7', day1)).toBe(p.ipHash('203.0.113.7', day1));
    expect(new AnalyticsPrivacy('other').ipHash('203.0.113.7', day1)).not.toBe(p.ipHash('203.0.113.7', day1));
    expect(p.ipHash(null)).toBeNull();
  });

  it('uses a random salt per process without a secret', () => {
    expect(new AnalyticsPrivacy().ipHash('203.0.113.7', day1)).not.toBe(new AnalyticsPrivacy().ipHash('203.0.113.7', day1));
    expect(AnalyticsPrivacy.ephemeral('')).toBe(true);
    expect(AnalyticsPrivacy.ephemeral('x')).toBe(false);
  });

  it('hashes guest ids and share tokens stably and per kind', () => {
    const p = new AnalyticsPrivacy('secret');
    const g = p.hashId('guest', 'guestAAAAAAAAAAAAAAAA1');
    expect(g).toMatch(/^[0-9a-f]{24}$/);
    expect(p.hashId('guest', 'guestAAAAAAAAAAAAAAAA1')).toBe(g);
    expect(p.hashId('share', 'guestAAAAAAAAAAAAAAAA1')).not.toBe(g);
  });
});

describe('uaFamily / mcpToolOf / utcDay', () => {
  it('reduces user agents to browser/os family', () => {
    expect(
      uaFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'),
    ).toBe('chrome/windows');
    expect(uaFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605 Version/17.5 Safari/605.1.15')).toBe('safari/mac');
    expect(uaFamily('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('edge/windows');
    expect(uaFamily('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('firefox/linux');
    expect(uaFamily('devdesigner-mcp/0.1.0')).toBe('mcp/other');
    expect(uaFamily(undefined)).toBeNull();
  });

  it('accepts only well-formed tool names', () => {
    expect(mcpToolOf('add_table')).toBe('add_table');
    expect(mcpToolOf('Add Table')).toBeNull();
    expect(mcpToolOf('x'.repeat(49))).toBeNull();
    expect(mcpToolOf(['add_table'])).toBeNull();
  });

  it('formats UTC days', () => {
    expect(utcDay(Date.UTC(2026, 0, 2, 23, 59))).toBe('2026-01-02');
  });
});
