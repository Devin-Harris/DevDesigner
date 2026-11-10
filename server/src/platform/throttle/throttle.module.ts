import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../../identity/auth/auth.module';
import { AppThrottlerGuard } from './app-throttler.guard';
import { ipTracker, rateKey, THROTTLER_IDENTITY, THROTTLER_IP, type TrackedRequest } from './rate-limit';

/**
 * Global HTTP rate limiting (security S3.1). In-memory storage: production runs a
 * single replica; a second replica would need a shared store (e.g. Redis).
 * Defaults: RATE_LIMIT_PER_MIN (per caller, 1200) and RATE_LIMIT_IP_PER_MIN (per
 * IP, 3000) across all routes; stricter named buckets come from `@RateLimit`.
 */
@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        generateKey: rateKey,
        errorMessage: 'Too many requests; slow down and retry shortly.',
        throttlers: [
          { name: THROTTLER_IDENTITY, ttl: 60_000, limit: config.get<number>('RATE_LIMIT_PER_MIN', 1200) },
          {
            name: THROTTLER_IP,
            ttl: 60_000,
            limit: config.get<number>('RATE_LIMIT_IP_PER_MIN', 3000),
            getTracker: (req) => ipTracker(req as TrackedRequest),
          },
        ],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class ThrottleModule {}
