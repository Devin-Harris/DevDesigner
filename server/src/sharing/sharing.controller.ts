import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProjectGraphResponse, ShareLinkResponse } from '@devdesigner/shared';
import { SharingService } from './sharing.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { CurrentUserId } from '../auth/current-user.decorator';
import {
  etagMatches,
  projectGraphTag,
  projectRevision,
  setGraphCacheHeaders,
} from '../common/project-revision';

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

  /** The shared graph, with the same per-project ETag / 304 handling as GET /projects/:id. */
  @Get('shared/:token')
  async getShared(
    @Param('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectGraphResponse | undefined> {
    const { projectId, accessLevel } = await this.sharing.sharedAccess(token);
    // Taken BEFORE reading, so a write landing mid-read leaves this tag outdated.
    const revision = projectRevision(projectId);
    const tag = projectGraphTag(projectId, accessLevel, revision);
    if (etagMatches(req.headers['if-none-match'], tag)) {
      setGraphCacheHeaders(res, tag);
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    const graph = await this.sharing.getSharedGraph(token);
    setGraphCacheHeaders(res, projectGraphTag(projectId, graph.accessLevel, revision));
    return graph;
  }
}
