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
import type { ColumnModel } from '@dbdesigner/shared';
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';

/**
 * Granular column routes (BUILD_INSTRUCTIONS.md section 5). Create and reorder
 * carry the parent tableId in the path; single-column edits/deletes target the
 * column id directly.
 */
@Controller()
export class ColumnsController {
  constructor(private readonly columns: ColumnsService) {}

  @Post('tables/:tableId/columns')
  create(
    @Param('tableId') tableId: string,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnModel> {
    return this.columns.create(tableId, dto);
  }

  @Patch('tables/:tableId/columns/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @Param('tableId') tableId: string,
    @Body() dto: ReorderColumnsDto,
  ): Promise<void> {
    return this.columns.reorder(tableId, dto);
  }

  @Patch('columns/:columnId')
  update(
    @Param('columnId') columnId: string,
    @Body() dto: UpdateColumnDto,
  ): Promise<ColumnModel> {
    return this.columns.update(columnId, dto);
  }

  @Delete('columns/:columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('columnId') columnId: string): Promise<void> {
    return this.columns.remove(columnId);
  }
}
