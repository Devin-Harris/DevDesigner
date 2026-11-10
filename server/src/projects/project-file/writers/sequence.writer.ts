import type { LifelineModel, SchemaModel, SequenceDiagramModel, SequenceMessageModel } from '@devdesigner/shared';
import { LifelineEntity } from '../../canvas/sequence/lifeline.entity';
import { SequenceDiagramEntity } from '../../canvas/sequence/sequence-diagram.entity';
import { SequenceMessageEntity } from '../../canvas/sequence/sequence-message.entity';
import { insertAll, type WriteContext } from './write-context';

/** Sequence diagrams -> lifelines -> messages (children of a missing parent are dropped). */
export async function writeSequence(
  ctx: WriteContext,
  schema: SchemaModel,
): Promise<{
  sequenceDiagrams: SequenceDiagramModel[];
  lifelines: LifelineModel[];
  sequenceMessages: SequenceMessageModel[];
}> {
  const diagramModels: SequenceDiagramModel[] = schema.sequenceDiagrams.map((d) => ({
    ...d,
    id: ctx.diagramIds.get(d.id)!,
    originY: d.originY + ctx.dy,
    groupId: ctx.group(d.groupId) ?? undefined,
    slideId: ctx.slideOf(d.slideId) ?? undefined,
  }));
  await insertAll(
    ctx.manager,
    SequenceDiagramEntity,
    diagramModels.map((d) => ({
      id: d.id,
      projectId: ctx.projectId,
      lifelineSpacing: d.lifelineSpacing,
      rowSpacing: d.rowSpacing,
      headerHeight: d.headerHeight,
      originY: d.originY,
      zIndex: d.zIndex,
      groupId: d.groupId ?? null,
      slideId: d.slideId ?? null,
      backgroundColor: d.backgroundColor ?? null,
      borderColor: d.borderColor ?? null,
      title: d.title ?? null,
      morphId: d.morphId ?? null,
    })),
  );

  const lifelineModels: LifelineModel[] = [];
  for (const l of schema.lifelines) {
    const diagramId = ctx.diagramIds.get(l.diagramId);
    if (!diagramId) continue;
    lifelineModels.push({ ...l, id: ctx.lifelineIds.mint(l.id), diagramId, x: l.x + ctx.dx });
  }
  await insertAll(
    ctx.manager,
    LifelineEntity,
    lifelineModels.map((l) => ({
      id: l.id,
      projectId: ctx.projectId,
      diagramId: l.diagramId,
      label: l.label,
      color: l.color ?? null,
      lineColor: l.lineColor ?? null,
      strokeColor: l.strokeColor ?? null,
      textColor: l.textColor ?? null,
      morphId: l.morphId ?? null,
      x: l.x,
      width: l.width,
      orderIndex: l.order,
    })),
  );

  const messageModels: SequenceMessageModel[] = [];
  for (const m of schema.sequenceMessages) {
    const diagramId = ctx.diagramIds.get(m.diagramId);
    const fromLifelineId = ctx.lifelineIds.get(m.fromLifelineId);
    const toLifelineId = ctx.lifelineIds.get(m.toLifelineId);
    if (!diagramId || !fromLifelineId || !toLifelineId) continue;
    // A message needs two different participants (a break has no arrow, so it may share).
    if (m.style !== 'break' && fromLifelineId === toLifelineId) continue;
    messageModels.push({
      ...m,
      id: ctx.messageIds.get(m.id)!,
      diagramId,
      fromLifelineId,
      toLifelineId,
      y: m.y + ctx.dy,
    });
  }
  await insertAll(
    ctx.manager,
    SequenceMessageEntity,
    messageModels.map((m) => ({
      id: m.id,
      projectId: ctx.projectId,
      diagramId: m.diagramId,
      fromLifelineId: m.fromLifelineId,
      toLifelineId: m.toLifelineId,
      label: m.label ?? null,
      y: m.y,
      style: m.style,
      direction: m.direction,
      arrowhead: m.arrowhead,
      color: m.color ?? null,
      wrap: m.wrap ?? null,
      morphId: m.morphId ?? null,
    })),
  );

  return { sequenceDiagrams: diagramModels, lifelines: lifelineModels, sequenceMessages: messageModels };
}
