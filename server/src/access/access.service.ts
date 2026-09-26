import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccessLevel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { TableEntity } from '../tables/table.entity';
import { ColumnEntity } from '../columns/column.entity';
import { RelationshipEntity } from '../relationships/relationship.entity';

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
 *  - Share-token access (EDIT / VIEW) is added in Phase 5; today the only
 *    resolvable level is OWNER, and everything else is rejected with 403.
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
    @InjectRepository(RelationshipEntity)
    private readonly relationships: Repository<RelationshipEntity>,
  ) {}

  /** Resolve the caller's effective access to a project, or throw 403/404. */
  async resolveProjectAccess(projectId: string, userId: string | null): Promise<AccessLevel> {
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
    throw new ForbiddenException('You do not have access to this project.');
  }

  /** Assert the caller may read the project (any resolvable level). */
  async assertCanRead(projectId: string, userId: string | null): Promise<AccessLevel> {
    return this.resolveProjectAccess(projectId, userId);
  }

  /** Assert the caller may write to the project (EDIT or OWNER; OWNER only today). */
  async assertCanWrite(projectId: string, userId: string | null): Promise<AccessLevel> {
    const level = await this.resolveProjectAccess(projectId, userId);
    if (level === 'VIEW') {
      throw new ForbiddenException('This link is read-only.');
    }
    return level;
  }

  /** Assert the caller owns the project (rename, duplicate, delete, sharing). */
  async assertOwner(projectId: string, userId: string | null): Promise<void> {
    const level = await this.resolveProjectAccess(projectId, userId);
    if (level !== 'OWNER') {
      throw new ForbiddenException('Only the project owner can perform this action.');
    }
  }

  // --- Ancestry-aware helpers: resolve a child to its project, then authorize. ---

  async assertCanWriteTable(tableId: string, userId: string | null): Promise<void> {
    await this.assertCanWrite(await this.projectIdForTable(tableId), userId);
  }

  async assertCanWriteColumn(columnId: string, userId: string | null): Promise<void> {
    await this.assertCanWrite(await this.projectIdForColumn(columnId), userId);
  }

  async assertCanWriteRelationship(relationshipId: string, userId: string | null): Promise<void> {
    await this.assertCanWrite(await this.projectIdForRelationship(relationshipId), userId);
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
}
