import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { UpdateSequenceDiagramDto as IUpdateSequenceDiagramDto } from '@dbdesigner/shared';

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
  @IsString()
  @MaxLength(20)
  backgroundColor?: string;
  
  @IsOptional()
  @IsString()
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
