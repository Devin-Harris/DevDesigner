import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../identity/auth/user.entity';
import type { AuthUser } from '../identity/auth/auth.types';

interface RequestWithUser extends Request {
  user?: AuthUser | null;
}

/**
 * Admin-only routes. Requires a cookie session (API tokens never qualify, even an
 * admin's) and re-reads the role from the DB so a demotion applies immediately. Every
 * rejection is the same 404 an unknown route returns, so the admin surface is hidden.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const caller = request.user;
    if (caller && !caller.viaToken) {
      const user = await this.users.findOne({ where: { id: caller.id }, select: { id: true, role: true } });
      if (user?.role === 'admin') {
        return true;
      }
    }
    throw new NotFoundException(`Cannot ${request.method} ${request.originalUrl ?? request.url}`);
  }
}
