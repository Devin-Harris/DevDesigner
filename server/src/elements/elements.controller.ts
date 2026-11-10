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
import type { CanvasElementModel } from '@devdesigner/shared';
import { ElementsService } from './elements.service';
import { CreateElementDto } from './dto/create-element.dto';
import { UpdateElementDto } from './dto/update-element.dto';
import { UpdateElementPositionDto } from './dto/update-element-position.dto';
import { ReorderElementsDto } from './dto/reorder-elements.dto';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../platform/http/request.decorators';

/**
 * Granular canvas-element routes (BUILD_INSTRUCTIONS.md section 5). Create and
 * reorder carry the parent projectId in the path; position is its own tiny
 * endpoint for drag/reshape autosave so the client never over-saves. The share
 * token authorizes anonymous link callers; the client id lets the realtime
 * broadcast skip the origin tab.
 */
@Controller()
export class ElementsController {
  constructor(private readonly elements: ElementsService) {}

  @Post('projects/:projectId/elements')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateElementDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<CanvasElementModel> {
    return this.elements.create(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/elements/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @Param('projectId') projectId: string,
    @Body() dto: ReorderElementsDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.elements.reorder(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('elements/:elementId')
  update(
    @Param('elementId') elementId: string,
    @Body() dto: UpdateElementDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<CanvasElementModel> {
    return this.elements.update(elementId, dto, userId, shareToken, clientId);
  }

  @Patch('elements/:elementId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePosition(
    @Param('elementId') elementId: string,
    @Body() dto: UpdateElementPositionDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.elements.updatePosition(elementId, dto, userId, shareToken, clientId);
  }

  @Delete('elements/:elementId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('elementId') elementId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.elements.remove(elementId, userId, shareToken, clientId);
  }
}
