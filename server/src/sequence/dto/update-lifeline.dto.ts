import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateLifelineDto as IUpdateLifelineDto } from '@dbdesigner/shared';

/** Body for PATCH /projects/:projectId/lifelines/:lifelineId. */
export class UpdateLifelineDto implements IUpdateLifelineDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsNumber()
  width?: number;
}
