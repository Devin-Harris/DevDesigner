import type { Request, Response } from 'express';
import { baseCookieOptions, durationMs, readCookie } from './cookies';
import { guestCookieMiddleware, GUEST_COOKIE, presentedGuestId } from './guest-id';

const config = (values: Record<string, string>) => ({
  get: <T>(key: string, fallback: T): T => (values[key] as T) ?? fallback,
});

describe('cookies', () => {
  it('reads one cookie out of a header', () => {
    expect(readCookie('a=1; access_token=x%20y; b=2', 'access_token')).toBe('x y');
    expect(readCookie('a=1', 'access_token')).toBeNull();
    expect(readCookie(undefined, 'a')).toBeNull();
    expect(readCookie('a=%E0%A4%A', 'a')).toBeNull();
  });

  it('parses JWT-style durations', () => {
    expect(durationMs('7d', 1)).toBe(7 * 86_400_000);
    expect(durationMs('12h', 1)).toBe(12 * 3_600_000);
    expect(durationMs('3600', 1)).toBe(3_600_000);
    expect(durationMs('soon', 42)).toBe(42);
    expect(durationMs(undefined, 42)).toBe(42);
  });

  it('forces Secure and Partitioned for SameSite=None', () => {
    expect(baseCookieOptions(config({ COOKIE_SAMESITE: 'none' }), 1000)).toMatchObject({
      sameSite: 'none',
      secure: true,
      partitioned: true,
      httpOnly: true,
      maxAge: 1000,
    });
    expect(baseCookieOptions(config({}), 1000)).toMatchObject({ sameSite: 'lax', secure: false, partitioned: false });
  });
});

describe('guest cookie', () => {
  const id = 'abcdefghijklmnop1234';
  const other = 'zzzzzzzzzzzzzzzz9999';

  function run(headers: Record<string, string>): { req: { headers: Record<string, unknown> }; res: { cookie: jest.Mock } } {
    const req = { headers: { ...headers } as Record<string, unknown> };
    const res = { cookie: jest.fn() };
    const next = jest.fn();
    guestCookieMiddleware(config({}))(req as unknown as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    return { req, res };
  }

  it('adopts a header-only guest id into an httpOnly cookie', () => {
    const { req, res } = run({ 'x-guest-id': id });
    expect(res.cookie).toHaveBeenCalledWith(GUEST_COOKIE, id, expect.objectContaining({ httpOnly: true }));
    expect(req.headers['x-guest-id']).toBe(id);
  });

  it('lets the cookie win over a different header', () => {
    const { req, res } = run({ cookie: `${GUEST_COOKIE}=${id}`, 'x-guest-id': other });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(req.headers['x-guest-id']).toBe(id);
  });

  it('drops a malformed header', () => {
    const { req, res } = run({ 'x-guest-id': 'short' });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(req.headers['x-guest-id']).toBeUndefined();
  });

  it('resolves socket handshakes the same way', () => {
    expect(presentedGuestId(`${GUEST_COOKIE}=${id}`, other)).toBe(id);
    expect(presentedGuestId(undefined, other)).toBe(other);
    expect(presentedGuestId(undefined, 'bad')).toBeNull();
  });
});
