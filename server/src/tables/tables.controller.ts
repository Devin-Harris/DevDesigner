import type { TableModel } from '@dbdesigner/shared';
import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';

/**
 * Granular table routes (BUILD_INSTRUCTIONS.md section 5). Create carries the
 * parent projectId in the path; position is its own tiny endpoint for drag
 * autosave so the client never over-saves. The share token authorizes anonymous
 * link callers; the client id lets the realtime broadcast skip the origin tab.
 */
@Controller()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Post('projects/:projectId/tables')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTableDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<TableModel> {
    return this.tables.create(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('tables/:tableId')
  update(
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<TableModel> {
    return this.tables.update(tableId, dto, userId, shareToken, clientId);
  }

  @Patch('tables/:tableId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePosition(
    @Param('tableId') tableId: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.tables.updatePosition(tableId, dto, userId, shareToken, clientId);
  }

  @Delete('tables/:tableId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tableId') tableId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.tables.remove(tableId, userId, shareToken, clientId);
  }
}
