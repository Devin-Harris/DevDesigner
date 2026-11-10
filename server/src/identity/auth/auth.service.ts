import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import type { CurrentUserResponse } from '@devdesigner/shared';
import { User } from './user.entity';
import { AUTH_COOKIE, type AuthUser, type JwtPayload } from './auth.types';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AdminBootstrapService } from '../../admin/admin-bootstrap.service';

const BCRYPT_ROUNDS = 12;

/**
 * Owner authentication: email/password registration and login, JWT issuance, and
 * current-user lookup (BUILD_INSTRUCTIONS.md sections 5 and 6). Passwords are
 * hashed with bcrypt; the raw password is never stored or returned. The signed
 * JWT is what the controller places in the httpOnly session cookie.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly adminBootstrap: AdminBootstrapService,
  ) {}

  /** Register a new account and return the user plus a signed session token. */
  async register(dto: RegisterDto): Promise<{ user: CurrentUserResponse; token: string }> {
    const email = normalizeEmail(dto.email);
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = this.users.create({
      email,
      passwordHash,
      displayName: dto.displayName?.trim() || null,
      provider: null,
      providerId: null,
      role: this.adminBootstrap.isAllowlisted(email) ? 'admin' : 'user',
      lastLoginAt: new Date(),
    });
    const saved = await this.users.save(user);
    return { user: toResponse(saved), token: this.sign(saved) };
  }

  /** Validate credentials and return the user plus a signed session token. */
  async login(dto: LoginDto): Promise<{ user: CurrentUserResponse; token: string }> {
    const email = normalizeEmail(dto.email);
    const user = await this.users.findOne({ where: { email } });
    // Uniform error whether the email is unknown or the password is wrong, so the
    // endpoint does not reveal which accounts exist.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    await this.adminBootstrap.promoteIfAllowlisted(user);
    user.lastLoginAt = new Date();
    await this.users.update({ id: user.id }, { lastLoginAt: user.lastLoginAt });
    return { user: toResponse(user), token: this.sign(user) };
  }

  /** Resolve the current user for GET /auth/me, or null when anonymous/missing. */
  async me(userId: string | null): Promise<CurrentUserResponse | null> {
    if (!userId) {
      return null;
    }
    const user = await this.users.findOne({ where: { id: userId } });
    return user ? toResponse(user) : null;
  }

  /**
   * Verify the session from a raw Cookie header and return the caller, or null
   * when anonymous / invalid. Shared by the HTTP guard and the realtime gateway
   * so both resolve the owner identically (no DB hit: straight from the token).
   */
  verifySession(cookieHeader: string | undefined): AuthUser | null {
    const token = readCookie(cookieHeader, AUTH_COOKIE);
    if (!token) {
      return null;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      return { id: payload.sub, email: payload.email ?? null };
    } catch {
      return null;
    }
  }

  private sign(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwt.sign(payload);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parse a single cookie value out of a raw Cookie header (no cookie-parser dep). */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function toResponse(user: User): CurrentUserResponse {
  const response: CurrentUserResponse = { id: user.id, email: user.email, displayName: user.displayName };
  if (user.role === 'admin') {
    response.isAdmin = true;
  }
  return response;
}
