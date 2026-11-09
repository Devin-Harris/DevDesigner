import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import type { ReorderElementsDto as IReorderElementsDto } from '@devdesigner/shared';

/** Body for PATCH /projects/:projectId/elements/reorder. */
export class ReorderElementsDto implements IReorderElementsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedElementIds!: string[];
}
