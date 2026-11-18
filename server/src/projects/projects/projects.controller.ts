import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ImportIntoProjectResponse,
  ProjectExportFile,
  ProjectSummary,
} from '@devdesigner/shared';
import type { Request, Response } from 'express';
import { GraphCache } from '../../platform/graph-cache/graph-cache';
import {
  CallerScoped,
  ProjectAccess,
  RequiresAccess,
  type ResolvedProjectAccess,
} from '../../collaboration/access/access-policy';
import { Caller } from '../../platform/http/caller';
import { RateLimit } from '../../platform/throttle/rate-limit';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateViewportDto } from './dto/update-viewport.dto';
import { UpdateHomeDto } from './dto/update-home.dto';
import { UpdateThemesDto } from './dto/update-themes.dto';

/**
 * Project routes. Controllers only parse/validate input and delegate; every
 * `:projectId` route declares the access it needs and ProjectAccessGuard has
 * resolved it before the handler runs. List/create/import act for the caller.
 */
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly graphs: GraphCache,
  ) {}

  @Get()
  @CallerScoped()
  list(@Caller() caller: Caller, @Query('archived') archived?: string): Promise<ProjectSummary[]> {
    return this.projects.list(caller.ownerId, archived === 'true');
  }

  @Post()
  @CallerScoped()
  @RateLimit('projectCreate')
  create(@Body() dto: CreateProjectDto, @Caller() caller: Caller): Promise<ProjectSummary> {
    return this.projects.create(dto, caller.ownerId);
  }

  /**
   * How many projects this browser created as a guest (X-Guest-Id), so a
   * freshly signed-in user can be offered to move them into their account.
   */
  @Get('guest-count')
  @CallerScoped()
  async guestCount(@Caller() caller: Caller): Promise<{ count: number }> {
    if (!caller.userId || !caller.guestId) {
      return { count: 0 };
    }
    return { count: await this.projects.countOwnedBy(caller.guestId) };
  }

  /** Move this browser's guest projects into the signed-in account. */
  @Post('claim-guest')
  @CallerScoped()
  async claimGuest(@Caller() caller: Caller): Promise<{ count: number }> {
    if (!caller.userId) {
      throw new UnauthorizedException('Sign in to claim guest projects.');
    }
    return {
      count: caller.guestId
        ? await this.projects.transferOwnership(caller.guestId, caller.userId)
        : 0,
    };
  }

  /** Create a project from an exported file. Declared before ':projectId' routes. */
  @Post('import')
  @CallerScoped()
  @RateLimit('projectImport')
  import(@Body() body: unknown, @Caller() caller: Caller): Promise<ProjectSummary> {
    return this.projects.importProject(body, caller.ownerId);
  }

  /** Merge an exported file into this existing project. */
  @Post(':projectId/import-content')
  @RequiresAccess('write')
  @RateLimit('projectImport')
  importContent(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() body: unknown,
  ): Promise<ImportIntoProjectResponse> {
    return this.projects.importIntoProject(projectId, body);
  }

  /** Make this project an exact, id-preserving mirror of an exported file (desktop sync). */
  @Post(':projectId/mirror-content')
  @RequiresAccess('write')
  @RateLimit('projectImport')
  mirrorContent(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() body: unknown,
  ): Promise<{ revision: number }> {
    return this.projects.mirrorProjectContent(projectId, body);
  }

  @Get(':projectId/export-file')
  @RequiresAccess('read')
  @RateLimit('exportFile')
  export(
    @ProjectAccess() { projectId, accessLevel }: ResolvedProjectAccess,
  ): Promise<ProjectExportFile> {
    return this.projects.exportProject(projectId, accessLevel);
  }

  @Get(':projectId')
  @RequiresAccess('read')
  async get(
    @ProjectAccess() { projectId, accessLevel }: ResolvedProjectAccess,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    // 304 while the caller's copy is current; else the cached (pre-gzipped) body.
    return this.graphs.respond(projectId, accessLevel, req, res, () =>
      this.projects.getGraph(projectId, accessLevel),
    );
  }

  @Patch(':projectId')
  @RequiresAccess('owner')
  update(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectSummary> {
    return this.projects.update(projectId, dto);
  }

  @Patch(':projectId/viewport')
  @RequiresAccess('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateViewport(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: UpdateViewportDto,
  ): Promise<void> {
    return this.projects.updateViewport(projectId, dto);
  }

  @Patch(':projectId/home')
  @RequiresAccess('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateHome(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: UpdateHomeDto,
  ): Promise<void> {
    return this.projects.updateHome(projectId, dto);
  }

  @Put(':projectId/themes')
  @RequiresAccess('write')
  @HttpCode(HttpStatus.NO_CONTENT)
  updateThemes(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: UpdateThemesDto,
  ): Promise<void> {
    return this.projects.updateThemes(projectId, dto);
  }

  @Post(':projectId/duplicate')
  @RequiresAccess('owner')
  @RateLimit('projectCreate')
  duplicate(@ProjectAccess() { projectId }: ResolvedProjectAccess): Promise<ProjectSummary> {
    return this.projects.duplicate(projectId);
  }

  @Delete(':projectId')
  @RequiresAccess('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@ProjectAccess() { projectId }: ResolvedProjectAccess): Promise<void> {
    return this.projects.remove(projectId);
  }
}
