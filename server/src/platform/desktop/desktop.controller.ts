import { timingSafeEqual } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { Project } from '../../projects/projects/project.entity';
import { Public } from '../../collaboration/access/access-policy';
import { isLoopback } from '../http/loopback';

export const DESKTOP_CONTROL_HEADER = 'x-desktop-control';

export class DesktopBackupDto {
  @IsString()
  @MaxLength(4096)
  path!: string;
}

/**
 * Control routes for the Electron main process (not the page): it passes a random
 * DESKTOP_CONTROL_TOKEN in the server's env and sends it back in a header. Anything
 * else, or any non-desktop server, gets a 404.
 */
@Controller('desktop')
export class DesktopController {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  /** Consistent copy of the live database (SQLite VACUUM INTO) at an absolute path. */
  @Post('backup')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async backup(@Req() req: Request, @Body() dto: DesktopBackupDto): Promise<void> {
    this.assertControl(req);
    if (!isAbsolute(dto.path)) throw new NotFoundException();
    await this.db.query('VACUUM INTO ?', [dto.path]);
  }

  /**
   * File > Open Recent in the app menu. Desktop mode has no analytics, so
   * `lastOpenedAt` is usually unset: most recently edited stands in for it.
   */
  @Get('recent-projects')
  @Public()
  async recentProjects(@Req() req: Request): Promise<Array<{ id: string; name: string }>> {
    this.assertControl(req);
    const rows = await this.db
      .getRepository(Project)
      .createQueryBuilder('p')
      .select(['p.id', 'p.name'])
      .where('p.archived = :archived', { archived: false })
      .orderBy('COALESCE(p.lastOpenedAt, p.updatedAt)', 'DESC')
      .limit(10)
      .getMany();
    return rows.map((p) => ({ id: p.id, name: p.name }));
  }

  private assertControl(req: Request): void {
    const expected = this.config.get<string>('DESKTOP_CONTROL_TOKEN', '');
    const given = req.header(DESKTOP_CONTROL_HEADER) ?? '';
    const ok =
      this.config.get<string>('DESKTOP') === 'true' &&
      isLoopback(req.socket.remoteAddress) &&
      expected.length >= 32 &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) throw new NotFoundException();
  }
}
