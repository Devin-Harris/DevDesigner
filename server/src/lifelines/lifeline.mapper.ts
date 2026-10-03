import type { LifelineModel } from '@dbdesigner/shared';
import type { LifelineEntity } from './lifeline.entity';

export function toLifelineModel(e: LifelineEntity): LifelineModel {
  return {
    id: e.id,
    label: e.label,
    color: e.color ?? undefined,
    x: e.x,
    width: e.width,
    order: e.order,
  };
}
