import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccessLevel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { TableEntity } from '../tables/table.entity';
import { ColumnEntity } from '../columns/column.entity';
import { IndexEntity } from '../indexes/index.entity';
import { RelationshipEntity } from '../relationships/relationship.entity';
import { ElementEntity } from '../elements/element.entity';
import { ShareLink } from '../sharing/share-link.entity';

/**
 * Access-resolution and policy layer (BUILD_INSTRUCTIONS.md sections 6 and 7).
 * Services call these before any mutation or protected read; access is defined
 * at the project level and resolved for child entities by walking the ancestry
 * (column -> table -> project) with the smallest queries possible.
 *
 * Ownership rules (current phase):
 *  - A project with no owner (ownerId null) is anonymous and open to everyone.
 *    This preserves the account-free workflow the app shipped with.
 *  - A project with an owner is private: only that owner has access.
 *  - A valid, non-revoked, non-expired share token for the project grants the
 *    link's level (EDIT or VIEW) to any caller, account or not (section 6).
 *  - Otherwise: 403.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(ColumnEntity)
    private readonly columns: Repository<ColumnEntity>,
    @InjectRepository(IndexEntity)
    private readonly indexes: Repository<IndexEntity>,
    @InjectRepository(RelationshipEntity)
    private readonly relationships: Repository<RelationshipEntity>,
    @InjectRepository(ElementEntity)
    private readonly elements: Repository<ElementEntity>,
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
  ) {}

  /** Resolve the caller's effective access to a project, or throw 403/404. */
  async resolveProjectAccess(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    const project = await this.projects.findOne({
      where: { id: projectId },
      select: { id: true, ownerId: true },
    });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    if (project.ownerId === null) {
      return 'OWNER'; // anonymous, open project
    }
    if (userId && project.ownerId === userId) {
      return 'OWNER';
    }
    if (shareToken) {
      const level = await this.resolveShareToken(projectId, shareToken);
      if (level) {
        return level;
      }
    }
    throw new ForbiddenException('You do not have access to this project.');
  }

  /**
   * Resolve a share token to the level it grants for a project, or null when the
   * token is unknown, for a different project, revoked, or expired.
   */
  async resolveShareToken(
    projectId: string,
    token: string,
  ): Promise<'EDIT' | 'VIEW' | null> {
    const link = await this.shareLinks.findOne({ where: { token } });
    if (!link || link.projectId !== projectId || link.revokedAt !== null) {
      return null;
    }
    if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return link.accessLevel;
  }

  /** Assert the caller may read the project (any resolvable level). */
  async assertCanRead(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    return this.resolveProjectAccess(projectId, userId, shareToken);
  }

  /** Assert the caller may write to the project (EDIT or OWNER). */
  async assertCanWrite(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    const level = await this.resolveProjectAccess(projectId, userId, shareToken);
    if (level === 'VIEW') {
      throw new ForbiddenException('This link is read-only.');
    }
    return level;
  }

  /** Assert the caller owns the project (rename, duplicate, delete, sharing). */
  async assertOwner(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<void> {
    const level = await this.resolveProjectAccess(projectId, userId, shareToken);
    if (level !== 'OWNER') {
      throw new ForbiddenException('Only the project owner can perform this action.');
    }
  }

  // --- Ancestry-aware helpers: resolve a child to its project, then authorize. ---

  /** Authorize a table write and return its owning project id (for broadcasts). */
  async assertCanWriteTable(
    tableId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<string> {
    const projectId = await this.projectIdForTable(tableId);
    await this.assertCanWrite(projectId, userId, shareToken);
    return projectId;
  }

  /** Authorize a column write and return its owning project id (for broadcasts). */
  async assertCanWriteColumn(
    columnId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<string> {
    const projectId = await this.projectIdForColumn(columnId);
    await this.assertCanWrite(projectId, userId, shareToken);
    return projectId;
  }

  /** Authorize an index write and return its owning project id (for broadcasts). */
  async assertCanWriteIndex(
    indexId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<string> {
    const projectId = await this.projectIdForIndex(indexId);
    await this.assertCanWrite(projectId, userId, shareToken);
    return projectId;
  }

  /** Authorize a relationship write and return its owning project id (for broadcasts). */
  async assertCanWriteRelationship(
    relationshipId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<string> {
    const projectId = await this.projectIdForRelationship(relationshipId);
    await this.assertCanWrite(projectId, userId, shareToken);
    return projectId;
  }

  /** Authorize an element write and return its owning project id (for broadcasts). */
  async assertCanWriteElement(
    elementId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<string> {
    const projectId = await this.projectIdForElement(elementId);
    await this.assertCanWrite(projectId, userId, shareToken);
    return projectId;
  }

  private async projectIdForTable(tableId: string): Promise<string> {
    const table = await this.tables.findOne({
      where: { id: tableId },
      select: { id: true, projectId: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    return table.projectId;
  }

  private async projectIdForColumn(columnId: string): Promise<string> {
    const column = await this.columns.findOne({
      where: { id: columnId },
      select: { id: true, tableId: true },
    });
    if (!column) {
      throw new NotFoundException(`Column ${columnId} not found.`);
    }
    return this.projectIdForTable(column.tableId);
  }

  private async projectIdForIndex(indexId: string): Promise<string> {
    const index = await this.indexes.findOne({
      where: { id: indexId },
      select: { id: true, tableId: true },
    });
    if (!index) {
      throw new NotFoundException(`Index ${indexId} not found.`);
    }
    return this.projectIdForTable(index.tableId);
  }

  private async projectIdForRelationship(relationshipId: string): Promise<string> {
    const relationship = await this.relationships.findOne({
      where: { id: relationshipId },
      select: { id: true, projectId: true },
    });
    if (!relationship) {
      throw new NotFoundException(`Relationship ${relationshipId} not found.`);
    }
    return relationship.projectId;
  }

  private async projectIdForElement(elementId: string): Promise<string> {
    const element = await this.elements.findOne({
      where: { id: elementId },
      select: { id: true, projectId: true },
    });
    if (!element) {
      throw new NotFoundException(`Element ${elementId} not found.`);
    }
    return element.projectId;
  }
}
