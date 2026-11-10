import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../identity/auth/user.entity';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

/**
 * Admin wall (docs/audits/04-auditing-analytics.md section 6). Depends only on the
 * User repository; AuthModule imports it to promote allowlisted users on login.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AdminController],
  providers: [AdminBootstrapService, AdminGuard],
  exports: [AdminBootstrapService],
})
export class AdminModule {}
