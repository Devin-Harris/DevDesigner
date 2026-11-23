import type {
  CanvasElementModel,
  ElementBinding,
  PointModel,
  SlideConfig,
  PlaceholderConfig,
  MediaConfig,
  TextRun,
} from '@devdesigner/shared';
import { ElementEntity } from './element.entity';

/** Reassemble a binding from its stored kind/id columns. */
function toBinding(
  kind: 'element' | 'table' | 'message' | null,
  id: string | null,
  focus: string | null = null,
): ElementBinding | undefined {
  if (!kind || !id) return undefined;
  const [x, y] = (focus ?? '').split(',').map(Number);
  return focus && Number.isFinite(x) && Number.isFinite(y)
    ? { targetKind: kind, targetId: id, focus: { x, y } }
    : { targetKind: kind, targetId: id };
}

/** A binding's focus as stored ("x,y"), or null when unset. */
export function focusColumn(binding: ElementBinding | null | undefined): string | null {
  const f = binding?.focus;
  return f ? `${f.x},${f.y}` : null;
}

/** Decode a stored placeholder; a corrupt value just means "not a placeholder". */
function toPlaceholder(json: string | null): PlaceholderConfig | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as PlaceholderConfig;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Decode stored per-corner radii; anything malformed means "uniform". */
function toCornerRadii(json: string | null): number[] | undefined {
  if (!json) return undefined;
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) && (v.length === 3 || v.length === 4) && v.every((n) => typeof n === 'number' && Number.isFinite(n))
      ? (v as number[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** Decode a stored media config; a corrupt value just means "defaults". */
function toMedia(json: string | null): MediaConfig | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as MediaConfig;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
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
    strokeOpacity: entity.strokeOpacity ?? 100,
    fillOpacity: entity.fillOpacity ?? 100,
    zIndex: entity.zIndex,
    cornerRadius: entity.cornerRadius ?? undefined,
    cornerRadii: toCornerRadii(entity.cornerRadiiJson),
    ellipticCorners: entity.ellipticCorners ?? undefined,
    elbow: entity.elbow ?? undefined,
    clipContent: entity.clipContent ?? undefined,
    scrollable: entity.scrollable ?? undefined,
    scrollPadding: entity.scrollPadding ?? undefined,
    points: entity.pointsJson ? (JSON.parse(entity.pointsJson) as PointModel[]) : undefined,
    text: entity.text ?? undefined,
    fontSize: entity.fontSize ?? undefined,
    fontFamily: entity.fontFamily ?? undefined,
    bold: entity.bold ?? undefined,
    aboveTables: entity.aboveTables ?? undefined,
    italic: entity.italic ?? undefined,
    lineHeight: entity.lineHeight ?? undefined,
    wrap: entity.wrap ?? undefined,
    runs: toRuns(entity.runsJson),
    textAlign: entity.textAlign ?? undefined,
    verticalAlign: entity.verticalAlign ?? undefined,
    startBinding: toBinding(entity.startBindingKind, entity.startBindingId, entity.startBindingFocus),
    endBinding: toBinding(entity.endBindingKind, entity.endBindingId, entity.endBindingFocus),
    startArrowhead: entity.startArrowhead ?? undefined,
    endArrowhead: entity.endArrowhead ?? undefined,
    curvature: entity.curvature ?? undefined,
    fileId: entity.fileId ?? undefined,
    media: toMedia(entity.mediaJson),
    language: entity.language ?? undefined,
    fileName: entity.fileName ?? undefined,
    diffText: entity.diffText ?? undefined,
    diffView: entity.diffView ?? undefined,
    diffSplit: entity.diffSplit ?? undefined,
    diffShowWhitespace: entity.diffShowWhitespace ?? undefined,
    expandedHeight: entity.expandedHeight ?? undefined,
    groupId: entity.groupId ?? undefined,
    slide: toSlide(entity.slideJson),
    placeholder: toPlaceholder(entity.placeholderJson),
    overrides: entity.overrides ?? undefined,
    morphId: entity.morphId ?? undefined,
    morphIn: entity.morphIn ?? undefined,
    morphOut: entity.morphOut ?? undefined,
    step: entity.step ?? undefined,
    slideId: entity.slideId ?? undefined,
  };
}
