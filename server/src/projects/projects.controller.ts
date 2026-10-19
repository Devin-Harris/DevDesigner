import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ImportIntoProjectResponse,
  ProjectExportFile,
  ProjectGraphResponse,
  ProjectSummary,
} from '@dbdesigner/shared';
import type { Request, Response } from 'express';
import { writeRevisionTag } from '../common/write-revision';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateViewportDto } from './dto/update-viewport.dto';
import { UpdateHomeDto } from './dto/update-home.dto';
import { UpdateThemesDto } from './dto/update-themes.dto';
import { CurrentUser, CurrentUserId } from '../auth/current-user.decorator';
import { guestOwnerId } from '../auth/guest-id';
import type { AuthUser } from '../auth/auth.types';
import { ClientId, GuestId, ShareToken } from '../common/request.decorators';

/**
 * Granular project routes (BUILD_INSTRUCTIONS.md section 5). Controllers only
 * parse/validate input and delegate; logic lives in the service. Access checks
 * move into the policy layer once auth/sharing land.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @CurrentUserId() userId: string | null,
    @Query('archived') archived?: string,
  ): Promise<ProjectSummary[]> {
    return this.projects.list(userId, archived === 'true');
  }

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUserId() userId: string | null,
  ): Promise<ProjectSummary> {
    return this.projects.create(dto, userId);
  }

  /**
   * How many projects this browser created as a guest (X-Guest-Id), so a
   * freshly signed-in user can be offered to move them into their account.
   */
  @Get('guest-count')
  async guestCount(
    @CurrentUser() user: AuthUser | null,
    @GuestId() guestId: string | null,
  ): Promise<{ count: number }> {
    const owner = guestOwnerId(guestId);
    if (!user || !owner) {
      return { count: 0 };
    }
    return { count: await this.projects.countOwnedBy(owner) };
  }

  /** Move this browser's guest projects into the signed-in account. */
  @Post('claim-guest')
  async claimGuest(
    @CurrentUser() user: AuthUser | null,
    @GuestId() guestId: string | null,
  ): Promise<{ count: number }> {
    if (!user) {
      throw new UnauthorizedException('Sign in to claim guest projects.');
    }
    const owner = guestOwnerId(guestId);
    return { count: owner ? await this.projects.transferOwnership(owner, user.id) : 0 };
  }

  /** Create a project from an exported file. Declared before ':projectId' routes. */
  @Post('import')
  import(
    @Body() body: unknown,
    @CurrentUserId() userId: string | null,
  ): Promise<ProjectSummary> {
    return this.projects.importProject(body, userId);
  }

  /** Merge an exported file into this existing project. */
  @Post(':projectId/import-content')
  importContent(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<ImportIntoProjectResponse> {
    return this.projects.importIntoProject(projectId, body, userId, shareToken, clientId);
  }

  @Get(':projectId/export-file')
  export(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
  ): Promise<ProjectExportFile> {
    return this.projects.exportProject(projectId, userId, shareToken);
  }

  @Get(':projectId')
  async get(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProjectGraphResponse | undefined> {
    // Taken BEFORE reading, so a write landing mid-read leaves this tag outdated.
    const tag = writeRevisionTag();
    const tagged = (): void => {
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('ETag', tag);
    };
    if (req.headers['if-none-match'] === tag) {
      // Nothing was written since the caller's copy: skip rebuilding the graph.
      await this.projects.assertCanRead(projectId, userId, shareToken);
      tagged();
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    const graph = await this.projects.getGraph(projectId, userId, shareToken);
    tagged();
    return graph;
  }

  @Patch(':projectId')
  update(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUserId() userId: string | null,
  ): Promise<ProjectSummary> {
    return this.projects.update(projectId, dto, userId);
  }

  @Patch(':projectId/viewport')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateViewport(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateViewportDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
  ): Promise<void> {
    return this.projects.updateViewport(projectId, dto, userId, shareToken);
  }

  @Patch(':projectId/home')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateHome(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateHomeDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.projects.updateHome(projectId, dto, userId, shareToken, clientId);
  }

  @Put(':projectId/themes')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateThemes(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateThemesDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.projects.updateThemes(projectId, dto, userId, shareToken, clientId);
  }

  @Post(':projectId/duplicate')
  duplicate(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
  ): Promise<ProjectSummary> {
    return this.projects.duplicate(projectId, userId);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
  ): Promise<void> {
    return this.projects.remove(projectId, userId);
  }
}
