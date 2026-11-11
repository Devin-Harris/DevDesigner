import type { CanvasElementModel, ExistingContent } from '@devdesigner/shared';
import { ElementEntity } from '../../canvas/elements/element.entity';
import { insertAll, type WriteContext } from './write-context';

/** The target project's top zIndex and slide configs, for planImportStacking. */
export async function existingContent(ctx: WriteContext, withSlides: boolean): Promise<ExistingContent> {
  const top = await ctx.manager
    .createQueryBuilder(ElementEntity, 'e')
    .select('MAX(e.zIndex)', 'max')
    .where('e.projectId = :projectId', { projectId: ctx.projectId })
    .getRawOne<{ max: number | null }>();
  const slides: ExistingContent['slides'][number][] = [];
  if (withSlides) {
    const frames = await ctx.manager.find(ElementEntity, {
      where: { projectId: ctx.projectId, type: 'frame' },
      select: { id: true, slideJson: true },
    });
    for (const row of frames) {
      try {
        slides.push(row.slideJson ? (JSON.parse(row.slideJson) as { order?: number; presentation?: string }) : null);
      } catch {
        /* ignore a corrupt value */
      }
    }
  }
  return { maxZIndex: top?.max ?? null, slides };
}

/** Planned free-form elements (ids, bindings, slides, layouts and morph lineage already remapped). */
export async function writeElements(ctx: WriteContext, elements: readonly CanvasElementModel[]): Promise<void> {
  await insertAll(
    ctx.manager,
    ElementEntity,
    elements.map((e) => ({
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
}
