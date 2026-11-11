import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  ADMIN_MAX_EVENTS_PAGE,
  ADMIN_MAX_PAGE_SIZE,
  ADMIN_METRICS,
  ADMIN_PROJECT_SORTS,
  ADMIN_RANGES,
  ADMIN_USER_SORTS,
  ANALYTICS_EVENTS,
  type AdminMetric,
  type AdminProjectSort,
  type AdminRange,
  type AdminSortDir,
  type AdminUserSort,
} from '@devdesigner/shared';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `?range=7d|30d|90d` (default 30d). */
export class RangeQueryDto {
  @IsOptional()
  @IsIn(ADMIN_RANGES)
  range?: AdminRange;
}

/** Explicit UTC days; the service caps the span (ADMIN_MAX_RANGE_DAYS). */
export class DayWindowQueryDto {
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class TimeseriesQueryDto extends DayWindowQueryDto {
  @IsIn(ADMIN_METRICS)
  metric!: AdminMetric;

  /** Mutation kind (entity_writes) or MCP tool (mcp_calls). */
  @IsOptional()
  @Matches(/^[a-zA-Z_.]{1,64}$/)
  dim?: string;
}

export class RetentionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26)
  weeks?: number;
}

class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_MAX_PAGE_SIZE)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: AdminSortDir;
}

export class UsersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(ADMIN_USER_SORTS)
  sort?: AdminUserSort;
}

export class ProjectsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(ADMIN_PROJECT_SORTS)
  sort?: AdminProjectSort;
}

export class EventsQueryDto extends DayWindowQueryDto {
  @IsOptional()
  @IsIn(Object.keys(ANALYTICS_EVENTS))
  name?: string;

  /** Event id to continue below (pages go newest first). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_MAX_EVENTS_PAGE)
  limit?: number;
}
