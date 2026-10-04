import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateLifelineDto as ICreateLifelineDto } from '@dbdesigner/shared';

/** Body for POST /projects/:projectId/lifelines. */
export class CreateLifelineDto implements ICreateLifelineDto {
  @IsString()
  @IsNotEmpty()
  diagramId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsNumber()
  x!: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  order?: number;
}
