import type {
  LifelineModel,
  SequenceDiagramModel,
  SequenceMessageModel,
} from '@dbdesigner/shared';
import { LifelineEntity } from './lifeline.entity';
import { SequenceMessageEntity } from './sequence-message.entity';
import { SequenceDiagramEntity } from './sequence-diagram.entity';

export function toSequenceDiagramModel(e: SequenceDiagramEntity): SequenceDiagramModel {
  return {
    id: e.id,
    lifelineSpacing: e.lifelineSpacing,
    rowSpacing: e.rowSpacing,
    headerHeight: e.headerHeight,
    originY: e.originY,
    groupId: e.groupId ?? undefined,
    backgroundColor: e.backgroundColor ?? undefined,
  };
}

export function toLifelineModel(e: LifelineEntity): LifelineModel {
  return {
    id: e.id,
    diagramId: e.diagramId,
    label: e.label,
    color: e.color ?? undefined,
    lineColor: e.lineColor ?? undefined,
    x: e.x,
    width: e.width,
    order: e.orderIndex,
  };
}

export function toSequenceMessageModel(e: SequenceMessageEntity): SequenceMessageModel {
  return {
    id: e.id,
    diagramId: e.diagramId,
    fromLifelineId: e.fromLifelineId,
    toLifelineId: e.toLifelineId,
    label: e.label ?? undefined,
    y: e.y,
    style: e.style,
    direction: e.direction,
    arrowhead: e.arrowhead,
    color: e.color ?? undefined,
  };
}
