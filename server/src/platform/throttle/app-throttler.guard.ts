import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AuthService } from '../../identity/auth/auth.service';
import { identityTracker, type TrackedRequest } from './rate-limit';

/**
 * Global rate-limit guard (APP_GUARD). Only HTTP requests are counted: the realtime
 * gateway has its own per-socket token buckets (S3.4). RATE_LIMIT_ENABLED=false
 * turns it off (for load tests); it is on by default everywhere.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly enabled: boolean;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    super(options, storage, reflector);
    this.enabled = config.get<string>('RATE_LIMIT_ENABLED', 'true') !== 'false';
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return !this.enabled || context.getType() !== 'http';
  }

  /** Identity tracker (the `ip` throttler overrides this with its own). */
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return identityTracker(req as unknown as TrackedRequest, (cookie) => this.auth.verifySession(cookie)?.id ?? null);
  }
}
