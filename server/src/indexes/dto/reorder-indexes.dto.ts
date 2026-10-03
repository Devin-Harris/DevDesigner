import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import type { ReorderIndexesDto as IReorderIndexesDto } from '@dbdesigner/shared';

/** Body for PATCH /tables/:tableId/indexes/reorder. */
export class ReorderIndexesDto implements IReorderIndexesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedIndexIds!: string[];
}
