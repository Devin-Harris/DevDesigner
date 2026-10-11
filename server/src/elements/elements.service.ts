import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CanvasElementModel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { ImagesService } from '../images/images.service';
import { ElementEntity } from './element.entity';
import { toElementModel } from './element.mapper';
import { CreateElementDto } from './dto/create-element.dto';
import { UpdateElementDto } from './dto/update-element.dto';
import { UpdateElementPositionDto } from './dto/update-element-position.dto';
import { ReorderElementsDto } from './dto/reorder-elements.dto';

/**
 * Business logic for canvas drawing elements (the excalidraw-style layer). Mirrors
 * the tables service: every mutation authorizes through the policy layer first,
 * then broadcasts the persisted change to the project's realtime room so peers
 * converge (server-authoritative sync). The parent projectId rides in the path so
 * ancestry resolution stays a single cheap query (BUILD_INSTRUCTIONS.md section 7).
 */
@Injectable()
export class ElementsService {
  constructor(
    @InjectRepository(ElementEntity)
    private readonly elements: Repository<ElementEntity>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
    private readonly images: ImagesService,
  ) {}

  /** All elements for a project, ordered by stacking index, as shared models. */
  async getModelsForProject(projectId: string): Promise<CanvasElementModel[]> {
    const rows = await this.elements.find({
      where: { projectId },
      order: { zIndex: 'ASC' },
    });
    return rows.map(toElementModel);
  }

