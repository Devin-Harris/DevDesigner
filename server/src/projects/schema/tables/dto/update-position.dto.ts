import { IsNumber } from 'class-validator';
import type { UpdatePositionDto as IUpdatePositionDto } from '@devdesigner/shared';

/** Body for PATCH /tables/:tableId/position (drag autosave). */
export class UpdatePositionDto implements IUpdatePositionDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}
