import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import {
  CONNECTOR_SIDES,
  RELATIONSHIP_TYPES,
  type ConnectorSide,
  type PointModel,
  type RelationshipType,
  type UpdateRelationshipDto as IUpdateRelationshipDto,
} from '@devdesigner/shared';
import { PointDto } from './point.dto';

/** Body for PATCH /relationships/:relationshipId. */
export class UpdateRelationshipDto implements IUpdateRelationshipDto {
  @IsOptional()
  @IsIn([...RELATIONSHIP_TYPES])
  type?: RelationshipType;

  @IsOptional()
  @IsString()
  sourceColumnId?: string;

  @IsOptional()
  @IsString()
  targetColumnId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  onDelete?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  onUpdate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  waypoints?: PointModel[];

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
