import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminStorageService } from './admin-storage.service';
import { AdminUsersService } from './admin-users.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

/**
 * Admin wall and dashboard API (docs/audits/04-auditing-analytics.md section 6).
 * AuthModule imports it to promote allowlisted users on login, so it must not import
 * AuthModule-dependent modules: the dashboard services read the app and analytics
 * DataSources (global) and the RealtimeGateway (exported by the global RealtimeModule).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AdminController],
  providers: [AdminBootstrapService, AdminGuard, AdminAnalyticsService, AdminStorageService, AdminUsersService],
  exports: [AdminBootstrapService],
})
export class AdminModule {}
