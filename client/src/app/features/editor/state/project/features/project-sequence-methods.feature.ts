import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { type UpdateSequenceDiagramDto } from '@devdesigner/shared';
import type { SequenceBounds, SequenceLayoutSnapshot } from '../models/project-state.model';
import { sequenceDiagramBox } from '../../../helpers/frame-contents.helper';
import { shiftSequenceIn } from '../helpers/item-moves.helper';
import { TABLE_PALETTE } from '../helpers/table-defaults.helper';
import { pickKeys, sameValues } from '../helpers/patch-diff.helper';
import type { SequenceOps } from './project-sequence-ops';
import type { SlidePlacement } from './project-slides-methods.feature';
import type { ProjectInternalsWith } from './project-internals';

/** Id of the local-only diagram shown while dragging out a new one with the sequence tool. */
export const SEQUENCE_PREVIEW_ID = 'seq-draft-preview';
const PREVIEW_ID = SEQUENCE_PREVIEW_ID;
const LIFELINE_W = 120;
const HEADER = 42;
/** Outer padding of a diagram box (mirrors sequence-diagram.component / frame-contents). */
const SEQ_BOX_PAD = 26;
/** Smallest row spacing a respace may produce. */
const SEQ_MIN_ROW = 20;

/**
 * Where a starter diagram's parts go. Without a size, (x, y) is the first participant's
 * center top (a click). With one, (x, y) is the dragged box's top-left: the participants
 * span its width and the rows stretch the lifelines to its height.
 */
function starterLayout(
   x: number,
   y: number,
   size?: { width: number; height: number }
): { x: number; lifelineWidth: number; lifelineSpacing: number; rowSpacing: number; headerHeight: number } {
   if (!size) return { x, lifelineWidth: LIFELINE_W, lifelineSpacing: 160, rowSpacing: 48, headerHeight: HEADER };
   // Fill the box exactly (no minimum), so the diagram grows from the press point.
   const lifelineWidth = Math.max(8, Math.min(LIFELINE_W, Math.round(size.width / 2)));
   const headerHeight = Math.max(8, Math.min(HEADER, Math.round(size.height / 3)));
   return {
      x: x + lifelineWidth / 2,
      lifelineWidth,
      lifelineSpacing: Math.max(1, size.width - lifelineWidth),
      rowSpacing: Math.max(1, Math.round((size.height - headerHeight) / 2)),
      headerHeight,
   };
}

