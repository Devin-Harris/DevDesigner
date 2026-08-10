import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  ProjectGraphResponse,
  ProjectSummary,
  SchemaModel,
} from '@dbdesigner/shared';
import { TablesService } from '../tables/tables.service';
import { RelationshipsService } from '../relationships/relationships.service';
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
  ) {}

  async list(archived = false): Promise<ProjectSummary[]> {
    const rows = await this.projects.find({
      where: { archived },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async create(dto: CreateProjectDto): Promise<ProjectSummary> {
    const project = this.projects.create({
      name: dto.name,
      description: dto.description ?? null,
      ownerId: null,
    });
    const saved = await this.projects.save(project);
    return this.toSummary(saved);
  }

  /** Full project graph for initial load. Relationships and notes land in later phases. */
  async getGraph(id: string): Promise<ProjectGraphResponse> {
    const project = await this.findOrThrow(id);
    const [tables, relationships] = await Promise.all([
      this.tables.getModelsForProject(id),
      this.relationships.getModelsForProject(id),
    ]);
    const schema: SchemaModel = {
      tables,
      relationships,
      notes: [],
      viewport: {
        x: project.viewportX,
        y: project.viewportY,
        zoom: project.zoom,
      },
    };
    return {
      project: this.toSummary(project),
      schema,
      accessLevel: 'OWNER',
    };
  }

  async updateViewport(id: string, dto: UpdateViewportDto): Promise<void> {
    const result = await this.projects.update(
      { id },
      { viewportX: dto.viewportX, viewportY: dto.viewportY, zoom: dto.zoom },
    );
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectSummary> {
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
    const saved = await this.projects.save(project);
    return this.toSummary(saved);
  }

  async duplicate(id: string): Promise<ProjectSummary> {
    const source = await this.findOrThrow(id);
    const copy = this.projects.create({
      name: `${source.name} (copy)`,
      description: source.description,
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

  async remove(id: string): Promise<void> {
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
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
