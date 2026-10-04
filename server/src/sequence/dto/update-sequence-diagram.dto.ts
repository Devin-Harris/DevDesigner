import { IsNumber, IsOptional } from 'class-validator';
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
}
