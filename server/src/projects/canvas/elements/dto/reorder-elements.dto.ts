import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';
import type { ReorderElementsDto as IReorderElementsDto } from '@devdesigner/shared';
import { MAX_ID_LENGTH, MAX_REORDER_ELEMENTS } from '../../../common/limits';

/** Body for PATCH /projects/:projectId/elements/reorder. */
export class ReorderElementsDto implements IReorderElementsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_REORDER_ELEMENTS)
  @IsString({ each: true })
  @MaxLength(MAX_ID_LENGTH, { each: true })
  orderedElementIds!: string[];
}
