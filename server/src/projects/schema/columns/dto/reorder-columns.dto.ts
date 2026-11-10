import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';
import type { ReorderColumnsDto as IReorderColumnsDto } from '@devdesigner/shared';
import { MAX_ID_LENGTH, MAX_TABLE_COLUMNS } from '../../../common/limits';

/** Body for PATCH /tables/:tableId/columns/reorder. */
export class ReorderColumnsDto implements IReorderColumnsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_TABLE_COLUMNS)
  @IsString({ each: true })
  @MaxLength(MAX_ID_LENGTH, { each: true })
  orderedColumnIds!: string[];
}
