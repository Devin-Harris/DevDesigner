import type {
  CanvasElementModel,
  ElementBinding,
  PointModel,
  SlideConfig,
  TextRun,
} from '@dbdesigner/shared';
import { ElementEntity } from './element.entity';

/** Reassemble a binding from its stored kind/id columns. */
function toBinding(
  kind: 'element' | 'table' | 'message' | null,
  id: string | null,
): ElementBinding | undefined {
  return kind && id ? { targetKind: kind, targetId: id } : undefined;
}

/** Decode a stored slide config; a corrupt value just means "not a slide". */
function toSlide(json: string | null): SlideConfig | undefined {
  if (!json) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(json) as SlideConfig;
    return parsed && typeof parsed.order === 'number' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Decode stored rich-text runs; a corrupt value just means "uniform style". */
function toRuns(json: string | null): TextRun[] | undefined {
  if (!json) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as TextRun[]) : undefined;
  } catch {
    return undefined;
  }
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
    cornerRadius: entity.cornerRadius ?? undefined,
    points: entity.pointsJson ? (JSON.parse(entity.pointsJson) as PointModel[]) : undefined,
    text: entity.text ?? undefined,
    fontSize: entity.fontSize ?? undefined,
    fontFamily: entity.fontFamily ?? undefined,
    bold: entity.bold ?? undefined,
    italic: entity.italic ?? undefined,
    lineHeight: entity.lineHeight ?? undefined,
    wrap: entity.wrap ?? undefined,
    runs: toRuns(entity.runsJson),
    textAlign: entity.textAlign ?? undefined,
    verticalAlign: entity.verticalAlign ?? undefined,
    startBinding: toBinding(entity.startBindingKind, entity.startBindingId),
    endBinding: toBinding(entity.endBindingKind, entity.endBindingId),
    startArrowhead: entity.startArrowhead ?? undefined,
    endArrowhead: entity.endArrowhead ?? undefined,
    curvature: entity.curvature ?? undefined,
    fileId: entity.fileId ?? undefined,
    language: entity.language ?? undefined,
    fileName: entity.fileName ?? undefined,
    expandedHeight: entity.expandedHeight ?? undefined,
    groupId: entity.groupId ?? undefined,
    slide: toSlide(entity.slideJson),
    morphId: entity.morphId ?? undefined,
    step: entity.step ?? undefined,
    slideId: entity.slideId ?? undefined,
  };
}
