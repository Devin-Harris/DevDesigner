import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { OAuthProviderId, OAuthProviderInfo } from '@devdesigner/shared';
import { AuthService } from '../auth.service';
import { OAUTH_PROVIDERS, isOAuthProviderId, type OAuthProviderSpec } from './oauth-providers';

/** How long the provider round trip may take (state cookie lifetime). */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** How long the one-time sign-in code handed to the client lives. */
const EXCHANGE_CODE_TTL_MS = 60_000;

export interface OAuthStart {
  url: string;
  /** Goes into the short-lived state cookie: `<state>.<pkce verifier>`. */
  cookie: string;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

/**
 * Third-party sign-in (Google, GitHub) with the authorization-code flow + PKCE.
 * The callback never sets the session cookie itself: it sends the browser to the
 * client with a one-time code, and the client trades it at POST
 * /auth/oauth/exchange, so the session cookie is set from the client's context
 * exactly like a password login (keeps cross-site, partitioned-cookie deployments
 * working). Codes live in memory (single replica, like the rest of the auth state).
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly codes = new Map<string, { userId: string; expires: number }>();
  /** Swappable in tests. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  /** Providers with both a client id and secret configured. */
  providers(): OAuthProviderInfo[] {
    return Object.values(OAUTH_PROVIDERS)
      .filter((p) => this.credentials(p.id) !== null)
      .map((p) => ({ id: p.id, name: p.name }));
  }

  start(providerId: string): OAuthStart {
    const { spec, clientId } = this.require(providerId);
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.callbackUrl(spec.id),
      response_type: 'code',
      scope: spec.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (spec.id === 'google') params.set('prompt', 'select_account');
    return { url: `${spec.authorizeUrl}?${params.toString()}`, cookie: `${state}.${verifier}` };
  }

  /**
   * Finish the provider round trip and return the client URL to send the browser
   * to: `?oauth_code=` on success, `?oauth_error=` otherwise.
   */
  async callback(
    providerId: string,
    query: { code?: string; state?: string; error?: string },
    stateCookie: string | null,
  ): Promise<string> {
    const { spec, clientId, clientSecret } = this.require(providerId);
    if (query.error) return this.clientUrl({ oauth_error: 'cancelled' });
    const [expectedState, verifier] = (stateCookie ?? '').split('.');
    if (!query.code || !query.state || !expectedState || !verifier || query.state !== expectedState) {
      return this.clientUrl({ oauth_error: 'state' });
    }
    try {
      const accessToken = await this.exchangeProviderCode(
        spec,
        clientId,
        clientSecret,
        query.code,
        verifier,
      );
      const profile = await spec.profile(accessToken, this.fetchFn);
      const user = await this.auth.oauthSession(spec.id, profile);
      return this.clientUrl({ oauth_code: this.issueCode(user.id) });
    } catch (err) {
      this.logger.warn({ err, provider: spec.id }, 'OAuth sign-in failed');
      return this.clientUrl({ oauth_error: 'failed' });
    }
  }

  /** Trade a one-time code for the user id it was issued for (null when unknown or expired). */
  redeem(code: string): string | null {
    const entry = this.codes.get(code);
    this.codes.delete(code);
    return entry && entry.expires > Date.now() ? entry.userId : null;
  }

  callbackUrl(id: OAuthProviderId): string {
    const base = String(this.config.get<string>('PUBLIC_API_URL', 'http://localhost:3000/api'));
    return `${base.replace(/\/$/, '')}/auth/oauth/${id}/callback`;
  }

  private issueCode(userId: string): string {
    const now = Date.now();
    for (const [key, entry] of this.codes) if (entry.expires <= now) this.codes.delete(key);
    const code = b64url(randomBytes(32));
    this.codes.set(code, { userId, expires: now + EXCHANGE_CODE_TTL_MS });
    return code;
  }

  private async exchangeProviderCode(
    spec: OAuthProviderSpec,
    clientId: string,
    clientSecret: string,
    code: string,
    verifier: string,
  ): Promise<string> {
    const res = await this.fetchFn(spec.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.callbackUrl(spec.id),
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`Token exchange failed (${res.status} ${body.error ?? ''})`);
    }
    return body.access_token;
  }

  private require(providerId: string): {
    spec: OAuthProviderSpec;
    clientId: string;
    clientSecret: string;
  } {
    if (!isOAuthProviderId(providerId)) throw new NotFoundException();
    const creds = this.credentials(providerId);
    if (!creds) {
      throw new BadRequestException(`${OAUTH_PROVIDERS[providerId].name} sign-in is not configured.`);
    }
    return { spec: OAUTH_PROVIDERS[providerId], ...creds };
  }

  private credentials(id: OAuthProviderId): { clientId: string; clientSecret: string } | null {
    const prefix = id.toUpperCase();
    const clientId = String(this.config.get<string>(`${prefix}_CLIENT_ID`) ?? '');
    const clientSecret = String(this.config.get<string>(`${prefix}_CLIENT_SECRET`) ?? '');
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private clientUrl(params: Record<string, string>): string {
    const base = String(this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:4242'));
    return `${base.replace(/\/$/, '')}/?${new URLSearchParams(params).toString()}`;
  }
}
