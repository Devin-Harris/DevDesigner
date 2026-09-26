import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  ProjectGraphResponse,
  ProjectSummary,
} from '@dbdesigner/shared';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateViewportDto } from './dto/update-viewport.dto';
import { CurrentUserId } from '../auth/current-user.decorator';

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

  @Get(':projectId')
  get(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
  ): Promise<ProjectGraphResponse> {
    return this.projects.getGraph(projectId, userId);
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
  ): Promise<void> {
    return this.projects.updateViewport(projectId, dto, userId);
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
