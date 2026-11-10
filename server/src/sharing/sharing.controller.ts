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
import { ProjectAccess, Public, RequiresAccess, type ResolvedProjectAccess } from '../access/access-policy';
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
  @RequiresAccess('owner')
  create(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateShareLinkDto,
  ): Promise<ShareLinkResponse> {
    return this.sharing.create(projectId, dto);
  }

  @Get('projects/:projectId/share')
  @RequiresAccess('owner')
  list(@ProjectAccess() { projectId }: ResolvedProjectAccess): Promise<ShareLinkResponse[]> {
    return this.sharing.list(projectId);
  }

  @Delete('projects/:projectId/share/:linkId')
  @RequiresAccess('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    return this.sharing.revoke(projectId, linkId);
  }

  /**
   * The shared graph, with the same per-project ETag / 304 handling as GET /projects/:id.
   * Public: the token in the path is the credential (resolved and checked by the service).
   */
  @Get('shared/:token')
  @Public()
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
