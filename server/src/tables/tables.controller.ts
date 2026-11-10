import type { TableModel } from '@devdesigner/shared';
import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../access/access-policy';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { TablesService } from './tables.service';

/**
 * Granular table routes (BUILD_INSTRUCTIONS.md section 5). Create carries the
 * parent projectId in the path; position is its own tiny endpoint for drag
 * autosave so the client never over-saves. Child routes authorize against the
 * table's project (`@RequiresAccess('write', { from: 'table' })`).
 */
@Controller()
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Post('projects/:projectId/tables')
  @RequiresAccess('write')
  create(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateTableDto,
  ): Promise<TableModel> {
    return this.tables.create(projectId, dto);
  }

  @Patch('tables/:tableId')
  @RequiresAccess('write', { from: 'table' })
  update(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableDto,
  ): Promise<TableModel> {
    return this.tables.update(projectId, tableId, dto);
  }

  @Patch('tables/:tableId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'table' })
  updatePosition(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
    @Body() dto: UpdatePositionDto,
  ): Promise<void> {
    return this.tables.updatePosition(projectId, tableId, dto);
  }

  @Delete('tables/:tableId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'table' })
  remove(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
  ): Promise<void> {
    return this.tables.remove(projectId, tableId);
  }
}
