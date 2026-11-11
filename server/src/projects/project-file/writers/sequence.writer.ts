import type { ProjectContent } from '@devdesigner/shared';
import { LifelineEntity } from '../../canvas/sequence/lifeline.entity';
import { SequenceDiagramEntity } from '../../canvas/sequence/sequence-diagram.entity';
import { SequenceMessageEntity } from '../../canvas/sequence/sequence-message.entity';
import { insertAll, type WriteContext } from './write-context';

/** Planned sequence diagrams -> lifelines -> messages (ids already remapped). */
export async function writeSequence(
  ctx: WriteContext,
  content: Pick<ProjectContent, 'sequenceDiagrams' | 'lifelines' | 'sequenceMessages'>,
): Promise<void> {
  await insertAll(
    ctx.manager,
    SequenceDiagramEntity,
    content.sequenceDiagrams.map((d) => ({
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

  await insertAll(
    ctx.manager,
    LifelineEntity,
    content.lifelines.map((l) => ({
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

  await insertAll(
    ctx.manager,
    SequenceMessageEntity,
    content.sequenceMessages.map((m) => ({
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

}
