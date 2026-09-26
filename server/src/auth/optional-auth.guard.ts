import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AUTH_COOKIE, type AuthUser, type JwtPayload } from './auth.types';

interface RequestWithUser extends Request {
  user?: AuthUser | null;
}

/**
 * Populates `request.user` from the session cookie when a valid JWT is present,
 * and leaves it null otherwise. It never rejects: anonymous callers are allowed
 * through so the app keeps working without an account (owned projects are then
 * protected in the policy layer, not here). Registered globally via APP_GUARD.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    request.user = this.resolveUser(request);
    return true;
  }

  private resolveUser(request: Request): AuthUser | null {
    const token = readCookie(request.headers.cookie, AUTH_COOKIE);
    if (!token) {
      return null;
    }
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      return { id: payload.sub, email: payload.email ?? null };
    } catch {
      // Expired or tampered token: treat as anonymous rather than erroring.
      return null;
    }
  }
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
