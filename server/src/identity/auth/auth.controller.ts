import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CookieOptions, Response } from 'express';
import type {
  ApiTokenResponse,
  CreatedApiTokenResponse,
  CurrentUserResponse,
} from '@devdesigner/shared';
import { CallerScoped, Public } from '../../collaboration/access/access-policy';
import { RateLimit } from '../../platform/throttle/rate-limit';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from './current-user.decorator';
import { ApiTokenService } from './api-token.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { AUTH_COOKIE, SESSION_MAX_AGE_MS, type AuthUser } from './auth.types';
import { baseCookieOptions, durationMs } from './cookies';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { track } from '../../platform/analytics/track';

/**
 * Auth routes (BUILD_INSTRUCTIONS.md section 5). Register and login issue a JWT
 * and set it as an httpOnly session cookie (never returned in the body, so it is
 * not exposed to client JS). The controller only routes and validates; hashing
 * and token logic live in the service.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly apiTokens: ApiTokenService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  @Post('register')
  @Public()
  @RateLimit('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUserResponse> {
    const { user, token } = await this.auth.register(dto);
    res.cookie(AUTH_COOKIE, token, this.cookieOptions());
    return user;
  }

  @Post('login')
  @Public()
  @RateLimit('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUserResponse> {
    let session: Awaited<ReturnType<AuthService['login']>>;
    try {
      session = await this.auth.login(dto);
    } catch (err) {
      const retryAfter = (err as { getResponse?: () => unknown }).getResponse?.() as { retryAfter?: number } | undefined;
      if (typeof retryAfter?.retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter.retryAfter));
      throw err;
    }
    const { user, token } = session;
    res.cookie(AUTH_COOKIE, token, this.cookieOptions());
    return user;
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    track(this.events, 'auth.logout');
    res.clearCookie(AUTH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  /** Sign out on every device: all existing session cookies stop working. */
  @Post('logout-all')
  @CallerScoped()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.revokeSessions(this.requireSessionUser(user));
    track(this.events, 'auth.logout_all');
    res.clearCookie(AUTH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  /** Delete the signed-in account and everything it owns (projects, themes, tokens, analytics). */
  @Delete('me')
  @CallerScoped()
  @RateLimit('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(
    @Body() dto: DeleteAccountDto,
    @CurrentUser() user: AuthUser | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.deleteAccount(this.requireSessionUser(user), dto.password);
    res.clearCookie(AUTH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  @Get('me')
  @Public()
  me(@CurrentUser() user: AuthUser | null): Promise<CurrentUserResponse | null> {
    return this.auth.me(user?.id ?? null);
  }

  // --- API tokens (for the MCP server / automation) ---
  // Managed only from a signed-in browser session: a token cannot mint or list tokens.

  @Get('api-tokens')
  @CallerScoped()
  listApiTokens(@CurrentUser() user: AuthUser | null): Promise<ApiTokenResponse[]> {
    return this.apiTokens.list(this.requireSessionUser(user));
  }

  @Post('api-tokens')
  @CallerScoped()
  createApiToken(
    @Body() dto: CreateApiTokenDto,
    @CurrentUser() user: AuthUser | null,
  ): Promise<CreatedApiTokenResponse> {
    return this.apiTokens.create(this.requireSessionUser(user), dto);
  }

  @Delete('api-tokens/:tokenId')
  @CallerScoped()
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeApiToken(
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: AuthUser | null,
  ): Promise<void> {
    return this.apiTokens.revoke(this.requireSessionUser(user), tokenId);
  }

  private requireSessionUser(user: AuthUser | null): string {
    if (!user || user.viaToken) {
      throw new UnauthorizedException('Sign in with a browser session to manage your account.');
    }
    return user.id;
  }

  /** httpOnly session cookie attributes; maxAge follows JWT_EXPIRES_IN (security L-3). */
  private cookieOptions(): CookieOptions {
    return baseCookieOptions(this.config, durationMs(this.config.get<string>('JWT_EXPIRES_IN', '7d'), SESSION_MAX_AGE_MS));
  }
}
