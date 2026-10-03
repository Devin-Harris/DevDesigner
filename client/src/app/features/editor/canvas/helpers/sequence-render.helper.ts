import type { LifelineModel, SequenceConfigModel, SequenceMessageModel } from '@dbdesigner/shared';

/** The default vertical extent of each lifeline spine below the last message (px). */
const SPINE_TAIL = 40;

export interface LifelineView {
  id: string;
  label: string;
  color: string;
  /** Header box top-left in world coords. */
  headerX: number;
  headerY: number;
  headerWidth: number;
  headerHeight: number;
  /** Spine center X (= headerX + headerWidth / 2). */
  spineX: number;
  /** Spine start Y (= headerY + headerHeight). */
  spineY1: number;
  /** Spine end Y (extends below the last message). */
  spineY2: number;
  order: number;
  selected: boolean;
}

export interface MessageView {
  id: string;
  fromLifelineId: string;
  toLifelineId: string;
  label: string | undefined;
  /** Arrow world coords. */
  x1: number;
  x2: number;
  y: number;
  /** Which end to place the filled arrowhead on. */
  arrowSide: 'end' | 'start';
  arrowhead: 'arrow' | 'open' | 'none';
  strokeDasharray: string;
  /** Label midpoint. */
  labelX: number;
  selected: boolean;
}

const DEFAULT_LIFELINE_COLOR = '#0ea5e9';

export function buildLifelineViews(
  lifelines: readonly LifelineModel[],
  config: SequenceConfigModel,
  messages: readonly SequenceMessageModel[],
  selectedLifelineIds: readonly string[],
): LifelineView[] {
  const originY = config.originY ?? 60;
  const maxMsgY = messages.reduce((m, msg) => Math.max(m, msg.y), originY);
  const spineBottom = maxMsgY + SPINE_TAIL;

  return lifelines.map((ll) => {
    const spineX = ll.x;
    const headerWidth = ll.width;
    const headerHeight = config.headerHeight;
    const headerX = spineX - headerWidth / 2;
    const headerY = originY - headerHeight;

    return {
      id: ll.id,
      label: ll.label,
      color: ll.color ?? DEFAULT_LIFELINE_COLOR,
      headerX,
      headerY,
      headerWidth,
      headerHeight,
      spineX,
      spineY1: originY,
      spineY2: spineBottom,
      order: ll.order,
      selected: selectedLifelineIds.includes(ll.id),
    };
  });
}

export function buildMessageViews(
  messages: readonly SequenceMessageModel[],
  lifelines: readonly LifelineModel[],
  selectedMessageIds: readonly string[],
): MessageView[] {
  const lifelineMap = new Map(lifelines.map((ll) => [ll.id, ll]));

  return messages
    .map((msg): MessageView | null => {
      const from = lifelineMap.get(msg.fromLifelineId);
      const to = lifelineMap.get(msg.toLifelineId);
      if (!from || !to) return null;

      const x1 = from.x;
      const x2 = to.x;
      const isForward = msg.direction === 'forward';
      return {
        id: msg.id,
        fromLifelineId: msg.fromLifelineId,
        toLifelineId: msg.toLifelineId,
        label: msg.label,
        x1,
        x2,
        y: msg.y,
        arrowSide: isForward ? 'end' : 'start',
        arrowhead: msg.arrowhead,
        strokeDasharray: msg.style === 'dashed' ? '6 4' : 'none',
        labelX: (x1 + x2) / 2,
        selected: selectedMessageIds.includes(msg.id),
      };
    })
    .filter((v): v is MessageView => v !== null);
}
