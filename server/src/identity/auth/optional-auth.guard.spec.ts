import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { OptionalAuthGuard } from './optional-auth.guard';
import type { AuthService } from './auth.service';
import type { ApiTokenService } from './api-token.service';
import type { AuthUser } from './auth.types';

/** C5.2 backfill: how the global guard resolves the caller. */
describe('OptionalAuthGuard', () => {
  const sessionUser: AuthUser = { id: 'u-cookie', email: 'a@b.c' };
  const readToken: AuthUser = { id: 'u-token', email: null, viaToken: { id: 't1', scope: 'read' } };
  const auth = { verifySession: jest.fn((cookie?: string) => (cookie === 'access_token=ok' ? sessionUser : null)) };
  const apiTokens = { verify: jest.fn(async (raw: string) => (raw === 'dd_read' ? readToken : null)) };
  const guard = new OptionalAuthGuard(auth as unknown as AuthService, apiTokens as unknown as ApiTokenService);

  function run(method: string, headers: Record<string, string>): { promise: Promise<boolean>; request: { user?: AuthUser | null } } {
    const request = { method, headers } as { method: string; headers: Record<string, string>; user?: AuthUser | null };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    return { promise: guard.canActivate(context), request };
  }

  it('resolves the session cookie, or null when anonymous', async () => {
    const signedIn = run('GET', { cookie: 'access_token=ok' });
    expect(await signedIn.promise).toBe(true);
    expect(signedIn.request.user).toBe(sessionUser);
    const anonymous = run('POST', {});
    expect(await anonymous.promise).toBe(true);
    expect(anonymous.request.user).toBeNull();
  });

  it('prefers a bearer token and refuses an unknown one outright', async () => {
    const viaToken = run('GET', { authorization: 'Bearer dd_read', cookie: 'access_token=ok' });
    expect(await viaToken.promise).toBe(true);
    expect(viaToken.request.user).toBe(readToken);
    await expect(run('GET', { authorization: 'Bearer nope' }).promise).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps read-scoped tokens to safe methods', async () => {
    await expect(run('PATCH', { authorization: 'Bearer dd_read' }).promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(await run('HEAD', { authorization: 'Bearer dd_read' }).promise).toBe(true);
  });
});
