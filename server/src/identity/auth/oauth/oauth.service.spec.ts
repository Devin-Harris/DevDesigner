import { ConfigService } from '@nestjs/config';
import { OAuthService } from './oauth.service';
import type { AuthService } from '../auth.service';

function setup(env: Record<string, string> = {}) {
  const config = new ConfigService({
    PUBLIC_API_URL: 'https://api.example.com/api',
    PUBLIC_APP_URL: 'https://app.example.com',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    ...env,
  });
  const oauthSession = jest.fn().mockResolvedValue({ id: 'user-1' });
  const service = new OAuthService(config, { oauthSession } as unknown as AuthService);
  return { service, oauthSession };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OAuthService', () => {
  it('lists only providers with credentials', () => {
    expect(setup().service.providers()).toEqual([{ id: 'github', name: 'GitHub' }]);
  });

  it('builds an authorize URL with state, PKCE and the callback', () => {
    const { service } = setup();
    const { url, cookie } = service.start('github');
    const params = new URL(url).searchParams;
    const [state, verifier] = cookie.split('.');
    expect(params.get('state')).toBe(state);
    expect(verifier.length).toBeGreaterThan(20);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('redirect_uri')).toBe('https://api.example.com/api/auth/oauth/github/callback');
  });

  it('refuses unconfigured and unknown providers', () => {
    const { service } = setup();
    expect(() => service.start('google')).toThrow('not configured');
    expect(() => service.start('nope')).toThrow();
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const { service, oauthSession } = setup();
    const target = await service.callback('github', { code: 'c', state: 'other' }, 'mine.verifier');
    expect(target).toBe('https://app.example.com/?oauth_error=state');
    expect(oauthSession).not.toHaveBeenCalled();
  });

  it('signs in with the verified primary email and issues a one-time code', async () => {
    const { service, oauthSession } = setup();
    service.fetchFn = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('access_token')) return jsonResponse({ access_token: 'tok' });
      if (url.endsWith('/user/emails')) {
        return jsonResponse([
          { email: 'other@x.dev', primary: false, verified: true },
          { email: 'me@x.dev', primary: true, verified: true },
        ]);
      }
      return jsonResponse({ id: 42, login: 'octo', name: null });
    }) as typeof fetch;
    const { cookie } = service.start('github');
    const target = await service.callback(
      'github',
      { code: 'c', state: cookie.split('.')[0] },
      cookie,
    );
    expect(oauthSession).toHaveBeenCalledWith('github', {
      id: '42',
      email: 'me@x.dev',
      emailVerified: true,
      name: 'octo',
    });
    const code = new URL(target).searchParams.get('oauth_code')!;
    expect(service.redeem(code)).toBe('user-1');
    expect(service.redeem(code)).toBeNull(); // one use only
  });

  it('reports a failed token exchange back to the client', async () => {
    const { service } = setup();
    service.fetchFn = jest.fn(async () => jsonResponse({ error: 'bad_verification_code' }, 400)) as typeof fetch;
    const { cookie } = service.start('github');
    const target = await service.callback('github', { code: 'c', state: cookie.split('.')[0] }, cookie);
    expect(target).toBe('https://app.example.com/?oauth_error=failed');
  });
});
