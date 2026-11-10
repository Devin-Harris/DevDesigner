import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { RelationshipModel, SchemaModel } from '@devdesigner/shared';
import { RelationshipEntity } from '../../schema/relationships/relationship.entity';
import { insertAll, type WriteContext } from './write-context';

/** Relationships whose two endpoint columns were both imported. */
export async function writeRelationships(ctx: WriteContext, schema: SchemaModel): Promise<RelationshipModel[]> {
  const relationshipModels: RelationshipModel[] = [];
  const relationshipRows: QueryDeepPartialEntity<RelationshipEntity>[] = [];
  for (const r of schema.relationships) {
    const sourceColumnId = ctx.columnIds.get(r.sourceColumnId);
    const targetColumnId = ctx.columnIds.get(r.targetColumnId);
    if (!sourceColumnId || !targetColumnId) continue;
    const waypoints = r.waypoints?.map((p) => ({ x: p.x + ctx.dx, y: p.y + ctx.dy }));
    const id = randomUUID();
    relationshipModels.push({ ...r, id, sourceColumnId, targetColumnId, waypoints });
    relationshipRows.push({
      id,
      projectId: ctx.projectId,
      sourceColumnId,
      targetColumnId,
      type: r.type,
      onDelete: r.onDelete ?? null,
      onUpdate: r.onUpdate ?? null,
      waypointsJson: waypoints?.length ? JSON.stringify(waypoints) : null,
      sourceSide: r.sourceSide ?? null,
      targetSide: r.targetSide ?? null,
      autoRoute: r.autoRoute ?? null,
    });
  }
  await insertAll(ctx.manager, RelationshipEntity, relationshipRows);

  return relationshipModels;
}
