import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateLifelineDto as IUpdateLifelineDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** Body for PATCH /projects/:projectId/lifelines/:lifelineId. */
export class UpdateLifelineDto implements IUpdateLifelineDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsColor()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsColor()
  @MaxLength(20)
  lineColor?: string;

  @IsOptional()
  @IsColor()
  @MaxLength(20)
  strokeColor?: string;

  @IsOptional()
  @IsColor()
  @MaxLength(20)
  textColor?: string;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
