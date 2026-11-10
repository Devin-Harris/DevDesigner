import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';
import type { ReorderIndexesDto as IReorderIndexesDto } from '@devdesigner/shared';
import { MAX_ID_LENGTH, MAX_TABLE_INDEXES } from '../../common/limits';

/** Body for PATCH /tables/:tableId/indexes/reorder. */
export class ReorderIndexesDto implements IReorderIndexesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_TABLE_INDEXES)
  @IsString({ each: true })
  @MaxLength(MAX_ID_LENGTH, { each: true })
  orderedIndexIds!: string[];
}
