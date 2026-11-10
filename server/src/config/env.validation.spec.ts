import { DEFAULT_JWT_SECRET, parseAdminEmails, validateEnv } from './env.validation';

const STRONG_SECRET = 'x'.repeat(48);

describe('validateEnv', () => {
  it('fills the dev defaults from an empty environment', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGIN).toBe('http://localhost:4242');
    expect(env.DATABASE_PATH).toBe('devdesigner.sqlite');
    expect(env.DATABASE_SYNCHRONIZE).toBe('true');
    expect(env.JWT_SECRET).toBe(DEFAULT_JWT_SECRET);
    expect(env.JWT_EXPIRES_IN).toBe('7d');
    expect(env.COOKIE_SECURE).toBe('false');
    expect(env.COOKIE_SAMESITE).toBe('lax');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.SLOW_QUERY_MS).toBe(200);
    expect(env.SENTRY_DSN).toBe('');
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
    expect(env.ADMIN_EMAILS).toBe('');
  });

  it('normalizes ADMIN_EMAILS and rejects non-emails', () => {
    expect(validateEnv({ ADMIN_EMAILS: ' Ada@Example.com, ,bob@x.io,ada@example.com ' }).ADMIN_EMAILS).toBe(
      'ada@example.com,bob@x.io',
    );
    expect(() => validateEnv({ ADMIN_EMAILS: 'ada@example.com,not-an-email' })).toThrow(/ADMIN_EMAILS/);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });

  it('normalizes typed values', () => {
    const env = validateEnv({
      PORT: '8080',
      DATABASE_SYNCHRONIZE: 'FALSE',
      COOKIE_SECURE: '1',
      COOKIE_SAMESITE: 'None',
      SENTRY_TRACES_SAMPLE_RATE: '0.25',
    });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_SYNCHRONIZE).toBe('false');
    expect(env.COOKIE_SECURE).toBe('true');
    expect(env.COOKIE_SAMESITE).toBe('none');
    expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0.25);
  });

  it('rejects malformed values', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ COOKIE_SAMESITE: 'sideways' })).toThrow(/COOKIE_SAMESITE/);
    expect(() => validateEnv({ SENTRY_TRACES_SAMPLE_RATE: '2' })).toThrow(/SENTRY_TRACES_SAMPLE_RATE/);
    expect(() => validateEnv({ DATABASE_SYNCHRONIZE: 'maybe' })).toThrow(/DATABASE_SYNCHRONIZE/);
  });

  describe('production', () => {
    it('requires JWT_SECRET', () => {
      expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET is required/);
    });

    it('rejects the public default secret', () => {
      expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: DEFAULT_JWT_SECRET })).toThrow(
        /public default/,
      );
    });

    it('rejects a short secret', () => {
      expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'short-secret' })).toThrow(
        /at least 32/,
      );
    });

    it('accepts a strong secret and defaults to info logs', () => {
      const env = validateEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET });
      expect(env.JWT_SECRET).toBe(STRONG_SECRET);
      expect(env.LOG_LEVEL).toBe('info');
    });
  });
});
