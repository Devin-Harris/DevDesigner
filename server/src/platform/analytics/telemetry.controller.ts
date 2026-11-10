import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { isClientAnalyticsEventName, TELEMETRY_MAX_EVENTS } from '@devdesigner/shared';
import { Public } from '../../collaboration/access/access-policy';
import { RateLimit } from '../throttle/rate-limit';
import { AnalyticsService } from './analytics.service';

/**
 * Client beacon (`navigator.sendBeacon`): `POST /api/telemetry` with
 * `{ events: [{ name, props }] }` (TelemetryBatch), at most 20 events and 8 KB
 * (route-scoped body limit in main.ts; text/plain bodies are accepted so the
 * beacon needs no CORS preflight). No auth required. Only `client.*` names from the
 * shared catalog are kept and their props are reduced to the declared enums,
 * numbers and booleans; everything else is counted as `telemetry.rejected`.
 */
@Controller('telemetry')
@Public()
export class TelemetryController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post()
  @RateLimit('telemetry')
  @HttpCode(HttpStatus.NO_CONTENT)
  collect(@Body() body: unknown): void {
    const events = (body as { events?: unknown } | null)?.events;
    if (!Array.isArray(events) || events.length > TELEMETRY_MAX_EVENTS) {
      throw new BadRequestException(`Expected { events: [...] } with at most ${TELEMETRY_MAX_EVENTS} events.`);
    }
    let rejected = 0;
    for (const event of events as Array<{ name?: unknown; props?: unknown } | null>) {
      const name = event?.name;
      if (!isClientAnalyticsEventName(name)) {
        rejected++;
        continue;
      }
      this.analytics.track({ name, props: event?.props, source: 'client' });
    }
    if (rejected > 0) this.analytics.count({ name: 'telemetry.rejected', count: rejected, source: 'client' });
  }
}
