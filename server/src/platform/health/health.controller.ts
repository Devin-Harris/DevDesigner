import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../collaboration/access/access-policy';
import { NoRateLimit } from '../throttle/rate-limit';

@Controller('health')
@Public()
@NoRateLimit()
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Liveness: never touches the database. */
  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness: the database answers a trivial query, else 503. */
  @Get('ready')
  async ready(): Promise<{ status: string; db: string; uptimeS: number; timestamp: string }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'unreachable' });
    }
    return { status: 'ok', db: 'ok', uptimeS: Math.round(process.uptime()), timestamp: new Date().toISOString() };
  }
}
