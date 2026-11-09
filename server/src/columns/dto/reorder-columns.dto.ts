import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import type { ReorderColumnsDto as IReorderColumnsDto } from '@devdesigner/shared';

/** Body for PATCH /tables/:tableId/columns/reorder. */
export class ReorderColumnsDto implements IReorderColumnsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedColumnIds!: string[];
}
