import type { PointModel, RelationshipModel } from '@dbdesigner/shared';
import { RelationshipEntity } from './relationship.entity';

/** Map a Relationship entity to the shared RelationshipModel. */
export function toRelationshipModel(entity: RelationshipEntity): RelationshipModel {
  return {
    id: entity.id,
    sourceColumnId: entity.sourceColumnId,
    targetColumnId: entity.targetColumnId,
    type: entity.type,
    onDelete: entity.onDelete ?? undefined,
    onUpdate: entity.onUpdate ?? undefined,
    waypoints: entity.waypointsJson
      ? (JSON.parse(entity.waypointsJson) as PointModel[])
      : undefined,
  };
}
