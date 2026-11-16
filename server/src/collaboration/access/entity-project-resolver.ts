import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityTarget, type ObjectLiteral } from 'typeorm';
import { Project } from '../../projects/projects/project.entity';
import { TableEntity } from '../../projects/schema/tables/table.entity';
import { ColumnEntity } from '../../projects/schema/columns/column.entity';
import { IndexEntity } from '../../projects/schema/indexes/index.entity';
import { RelationshipEntity } from '../../projects/schema/relationships/relationship.entity';
import { ElementEntity } from '../../projects/canvas/elements/element.entity';
import { ProjectImageEntity } from '../../projects/canvas/images/project-image.entity';
import { SequenceDiagramEntity } from '../../projects/canvas/sequence/sequence-diagram.entity';
import { LifelineEntity } from '../../projects/canvas/sequence/lifeline.entity';
import { SequenceMessageEntity } from '../../projects/canvas/sequence/sequence-message.entity';
import { AccessCache } from './access-cache';

/**
 * Entity -> project registry. Each kind says how to find the project a row
 * belongs to: rows with their own `projectId` column, or rows that hang off a
 * table (`tableId` -> tables.projectId). A new project-owned entity registers
 * here (one line) and every guard / membership check picks it up; nothing else
 * in the access layer needs to know about it.
 */
interface Direct {
  entity: EntityTarget<ObjectLiteral>;
  label: string;
}
interface ViaTable {
  entity: EntityTarget<ObjectLiteral>;
  label: string;
  viaTable: true;
}

const REGISTRY = {
  project: { entity: Project, label: 'Project' },
  table: { entity: TableEntity, label: 'Table' },
  column: { entity: ColumnEntity, label: 'Column', viaTable: true },
  index: { entity: IndexEntity, label: 'Index', viaTable: true },
  relationship: { entity: RelationshipEntity, label: 'Relationship' },
  element: { entity: ElementEntity, label: 'Element' },
  image: { entity: ProjectImageEntity, label: 'Image' },
  diagram: { entity: SequenceDiagramEntity, label: 'Sequence diagram' },
  lifeline: { entity: LifelineEntity, label: 'Lifeline' },
  message: { entity: SequenceMessageEntity, label: 'Message' },
} satisfies Record<string, Direct | ViaTable>;

export type ProjectEntityKind = keyof typeof REGISTRY;

export const PROJECT_ENTITY_KINDS = Object.keys(REGISTRY) as ProjectEntityKind[];

const isViaTable = (entry: Direct | ViaTable): entry is ViaTable => 'viaTable' in entry;

@Injectable()
export class EntityProjectResolver {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cache: AccessCache,
  ) {}

  /** The project `id` (of `kind`) belongs to; 404 when there is no such row. */
  async projectIdOf(kind: ProjectEntityKind, id: string): Promise<string> {
    const entry: Direct | ViaTable = REGISTRY[kind];
    const key = this.cache.childKey(kind, id);
    const cached = kind === 'project' ? undefined : this.cache.children.get(key);
    if (cached !== undefined) return cached;
    if (kind === 'project') {
      const found = await this.dataSource.getRepository(Project).exists({ where: { id } });
      if (!found) throw new NotFoundException(`Project ${id} not found.`);
      return id;
    }
    const projectId = isViaTable(entry)
      ? await this.viaTable(entry, id)
      : ((await this.dataSource
          .getRepository(entry.entity)
          .findOne({ where: { id }, select: { id: true, projectId: true } as never })) as { projectId?: string } | null)
          ?.projectId;
    if (!projectId) {
      throw new NotFoundException(`${entry.label} ${id} not found.`);
    }
    // Rows never move to another project; deletes evict (AccessCache).
    this.cache.children.set(key, projectId);
    return projectId;
  }

  /**
   * The subset of `ids` (of `kind`) that does NOT belong to `projectId`, either
   * because the row is missing or because it lives in another project. One query.
   */
  async idsOutsideProject(kind: ProjectEntityKind, ids: string[], projectId: string): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const entry: Direct | ViaTable = REGISTRY[kind];
    let inside: string[];
    if (kind === 'project') {
      inside = unique.filter((id) => id === projectId);
    } else if (isViaTable(entry)) {
      const rows = await this.dataSource
        .getRepository(entry.entity)
        .createQueryBuilder('row')
        .innerJoin(TableEntity, 't', 't.id = row.tableId')
        .select('row.id', 'id')
        .where('row.id IN (:...ids)', { ids: unique })
        .andWhere('t.projectId = :projectId', { projectId })
        .getRawMany<{ id: string }>();
      inside = rows.map((r) => r.id);
    } else {
      const rows = await this.dataSource
        .getRepository(entry.entity)
        .find({ where: { id: In(unique), projectId } as never, select: { id: true } as never });
      inside = rows.map((r) => (r as { id: string }).id);
    }
    const found = new Set(inside);
    return unique.filter((id) => !found.has(id));
  }

  /** Human label for error messages ("Table", "Lifeline", ...). */
  labelOf(kind: ProjectEntityKind): string {
    return REGISTRY[kind].label;
  }

  private async viaTable(entry: ViaTable, id: string): Promise<string | undefined> {
    const row = await this.dataSource
      .getRepository(entry.entity)
      .createQueryBuilder('row')
      .innerJoin(TableEntity, 't', 't.id = row.tableId')
      .select('t.projectId', 'projectId')
      .where('row.id = :id', { id })
      .getRawOne<{ projectId: string }>();
    return row?.projectId;
  }
}
