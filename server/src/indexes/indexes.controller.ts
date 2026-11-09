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
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

/**
 * Granular index routes. Create and reorder carry the parent tableId in the
 * path; single-index edits/deletes target the index id directly.
 */
@Controller()
export class IndexesController {
  constructor(private readonly indexes: IndexesService) {}

  @Post('tables/:tableId/indexes')
  create(
    @Param('tableId') tableId: string,
    @Body() dto: CreateIndexDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<IndexModel> {
    return this.indexes.create(tableId, dto, userId, shareToken, clientId);
  }

  @Patch('tables/:tableId/indexes/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @Param('tableId') tableId: string,
    @Body() dto: ReorderIndexesDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.indexes.reorder(tableId, dto, userId, shareToken, clientId);
  }

  @Patch('indexes/:indexId')
  update(
    @Param('indexId') indexId: string,
    @Body() dto: UpdateIndexDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<IndexModel> {
    return this.indexes.update(indexId, dto, userId, shareToken, clientId);
  }

  @Delete('indexes/:indexId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('indexId') indexId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.indexes.remove(indexId, userId, shareToken, clientId);
  }
}
