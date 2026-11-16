import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AuthService } from '../../identity/auth/auth.service';
import { AppThrottlerGuard } from './app-throttler.guard';
import {
  identityTracker,
  ipTracker,
  NoRateLimit,
  RATE_POLICIES,
  RateLimit,
  rateKey,
  THROTTLER_IDENTITY,
  THROTTLER_IP,
  type TrackedRequest,
} from './rate-limit';

class Routes {
  a(): void {}
  b(): void {}
  @RateLimit('login')
  login(): void {}
  @RateLimit('projectImport')
  importFile(): void {}
  @RateLimit('projectImport')
  importContent(): void {}
}

@NoRateLimit()
class Health {
  check(): void {}
}

interface FakeReq extends TrackedRequest {
  method: string;
}

function ctx(cls: object, handler: () => void, req: FakeReq, type = 'http'): ExecutionContext {
  const res = { headers: {} as Record<string, unknown>, setHeader(k: string, v: unknown) { this.headers[k] = v; } };
  return {
    getType: () => type,
    getClass: () => cls,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

const req = (headers: Record<string, string> = {}, ip = '203.0.113.7'): FakeReq => ({ method: 'GET', ip, headers });

const storages: ThrottlerStorageService[] = [];
afterEach(() => storages.splice(0).forEach((s) => s.onApplicationShutdown()));

async function makeGuard(limit: number, ipLimit: number, enabled = 'true'): Promise<AppThrottlerGuard> {
  const options: ThrottlerModuleOptions = {
    generateKey: rateKey,
    throttlers: [
      { name: THROTTLER_IDENTITY, ttl: 60_000, limit },
      { name: THROTTLER_IP, ttl: 60_000, limit: ipLimit, getTracker: (r) => ipTracker(r as TrackedRequest) },
    ],
  };
  const auth = {
    verifySession: (cookie: string | undefined) => (cookie === 'access_token=good' ? { id: 'user-1', email: null } : null),
  } as unknown as AuthService;
  const config = { get: (_k: string, d: unknown) => (_k === 'RATE_LIMIT_ENABLED' ? enabled : d) } as unknown as ConfigService;
  const storage = new ThrottlerStorageService();
  const guard = new AppThrottlerGuard(options, storage, new Reflector(), auth, config);
  await guard.onModuleInit();
  storages.push(storage);
  return guard;
}

async function hit(guard: AppThrottlerGuard, c: ExecutionContext, times: number): Promise<number> {
  let ok = 0;
  for (let i = 0; i < times; i++) {
    try {
      await guard.canActivate(c);
      ok++;
    } catch (err) {
      if (!(err instanceof ThrottlerException)) throw err;
    }
  }
  return ok;
}

describe('identityTracker', () => {
  const session = (cookie: string | undefined) => (cookie === 'access_token=good' ? 'user-1' : null);

  it('prefers an API token (hashed), then the session, then the guest id, then the IP', () => {
    const token = identityTracker(req({ authorization: 'Bearer dd_secret', 'x-guest-id': 'guestAAAAAAAAAAAAAAAA1' }), session);
    expect(token).toMatch(/^t:[0-9a-f]{32}$/);
    expect(token).not.toContain('dd_secret');
    expect(identityTracker(req({ cookie: 'access_token=good', 'x-guest-id': 'guestAAAAAAAAAAAAAAAA1' }), session)).toBe('u:user-1');
    expect(identityTracker(req({ 'x-guest-id': 'guestAAAAAAAAAAAAAAAA1' }), session)).toBe('g:guestAAAAAAAAAAAAAAAA1');
    expect(identityTracker(req({ 'x-guest-id': 'bad id' }), session)).toBe('ip:203.0.113.7');
    expect(identityTracker(req({}, '::ffff:198.51.100.2'), session)).toBe('ip:198.51.100.2');
  });
});

describe('AppThrottlerGuard', () => {
  it('counts all unannotated routes against one global bucket per caller', async () => {
    const guard = await makeGuard(5, 100);
    const r = req({ 'x-guest-id': 'guestAAAAAAAAAAAAAAAA1' });
    expect(await hit(guard, ctx(Routes, Routes.prototype.a, r), 3)).toBe(3);
    expect(await hit(guard, ctx(Routes, Routes.prototype.b, r), 3)).toBe(2);
    // Another caller has its own bucket.
    expect(await hit(guard, ctx(Routes, Routes.prototype.a, req({ cookie: 'access_token=good' })), 1)).toBe(1);
  });

  it('stops a caller who rotates guest ids with the per-IP bucket', async () => {
    const guard = await makeGuard(5, 8);
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      const guest = `guest${String(i).padStart(17, 'X')}`;
      ok += await hit(guard, ctx(Routes, Routes.prototype.a, req({ 'x-guest-id': guest })), 1);
    }
    expect(ok).toBe(8);
  });

  it('gives a policy route its own, stricter bucket shared by the routes in that policy', async () => {
    const guard = await makeGuard(1000, 1000);
    const r = req({ 'x-guest-id': 'guestAAAAAAAAAAAAAAAA1' });
    expect(await hit(guard, ctx(Routes, Routes.prototype.login, r), RATE_POLICIES.login.limit + 5)).toBe(
      RATE_POLICIES.login.limit,
    );
    // The global bucket is untouched.
    expect(await hit(guard, ctx(Routes, Routes.prototype.a, r), 1)).toBe(1);
    const half = RATE_POLICIES.projectImport.limit / 2;
    expect(await hit(guard, ctx(Routes, Routes.prototype.importFile, r), half)).toBe(half);
    expect(await hit(guard, ctx(Routes, Routes.prototype.importContent, r), half + 3)).toBe(half);
  });

  it('skips @NoRateLimit routes, non-HTTP contexts, and everything when disabled', async () => {
    const guard = await makeGuard(1, 1);
    expect(await hit(guard, ctx(Health, Health.prototype.check, req()), 5)).toBe(5);
    expect(await hit(guard, ctx(Routes, Routes.prototype.a, req(), 'ws'), 5)).toBe(5);
    const off = await makeGuard(1, 1, 'false');
    expect(await hit(off, ctx(Routes, Routes.prototype.a, req()), 5)).toBe(5);
  });
});
