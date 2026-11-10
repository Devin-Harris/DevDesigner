import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AdminPingResponse } from '@devdesigner/shared';
import { AdminGuard } from './admin.guard';

/** Read-only admin API (`/api/admin/*`). Every route sits behind AdminGuard. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  @Get('ping')
  ping(): AdminPingResponse {
    return { ok: true, serverTime: new Date().toISOString() };
  }
}
