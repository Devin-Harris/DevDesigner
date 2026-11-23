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
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ShareLinkResponse, SharedProjectEntry } from '@devdesigner/shared';
import { SharingService } from './sharing.service';
import { SharedWithMeService } from './shared-with-me.service';
import { Caller } from '../../platform/http/caller';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { CallerScoped, ProjectAccess, Public, RequiresAccess, type ResolvedProjectAccess } from '../access/access-policy';
import { RateLimit } from '../../platform/throttle/rate-limit';
import { GraphCache } from '../../platform/graph-cache/graph-cache';

/**
 * Sharing routes (BUILD_INSTRUCTIONS.md section 5). Owner-only link management
 * under /projects/:projectId/share, plus the account-free entry point
 * GET /shared/:token. The controller only routes and validates; ownership and
 * token resolution live in the service and the policy layer.
 */
@Controller()
export class SharingController {
  constructor(
    private readonly sharing: SharingService,
    private readonly graphs: GraphCache,
    private readonly sharedWithMe: SharedWithMeService,
  ) {}

  @Post('projects/:projectId/share')
  @RequiresAccess('owner')
  @RateLimit('shareCreate')
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
    @Caller() caller: Caller,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const { projectId, accessLevel } = await this.sharing.sharedAccess(token);
    // Signed in (cookie session): remember the link for the projects dialog.
    if (caller.userId && !caller.viaToken) void this.sharedWithMe.recordVisit(caller.userId, projectId, token);
    return this.graphs.respond(projectId, accessLevel, req, res, () => this.sharing.graphFor(projectId, accessLevel));
  }

  /** Projects the signed-in user opened through share links that are still valid. */
  @Get('shared-with-me')
  @CallerScoped()
  async listSharedWithMe(@Caller() caller: Caller): Promise<SharedProjectEntry[]> {
    if (!caller.userId || caller.viaToken) return [];
    return this.sharedWithMe.list(caller.userId);
  }

  /** Remove a project from the user's "Shared with me" list (the link itself is untouched). */
  @Delete('shared-with-me/:projectId')
  @CallerScoped()
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgetSharedWithMe(@Caller() caller: Caller, @Param('projectId') projectId: string): Promise<void> {
    if (caller.userId && !caller.viaToken) await this.sharedWithMe.forget(caller.userId, projectId);
  }
}
