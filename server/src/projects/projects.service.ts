import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  PROJECT_EXPORT_FORMAT,
  type AccessLevel,
  PROJECT_EXPORT_VERSION,
  type ImportIntoProjectResponse,
  type ProjectExportFile,
  type ProjectExportImage,
  type ProjectGraphResponse,
  type ProjectSummary,
  type SchemaMutation,
  type SchemaModel,
  type SlideTheme,
} from '@devdesigner/shared';
import { TablesService } from '../tables/tables.service';
import { RelationshipsService } from '../relationships/relationships.service';
import { ElementsService } from '../elements/elements.service';
import { SequenceService } from '../sequence/sequence.service';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { ElementEntity } from '../elements/element.entity';
import { TableEntity } from '../tables/table.entity';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateViewportDto } from './dto/update-viewport.dto';
import { UpdateHomeDto } from './dto/update-home.dto';
import { UpdateThemesDto } from './dto/update-themes.dto';
import { parseProjectExport } from './project-import.parser';
import {
  offsetToAnchor,
  writeImportedProject,
  writeSchemaInto,
  type ImportedImage,
} from './project-import.writer';
import { ImagesService } from '../images/images.service';
import { bumpProjectRevision } from '../common/project-revision';

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
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimePublisher,
    private readonly images: ImagesService,
  ) {}

  /**
   * List projects for the dashboard. An authenticated caller sees only the
   * projects they own; an anonymous caller sees only its own browser's guest
   * projects (userId is `guest:<id>`). Legacy ownerless projects are never listed.
   */
  async list(userId: string | null, archived = false): Promise<ProjectSummary[]> {
    if (!userId) {
      return [];
    }
    const rows = await this.projects.find({
      where: { archived, ownerId: userId },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((row) => this.toSummary(row));
  }

  /** Number of projects (archived or not) owned by `ownerId`. */
  countOwnedBy(ownerId: string): Promise<number> {
    return this.projects.count({ where: { ownerId } });
  }

  /** Reassign every project of `fromOwner` to `toOwner`; returns how many moved. */
  async transferOwnership(fromOwner: string, toOwner: string): Promise<number> {
    const result = await this.projects.update({ ownerId: fromOwner }, { ownerId: toOwner });
    return result.affected ?? 0;
  }

  async create(dto: CreateProjectDto, userId: string | null): Promise<ProjectSummary> {
    const project = this.projects.create({
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'ERD',
      // Owned by the account when signed in, else by this browser's guest id.
      ownerId: userId,
    });
    const saved = await this.projects.save(project);
    return this.toSummary(saved);
  }

  /** Authorize a read without loading anything (conditional graph requests); returns the level. */
  assertCanRead(
    id: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    return this.access.assertCanRead(id, userId, shareToken);
  }

  /** Full project graph for initial load. Authorized against the caller's access. */
  async getGraph(
    id: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<ProjectGraphResponse> {
    // One read both authorizes and supplies the project row.
    const { project, accessLevel } = await this.access.readProject(id, userId, shareToken);
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
      home:
        project.homeX !== null && project.homeY !== null && project.homeZoom !== null
          ? { x: project.homeX, y: project.homeY, zoom: project.homeZoom }
          : null,
      themes: parseThemes(project.themesJson),
    };
    return {
      project: this.toSummary(project),
      schema,
      accessLevel,
    };
  }

  /**
   * Just the database part of a project (tables + relationships), for SQL export.
   * Authorized like getGraph; skips elements, sequence diagrams and the project row.
   */
  async getDatabaseSchema(
    id: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<Pick<SchemaModel, 'tables' | 'relationships'>> {
    await this.access.assertCanRead(id, userId, shareToken);
    const [tables, relationships] = await Promise.all([
      this.tables.getModelsForProject(id),
      this.relationships.getModelsForProject(id),
    ]);
    return { tables, relationships };
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

  /** Set (or clear, with `home: null`) the project's shared home view and tell collaborators. */
  async updateHome(
    id: string,
    dto: UpdateHomeDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    await this.access.assertCanWrite(id, userId, shareToken);
    const home = dto.home ?? null;
    const result = await this.projects.update(
      { id },
      {
        homeX: home?.x ?? null,
        homeY: home?.y ?? null,
        homeZoom: home?.zoom ?? null,
      },
    );
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
    this.realtime.emit(id, clientId, { kind: 'home.updated', home });
  }

  /** Replace the project's custom theme library and tell collaborators. */
  async updateThemes(
    id: string,
    dto: UpdateThemesDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    await this.access.assertCanWrite(id, userId, shareToken);
    const result = await this.projects.update({ id }, { themesJson: JSON.stringify(dto.themes) });
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
    this.realtime.emit(id, clientId, { kind: 'themes.updated', themes: dto.themes });
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
    // Name/description/type/archived ride in the graph's project summary.
    bumpProjectRevision(id);
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
      homeX: source.homeX,
      homeY: source.homeY,
      homeZoom: source.homeZoom,
      themesJson: source.themesJson,
    });
    const saved = await this.projects.save(copy);
    // NOTE: deep-copies only the project row for now. Tables, columns,
    // relationships, and notes are copied once those modules exist (Phase 2+).
    return this.toSummary(saved);
  }

  /**
   * Portable snapshot of a project for download. Anyone who can read the project
   * can export it (a view-only share link included, since they already see all of it).
   */
  async exportProject(
    id: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<ProjectExportFile> {
    const { project, schema } = await this.getGraph(id, userId, shareToken);
    return {
      format: PROJECT_EXPORT_FORMAT,
      version: PROJECT_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      project: { name: project.name, description: project.description, type: project.type },
      schema,
      images: await this.images.exportForProject(id),
    };
  }

  /**
   * Create a new project from an exported file. The importer owns the result
   * (or it is ownerless when anonymous), so a file moves freely between accounts
   * and devices. All-or-nothing: a failure rolls back and leaves no partial project.
   */
  async importProject(raw: unknown, userId: string | null): Promise<ProjectSummary> {
    const parsed = parseProjectExport(raw);
    const images = this.decodeImages(parsed.images);
    const saved = await this.dataSource.transaction((manager) =>
      writeImportedProject(manager, parsed, userId, images),
    );
    return this.toSummary(saved);
  }

  /**
   * Merge an exported file into an EXISTING project (needs write access). Content
   * gets fresh ids, is shifted so its top-left sits at `anchor`, and is stacked
   * above existing shapes. The additions are broadcast to collaborators and also
   * returned so the importing tab can apply them without a reload.
   */
  async importIntoProject(
    projectId: string,
    body: unknown,
    userId: string | null,
    shareToken: string | null,
    clientId: string | null,
  ): Promise<ImportIntoProjectResponse> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const { file, anchor, linkExisting, joinPresentations } = (body ?? {}) as {
      file?: unknown;
      joinPresentations?: unknown;
      anchor?: { x?: unknown; y?: unknown };
      linkExisting?: unknown;
    };
    const parsed = parseProjectExport(file);
    const { dx, dy } =
      anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
        ? offsetToAnchor(parsed.schema, { x: anchor.x as number, y: anchor.y as number })
        : { dx: 0, dy: 0 };
    const images = this.decodeImages(parsed.images);
    const added = await this.dataSource.transaction(async (manager) => {
      // Optionally let slide ownership / arrow bindings point at content already here.
      const linked =
        linkExisting === true
          ? {
              elementIds: new Set(
                (await manager.find(ElementEntity, { where: { projectId }, select: { id: true } })).map((e) => e.id),
              ),
              tableIds: new Set(
                (await manager.find(TableEntity, { where: { projectId }, select: { id: true } })).map((t) => t.id),
              ),
            }
          : undefined;
      return writeSchemaInto(manager, projectId, parsed.schema, {
        dx,
        dy,
        stackAboveExisting: true,
        images,
        linkExisting: linked,
        joinPresentations: joinPresentations === true,
      });
    });
    // Parents before children so peers never see a dangling reference.
    const mutations: SchemaMutation[] = [
      ...added.tables.map((table): SchemaMutation => ({ kind: 'table.created', table })),
      ...added.relationships.map(
        (relationship): SchemaMutation => ({ kind: 'relationship.created', relationship }),
      ),
      ...added.elements.map((element): SchemaMutation => ({ kind: 'element.created', element })),
      ...added.sequenceDiagrams.map(
        (diagram): SchemaMutation => ({ kind: 'sequenceDiagram.created', diagram }),
      ),
      ...added.lifelines.map((lifeline): SchemaMutation => ({ kind: 'lifeline.created', lifeline })),
      ...added.sequenceMessages.map(
        (message): SchemaMutation => ({ kind: 'message.created', message }),
      ),
    ];
    this.realtime.emitMany(projectId, clientId, mutations);
    return { mutations };
  }

  async remove(id: string, userId: string | null): Promise<void> {
    await this.access.assertOwner(id, userId);
    const result = await this.projects.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
    // Any tag issued before the delete must never match again.
    bumpProjectRevision(id);
  }

  /** Validate (type, size, SVG safety) and decode the images embedded in an import file. */
  private decodeImages(images: ProjectExportImage[]): ImportedImage[] {
    return images.map((img) => ({
      id: img.id,
      mimeType: img.mimeType,
      data: this.images.validate(img.mimeType, img.data),
    }));
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

/** The stored custom theme library (bad or missing JSON reads as none). */
function parseThemes(json: string | null): SlideTheme[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as SlideTheme[]) : [];
  } catch {
    return [];
  }
}
