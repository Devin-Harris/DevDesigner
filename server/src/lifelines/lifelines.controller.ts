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
import type { LifelineModel } from '@dbdesigner/shared';
import { LifelinesService } from './lifelines.service';
import { CreateLifelineDto } from './dto/create-lifeline.dto';
import { UpdateLifelineDto } from './dto/update-lifeline.dto';
import { UpdateLifelinePositionDto } from './dto/update-lifeline-position.dto';
import { ReorderLifelinesDto } from './dto/reorder-lifelines.dto';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

@Controller()
export class LifelinesController {
  constructor(private readonly lifelines: LifelinesService) {}

  @Post('projects/:projectId/lifelines')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateLifelineDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<LifelineModel> {
    return this.lifelines.create(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('lifelines/:lifelineId')
  update(
    @Param('lifelineId') lifelineId: string,
    @Body() dto: UpdateLifelineDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<LifelineModel> {
    return this.lifelines.update(lifelineId, dto, userId, shareToken, clientId);
  }

  @Patch('lifelines/:lifelineId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePosition(
    @Param('lifelineId') lifelineId: string,
    @Body() dto: UpdateLifelinePositionDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.lifelines.updatePosition(lifelineId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/lifelines/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @Param('projectId') projectId: string,
    @Body() dto: ReorderLifelinesDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.lifelines.reorder(projectId, dto, userId, shareToken, clientId);
  }

  @Delete('lifelines/:lifelineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('lifelineId') lifelineId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.lifelines.remove(lifelineId, userId, shareToken, clientId);
  }
}
