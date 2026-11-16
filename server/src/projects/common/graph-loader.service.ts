import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccessLevel, ProjectGraphResponse, SchemaModel } from '@devdesigner/shared';
import { Project } from '../projects/project.entity';
import { parseThemes, toProjectSummary } from '../projects/project.mapper';
import { TableEntity } from '../schema/tables/table.entity';
import { toTableModel } from '../schema/tables/table.mapper';
import { RelationshipEntity } from '../schema/relationships/relationship.entity';
import { toRelationshipModel } from '../schema/relationships/relationship.mapper';
import { ElementEntity } from '../canvas/elements/element.entity';
import { toElementModel } from '../canvas/elements/element.mapper';
import { SequenceDiagramEntity } from '../canvas/sequence/sequence-diagram.entity';
import { LifelineEntity } from '../canvas/sequence/lifeline.entity';
import { SequenceMessageEntity } from '../canvas/sequence/sequence-message.entity';
import { toLifelineModel, toSequenceDiagramModel, toSequenceMessageModel } from '../canvas/sequence/sequence.mapper';

/**
 * Reads a whole project graph (or just its database part) for the graph routes,
 * the share-link entry point, project-file export and SQL export, so those no
 * longer depend on ProjectsService. Callers have already authorized the read.
 */
@Injectable()
export class GraphLoaderService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(TableEntity) private readonly tables: Repository<TableEntity>,
    @InjectRepository(RelationshipEntity) private readonly relationships: Repository<RelationshipEntity>,
    @InjectRepository(ElementEntity) private readonly elements: Repository<ElementEntity>,
    @InjectRepository(SequenceDiagramEntity) private readonly diagrams: Repository<SequenceDiagramEntity>,
    @InjectRepository(LifelineEntity) private readonly lifelines: Repository<LifelineEntity>,
    @InjectRepository(SequenceMessageEntity) private readonly messages: Repository<SequenceMessageEntity>,
  ) {}

  /** The full graph as seen at `accessLevel`. */
  async graph(projectId: string, accessLevel: AccessLevel): Promise<ProjectGraphResponse> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    const [{ tables, relationships }, elementRows, diagramRows, lifelineRows, messageRows] = await Promise.all([
      this.databaseSchema(projectId),
      this.elements.find({ where: { projectId }, order: { zIndex: 'ASC' } }),
      this.diagrams.find({ where: { projectId } }),
      this.lifelines.find({ where: { projectId }, order: { orderIndex: 'ASC' } }),
      this.messages.find({ where: { projectId }, order: { y: 'ASC' } }),
    ]);
    const schema: SchemaModel = {
      tables,
      relationships,
      notes: [],
      elements: elementRows.map(toElementModel),
      sequenceDiagrams: diagramRows.map(toSequenceDiagramModel),
      // Drop any pre-existing rows left without a diagram (dev-schema upgrade).
      lifelines: lifelineRows.filter((r) => r.diagramId).map(toLifelineModel),
      sequenceMessages: messageRows.filter((r) => r.diagramId).map(toSequenceMessageModel),
      viewport: { x: project.viewportX, y: project.viewportY, zoom: project.zoom },
      home:
        project.homeX !== null && project.homeY !== null && project.homeZoom !== null
          ? { x: project.homeX, y: project.homeY, zoom: project.homeZoom }
          : null,
      themes: parseThemes(project.themesJson),
    };
    return { project: toProjectSummary(project), schema, accessLevel };
  }

  /** Just the database part (tables with columns/indexes, relationships), e.g. for SQL export. */
  async databaseSchema(projectId: string): Promise<Pick<SchemaModel, 'tables' | 'relationships'>> {
    const [tableRows, relationshipRows] = await Promise.all([
      this.tables.find({
        where: { projectId },
        relations: { columns: true, indexes: true },
        // Columns and indexes in their own IN queries, not one columns x indexes JOIN.
        relationLoadStrategy: 'query',
        order: { name: 'ASC' },
      }),
      this.relationships.find({ where: { projectId } }),
    ]);
    return { tables: tableRows.map(toTableModel), relationships: relationshipRows.map(toRelationshipModel) };
  }
}
