import { IsNumber, Max, Min, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateSequenceDiagramDto as IUpdateSequenceDiagramDto } from '@devdesigner/shared';
import { IsColor } from '../../../common/validators';

/** Body for PATCH /projects/:projectId/sequence-diagrams/:diagramId. */
export class UpdateSequenceDiagramDto implements IUpdateSequenceDiagramDto {
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

  /** Box bounds beyond the content; 0 = hug the content. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  padLeft?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  padTop?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  boxWidth?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  boxHeight?: number;

  @IsOptional()
  @IsNumber()
  originY?: number;

  @IsOptional()
  @IsNumber()
  zIndex?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  slideId?: string | null;

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
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  morphId?: string;
}
