import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, MaxLength } from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import type { CurrentUserResponse, OAuthProviderInfo } from '@devdesigner/shared';
import { Public } from '../../../collaboration/access/access-policy';
import { RateLimit } from '../../../platform/throttle/rate-limit';
import { AuthService } from '../auth.service';
import { AUTH_COOKIE, SESSION_MAX_AGE_MS } from '../auth.types';
import { baseCookieOptions, durationMs, readCookie } from '../cookies';
import { OAUTH_STATE_TTL_MS, OAuthService } from './oauth.service';

/** Holds `<state>.<pkce verifier>` during the provider round trip. */
export const OAUTH_STATE_COOKIE = 'oauth_state';

export class OAuthExchangeDto {
  @IsString()
  @MaxLength(200)
  code!: string;
}

/**
 * Sign in with Google / GitHub. `GET /auth/oauth/:provider` starts the flow (a
 * top-level navigation from the client), the provider returns to the callback,
 * which sends the browser back to the client with a one-time code; the client
 * posts it to `/auth/oauth/exchange` for the usual session cookie.
 */
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('providers')
  @Public()
  providers(): OAuthProviderInfo[] {
    return this.oauth.providers();
  }

  @Post('exchange')
  @Public()
  @RateLimit('login')
  async exchange(
    @Body() dto: OAuthExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUserResponse> {
    const userId = this.oauth.redeem(dto.code);
    const session = userId ? await this.auth.sessionFor(userId) : null;
    if (!session) throw new UnauthorizedException('That sign-in link expired. Try again.');
    res.cookie(
      AUTH_COOKIE,
      session.token,
      baseCookieOptions(
        this.config,
        durationMs(this.config.get<string>('JWT_EXPIRES_IN', '7d'), SESSION_MAX_AGE_MS),
      ),
    );
    return session.user;
  }

  @Get(':provider')
  @Public()
  @RateLimit('login')
  start(@Param('provider') provider: string, @Res() res: Response): void {
    const { url, cookie } = this.oauth.start(provider);
    res.cookie(OAUTH_STATE_COOKIE, cookie, this.stateCookieOptions(OAUTH_STATE_TTL_MS));
    res.redirect(302, url);
  }

  @Get(':provider/callback')
  @Public()
  @RateLimit('login')
  async callback(
    @Param('provider') provider: string,
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const stateCookie = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
    const target = await this.oauth.callback(
      provider,
      {
        code: typeof query.code === 'string' ? query.code : undefined,
        state: typeof query.state === 'string' ? query.state : undefined,
        error: typeof query.error === 'string' ? query.error : undefined,
      },
      stateCookie,
    );
    res.clearCookie(OAUTH_STATE_COOKIE, { ...this.stateCookieOptions(0), maxAge: undefined });
    res.redirect(302, target);
  }

  /**
   * The state cookie is only read on the provider's top-level redirect back to the
   * API, so it is always SameSite=Lax and never partitioned.
   */
  private stateCookieOptions(maxAge: number): CookieOptions {
    const base = baseCookieOptions(this.config, maxAge);
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: base.secure,
      path: '/',
      maxAge,
    };
  }
}
