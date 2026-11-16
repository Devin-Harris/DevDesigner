import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { CreateLifelineDto as ICreateLifelineDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** Body for POST /projects/:projectId/lifelines. */
export class CreateLifelineDto implements ICreateLifelineDto {
  /** Client-generated UUID (optimistic create); 409 when it is already taken. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  diagramId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

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

  @IsNumber()
  x!: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
