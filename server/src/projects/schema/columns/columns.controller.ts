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
import type { ColumnModel } from '@devdesigner/shared';
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';

/**
 * Granular column routes (BUILD_INSTRUCTIONS.md section 5). Create and reorder
 * carry the parent tableId in the path; single-column edits/deletes target the
 * column id directly.
 */
@Controller()
export class ColumnsController {
  constructor(private readonly columns: ColumnsService) {}

  @Post('tables/:tableId/columns')
  @RequiresAccess('write', { from: 'table' })
  create(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnModel> {
    return this.columns.create(projectId, tableId, dto);
  }

  @Patch('tables/:tableId/columns/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'table' })
  reorder(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
    @Body() dto: ReorderColumnsDto,
  ): Promise<void> {
    return this.columns.reorder(projectId, tableId, dto);
  }

  @Patch('columns/:columnId')
  @RequiresAccess('write', { from: 'column' })
  update(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('columnId') columnId: string,
    @Body() dto: UpdateColumnDto,
  ): Promise<ColumnModel> {
    return this.columns.update(projectId, columnId, dto);
  }

  @Delete('columns/:columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'column' })
  remove(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('columnId') columnId: string,
  ): Promise<void> {
    return this.columns.remove(projectId, columnId);
  }
}
