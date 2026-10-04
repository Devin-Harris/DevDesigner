import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type {
  ProjectGraphResponse,
  ProjectSummary,
  SchemaModel,
} from '@dbdesigner/shared';
import { TablesService } from '../tables/tables.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { ElementsService } from '../elements/elements.service';
import { SequenceService } from '../sequence/sequence.service';
import { AccessService } from '../access/access.service';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateViewportDto } from './dto/update-viewport.dto';

/**
 * Business logic for projects. Data access goes through the injected repository;
 * responses are mapped to the shared ProjectSummary / ProjectGraphResponse shapes
 * so the client consumes exactly what it is typed against.
 *
 * Access control is deferred (anonymous phase): every caller currently has full
 * access. The policy layer (access/) will authorize these operations once auth
 * and sharing land (BUILD_INSTRUCTIONS.md sections 6 and 7).
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly tables: TablesService,
    private readonly relationships: RelationshipsService,
    private readonly elements: ElementsService,
    private readonly sequence: SequenceService,
    private readonly access: AccessService,
  ) {}

  /**
   * List projects for the dashboard. An authenticated caller sees only the
   * projects they own; an anonymous caller sees the account-free (ownerless)
   * projects, preserving the app's original no-login workflow.
   */
  async list(userId: string | null, archived = false): Promise<ProjectSummary[]> {
    const rows = await this.projects.find({
      where: { archived, ownerId: userId ?? IsNull() },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async create(dto: CreateProjectDto, userId: string | null): Promise<ProjectSummary> {
    const project = this.projects.create({
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'ERD',
      // Owned by the creator when signed in; ownerless (open) when anonymous.
      ownerId: userId,
    });
    const saved = await this.projects.save(project);
    return this.toSummary(saved);
  }

  /** Full project graph for initial load. Authorized against the caller's access. */
  async getGraph(
    id: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<ProjectGraphResponse> {
    const accessLevel = await this.access.assertCanRead(id, userId, shareToken);
    const project = await this.findOrThrow(id);
    const [tables, relationships, elements, sequence] = await Promise.all([
      this.tables.getModelsForProject(id),
      this.relationships.getModelsForProject(id),
      this.elements.getModelsForProject(id),
      this.sequence.getSchemaForProject(id),
    ]);
    const schema: SchemaModel = {
      tables,
      relationships,
      notes: [],
      elements,
      sequenceDiagrams: sequence.sequenceDiagrams,
      lifelines: sequence.lifelines,
      sequenceMessages: sequence.sequenceMessages,
      viewport: {
        x: project.viewportX,
        y: project.viewportY,
        zoom: project.zoom,
      },
    };
    return {
      project: this.toSummary(project),
      schema,
      accessLevel,
    };
  }

  async updateViewport(
    id: string,
    dto: UpdateViewportDto,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<void> {
    await this.access.assertCanWrite(id, userId, shareToken);
    const result = await this.projects.update(
      { id },
      { viewportX: dto.viewportX, viewportY: dto.viewportY, zoom: dto.zoom },
    );
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    userId: string | null,
  ): Promise<ProjectSummary> {
    await this.access.assertOwner(id, userId);
    const project = await this.findOrThrow(id);
    if (dto.name !== undefined) {
      project.name = dto.name;
    }
    if (dto.description !== undefined) {
      project.description = dto.description;
    }
    if (dto.archived !== undefined) {
      project.archived = dto.archived;
    }
    if (dto.type !== undefined) {
      project.type = dto.type;
    }
    const saved = await this.projects.save(project);
    return this.toSummary(saved);
  }

  async duplicate(id: string, userId: string | null): Promise<ProjectSummary> {
    await this.access.assertOwner(id, userId);
    const source = await this.findOrThrow(id);
    const copy = this.projects.create({
      name: `${source.name} (copy)`,
      description: source.description,
      type: source.type,
      ownerId: source.ownerId,
      archived: false,
      viewportX: source.viewportX,
      viewportY: source.viewportY,
      zoom: source.zoom,
    });
    const saved = await this.projects.save(copy);
    // NOTE: deep-copies only the project row for now. Tables, columns,
    // relationships, and notes are copied once those modules exist (Phase 2+).
    return this.toSummary(saved);
  }

  async remove(id: string, userId: string | null): Promise<void> {
    await this.access.assertOwner(id, userId);
    const result = await this.projects.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
  }

  private async findOrThrow(id: string): Promise<Project> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
    return project;
  }

  private toSummary(project: Project): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      archived: project.archived,
      type: project.type,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
