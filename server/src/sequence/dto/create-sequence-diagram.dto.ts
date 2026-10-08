import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateSequenceDiagramDto as ICreateSequenceDiagramDto } from '@dbdesigner/shared';

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
  @IsString()
  @MaxLength(20)
  backgroundColor?: string;
}
