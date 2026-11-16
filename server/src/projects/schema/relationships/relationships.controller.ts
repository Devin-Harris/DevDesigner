import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { RelationshipModel } from '@devdesigner/shared';
import { RelationshipsService } from './relationships.service';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';

/** Granular relationship routes (BUILD_INSTRUCTIONS.md section 5). */
@Controller()
export class RelationshipsController {
  constructor(private readonly relationships: RelationshipsService) {}

  @Post('projects/:projectId/relationships')
  @RequiresAccess('write')
  create(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateRelationshipDto,
  ): Promise<RelationshipModel> {
    return this.relationships.create(projectId, dto);
  }

  @Patch('relationships/:relationshipId')
  @RequiresAccess('write', { from: 'relationship' })
  update(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('relationshipId') relationshipId: string,
    @Body() dto: UpdateRelationshipDto,
  ): Promise<RelationshipModel> {
    return this.relationships.update(projectId, relationshipId, dto);
  }

  @Delete('relationships/:relationshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'relationship' })
  remove(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('relationshipId') relationshipId: string,
  ): Promise<void> {
    return this.relationships.remove(projectId, relationshipId);
  }
}