/** Whole sequence diagrams: create, duplicate, delete, config, and live move/resize with undo. */
export function withProjectSequenceMethods() {
   return signalStoreFeature(
      type<
         ProjectInternalsWith<
            { _placement: SlidePlacement; _sequenceOps: SequenceOps },
            { moveLifeline(lifelineId: string, x: number): void; moveMessage(messageId: string, y: number): void }
         >
      >(),
      withMethods((store) => {
         const { setSchema } = store._schema;
         const { runSave, patchDiagramLocal } = store._queue;
         const { push: pushHistory, rid } = store._history;
         const { sequenceApi } = store._api;
         const { shownSlideAt } = store._placement;
         const { captureSeq, removeSeq, recordSeqCreate, recordSeqDelete } = store._sequenceOps;

         /** A diagram's whole layout (positions, spacing, scale, bounds), for undo. */
         const sequenceLayoutOf = (diagramId: string): SequenceLayoutSnapshot => {
            const d = store.sequenceDiagrams().find((x) => x.id === diagramId);
            const lls = store.lifelines().filter((l) => l.diagramId === diagramId);
            return {
               lifelineXs: new Map(lls.map((l) => [l.id, l.x])),
               lifelineWidths: new Map(lls.map((l) => [l.id, l.width])),
               messageYs: new Map(
                  store
                     .sequenceMessages()
                     .filter((m) => m.diagramId === diagramId)
                     .map((m) => [m.id, m.y])
               ),
               originY: d?.originY ?? 0,
               rowSpacing: d?.rowSpacing ?? 48,
               headerHeight: d?.headerHeight,
               scale: d?.scale ?? 1,
               bounds: {
                  padLeft: d?.padLeft ?? 0,
                  padTop: d?.padTop ?? 0,
                  boxWidth: d?.boxWidth ?? 0,
                  boxHeight: d?.boxHeight ?? 0,
               },
            };
         };

            /**
             * Show (or with null, remove) a local-only starter diagram filling a box being
             * dragged out with the sequence tool, so it renders as it will look. Never saved.
             */
         const previewSequenceLocal = (box: { x: number; y: number; width: number; height: number } | null): void => {
               setSchema((s) => {
                  const rest = {
                     ...s,
                     sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== PREVIEW_ID),
                     lifelines: s.lifelines.filter((l) => l.diagramId !== PREVIEW_ID),
                     sequenceMessages: s.sequenceMessages.filter((m) => m.diagramId !== PREVIEW_ID),
                  };
                  if (!box) return rest;
                  const l = starterLayout(box.x, box.y, box);
                  const base = { diagramId: PREVIEW_ID, width: l.lifelineWidth };
                  return {
                     ...rest,
                     sequenceDiagrams: [
                        ...rest.sequenceDiagrams,
                        {
                           id: PREVIEW_ID,
                           lifelineSpacing: l.lifelineSpacing,
                           rowSpacing: l.rowSpacing,
                           headerHeight: l.headerHeight,
                           originY: box.y,
                           zIndex: -1,
                        },
                     ],
                     lifelines: [
                        ...rest.lifelines,
                        { ...base, id: `${PREVIEW_ID}-a`, label: 'Participant 1', x: l.x, order: 0, color: TABLE_PALETTE[0] },
                        {
                           ...base,
                           id: `${PREVIEW_ID}-b`,
                           label: 'Participant 2',
                           x: l.x + l.lifelineSpacing,
                           order: 1,
                           color: TABLE_PALETTE[1],
                        },
                     ],
                     sequenceMessages: [
                        ...rest.sequenceMessages,
                        {
                           id: `${PREVIEW_ID}-m`,
                           diagramId: PREVIEW_ID,
                           fromLifelineId: `${PREVIEW_ID}-a`,
                           toLifelineId: `${PREVIEW_ID}-b`,
                           y: box.y + l.headerHeight + l.rowSpacing,
                           style: 'solid',
                           direction: 'forward',
                           arrowhead: 'arrow',
                        },
                     ],
                  };
               });
            };

         return {
            /** Positions of a diagram's lifelines/rows, captured at the start of a group move. */
            sequenceDiagramSnapshot(diagramId: string): {
               diagramId: string;
               startXs: Map<string, number>;
               startOriginY: number;
               startRows: Map<string, number>;
            } | null {
               const s = store.schema();
               const d = s?.sequenceDiagrams.find((x) => x.id === diagramId);
               if (!s || !d) return null;
               const base = d.originY + d.headerHeight;
               return {
                  diagramId,
                  startXs: new Map(s.lifelines.filter((l) => l.diagramId === diagramId).map((l) => [l.id, l.x])),
                  startOriginY: d.originY,
                  startRows: new Map(
                     s.sequenceMessages
                        .filter((m) => m.diagramId === diagramId)
                        .map((m) => [m.id, Math.max(1, Math.round((m.y - base) / d.rowSpacing))])
                  ),
               };
            },

            /** Drop a NEW sequence diagram at (x, y): its own group + two participants + a message. */
            previewSequenceLocal,

            async addSequenceStarter(x: number, y: number, size?: { width: number; height: number }): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  previewSequenceLocal(null);
                  return;
               }
               const layout = starterLayout(x, y, size);
               const sized = size
                  ? {
                       lifelineSpacing: layout.lifelineSpacing,
                       rowSpacing: layout.rowSpacing,
                       headerHeight: layout.headerHeight,
                    }
                  : {};
               x = layout.x;
               const diagram = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createDiagram(projectId, {
                        ...sized,
                        originY: y,
                        slideId: shownSlideAt(x, y),
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, diagram] }));
               const spacing = diagram.lifelineSpacing;
               const a = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId: diagram.id,
                        label: 'Participant 1',
                        x,
                        width: layout.lifelineWidth,
                        order: 0,
                        color: TABLE_PALETTE[0],
                     })
                  )
               );
               const b = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId: diagram.id,
                        label: 'Participant 2',
                        x: x + spacing,
                        width: layout.lifelineWidth,
                        order: 1,
                        color: TABLE_PALETTE[1],
                     })
                  )
               );
               // Seed one message so the diagram reads as a sequence immediately.
               const m = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createMessage(projectId, {
                        diagramId: diagram.id,
                        fromLifelineId: a.id,
                        toLifelineId: b.id,
                        y: y + diagram.headerHeight + diagram.rowSpacing,
                        style: 'solid',
                        direction: 'forward',
                        arrowhead: 'arrow',
                     })
                  )
               );
               setSchema((s) => ({
                  ...s,
                  lifelines: [...s.lifelines, a, b],
                  sequenceMessages: [...s.sequenceMessages, m],
               }));
               // The drag preview stays up until the real diagram is complete (no flicker).
               previewSequenceLocal(null);
               patchState(store, {
                  selectedDiagramIds: [diagram.id],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
               });
               recordSeqCreate('diagram', diagram.id);
            },

            /**
             * Clone a whole sequence diagram (config, participants, messages) offset by
             * (dx, dy) and select the copy. Returns the new diagram id.
             */
            async duplicateSequence(diagramId: string, dx = 0, dy = 0): Promise<string | null> {
               const projectId = store.projectId();
               const src = store.sequenceDiagrams().find((d) => d.id === diagramId);
               if (!projectId || !src) {
                  return null;
               }
               const diagram = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createDiagram(projectId, {
                        originY: src.originY + dy,
                        lifelineSpacing: src.lifelineSpacing,
                        rowSpacing: src.rowSpacing,
                        headerHeight: src.headerHeight,
                        backgroundColor: src.backgroundColor,
                        title: src.title,
                        morphId: src.morphId,
                        zIndex: src.zIndex,
                        slideId: src.slideId,
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, diagram] }));
               patchState(store, {
                  selectedDiagramIds: [diagram.id],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
               });
               const idMap = new Map<string, string>();
               const lifelines = store
                  .lifelines()
                  .filter((l) => l.diagramId === diagramId)
                  .sort((a, b) => a.order - b.order);
               for (const l of lifelines) {
                  const copy = await runSave(() =>
                     firstValueFrom(
                        sequenceApi.createLifeline(projectId, {
                           diagramId: diagram.id,
                           label: l.label,
                           color: l.color,
                           lineColor: l.lineColor,
                           strokeColor: l.strokeColor,
                           textColor: l.textColor,
                           morphId: l.morphId,
                           x: l.x + dx,
                           width: l.width,
                           order: l.order,
                        })
                     )
                  );
                  idMap.set(l.id, copy.id);
                  setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
               }
               const messages = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
               for (const m of messages) {
                  const from = idMap.get(m.fromLifelineId);
                  const to = idMap.get(m.toLifelineId);
                  if (!from || !to) {
                     continue;
                  }
                  const copy = await runSave(() =>
                     firstValueFrom(
                        sequenceApi.createMessage(projectId, {
                           diagramId: diagram.id,
                           fromLifelineId: from,
                           toLifelineId: to,
                           label: m.label,
                           y: m.y + dy,
                           style: m.style,
                           direction: m.direction,
                           arrowhead: m.arrowhead,
                           color: m.color,
                           wrap: m.wrap,
                           morphId: m.morphId,
                        })
                     )
                  );
                  setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
               }
               recordSeqCreate('diagram', diagram.id);
               return diagram.id;
            },

            /** Delete one sequence diagram and all its participants + messages. */
            async deleteSequence(diagramId: string): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const snap = captureSeq('diagram', diagramId);
               if ((await removeSeq('diagram', diagramId)) && snap) recordSeqDelete(snap);
            },

            /** Update one diagram's layout config (spacing / origin), persisted. */
            async updateSequenceConfig(
               diagramId: string,
               patch: UpdateSequenceDiagramDto,
               /** false: persist without an undo step (a gesture records its own). */
               record = true
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               // Move/resize gestures record their own layout step; only the appearance
               // settings are recorded here.
               const keys = Object.keys(patch).filter((k) =>
                  record &&
                  ['backgroundColor', 'borderColor', 'lifelineSpacing', 'headerHeight', 'title', 'morphId'].includes(k)
               );
               const current = store.sequenceDiagrams().find((d) => d.id === diagramId);
               const before = current && keys.length ? pickKeys(current, keys) : null;
               patchDiagramLocal(diagramId, patch);
               const after = before ? pickKeys({ ...current, ...patch }, keys) : null;
               if (before && after && !sameValues(before, after)) {
                  pushHistory({
                     undo: () => this.updateSequenceConfig(rid(diagramId), before as UpdateSequenceDiagramDto),
                     redo: () => this.updateSequenceConfig(rid(diagramId), after as UpdateSequenceDiagramDto),
                  });
               }
            },

            /** Record a completed diagram move/resize (already applied) so it can be undone. */
            recordSequenceLayout(
               diagramId: string,
               before: SequenceLayoutSnapshot,
               after: SequenceLayoutSnapshot
            ): void {
               const apply = (snap: SequenceLayoutSnapshot): void => {
                  for (const [id, x] of snap.lifelineXs) {
                     store.moveLifeline(id, x);
                  }
                  for (const [id, y] of snap.messageYs) {
                     store.moveMessage(id, y);
                  }
                  void this.updateSequenceConfig(
                     diagramId,
                     {
                        rowSpacing: snap.rowSpacing,
                        originY: snap.originY,
                        ...(snap.headerHeight !== undefined ? { headerHeight: snap.headerHeight } : {}),
                        ...(snap.scale !== undefined ? { scale: snap.scale } : {}),
                        ...(snap.bounds ?? {}),
                     },
                     false
                  );
                  for (const [id, width] of snap.lifelineWidths ?? []) {
                     const l = store.lifelines().find((x) => x.id === id);
                     // withProjectSequenceRowsMethods is composed before this feature (project.store).
                     const rows = store as unknown as {
                        updateLifeline(id: string, p: { width: number }, prev: undefined, record: boolean): Promise<void>;
                     };
                     if (l && l.width !== width) void rows.updateLifeline(id, { width }, undefined, false);
                  }
               };
               pushHistory({ undo: () => apply(before), redo: () => apply(after) });
            },

            /**
             * Live (local-only) shift of one diagram: every lifeline's x plus the row
             * origin, and every message moves with it (kept on its row via `startRows`),
             * so the diagram translates as a whole. Persist on drag end.
             */
            shiftSequence(
               diagramId: string,
               startXs: ReadonlyMap<string, number>,
               dx: number,
               startOriginY: number,
               dy: number,
               startRows: ReadonlyMap<string, number>
            ): void {
               setSchema((s) => shiftSequenceIn(s, { diagramId, startXs, dx, startOriginY, dy, startRows }));
            },

            /**
             * Live (local-only) content scale of one diagram (Ctrl + resize): header height,
             * text scale and participant widths. Persist on end.
             */
            scaleSequenceLocal(
               diagramId: string,
               headerHeight: number,
               scale: number,
               widths: ReadonlyMap<string, number>
            ): void {
               setSchema((s) => ({
                  ...s,
                  lifelines: s.lifelines.map((l) =>
                     l.diagramId === diagramId && widths.has(l.id) ? { ...l, width: widths.get(l.id)! } : l
                  ),
                  sequenceDiagrams: s.sequenceDiagrams.map((x) =>
                     x.id === diagramId ? { ...x, headerHeight, scale } : x
                  ),
               }));
            },

            /** Live (local-only) box bounds of one diagram (plain resize). Persist on end. */
            setSequenceBoundsLocal(diagramId: string, bounds: SequenceBounds): void {
               setSchema((s) => ({
                  ...s,
                  sequenceDiagrams: s.sequenceDiagrams.map((x) => (x.id === diagramId ? { ...x, ...bounds } : x)),
               }));
            },

            /**
             * Spread the messages evenly down the diagram's current box: rows are renumbered
             * 1..n (simultaneous messages keep sharing a row) and the row spacing fills the
             * box's height, so the box itself does not change. One undo step.
             */
            spaceSequenceEvenly(diagramId: string): void {
               const d = store.sequenceDiagrams().find((x) => x.id === diagramId);
               if (!d) return;
               const msgs = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
               const box = sequenceDiagramBox(d, store.lifelines(), store.sequenceMessages());
               if (!box || !msgs.length) return;
               const before = sequenceLayoutOf(diagramId);
               const hb = d.originY + d.headerHeight;
               const rowOf = (y: number) => Math.max(1, Math.round((y - hb) / d.rowSpacing));
               const distinct = [...new Set(msgs.map((m) => rowOf(m.y)))].sort((a, b) => a - b);
               const index = new Map(distinct.map((r, i) => [r, i + 1] as const));
               // Spine end (box bottom minus padding) sits one row below the last message.
               const avail = box.y1 - SEQ_BOX_PAD - hb;
               const rowSpacing = Math.max(SEQ_MIN_ROW, Math.round((avail / (distinct.length + 1)) * 100) / 100);
               for (const m of msgs) store.moveMessage(m.id, hb + rowSpacing * (index.get(rowOf(m.y)) ?? 1));
               void this.updateSequenceConfig(diagramId, { rowSpacing }, false);
               this.recordSequenceLayout(diagramId, before, sequenceLayoutOf(diagramId));
            },

            /** Shrink the box back to its content, on one or both axes. One undo step. */
            fitSequenceToContent(diagramId: string, axes: { x: boolean; y: boolean } = { x: true, y: true }): void {
               const d = store.sequenceDiagrams().find((x) => x.id === diagramId);
               if (!d) return;
               const before = sequenceLayoutOf(diagramId);
               const patch = {
                  ...(axes.x ? { padLeft: 0, boxWidth: 0 } : {}),
                  ...(axes.y ? { padTop: 0, boxHeight: 0 } : {}),
               };
               void this.updateSequenceConfig(diagramId, patch, false);
               const after = sequenceLayoutOf(diagramId);
               if (JSON.stringify(before.bounds) !== JSON.stringify(after.bounds)) {
                  this.recordSequenceLayout(diagramId, before, after);
               }
            },

            /**
             * Live (local-only) resize of one diagram: each lifeline's x is scaled
             * around `anchorX` by `scaleX`, the vertical size is set via `rowSpacing` +
             * `originY`, and messages are re-spaced to keep their rows. Persist on end.
             */
            resizeSequenceTo(
               diagramId: string,
               startXs: ReadonlyMap<string, number>,
               anchorX: number,
               scaleX: number,
               rowSpacing: number,
               originY: number,
               startRows: ReadonlyMap<string, number>
            ): void {
               setSchema((s) => {
                  const d = s.sequenceDiagrams.find((x) => x.id === diagramId);
                  const base = originY + (d?.headerHeight ?? 42);
                  return {
                     ...s,
                     lifelines: s.lifelines.map((l) =>
                        l.diagramId === diagramId
                           ? { ...l, x: anchorX + ((startXs.get(l.id) ?? l.x) - anchorX) * scaleX }
                           : l
                     ),
                     sequenceMessages: s.sequenceMessages.map((m) =>
                        m.diagramId === diagramId && startRows.has(m.id)
                           ? { ...m, y: base + rowSpacing * (startRows.get(m.id) ?? 1) }
                           : m
                     ),
                     sequenceDiagrams: s.sequenceDiagrams.map((x) =>
                        x.id === diagramId ? { ...x, rowSpacing, originY } : x
                     ),
                  };
               });
            },
         };
      })
   );
}
