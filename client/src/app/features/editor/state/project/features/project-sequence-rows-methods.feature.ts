import { patchState, signalStoreFeature, type, withMethods, withProps } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
   type LifelineModel,
   type SequenceMessageModel,
   type UpdateLifelineDto,
   type UpdateSequenceMessageDto,
} from '@devdesigner/shared';
import { TABLE_PALETTE } from '../helpers/table-defaults.helper';
import { pickKeys, sameValues } from '../helpers/patch-diff.helper';
import { createSequenceOps } from './project-sequence-ops';
import type { ProjectInternals } from './project-internals';

/** Sequence participants (lifelines) and messages: add/duplicate/update/move/delete with undo. */
export function withProjectSequenceRowsMethods() {
   return signalStoreFeature(
      type<ProjectInternals>(),
      withProps((store) => ({ _sequenceOps: createSequenceOps(store) })),
      withMethods((store) => {
         const { setSchema, mapLifeline, mapMessage } = store._schema;
         const { debounce, runSave, stage } = store._queue;
         const { push: pushHistory, rid } = store._history;
         const { sequenceApi } = store._api;
         const { captureSeq, restoreSeq, removeSeq, recordSeqCreate, recordSeqDelete, resolveRefs } =
            store._sequenceOps;

         return {
            /** Add a participant column to a diagram, on the given side of its spread. */
            /**
             * Add a participant. `at` is the insert position in left-to-right order
             * (0 = before the first, n = after the last); later participants slide
             * right by one spacing to make room.
             */
            async addLifeline(diagramId: string, at: number): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const diagram = store.sequenceDiagrams().find((d) => d.id === diagramId);
               const lls = store
                  .lifelines()
                  .filter((l) => l.diagramId === diagramId)
                  .sort((a, b) => a.x - b.x);
               const spacing = diagram?.lifelineSpacing ?? 160;
               const order = lls.length;
               const index = Math.max(0, Math.min(at, lls.length));
               let x = 0;
               const shifted: { id: string; from: number; to: number }[] = [];
               if (lls.length) {
                  if (index === 0) {
                     x = lls[0].x - spacing;
                  } else {
                     x = lls[index - 1].x + spacing;
                     for (const l of lls.slice(index)) {
                        const nx = l.x + spacing;
                        shifted.push({ id: l.id, from: l.x, to: nx });
                        mapLifeline(l.id, (m) => ({ ...m, x: nx }));
                        debounce(`llpos:${l.id}`, () => {
                           void runSave(() => firstValueFrom(sequenceApi.moveLifeline(projectId, l.id, { x: nx })));
                        });
                     }
                  }
               }
               const created = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId,
                        label: `Participant ${order + 1}`,
                        x,
                        width: 120,
                        order,
                        color: TABLE_PALETTE[order % TABLE_PALETTE.length],
                     })
                  )
               );
               setSchema((s) => ({ ...s, lifelines: [...s.lifelines, created] }));
               patchState(store, {
                  selectedLifelineIds: [created.id],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
               });
               let snap = captureSeq('lifeline', created.id);
               if (snap) {
                  pushHistory({
                     undo: async () => {
                        snap = captureSeq('lifeline', rid(created.id)) ?? snap;
                        await removeSeq('lifeline', rid(created.id));
                        shifted.forEach((s) => this.moveLifeline(rid(s.id), s.from));
                     },
                     redo: async () => {
                        await restoreSeq(snap!);
                        shifted.forEach((s) => this.moveLifeline(rid(s.id), s.to));
                     },
                  });
               }
            },

            async updateLifeline(
               lifelineId: string,
               patch: UpdateLifelineDto,
               /** Values to restore on undo when the local model was already changed live (drag). */
               prev?: UpdateLifelineDto
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const keys = Object.keys(patch);
               const current = store.lifelines().find((l) => l.id === lifelineId);
               const before = prev ? (prev as Record<string, unknown>) : current ? pickKeys(current, keys) : null;
               stage('lifelines', lifelineId, patch);
               mapLifeline(lifelineId, (l) => ({ ...l, ...(patch as Partial<LifelineModel>) }));
               const after = pickKeys({ ...current, ...patch }, keys);
               if (before && !sameValues(before, after)) {
                  pushHistory({
                     undo: () => this.updateLifeline(rid(lifelineId), before as UpdateLifelineDto),
                     redo: () => this.updateLifeline(rid(lifelineId), after as UpdateLifelineDto),
                  });
               }
            },

            /** Optimistic horizontal move; the position PATCH is debounced per lifeline. */
            moveLifeline(lifelineId: string, x: number): void {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               stage('lifelines', lifelineId, { x });
               mapLifeline(lifelineId, (l) => ({ ...l, x }));
            },

            /** Live (local-only) header width while dragging its edge; persist via updateLifeline. */
            setLifelineWidthLocal(lifelineId: string, width: number): void {
               mapLifeline(lifelineId, (l) => ({ ...l, width }));
            },

            async deleteLifeline(lifelineId: string): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const snap = captureSeq('lifeline', lifelineId);
               if ((await removeSeq('lifeline', lifelineId)) && snap) recordSeqDelete(snap);
            },

            /** Clone one participant column (same diagram, label and color) and select it. */
            async duplicateLifeline(lifelineId: string, dx = 0): Promise<string | null> {
               const projectId = store.projectId();
               const src = store.lifelines().find((l) => l.id === lifelineId);
               if (!projectId || !src) {
                  return null;
               }
               const order = store.lifelines().filter((l) => l.diagramId === src.diagramId).length;
               const copy = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId: src.diagramId,
                        label: src.label,
                        color: src.color,
                        lineColor: src.lineColor,
                        strokeColor: src.strokeColor,
                        textColor: src.textColor,
                        morphId: src.morphId,
                        x: src.x + dx,
                        width: src.width,
                        order,
                     })
                  )
               );
               setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
               patchState(store, {
                  selectedLifelineIds: [copy.id],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
               });
               recordSeqCreate('lifeline', copy.id);
               return copy.id;
            },

            /** Record a finished horizontal drag of a participant for undo/redo. */
            recordLifelineMove(id: string, from: number, to: number): void {
               pushHistory({
                  undo: () => this.moveLifeline(rid(id), from),
                  redo: () => this.moveLifeline(rid(id), to),
               });
            },

            /**
             * Create a message between two lifelines. `atY` is the world-y where the
             * connection was drawn; it snaps to the nearest row of the grid. Multiple
             * messages may share a row (simultaneous messages). Without `atY` it goes
             * on the row after the lowest existing one.
             */
            async addMessage(
               diagramId: string,
               fromLifelineId: string,
               toLifelineId: string,
               atY?: number
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               if (fromLifelineId === toLifelineId) {
                  return; // a message needs two different participants
               }
               const diagram = store.sequenceDiagrams().find((d) => d.id === diagramId);
               if (!diagram) {
                  return;
               }
               const base = diagram.originY + diagram.headerHeight;
               const gap = diagram.rowSpacing;
               const rowOf = (y: number) => Math.max(1, Math.round((y - base) / gap));
               const msgs = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
               const row = atY != null ? rowOf(atY) : msgs.length ? Math.max(...msgs.map((m) => rowOf(m.y))) + 1 : 1;
               const y = base + gap * row;
               const created = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createMessage(projectId, {
                        diagramId,
                        fromLifelineId,
                        toLifelineId,
                        y,
                        style: 'solid',
                        direction: 'forward',
                        arrowhead: 'arrow',
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, created] }));
               patchState(store, {
                  selectedMessageIds: [created.id],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
               });
               recordSeqCreate('message', created.id);
            },

            /** Clone one message (same endpoints, style and row) and select it. */
            async duplicateMessage(messageId: string, dy = 0): Promise<string | null> {
               const projectId = store.projectId();
               const src = store.sequenceMessages().find((m) => m.id === messageId);
               if (!projectId || !src) {
                  return null;
               }
               const copy = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createMessage(projectId, {
                        diagramId: src.diagramId,
                        fromLifelineId: src.fromLifelineId,
                        toLifelineId: src.toLifelineId,
                        label: src.label,
                        y: src.y + dy,
                        style: src.style,
                        direction: src.direction,
                        arrowhead: src.arrowhead,
                        color: src.color,
                        wrap: src.wrap,
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
               patchState(store, {
                  selectedMessageIds: [copy.id],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
               });
               recordSeqCreate('message', copy.id);
               return copy.id;
            },

            async updateMessage(messageId: string, patch: UpdateSequenceMessageDto): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const keys = Object.keys(patch);
               const current = store.sequenceMessages().find((m) => m.id === messageId);
               const before = current ? pickKeys(current, keys) : null;
               stage('messages', messageId, patch);
               mapMessage(messageId, (m) => ({ ...m, ...(patch as Partial<SequenceMessageModel>) }));
               const after = pickKeys({ ...current, ...patch }, keys);
               if (before && !sameValues(before, after)) {
                  pushHistory({
                     undo: () => this.updateMessage(rid(messageId), resolveRefs(before) as UpdateSequenceMessageDto),
                     redo: () => this.updateMessage(rid(messageId), resolveRefs(after) as UpdateSequenceMessageDto),
                  });
               }
            },

            /** Optimistic vertical move; the position PATCH is debounced per message. */
            moveMessage(messageId: string, y: number): void {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               stage('messages', messageId, { y });
               mapMessage(messageId, (m) => ({ ...m, y }));
            },

            async deleteMessage(messageId: string): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const snap = captureSeq('message', messageId);
               if ((await removeSeq('message', messageId)) && snap) recordSeqDelete(snap);
            },

            /** Record a finished drag of message rows (already applied) for undo/redo. */
            recordMessageMoves(moves: { id: string; from: number; to: number }[]): void {
               if (!moves.length) return;
               pushHistory({
                  undo: () => moves.forEach((m) => this.moveMessage(rid(m.id), m.from)),
                  redo: () => moves.forEach((m) => this.moveMessage(rid(m.id), m.to)),
               });
            },
         };
      })
   );
}
