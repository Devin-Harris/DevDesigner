import { IsNumber } from 'class-validator';
import type { UpdateLifelinePositionDto as IUpdateLifelinePositionDto } from '@dbdesigner/shared';

/** Body for PATCH /projects/:projectId/lifelines/:lifelineId/position (drag autosave). */
export class UpdateLifelinePositionDto implements IUpdateLifelinePositionDto {
  @IsNumber()
  x!: number;
}
