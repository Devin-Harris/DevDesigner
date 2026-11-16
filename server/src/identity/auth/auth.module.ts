import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OptionalAuthGuard } from './optional-auth.guard';
import { ApiToken } from './api-token.entity';
import { ApiTokenService } from './api-token.service';
import { AdminModule } from '../admin/admin.module';

/**
 * Owner authentication (BUILD_INSTRUCTIONS.md sections 5 and 6).
 *
 * Registers the User repository, configures the JWT signer/verifier from env,
 * and installs OptionalAuthGuard globally (APP_GUARD) so every request carries
 * the resolved caller (or null) without any route being forced to log in.
 * Sharing stays anonymous regardless of owner auth.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, ApiToken]),
    AdminModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'change-me-in-production'),
        signOptions: { algorithm: 'HS256', expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ApiTokenService, { provide: APP_GUARD, useClass: OptionalAuthGuard }],
  exports: [AuthService, ApiTokenService],
})
export class AuthModule {}
