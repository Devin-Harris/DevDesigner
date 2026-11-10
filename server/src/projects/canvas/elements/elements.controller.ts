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
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';

/**
 * Granular canvas-element routes (BUILD_INSTRUCTIONS.md section 5). Create and
 * reorder carry the parent projectId in the path; position is its own tiny
 * endpoint for drag/reshape autosave so the client never over-saves. Child routes
 * authorize against the element's project (`from: 'element'`).
 */
@Controller()
export class ElementsController {
  constructor(private readonly elements: ElementsService) {}

  @Post('projects/:projectId/elements')
  @RequiresAccess('write')
  create(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateElementDto,
  ): Promise<CanvasElementModel> {
    return this.elements.create(projectId, dto);
  }

  @Patch('projects/:projectId/elements/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write')
  reorder(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: ReorderElementsDto,
  ): Promise<void> {
    return this.elements.reorder(projectId, dto);
  }

  @Patch('elements/:elementId')
  @RequiresAccess('write', { from: 'element' })
  update(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('elementId') elementId: string,
    @Body() dto: UpdateElementDto,
  ): Promise<CanvasElementModel> {
    return this.elements.update(projectId, elementId, dto);
  }

  @Patch('elements/:elementId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'element' })
  updatePosition(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('elementId') elementId: string,
    @Body() dto: UpdateElementPositionDto,
  ): Promise<void> {
    return this.elements.updatePosition(projectId, elementId, dto);
  }

  @Delete('elements/:elementId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write', { from: 'element' })
  remove(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('elementId') elementId: string,
  ): Promise<void> {
    return this.elements.remove(projectId, elementId);
  }
}