  async create(
    projectId: string,
    dto: CreateElementDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<CanvasElementModel> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    if (dto.type === 'image') {
      // An image element must point at a file uploaded to THIS project.
      const owned = dto.fileId
        ? await this.images.existsInProject(dto.fileId, projectId)
        : false;
      if (!owned) {
        throw new BadRequestException('Image elements need an image uploaded to this project.');
      }
    }
    const element = this.elements.create({
      projectId,
      type: dto.type,
      x: dto.x,
      y: dto.y,
      width: dto.width,
      height: dto.height,
      angle: dto.angle ?? 0,
      strokeColor: dto.strokeColor,
      backgroundColor: dto.backgroundColor ?? null,
      fillStyle: dto.fillStyle,
      strokeWidth: dto.strokeWidth,
      strokeStyle: dto.strokeStyle,
      opacity: dto.opacity,
      zIndex: dto.zIndex ?? (await this.nextZIndex(projectId)),
      cornerRadius: dto.cornerRadius ?? null,
      pointsJson: dto.points ? JSON.stringify(dto.points) : null,
      text: dto.text ?? null,
      fontSize: dto.fontSize ?? null,
      fontFamily: dto.fontFamily ?? null,
      bold: dto.bold ?? null,
      italic: dto.italic ?? null,
      lineHeight: dto.lineHeight ?? null,
      wrap: dto.wrap ?? null,
      runsJson: dto.runs?.length ? JSON.stringify(dto.runs) : null,
      textAlign: dto.textAlign ?? null,
      verticalAlign: dto.verticalAlign ?? null,
      startBindingKind: dto.startBinding?.targetKind ?? null,
      startBindingId: dto.startBinding?.targetId ?? null,
      endBindingKind: dto.endBinding?.targetKind ?? null,
      endBindingId: dto.endBinding?.targetId ?? null,
      startArrowhead: dto.startArrowhead ?? null,
      endArrowhead: dto.endArrowhead ?? null,
      curvature: dto.curvature ?? null,
      fileId: dto.type === 'image' ? (dto.fileId ?? null) : null,
      language: dto.type === 'code' ? (dto.language ?? 'typescript') : null,
      fileName: dto.type === 'code' ? dto.fileName?.trim() || null : null,
      expandedHeight: dto.type === 'code' ? (dto.expandedHeight ?? null) : null,
      slideJson: dto.type === 'frame' && dto.slide ? JSON.stringify(dto.slide) : null,
      morphId: dto.morphId ?? null,
      step: dto.step ?? null,
      slideId: dto.type === 'frame' ? null : (dto.slideId ?? null),
    });
    const saved = await this.elements.save(element);
    const model = toElementModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'element.created', element: model });
    return model;
  }

  async update(
    elementId: string,
    dto: UpdateElementDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<CanvasElementModel> {
    const projectId = await this.access.assertCanWriteElement(elementId, userId, shareToken);
    const element = await this.findOrThrow(elementId);
    this.applyPatch(element, dto);
    await this.elements.save(element);
    const model = toElementModel(element);
    this.realtime.emit(projectId, clientId, { kind: 'element.updated', element: model });
    return model;
  }

  async updatePosition(
    elementId: string,
    dto: UpdateElementPositionDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteElement(elementId, userId, shareToken);
    const patch: Partial<ElementEntity> = {};
    if (dto.x !== undefined) {
      patch.x = dto.x;
    }
    if (dto.y !== undefined) {
      patch.y = dto.y;
    }
    if (dto.points !== undefined) {
      patch.pointsJson = JSON.stringify(dto.points);
    }
    const result = await this.elements.update({ id: elementId }, patch);
    if (!result.affected) {
      throw new NotFoundException(`Element ${elementId} not found.`);
    }
    this.realtime.emit(projectId, clientId, {
      kind: 'element.moved',
      elementId,
      x: dto.x,
      y: dto.y,
      points: dto.points,
    });
  }

  async reorder(
    projectId: string,
    dto: ReorderElementsDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    await Promise.all(
      dto.orderedElementIds.map((id, index) =>
        this.elements.update({ id, projectId }, { zIndex: index }),
      ),
    );
    this.realtime.emit(projectId, clientId, {
      kind: 'element.reordered',
      orderedElementIds: dto.orderedElementIds,
    });
  }

  async remove(
    elementId: string,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteElement(elementId, userId, shareToken);
    const result = await this.elements.delete({ id: elementId });
    if (!result.affected) {
      throw new NotFoundException(`Element ${elementId} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'element.deleted', elementId });
  }

  /** Apply an update DTO onto an entity, translating points/bindings to columns. */
  private applyPatch(element: ElementEntity, dto: UpdateElementDto): void {
    const scalarKeys = [
      'x',
      'y',
      'width',
      'height',
      'angle',
      'strokeColor',
      'strokeWidth',
      'strokeStyle',
      'fillStyle',
      'opacity',
      'zIndex',
      'cornerRadius',
      'fontSize',
      'fontFamily',
      'bold',
      'italic',
      'lineHeight',
      'wrap',
      'textAlign',
      'verticalAlign',
      'startArrowhead',
      'endArrowhead',
      'curvature',
      'language',
    ] as const;
    for (const key of scalarKeys) {
      if (dto[key] !== undefined) {
        // Each key maps to an identically-named column of the matching type.
        (element as unknown as Record<string, unknown>)[key] = dto[key];
      }
    }
    // Nullable fields: a present value sets it, an explicit clear is handled below.
    if (dto.backgroundColor !== undefined) {
      element.backgroundColor = dto.backgroundColor;
    }
    if (dto.expandedHeight !== undefined && element.type === 'code') {
      element.expandedHeight = dto.expandedHeight;
    }
    if (dto.fileName !== undefined && element.type === 'code') {
      element.fileName = dto.fileName.trim() || null;
    }
    if (dto.text !== undefined) {
      element.text = dto.text;
    }
    if (dto.points !== undefined) {
      element.pointsJson = JSON.stringify(dto.points);
    }
    if (dto.runs !== undefined) {
      element.runsJson = dto.runs?.length ? JSON.stringify(dto.runs) : null;
    }
    if (dto.groupId !== undefined) {
      element.groupId = dto.groupId;
    }
    if (dto.slide !== undefined && element.type === 'frame') {
      element.slideJson = dto.slide ? JSON.stringify(dto.slide) : null;
    }
    if (dto.morphId !== undefined) {
      element.morphId = dto.morphId;
    }
    if (dto.step !== undefined) {
      element.step = dto.step;
    }
    if (dto.slideId !== undefined) {
      element.slideId = dto.slideId;
    }
    if (dto.startBinding !== undefined) {
      element.startBindingKind = dto.startBinding?.targetKind ?? null;
      element.startBindingId = dto.startBinding?.targetId ?? null;
    }
    if (dto.endBinding !== undefined) {
      element.endBindingKind = dto.endBinding?.targetKind ?? null;
      element.endBindingId = dto.endBinding?.targetId ?? null;
    }
  }

  /** Next stacking index for a project (max existing + 1, or 0). */
  private async nextZIndex(projectId: string): Promise<number> {
    const top = await this.elements.findOne({
      where: { projectId },
      order: { zIndex: 'DESC' },
      select: { id: true, zIndex: true },
    });
    return top ? top.zIndex + 1 : 0;
  }

  private async findOrThrow(elementId: string): Promise<ElementEntity> {
    const element = await this.elements.findOne({ where: { id: elementId } });
    if (!element) {
      throw new NotFoundException(`Element ${elementId} not found.`);
    }
    return element;
  }
}
