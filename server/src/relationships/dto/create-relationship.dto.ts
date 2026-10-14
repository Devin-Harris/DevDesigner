import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CONNECTOR_SIDES,
  RELATIONSHIP_TYPES,
  type ConnectorSide,
  type CreateRelationshipDto as ICreateRelationshipDto,
  type RelationshipType,
} from '@dbdesigner/shared';

/** Body for POST /projects/:projectId/relationships. */
export class CreateRelationshipDto implements ICreateRelationshipDto {
  @IsString()
  @IsNotEmpty()
  sourceColumnId!: string;

  @IsString()
  @IsNotEmpty()
  targetColumnId!: string;

  @IsIn([...RELATIONSHIP_TYPES])
  type!: RelationshipType;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  onDelete?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  onUpdate?: string;

  @IsOptional()
  @IsIn([...CONNECTOR_SIDES])
  sourceSide?: ConnectorSide;

  @IsOptional()
  @IsIn([...CONNECTOR_SIDES])
  targetSide?: ConnectorSide;

  @IsOptional()
  @IsBoolean()
  autoRoute?: boolean;
}
