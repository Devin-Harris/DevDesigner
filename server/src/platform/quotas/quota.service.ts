import { ForbiddenException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Project } from '../../projects/projects/project.entity';
import { TableEntity } from '../../projects/schema/tables/table.entity';
import { ElementEntity } from '../../projects/canvas/elements/element.entity';
import { ProjectImageEntity } from '../../projects/canvas/images/project-image.entity';

/** Effective limits; 0 means unlimited. */
export interface QuotaLimits {
  projectsPerOwner: number;
  tablesPerProject: number;
  elementsPerProject: number;
  imageBytesPerOwner: number;
  imageBytesPerProject: number;
  importMaxImages: number;
}

/** New rows a write is about to add to one project. */
export interface ProjectAdditions {
  tables?: number;
  elements?: number;
}

/** What an import file would add (counted before anything is written). */
export interface ImportFootprint extends ProjectAdditions {
  images: number;
  imageBytes: number;
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const mb = (bytes: number): string =>
  bytes >= 1024 ** 3 ? `${+(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

/**
 * Per-owner and per-project storage quotas (security H-3 / S3.2). Every create path
 * asks here first: project create/duplicate/import, table and element creates, clone,
 * import-content and image upload. Each check is one indexed COUNT or SUM. Limits come
 * from env (QUOTA_*), generous by default; 0 disables a limit. Counting is not done
 * inside the write's transaction, so two racing requests can overshoot a limit by
 * one request's worth: these are abuse caps, not billing.
 *
 * Errors: 403 for count limits, 413 for media bytes, each with a plain message.
 */
@Injectable()
export class QuotaService {
  readonly limits: QuotaLimits;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    const get = (key: string, fallback: number): number => Number(config.get<number>(key, fallback));
    this.limits = {
      projectsPerOwner: get('QUOTA_PROJECTS_PER_OWNER', 500),
      tablesPerProject: get('QUOTA_TABLES_PER_PROJECT', 5_000),
      elementsPerProject: get('QUOTA_ELEMENTS_PER_PROJECT', 20_000),
      imageBytesPerOwner: get('QUOTA_IMAGE_BYTES_PER_OWNER', 1024 ** 3),
      imageBytesPerProject: get('QUOTA_IMAGE_BYTES_PER_PROJECT', 512 * 1024 ** 2),
      importMaxImages: get('QUOTA_IMPORT_MAX_IMAGES', 1_000),
    };
  }

  /** Room for `count` more projects owned by `ownerId` (archived ones count too). */
  async assertCanCreateProjects(ownerId: string, count = 1): Promise<void> {
    const limit = this.limits.projectsPerOwner;
    if (!limit) return;
    const have = await this.dataSource.getRepository(Project).count({ where: { ownerId } });
    if (have + count > limit) {
      throw new ForbiddenException(
        `Project limit reached: an account can have at most ${fmt(limit)} projects (archived ones included). Delete some to make room.`,
      );
    }
  }

  /** Room in `projectId` for the given new tables / elements. */
  async assertProjectRoom(projectId: string, add: ProjectAdditions): Promise<void> {
    await this.checkCount(TableEntity, projectId, add.tables ?? 0, this.limits.tablesPerProject, 'tables');
    await this.checkCount(ElementEntity, projectId, add.elements ?? 0, this.limits.elementsPerProject, 'drawing elements');
  }

  /**
   * An import file's own size limits (checked before anything is written): its
   * tables, elements and embedded media must each fit in one project.
   */
  assertImportFits(footprint: ImportFootprint): void {
    const { tablesPerProject, elementsPerProject, importMaxImages, imageBytesPerProject } = this.limits;
    const tables = footprint.tables ?? 0;
    const elements = footprint.elements ?? 0;
    if (tablesPerProject && tables > tablesPerProject) {
      throw new ForbiddenException(`This file has ${fmt(tables)} tables; a project can hold at most ${fmt(tablesPerProject)}.`);
    }
    if (elementsPerProject && elements > elementsPerProject) {
      throw new ForbiddenException(
        `This file has ${fmt(elements)} drawing elements; a project can hold at most ${fmt(elementsPerProject)}.`,
      );
    }
    if (importMaxImages && footprint.images > importMaxImages) {
      throw new PayloadTooLargeException(
        `This file embeds ${fmt(footprint.images)} media files; at most ${fmt(importMaxImages)} are allowed.`,
      );
    }
    if (imageBytesPerProject && footprint.imageBytes > imageBytesPerProject) {
      throw new PayloadTooLargeException(
        `This file embeds ${mb(footprint.imageBytes)} of media; a project can store at most ${mb(imageBytesPerProject)}.`,
      );
    }
  }

  /**
   * Room for `bytes` more media in `projectId` and in its owner's whole account.
   * `ownerId` defaults to the project's owner; pass it (and a null project) for a
   * project that does not exist yet.
   */
  async assertImageRoom(projectId: string | null, bytes: number, ownerId?: string | null): Promise<void> {
    if (bytes <= 0) return;
    const { imageBytesPerProject, imageBytesPerOwner } = this.limits;
    if (projectId && imageBytesPerProject) {
      const used = await this.imageBytes({ projectId });
      if (used + bytes > imageBytesPerProject) {
        throw new PayloadTooLargeException(
          `Media storage limit reached: a project can store at most ${mb(imageBytesPerProject)} of images and videos (${mb(used)} used).`,
        );
      }
    }
    if (!imageBytesPerOwner) return;
    let owner = ownerId ?? null;
    if (ownerId === undefined && projectId) {
      const row = await this.dataSource
        .getRepository(Project)
        .findOne({ where: { id: projectId }, select: { id: true, ownerId: true } });
      owner = row?.ownerId ?? null;
    }
    if (!owner) return;
    const used = await this.imageBytes({ ownerId: owner });
    if (used + bytes > imageBytesPerOwner) {
      throw new PayloadTooLargeException(
        `Media storage limit reached: an account can store at most ${mb(imageBytesPerOwner)} of images and videos (${mb(used)} used). Delete unused media or projects to make room.`,
      );
    }
  }

  /** Stored media bytes of one project, or of every project an owner has. */
  async imageBytes(scope: { projectId: string } | { ownerId: string }): Promise<number> {
    const qb = this.dataSource
      .getRepository(ProjectImageEntity)
      .createQueryBuilder('i')
      .select('COALESCE(SUM(COALESCE(i.byteSize, LENGTH(i.data))), 0)', 'total');
    if ('projectId' in scope) {
      qb.where('i.projectId = :projectId', { projectId: scope.projectId });
    } else {
      qb.innerJoin(Project, 'p', 'p.id = i.projectId').where('p.ownerId = :ownerId', { ownerId: scope.ownerId });
    }
    const row = await qb.getRawOne<{ total: number | string | null }>();
    return Number(row?.total ?? 0);
  }

  private async checkCount(
    entity: typeof TableEntity | typeof ElementEntity,
    projectId: string,
    adding: number,
    limit: number,
    label: string,
  ): Promise<void> {
    if (!limit || adding <= 0) return;
    const have = await this.dataSource.getRepository(entity).count({ where: { projectId } });
    if (have + adding > limit) {
      throw new ForbiddenException(
        `Project limit reached: a project can hold at most ${fmt(limit)} ${label} (it has ${fmt(have)}).`,
      );
    }
  }
}
