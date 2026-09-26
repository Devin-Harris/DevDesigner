import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import type { CurrentUserResponse } from '@dbdesigner/shared';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CurrentUserId } from './current-user.decorator';
import { AUTH_COOKIE, SESSION_MAX_AGE_MS } from './auth.types';

/**
 * Auth routes (BUILD_INSTRUCTIONS.md section 5). Register and login issue a JWT
 * and set it as an httpOnly session cookie (never returned in the body, so it is
 * not exposed to client JS). The controller only routes and validates; hashing
 * and token logic live in the service. OAuth routes are stubbed for Phase 8.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUserResponse> {
    const { user, token } = await this.auth.register(dto);
    res.cookie(AUTH_COOKIE, token, this.cookieOptions());
    return user;
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentUserResponse> {
    const { user, token } = await this.auth.login(dto);
    res.cookie(AUTH_COOKIE, token, this.cookieOptions());
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(AUTH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  @Get('me')
  me(@CurrentUserId() userId: string | null): Promise<CurrentUserResponse | null> {
    return this.auth.me(userId);
  }

  // --- OAuth (stubbed now, implemented in Phase 8) ---

  @Get('oauth/:provider')
  oauthStart(@Param('provider') provider: string): never {
    throw new NotImplementedException(
      `OAuth sign-in with "${provider}" is implemented in a later phase.`,
    );
  }

  @Get('oauth/:provider/callback')
  oauthCallback(@Param('provider') provider: string): never {
    throw new NotImplementedException(
      `OAuth callback for "${provider}" is implemented in a later phase.`,
    );
  }

  /** httpOnly session cookie attributes. Secure is enabled in production. */
  private cookieOptions(): CookieOptions {
    const secure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    };
  }
}
