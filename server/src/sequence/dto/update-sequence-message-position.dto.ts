import { IsNumber } from 'class-validator';
import type { UpdateSequenceMessagePositionDto as IUpdateSequenceMessagePositionDto } from '@dbdesigner/shared';

/** Body for PATCH /projects/:projectId/messages/:messageId/position (drag autosave). */
export class UpdateSequenceMessagePositionDto implements IUpdateSequenceMessagePositionDto {
  @IsNumber()
  y!: number;
}
