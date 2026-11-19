import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_POLICY_KEY, PROJECT_TOKEN_OK_KEY, type AccessPolicy } from '../../collaboration/access/access-policy.types';
import { OptionalAuthGuard } from './optional-auth.guard';
import type { AuthService } from './auth.service';
import type { ApiTokenService } from './api-token.service';
import type { AuthUser } from './auth.types';

/** C5.2 backfill: how the global guard resolves the caller. */
describe('OptionalAuthGuard', () => {
  const sessionUser: AuthUser = { id: 'u-cookie', email: 'a@b.c' };
  const readToken: AuthUser = { id: 'u-token', email: null, viaToken: { id: 't1', scope: 'read' } };
  const auth = { verifySession: jest.fn((cookie?: string) => (cookie === 'access_token=ok' ? sessionUser : null)) };
  const projectToken: AuthUser = {
    id: 'u-token',
    email: null,
    viaToken: { id: 't2', scope: 'write', projectId: 'p1' },
  };
  const apiTokens = {
    verify: jest.fn(async (raw: string) => (raw === 'dd_read' ? readToken : raw === 'dd_project' ? projectToken : null)),
  };
  const guard = new OptionalAuthGuard(
    auth as unknown as AuthService,
    apiTokens as unknown as ApiTokenService,
    new Reflector(),
  );

  /** A route handler carrying the given access metadata. */
  function route(policy?: AccessPolicy, projectTokenOk = false): () => void {
    const handler = (): void => undefined;
    if (policy) Reflect.defineMetadata(ACCESS_POLICY_KEY, policy, handler);
    if (projectTokenOk) Reflect.defineMetadata(PROJECT_TOKEN_OK_KEY, true, handler);
    return handler;
  }

  function run(
    method: string,
    headers: Record<string, string>,
    handler: () => void = route(),
  ): { promise: Promise<boolean>; request: { user?: AuthUser | null } } {
    const request = { method, headers } as { method: string; headers: Record<string, string>; user?: AuthUser | null };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;
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

  it('keeps project-scoped tokens to project routes, public routes and allowed caller routes', async () => {
    const auth = { authorization: 'Bearer dd_project' };
    const projectRoute = route({ kind: 'project', access: 'read', from: 'project', param: 'projectId' });
    expect(await run('PATCH', auth, projectRoute).promise).toBe(true);
    expect(await run('GET', auth, route({ kind: 'public' })).promise).toBe(true);
    expect(await run('GET', auth, route({ kind: 'caller' }, true)).promise).toBe(true);
    await expect(run('POST', auth, route({ kind: 'caller' })).promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run('GET', auth, route({ kind: 'admin' })).promise).rejects.toBeInstanceOf(ForbiddenException);
  });
});
