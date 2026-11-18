import { IsNumber, Max, Min, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { CreateSequenceDiagramDto as ICreateSequenceDiagramDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** Body for POST /projects/:projectId/sequence-diagrams. */
export class CreateSequenceDiagramDto implements ICreateSequenceDiagramDto {
  /** Client-generated UUID (optimistic create); 409 when it is already taken. */
  @IsOptional()
  @IsUUID()
  id?: string;

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

  /** Text size multiple (Ctrl + resize). */
  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(20)
  scale?: number;

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
