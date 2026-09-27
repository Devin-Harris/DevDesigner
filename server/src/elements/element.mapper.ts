import type { CanvasElementModel, ElementBinding, PointModel } from '@dbdesigner/shared';
import { ElementEntity } from './element.entity';

/** Reassemble a binding from its stored kind/id columns. */
function toBinding(
  kind: 'element' | 'table' | null,
  id: string | null,
): ElementBinding | undefined {
  return kind && id ? { targetKind: kind, targetId: id } : undefined;
}

/** Map an Element entity to the shared CanvasElementModel. */
export function toElementModel(entity: ElementEntity): CanvasElementModel {
  return {
    id: entity.id,
    type: entity.type,
    x: entity.x,
    y: entity.y,
    width: entity.width,
    height: entity.height,
    angle: entity.angle,
    strokeColor: entity.strokeColor,
    backgroundColor: entity.backgroundColor ?? undefined,
    fillStyle: entity.fillStyle,
    strokeWidth: entity.strokeWidth,
    strokeStyle: entity.strokeStyle,
    opacity: entity.opacity,
    zIndex: entity.zIndex,
    points: entity.pointsJson ? (JSON.parse(entity.pointsJson) as PointModel[]) : undefined,
    text: entity.text ?? undefined,
    fontSize: entity.fontSize ?? undefined,
    fontFamily: entity.fontFamily ?? undefined,
    textAlign: entity.textAlign ?? undefined,
    verticalAlign: entity.verticalAlign ?? undefined,
    startBinding: toBinding(entity.startBindingKind, entity.startBindingId),
    endBinding: toBinding(entity.endBindingKind, entity.endBindingId),
    startArrowhead: entity.startArrowhead ?? undefined,
    endArrowhead: entity.endArrowhead ?? undefined,
  };
}
