import type { CanvasElementModel, ElementBinding, SchemaModel } from '@devdesigner/shared';
import { DEFAULT_PRESENTATION } from '@devdesigner/shared';
import { ElementEntity } from '../../canvas/elements/element.entity';
import { insertAll, type WriteContext } from './write-context';

/**
 * Free-form elements: ids, bindings, slide ownership, layouts, animations,
 * placeholders and morph lineage rewritten to the new ids; image elements whose
 * file is missing are dropped (`fileOf`).
 */
export async function writeElements(
  ctx: WriteContext,
  schema: SchemaModel,
  fileOf: (old: string | undefined) => string | undefined,
): Promise<CanvasElementModel[]> {
  const sourceElements = schema.elements.filter((e) => e.type !== 'image' || fileOf(e.fileId) !== undefined);
  let zShift = 0;
  if (ctx.options.stackAboveExisting && sourceElements.length) {
    const top = await ctx.manager
      .createQueryBuilder(ElementEntity, 'e')
      .select('MAX(e.zIndex)', 'max')
      .where('e.projectId = :projectId', { projectId: ctx.projectId })
      .getRawOne<{ max: number | null }>();
    const lowest = Math.min(...sourceElements.map((e) => e.zIndex));
    zShift = (top?.max ?? -1) + 1 - lowest;
  }
  // New slides go after the project's existing ones rather than interleaving.
  let slideShift = 0;
  // An import is a clone: its slides form their own presentation(s), never joining
  // an existing one of the same name.
  const presentationName = new Map<string, string>();
  if (ctx.options.stackAboveExisting && sourceElements.some((e) => e.slide)) {
    const existing = await ctx.manager.find(ElementEntity, {
      where: { projectId: ctx.projectId, type: 'frame' },
      select: { id: true, slideJson: true },
    });
    let top = -1;
    const taken = new Set<string>();
    for (const row of existing) {
      try {
        const o = row.slideJson
          ? (JSON.parse(row.slideJson) as { order?: number; presentation?: string })
          : null;
        if (typeof o?.order === 'number') top = Math.max(top, o.order);
        if (o) taken.add(o.presentation?.trim() || DEFAULT_PRESENTATION);
      } catch {
        /* ignore a corrupt value */
      }
    }
    for (const e of sourceElements) {
      if (!e.slide) continue;
      const name = e.slide.presentation?.trim() || DEFAULT_PRESENTATION;
      if (ctx.options.joinPresentations || presentationName.has(name) || !taken.has(name)) continue;
      let n = 1;
      let next = `${name} (copy)`;
      while (taken.has(next)) next = `${name} (copy ${++n})`;
      taken.add(next);
      presentationName.set(name, next);
    }
    const lowest = Math.min(...sourceElements.filter((e) => e.slide).map((e) => e.slide!.order));
    slideShift = top + 1 - lowest;
  }
  const resolveBinding = (b: ElementBinding | undefined): ElementBinding | undefined => {
    if (!b) return undefined;
    const map =
      b.targetKind === 'table' ? ctx.tableIds : b.targetKind === 'message' ? ctx.messageIds : ctx.elementIds;
    const id = map.get(b.targetId);
    if (id) return { targetKind: b.targetKind, targetId: id };
    const keep =
      b.targetKind === 'table'
        ? ctx.options.linkExisting?.tableIds.has(b.targetId)
        : b.targetKind === 'element' && ctx.options.linkExisting?.elementIds.has(b.targetId);
    return keep ? { targetKind: b.targetKind, targetId: b.targetId } : undefined;
  };
  const elementModels: CanvasElementModel[] = sourceElements.map((e) => ({
    ...e,
    id: ctx.elementIds.get(e.id)!,
    fileId: e.type === 'image' ? fileOf(e.fileId) : undefined,
    x: e.x + ctx.dx,
    y: e.y + ctx.dy,
    zIndex: e.zIndex + zShift,
    startBinding: resolveBinding(e.startBinding),
    endBinding: resolveBinding(e.endBinding),
    groupId: ctx.group(e.groupId) ?? undefined,
    slideId: ctx.slideOf(e.slideId) ?? undefined,
    slide:
      e.type === 'frame' && e.slide
        ? {
            ...e.slide,
            presentation:
              presentationName.get(e.slide.presentation?.trim() || DEFAULT_PRESENTATION) ??
              e.slide.presentation,
            order: e.slide.order + slideShift,
            // A slide's layout is another frame of the file; drop it if that is missing.
            layoutId: e.slide.layoutId ? (ctx.elementIds.get(e.slide.layoutId) ?? undefined) : undefined,
            // Animations follow their objects to the new ids; ones whose object is gone drop.
            animations: e.slide.animations
              ?.map((a) => {
                const target =
                  ctx.elementIds.get(a.target) ?? ctx.tableIds.get(a.target) ?? ctx.diagramIds.get(a.target);
                return target ? { ...a, target } : null;
              })
              .filter((a): a is NonNullable<typeof a> => a !== null),
          }
        : undefined,
    // A slide's placeholder copy points at its layout's element; drop the link if gone.
    placeholder: e.placeholder
      ? {
          ...e.placeholder,
          of: e.placeholder.of ? (ctx.elementIds.get(e.placeholder.of) ?? undefined) : undefined,
        }
      : undefined,
    // A slide's or layout's stand-in for a master item; drop the link if it is gone.
    overrides: e.overrides ? ctx.elementIds.get(e.overrides) : undefined,
    // Lineage ids are remapped as a set so copies still match each other after import.
    // Named morph tags ("tag:...") are kept as written so slides added by a later import
    // still pair with earlier ones.
    morphId: e.morphId
      ? e.morphId.startsWith('tag:')
        ? e.morphId
        : (ctx.morphIds.get(e.morphId) ?? ctx.morphIds.mint(e.morphId))
      : undefined,
    // Split tags are named tags (or solo markers) and are kept as written.
    morphIn: e.morphIn,
    morphOut: e.morphOut,
  }));
  await insertAll(
    ctx.manager,
    ElementEntity,
    elementModels.map((e) => ({
      id: e.id,
      projectId: ctx.projectId,
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      angle: e.angle,
      strokeColor: e.strokeColor,
      backgroundColor: e.backgroundColor ?? null,
      fillStyle: e.fillStyle,
      strokeWidth: e.strokeWidth,
      strokeStyle: e.strokeStyle,
      opacity: e.opacity,
      zIndex: e.zIndex,
      cornerRadius: e.cornerRadius ?? null,
      ellipticCorners: e.ellipticCorners ?? null,
      elbow: e.elbow ?? null,
      clipContent: e.clipContent ?? null,
      pointsJson: e.points?.length ? JSON.stringify(e.points) : null,
      text: e.text ?? null,
      fontSize: e.fontSize ?? null,
      fontFamily: e.fontFamily ?? null,
      bold: e.bold ?? null,
      aboveTables: e.aboveTables ?? null,
      italic: e.italic ?? null,
      lineHeight: e.lineHeight ?? null,
      wrap: e.wrap ?? null,
      runsJson: e.runs?.length ? JSON.stringify(e.runs) : null,
      textAlign: e.textAlign ?? null,
      verticalAlign: e.verticalAlign ?? null,
      startBindingKind: e.startBinding?.targetKind ?? null,
      startBindingId: e.startBinding?.targetId ?? null,
      endBindingKind: e.endBinding?.targetKind ?? null,
      endBindingId: e.endBinding?.targetId ?? null,
      startArrowhead: e.startArrowhead ?? null,
      endArrowhead: e.endArrowhead ?? null,
      curvature: e.curvature ?? null,
      fileId: e.fileId ?? null,
      mediaJson: e.type === 'image' && e.media ? JSON.stringify(e.media) : null,
      language: e.type === 'code' ? (e.language ?? 'typescript') : null,
      fileName: e.type === 'code' ? (e.fileName?.trim() || null) : null,
      diffText: e.type === 'code' ? (e.diffText ?? null) : null,
      diffView: e.type === 'code' ? (e.diffView ?? null) : null,
      diffShowWhitespace: e.type === 'code' ? (e.diffShowWhitespace ?? null) : null,
      diffSplit: e.type === 'code' && e.diffSplit != null ? Math.min(0.85, Math.max(0.15, e.diffSplit)) : null,
      expandedHeight: e.type === 'code' ? (e.expandedHeight ?? null) : null,
      groupId: e.groupId ?? null,
      slideJson: e.slide ? JSON.stringify(e.slide) : null,
      placeholderJson: e.placeholder ? JSON.stringify(e.placeholder) : null,
      overrides: e.overrides ?? null,
      morphId: e.morphId ?? null,
      morphIn: e.morphIn ?? null,
      morphOut: e.morphOut ?? null,
      step: e.step ?? null,
      slideId: e.slideId ?? null,
    })),
  );

  return elementModels;
}
