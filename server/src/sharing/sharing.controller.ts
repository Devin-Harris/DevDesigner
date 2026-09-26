import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type { ProjectGraphResponse, ShareLinkResponse } from '@dbdesigner/shared';
import { SharingService } from './sharing.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { CurrentUserId } from '../auth/current-user.decorator';

/**
 * Sharing routes (BUILD_INSTRUCTIONS.md section 5). Owner-only link management
 * under /projects/:projectId/share, plus the account-free entry point
 * GET /shared/:token. The controller only routes and validates; ownership and
 * token resolution live in the service and the policy layer.
 */
@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post('projects/:projectId/share')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateShareLinkDto,
    @CurrentUserId() userId: string | null,
  ): Promise<ShareLinkResponse> {
    return this.sharing.create(projectId, dto, userId);
  }

  @Get('projects/:projectId/share')
  list(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
  ): Promise<ShareLinkResponse[]> {
    return this.sharing.list(projectId, userId);
  }

  @Delete('projects/:projectId/share/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('projectId') projectId: string,
    @Param('linkId') linkId: string,
    @CurrentUserId() userId: string | null,
  ): Promise<void> {
    return this.sharing.revoke(projectId, linkId, userId);
  }

  @Get('shared/:token')
  getShared(@Param('token') token: string): Promise<ProjectGraphResponse> {
    return this.sharing.getSharedGraph(token);
  }
}
