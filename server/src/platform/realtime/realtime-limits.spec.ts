import {
  RelayLimiter,
  TokenBucket,
  clientIp,
  configureAllowedOrigins,
  isAllowedOrigin,
  parseCursor,
  parseLaser,
  parsePresent,
  parseSelection,
} from './realtime-limits';

/** Pure realtime guards (security M-3, L-6). */
describe('realtime limits', () => {
  describe('TokenBucket', () => {
    it('allows a burst, then refills at the rate', () => {
      let now = 0;
      const bucket = new TokenBucket(10, 3, () => now);
      expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
        true,
        true,
        true,
        false,
      ]);
      expect(bucket.msUntilNext()).toBe(100);
      now += 100;
      expect(bucket.take()).toBe(true);
      expect(bucket.take()).toBe(false);
      now += 10_000; // never above the burst
      expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
        true,
        true,
        true,
        false,
      ]);
    });
  });

  describe('RelayLimiter', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('drops over-budget samples that are not trailing', () => {
      const limiter = new RelayLimiter(() => Date.now());
      let sent = 0;
      for (let i = 0; i < 100; i++) limiter.relay('cursor', () => sent++, false);
      expect(sent).toBe(60);
      jest.advanceTimersByTime(5_000);
      expect(sent).toBe(60);
    });

    it('sends the latest trailing value once a token frees up', () => {
      const limiter = new RelayLimiter(() => Date.now());
      const sent: number[] = [];
      for (let i = 0; i < 30; i++) limiter.relay('selection', () => sent.push(i), true);
      expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      jest.advanceTimersByTime(1_000);
      expect(sent[sent.length - 1]).toBe(29);
      expect(sent).toHaveLength(11);
    });

    it('dispose cancels pending sends', () => {
      const limiter = new RelayLimiter(() => Date.now());
      let sent = 0;
      for (let i = 0; i < 20; i++) limiter.relay('present', () => sent++, true);
      limiter.dispose();
      jest.advanceTimersByTime(5_000);
      expect(sent).toBe(5);
    });
  });

  describe('payload parsers', () => {
    it('cursor and laser need finite, bounded numbers', () => {
      expect(parseCursor({ x: 1, y: 2, extra: 'x' })).toEqual({ x: 1, y: 2 });
      expect(parseCursor({ x: Infinity, y: 2 })).toBeNull();
      expect(parseCursor({ x: 1e12, y: 2 })).toBeNull();
      expect(parseCursor(null)).toBeNull();
      expect(parseLaser({ x: 1, y: 2, end: 'yes' })).toEqual({ x: 1, y: 2, end: false });
      expect(parseLaser({ x: 1, y: 2, end: true })).toEqual({ x: 1, y: 2, end: true });
    });

    it('selection takes capped lists of short string ids', () => {
      expect(parseSelection({ tableIds: ['a'], relationshipIds: [], columnId: 'c' })).toEqual({
        tableIds: ['a'],
        relationshipIds: [],
        columnId: 'c',
      });
      expect(parseSelection({ tableIds: undefined })).toEqual({
        tableIds: [],
        relationshipIds: [],
      });
      expect(parseSelection({ tableIds: [1], relationshipIds: [] })).toBeNull();
      expect(parseSelection({ tableIds: Array(501).fill('a'), relationshipIds: [] })).toBeNull();
      expect(parseSelection({ tableIds: [], relationshipIds: [], columnId: { a: 1 } })).toBeNull();
    });

    it('present takes a frame id or null and a clamped step', () => {
      expect(parsePresent({ frameId: 'f', step: 99 })).toEqual({ frameId: 'f', step: 50 });
      expect(parsePresent({ frameId: null })).toEqual({ frameId: null, step: 0 });
      expect(parsePresent({ frameId: 'x'.repeat(65) })).toBeNull();
    });
  });

  describe('origin and address', () => {
    afterEach(() => configureAllowedOrigins(undefined));

    it('accepts listed and same-origin, refuses the rest', () => {
      configureAllowedOrigins('https://app.example.com, https://other.example.com');
      expect(isAllowedOrigin('https://other.example.com', 'api.example.com')).toBe(true);
      expect(isAllowedOrigin('https://api.example.com', 'api.example.com')).toBe(true);
      expect(isAllowedOrigin('https://evil.example.com', 'api.example.com')).toBe(false);
      expect(isAllowedOrigin(undefined, 'api.example.com')).toBe(false);
      expect(isAllowedOrigin('not a url', undefined)).toBe(false);
    });

    it('defaults to the local dev client', () => {
      configureAllowedOrigins(undefined);
      expect(isAllowedOrigin('http://localhost:4242', 'localhost:3000')).toBe(true);
    });

    it('uses the proxy-added (right-most) X-Forwarded-For entry', () => {
      expect(clientIp({ 'x-forwarded-for': 'spoofed, 203.0.113.9' }, '10.0.0.1')).toBe(
        '203.0.113.9',
      );
      expect(clientIp({}, '10.0.0.1')).toBe('10.0.0.1');
    });
  });
});
