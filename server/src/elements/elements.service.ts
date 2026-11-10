import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CanvasElementModel } from '@devdesigner/shared';
import { Project } from '../projects/project.entity';
import { AccessService, bindingRefs, mergeRefs, type ProjectRefs } from '../access/access.service';
import { applyDefined } from '../common/apply-patch';
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

  async create(
    projectId: string,
    dto: CreateElementDto,
  ): Promise<CanvasElementModel> {
    await this.access.assertRefsInProject(elementRefs(dto), projectId);
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
    // A client-chosen id must be new: `save` would otherwise update the existing row.
    if (dto.id && (await this.elements.exists({ where: { id: dto.id } }))) {
      throw new ConflictException(`Element ${dto.id} already exists.`);
    }
    const element = this.elements.create({
      ...(dto.id ? { id: dto.id } : {}),
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
      ellipticCorners: dto.ellipticCorners ?? null,
      elbow: dto.elbow ?? null,
      clipContent: dto.clipContent ?? null,
      pointsJson: dto.points ? JSON.stringify(dto.points) : null,
      text: dto.text ?? null,
      fontSize: dto.fontSize ?? null,
      fontFamily: dto.fontFamily ?? null,
      bold: dto.bold ?? null,
      aboveTables: dto.aboveTables ?? null,
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
      mediaJson: dto.type === 'image' && dto.media ? JSON.stringify(dto.media) : null,
      language: dto.type === 'code' ? (dto.language ?? 'typescript') : null,
      fileName: dto.type === 'code' ? dto.fileName?.trim() || null : null,
      diffText: dto.type === 'code' ? (dto.diffText ?? null) : null,
      diffView: dto.type === 'code' ? (dto.diffView ?? null) : null,
      diffSplit: dto.type === 'code' ? (dto.diffSplit ?? null) : null,
      diffShowWhitespace: dto.type === 'code' ? (dto.diffShowWhitespace ?? null) : null,
      expandedHeight: dto.type === 'code' ? (dto.expandedHeight ?? null) : null,
      slideJson: dto.type === 'frame' && dto.slide ? JSON.stringify(dto.slide) : null,
      morphId: dto.morphId ?? null,
      morphIn: dto.morphIn ?? null,
      morphOut: dto.morphOut ?? null,
      placeholderJson: dto.placeholder ? JSON.stringify(dto.placeholder) : null,
      overrides: dto.overrides ?? null,
      step: dto.step ?? null,
      slideId: dto.type === 'frame' ? null : (dto.slideId ?? null),
    });
    const saved = await this.elements.save(element);
    const model = toElementModel(saved);
    this.realtime.emit(projectId, { kind: 'element.created', element: model });
    return model;
  }

  async update(
    projectId: string,
    elementId: string,
    dto: UpdateElementDto,
  ): Promise<CanvasElementModel> {
    await this.access.assertRefsInProject(elementRefs(dto), projectId);
    const element = await this.findOrThrow(elementId);
    applyElementPatch(element, dto);
    await this.elements.save(element);
    const model = toElementModel(element);
    this.realtime.emit(projectId, { kind: 'element.updated', element: model });
    return model;
  }

  async updatePosition(
    projectId: string,
    elementId: string,
    dto: UpdateElementPositionDto,
  ): Promise<void> {
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
    this.realtime.emit(projectId, {
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
  ): Promise<void> {
    // Position in the list is the new zIndex (a repeated id keeps its last position).
    const wanted = new Map(dto.orderedElementIds.map((id, index) => [id, index]));
    // One transaction (one commit), touching only this project's rows whose index moved.
    await this.elements.manager.transaction(async (m) => {
      const rows = await m.find(ElementEntity, {
        where: { projectId },
        select: { id: true, zIndex: true },
      });
      for (const row of rows) {
        const zIndex = wanted.get(row.id);
        if (zIndex !== undefined && zIndex !== row.zIndex) {
          await m.update(ElementEntity, { id: row.id, projectId }, { zIndex });
        }
      }
    });
    this.realtime.emit(projectId, {
      kind: 'element.reordered',
      orderedElementIds: dto.orderedElementIds,
    });
  }

  async remove(
    projectId: string,
    elementId: string,
  ): Promise<void> {
    const result = await this.elements.delete({ id: elementId });
    if (!result.affected) {
      throw new NotFoundException(`Element ${elementId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'element.deleted', elementId });
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

/** What an element write points at: its slide frame and its arrow bindings (security L-7). */
export function elementRefs(dto: Pick<UpdateElementDto, 'slideId' | 'startBinding' | 'endBinding'>): ProjectRefs {
  return mergeRefs({ element: [dto.slideId] }, bindingRefs(dto.startBinding, dto.endBinding));
}

/** Apply an update DTO onto an entity, translating points/bindings to columns. */
export function applyElementPatch(element: ElementEntity, dto: UpdateElementDto): void {
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
    'ellipticCorners',
    'elbow',
    'clipContent',
    'fontSize',
    'fontFamily',
    'bold',
    'aboveTables',
    'italic',
    'lineHeight',
    'wrap',
    'textAlign',
    'verticalAlign',
    'startArrowhead',
    'endArrowhead',
    'curvature',
    'language',
    // Nullable fields: a present value sets it, null clears it.
    'backgroundColor',
    'text',
    'groupId',
    'overrides',
    'morphIn',
    'morphOut',
    'morphId',
    'step',
    'slideId',
  ] as const;
  // Each key maps to an identically-named column of the matching type.
  applyDefined(element, dto, scalarKeys);
  if (dto.expandedHeight !== undefined && element.type === 'code') {
    element.expandedHeight = dto.expandedHeight;
  }
  if (dto.diffText !== undefined && element.type === 'code') {
    element.diffText = dto.diffText;
  }
  if (dto.diffShowWhitespace !== undefined && element.type === 'code') {
    element.diffShowWhitespace = dto.diffShowWhitespace;
  }
  if (dto.diffSplit !== undefined && element.type === 'code') {
    element.diffSplit = dto.diffSplit;
  }
  if (dto.diffView !== undefined && element.type === 'code') {
    element.diffView = dto.diffView;
  }
  if (dto.fileName !== undefined && element.type === 'code') {
    element.fileName = dto.fileName.trim() || null;
  }
  if (dto.points !== undefined) {
    element.pointsJson = JSON.stringify(dto.points);
  }
  if (dto.runs !== undefined) {
    element.runsJson = dto.runs?.length ? JSON.stringify(dto.runs) : null;
  }
  if (dto.slide !== undefined && element.type === 'frame') {
    element.slideJson = dto.slide ? JSON.stringify(dto.slide) : null;
  }
  if (dto.media !== undefined && element.type === 'image') {
    element.mediaJson = dto.media ? JSON.stringify(dto.media) : null;
  }
  if (dto.placeholder !== undefined) {
    element.placeholderJson = dto.placeholder ? JSON.stringify(dto.placeholder) : null;
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
