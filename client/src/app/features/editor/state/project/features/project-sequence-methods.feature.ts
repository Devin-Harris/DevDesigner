import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { type UpdateSequenceDiagramDto } from '@devdesigner/shared';
import type { SequenceLayoutSnapshot } from '../models/project-state.model';
import { shiftSequenceIn } from '../helpers/item-moves.helper';
import { TABLE_PALETTE } from '../helpers/table-defaults.helper';
import { pickKeys, sameValues } from '../helpers/patch-diff.helper';
import type { SequenceOps } from './project-sequence-ops';
import type { SlidePlacement } from './project-slides-methods.feature';
import type { ProjectInternalsWith } from './project-internals';

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
            async addSequenceStarter(x: number, y: number): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const diagram = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createDiagram(projectId, {
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
                        width: 120,
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
                        width: 120,
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
