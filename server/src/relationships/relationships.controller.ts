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
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

/** Granular relationship routes (BUILD_INSTRUCTIONS.md section 5). */
@Controller()
export class RelationshipsController {
  constructor(private readonly relationships: RelationshipsService) {}

  @Post('projects/:projectId/relationships')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateRelationshipDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<RelationshipModel> {
    return this.relationships.create(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('relationships/:relationshipId')
  update(
    @Param('relationshipId') relationshipId: string,
    @Body() dto: UpdateRelationshipDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<RelationshipModel> {
    return this.relationships.update(relationshipId, dto, userId, shareToken, clientId);
  }

  @Delete('relationships/:relationshipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('relationshipId') relationshipId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.relationships.remove(relationshipId, userId, shareToken, clientId);
  }
}
