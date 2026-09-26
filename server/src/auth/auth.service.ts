import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import type { CurrentUserResponse } from '@dbdesigner/shared';
import { User } from './user.entity';
import type { JwtPayload } from './auth.types';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

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

  private sign(user: User): string {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwt.sign(payload);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toResponse(user: User): CurrentUserResponse {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
