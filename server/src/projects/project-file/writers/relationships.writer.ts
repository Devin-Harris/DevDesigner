import type { RelationshipModel } from '@devdesigner/shared';
import { RelationshipEntity } from '../../schema/relationships/relationship.entity';
import { insertAll, type WriteContext } from './write-context';

/** Planned relationships (both endpoint columns were imported). */
export async function writeRelationships(ctx: WriteContext, relationships: readonly RelationshipModel[]): Promise<void> {
  await insertAll(
    ctx.manager,
    RelationshipEntity,
    relationships.map((r) => ({
      id: r.id,
      projectId: ctx.projectId,
      sourceColumnId: r.sourceColumnId,
      targetColumnId: r.targetColumnId,
      type: r.type,
      onDelete: r.onDelete ?? null,
      onUpdate: r.onUpdate ?? null,
      waypointsJson: r.waypoints?.length ? JSON.stringify(r.waypoints) : null,
      sourceSide: r.sourceSide ?? null,
      targetSide: r.targetSide ?? null,
      autoRoute: r.autoRoute ?? null,
    })),
  );
}
