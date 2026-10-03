import type { SequenceMessageModel } from '@dbdesigner/shared';
import type { SequenceMessageEntity } from './sequence-message.entity';

export function toSequenceMessageModel(e: SequenceMessageEntity): SequenceMessageModel {
  return {
    id: e.id,
    fromLifelineId: e.fromLifelineId,
    toLifelineId: e.toLifelineId,
    label: e.label ?? undefined,
    y: e.y,
    style: e.style,
    direction: e.direction,
    arrowhead: e.arrowhead,
  };
}
