import type { OAuthProviderId } from '@devdesigner/shared';

/** What the callback learns about the person from the provider. */
export interface OAuthProfile {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface OAuthProviderSpec {
  id: OAuthProviderId;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Read the profile with the provider access token. */
  profile(accessToken: string, fetchFn: typeof fetch): Promise<OAuthProfile>;
}

async function getJson<T>(fetchFn: typeof fetch, url: string, accessToken: string): Promise<T> {
  const res = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'DevDesigner',
    },
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderSpec> = {
  google: {
    id: 'google',
    name: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async profile(accessToken, fetchFn) {
      const info = await getJson<{
        sub: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      }>(fetchFn, 'https://openidconnect.googleapis.com/v1/userinfo', accessToken);
      return {
        id: String(info.sub),
        email: info.email ?? null,
        emailVerified: info.email_verified === true,
        name: info.name ?? null,
      };
    },
  },
  github: {
    id: 'github',
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async profile(accessToken, fetchFn) {
      const user = await getJson<{ id: number; login: string; name?: string | null }>(
        fetchFn,
        'https://api.github.com/user',
        accessToken,
      );
      const emails = await getJson<{ email: string; primary: boolean; verified: boolean }[]>(
        fetchFn,
        'https://api.github.com/user/emails',
        accessToken,
      ).catch(() => []);
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      return {
        id: String(user.id),
        email: primary?.email ?? null,
        emailVerified: !!primary,
        name: user.name || user.login || null,
      };
    },
  },
};

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return Object.prototype.hasOwnProperty.call(OAUTH_PROVIDERS, value);
}
