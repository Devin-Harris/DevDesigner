import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateSequenceDiagramDto as ICreateSequenceDiagramDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** Body for POST /projects/:projectId/sequence-diagrams. */
export class CreateSequenceDiagramDto implements ICreateSequenceDiagramDto {
  @IsNumber()
  originY!: number;

  @IsOptional()
  @IsNumber()
  lifelineSpacing?: number;

  @IsOptional()
  @IsNumber()
  rowSpacing?: number;

  @IsOptional()
  @IsNumber()
  headerHeight?: number;

  @IsOptional()
  @IsNumber()
  zIndex?: number;

  @IsOptional()
  @IsColor()
  @MaxLength(20)
  backgroundColor?: string;
  
  @IsOptional()
  @IsColor()
  @MaxLength(20)
  borderColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
