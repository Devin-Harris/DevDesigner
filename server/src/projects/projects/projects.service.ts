import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
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
} from '@devdesigner/shared';
import { GraphLoaderService } from '../common/graph-loader.service';
import { toProjectSummary } from './project.mapper';
import { RealtimePublisher } from '../../platform/realtime/realtime.publisher';
import { ElementEntity } from '../canvas/elements/element.entity';
import { TableEntity } from '../schema/tables/table.entity';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateViewportDto } from './dto/update-viewport.dto';
import { UpdateHomeDto } from './dto/update-home.dto';
import { UpdateThemesDto } from './dto/update-themes.dto';
import { parseProjectExport } from '../project-file/project-import.parser';
import {
  offsetToAnchor,
  writeImportedProject,
  writeSchemaInto,
  type ImportedImage,
} from '../project-file/project-import.writer';
import { ImagesService } from '../canvas/images/images.service';
import { bumpProjectRevision } from '../../platform/http/project-revision';
import { applyDefined } from '../common/apply-patch';
import { QuotaService, type ImportFootprint } from '../../platform/quotas/quota.service';

/**
 * Business logic for projects. Data access goes through the injected repository;
 * responses are mapped to the shared ProjectSummary / ProjectGraphResponse shapes
 * so the client consumes exactly what it is typed against.
 *
 * Authorization happens before these methods run: project routes declare
 * `@RequiresAccess` and ProjectAccessGuard resolves the caller's level once, so
 * the methods below take an already-authorized project id. List/create/import
 * are scoped by the caller's owner id instead.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly graphs: GraphLoaderService,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimePublisher,
    private readonly images: ImagesService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * List projects for the dashboard. An authenticated caller sees only the
   * projects they own; an anonymous caller sees only its own browser's guest
   * projects (userId is `guest:<id>`). Legacy ownerless projects are never listed.
   */
  async list(ownerId: string | null, archived = false): Promise<ProjectSummary[]> {
    if (!ownerId) {
      return [];
    }
    const rows = await this.projects.find({
      where: { archived, ownerId },
      order: { updatedAt: 'DESC' },
    });
    return rows.map((row) => toProjectSummary(row));
  }

  /** Number of projects (archived or not) owned by `ownerId`. */
  countOwnedBy(ownerId: string): Promise<number> {
    return this.projects.count({ where: { ownerId } });
  }

  /**
   * Reassign every project of `fromOwner` to `toOwner`; returns how many moved.
   * Sockets that were in those projects as `fromOwner` are re-checked (and dropped).
   */
  async transferOwnership(fromOwner: string, toOwner: string): Promise<number> {
    const moved = await this.projects.find({ where: { ownerId: fromOwner }, select: { id: true } });
    const result = await this.projects.update({ ownerId: fromOwner }, { ownerId: toOwner });
    for (const { id } of moved) {
      this.realtime.accessRevoked(id);
    }
    return result.affected ?? 0;
  }

  async create(dto: CreateProjectDto, ownerId: string | null): Promise<ProjectSummary> {
    requireOwner(ownerId);
    await this.quota.assertCanCreateProjects(ownerId);
    const project = this.projects.create({
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'ERD',
      // Owned by the account when signed in, else by this browser's guest id.
      ownerId,
    });
    const saved = await this.projects.save(project);
    return toProjectSummary(saved);
  }

  /** Full project graph for initial load, as seen at the caller's (already resolved) level. */
  getGraph(id: string, accessLevel: AccessLevel): Promise<ProjectGraphResponse> {
    return this.graphs.graph(id, accessLevel);
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

  /** Set (or clear, with `home: null`) the project's shared home view and tell collaborators. */
  async updateHome(id: string, dto: UpdateHomeDto): Promise<void> {
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
    this.realtime.emit(id, { kind: 'home.updated', home });
  }

  /** Replace the project's custom theme library and tell collaborators. */
  async updateThemes(id: string, dto: UpdateThemesDto): Promise<void> {
    const result = await this.projects.update({ id }, { themesJson: JSON.stringify(dto.themes) });
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
    this.realtime.emit(id, { kind: 'themes.updated', themes: dto.themes });
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectSummary> {
    const project = await this.findOrThrow(id);
    applyDefined(project, dto, ['name', 'description', 'archived', 'type']);
    const saved = await this.projects.save(project);
    // Name/description/type/archived ride in the graph's project summary.
    bumpProjectRevision(id);
    return toProjectSummary(saved);
  }

  async duplicate(id: string): Promise<ProjectSummary> {
    const source = await this.findOrThrow(id);
    if (source.ownerId) await this.quota.assertCanCreateProjects(source.ownerId);
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
    return toProjectSummary(saved);
  }

  /**
   * Portable snapshot of a project for download. Anyone who can read the project
   * can export it (a view-only share link included, since they already see all of it).
   */
  async exportProject(id: string, accessLevel: AccessLevel): Promise<ProjectExportFile> {
    const { project, schema } = await this.graphs.graph(id, accessLevel);
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
   * Create a new project from an exported file. The importer (account or guest id)
   * owns the result, so a file moves freely between accounts
   * and devices. All-or-nothing: a failure rolls back and leaves no partial project.
   */
  async importProject(raw: unknown, ownerId: string | null): Promise<ProjectSummary> {
    requireOwner(ownerId);
    await this.quota.assertCanCreateProjects(ownerId);
    const parsed = parseProjectExport(raw);
    const images = this.decodeImages(parsed.images);
    const footprint = importFootprint(parsed.schema, images);
    this.quota.assertImportFits(footprint);
    await this.quota.assertImageRoom(null, footprint.imageBytes, ownerId);
    const saved = await this.dataSource.transaction((manager) =>
      writeImportedProject(manager, parsed, ownerId, images),
    );
    return toProjectSummary(saved);
  }

  /**
   * Merge an exported file into an EXISTING project (needs write access). Content
   * gets fresh ids, is shifted so its top-left sits at `anchor`, and is stacked
   * above existing shapes. The additions are broadcast to collaborators and also
   * returned so the importing tab can apply them without a reload.
   */
  async importIntoProject(projectId: string, body: unknown): Promise<ImportIntoProjectResponse> {
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
    const footprint = importFootprint(parsed.schema, images);
    this.quota.assertImportFits(footprint);
    await this.quota.assertProjectRoom(projectId, footprint);
    await this.quota.assertImageRoom(projectId, await this.images.newBytes(projectId, images));
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
    this.realtime.emitMany(projectId, mutations);
    return { mutations };
  }

  async remove(id: string): Promise<void> {
    const result = await this.projects.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Project ${id} not found.`);
    }
    // Any tag issued before the delete must never match again.
    bumpProjectRevision(id);
    // Collaborators still in the room lose access with the project.
    this.realtime.accessRevoked(id);
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
}

/** What an import file adds, for the quotas (media bytes before any dedup). */
function importFootprint(schema: { tables: unknown[]; elements: unknown[] }, images: ImportedImage[]): ImportFootprint {
  return {
    tables: schema.tables.length,
    elements: schema.elements.length,
    images: images.length,
    imageBytes: images.reduce((sum, img) => sum + img.data.length, 0),
  };
}

/**
 * Every new project needs an owner: an account, or this browser's guest id. An
 * ownerless project would be quarantined at once (security M-1), so refuse it.
 */
function requireOwner(ownerId: string | null): asserts ownerId is string {
  if (!ownerId) {
    throw new UnauthorizedException('Sign in (or send an X-Guest-Id) to create a project.');
  }
}
