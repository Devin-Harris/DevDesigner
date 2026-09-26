import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { TableModel } from '@dbdesigner/shared';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { CurrentUserId } from '../auth/current-user.decorator';

/**
 * Granular table routes (BUILD_INSTRUCTIONS.md section 5). Create carries the
 * parent projectId in the path; position is its own tiny endpoint for drag
 * autosave so the client never over-saves.
 */
@Controller()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Post('projects/:projectId/tables')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateTableDto,
    @CurrentUserId() userId: string | null,
  ): Promise<TableModel> {
    return this.tables.create(projectId, dto, userId);
  }

  @Patch('tables/:tableId')
  update(
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableDto,
    @CurrentUserId() userId: string | null,
  ): Promise<TableModel> {
    return this.tables.update(tableId, dto, userId);
  }

  @Patch('tables/:tableId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePosition(
    @Param('tableId') tableId: string,
    @Body() dto: UpdatePositionDto,
    @CurrentUserId() userId: string | null,
  ): Promise<void> {
    return this.tables.updatePosition(tableId, dto, userId);
  }

  @Delete('tables/:tableId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tableId') tableId: string,
    @CurrentUserId() userId: string | null,
  ): Promise<void> {
    return this.tables.remove(tableId, userId);
  }
}
