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
import type { IndexModel } from '@devdesigner/shared';
import { IndexesService } from './indexes.service';
import { CreateIndexDto } from './dto/create-index.dto';
import { UpdateIndexDto } from './dto/update-index.dto';
import { ReorderIndexesDto } from './dto/reorder-indexes.dto';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';

/**
 * Granular index routes. Create and reorder carry the parent tableId in the
 * path; single-index edits/deletes target the index id directly.
 */
@Controller()
export class IndexesController {
  constructor(private readonly indexes: IndexesService) {}

  @Post('tables/:tableId/indexes')
  @RequiresAccess('write', { from: 'table' })
  create(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
    @Body() dto: CreateIndexDto,
  ): Promise<IndexModel> {
    return this.indexes.create(projectId, tableId, dto);
  }

  @Patch('tables/:tableId/indexes/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'table' })
  reorder(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('tableId') tableId: string,
    @Body() dto: ReorderIndexesDto,
  ): Promise<void> {
    return this.indexes.reorder(projectId, tableId, dto);
  }

  @Patch('indexes/:indexId')
  @RequiresAccess('write', { from: 'index' })
  update(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('indexId') indexId: string,
    @Body() dto: UpdateIndexDto,
  ): Promise<IndexModel> {
    return this.indexes.update(projectId, indexId, dto);
  }

  @Delete('indexes/:indexId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'index' })
  remove(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('indexId') indexId: string,
  ): Promise<void> {
    return this.indexes.remove(projectId, indexId);
  }
}
