import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import type {
  AdminApiTokensResponse,
  AdminErrorsResponse,
  AdminEventsResponse,
  AdminFeaturesResponse,
  AdminOverviewResponse,
  AdminPage,
  AdminPingResponse,
  AdminProjectRow,
  AdminRealtimeResponse,
  AdminRetentionResponse,
  AdminStorageResponse,
  AdminTimeseriesResponse,
  AdminUserDetail,
  AdminUserRow,
} from '@devdesigner/shared';
import { AdminRoute } from '../../collaboration/access/access-policy';
import { RateLimit } from '../../platform/throttle/rate-limit';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminStorageService } from './admin-storage.service';
import { AdminUsersService } from './admin-users.service';
import { AdminGuard } from './admin.guard';
import {
  EventsQueryDto,
  ProjectsQueryDto,
  RangeQueryDto,
  RetentionQueryDto,
  TimeseriesQueryDto,
  UsersQueryDto,
} from './dto/admin-query.dto';

/**
 * Read-only admin API (`/api/admin/*`, audit 04 §6.2). Every route sits behind
 * AdminGuard and the `admin` rate limit; query params are validated (unknown ones
 * are refused), lists are paged and date windows are capped.
 */
@Controller('admin')
@UseGuards(AdminGuard)
@AdminRoute()
@RateLimit('admin')
export class AdminController {
  constructor(
    private readonly analytics: AdminAnalyticsService,
    private readonly storage: AdminStorageService,
    private readonly users: AdminUsersService,
  ) {}

  @Get('ping')
  ping(): AdminPingResponse {
    return { ok: true, serverTime: new Date().toISOString() };
  }

  @Get('overview')
  overview(@Query() query: RangeQueryDto): Promise<AdminOverviewResponse> {
    return this.analytics.overview(query.range ?? '30d');
  }

  @Get('timeseries')
  timeseries(@Query() query: TimeseriesQueryDto): Promise<AdminTimeseriesResponse> {
    return this.analytics.timeseries(query.metric, query.dim, query.from, query.to);
  }

  @Get('features')
  features(@Query() query: RangeQueryDto): Promise<AdminFeaturesResponse> {
    return this.analytics.features(query.range ?? '30d');
  }

  @Get('retention')
  retention(@Query() query: RetentionQueryDto): Promise<AdminRetentionResponse> {
    return this.analytics.retention(query.weeks ?? 8);
  }

  @Get('users')
  userList(@Query() query: UsersQueryDto): Promise<AdminPage<AdminUserRow>> {
    return this.users.list(query);
  }

  @Get('users/:userId')
  user(@Param('userId', new ParseUUIDPipe()) userId: string): Promise<AdminUserDetail> {
    return this.users.detail(userId);
  }

  @Get('projects')
  projects(@Query() query: ProjectsQueryDto): Promise<AdminPage<AdminProjectRow>> {
    return this.users.projects(query);
  }

  @Get('storage')
  storageReport(): Promise<AdminStorageResponse> {
    return this.storage.report();
  }

  @Get('api-tokens')
  apiTokens(@Query() query: RangeQueryDto): Promise<AdminApiTokensResponse> {
    return this.analytics.apiTokens(query.range ?? '30d');
  }

  @Get('errors')
  errors(@Query() query: RangeQueryDto): Promise<AdminErrorsResponse> {
    return this.analytics.errors(query.range ?? '7d');
  }

  @Get('realtime')
  realtime(): Promise<AdminRealtimeResponse> {
    return this.analytics.realtime();
  }

  @Get('events')
  events(@Query() query: EventsQueryDto): Promise<AdminEventsResponse> {
    return this.analytics.events(query);
  }
}
