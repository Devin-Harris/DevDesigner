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
import type { RelationshipModel } from '@dbdesigner/shared';
import { RelationshipsService } from './relationships.service';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';

/** Granular relationship routes (BUILD_INSTRUCTIONS.md section 5). */
@Controller()
export class RelationshipsController {
  constructor(private readonly relationships: RelationshipsService) {}

  @Post('projects/:projectId/relationships')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateRelationshipDto,
  ): Promise<RelationshipModel> {
    return this.relationships.create(projectId, dto);
  }

  @Patch('relationships/:relationshipId')
  update(
    @Param('relationshipId') relationshipId: string,
    @Body() dto: UpdateRelationshipDto,
  ): Promise<RelationshipModel> {
    return this.relationships.update(relationshipId, dto);
  }

  @Delete('relationships/:relationshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('relationshipId') relationshipId: string): Promise<void> {
    return this.relationships.remove(relationshipId);
  }
}
