import { patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { type LifelineModel, type SequenceDiagramModel, type SequenceMessageModel } from '@devdesigner/shared';
import type { ProjectInternalsStore } from './project-internals';

export type SeqKind = 'message' | 'lifeline' | 'diagram';

/**
 * Sequence-diagram row operations shared by the diagram and row methods: snapshot, re-create
 * (new server ids, aliased through `_history.rid`), optimistic delete and the history recorders.
 */
export function createSequenceOps(store: ProjectInternalsStore) {
   const { setSchema } = store._schema;
   const { flushTimers, runSave, optimistic } = store._queue;
   const { push: pushHistory, rid, aliasTo } = store._history;
   const { sequenceApi } = store._api;

   interface SeqSnapshot {
      kind: SeqKind;
      diagram?: SequenceDiagramModel;
      lifelines: LifelineModel[];
      messages: SequenceMessageModel[];
   }

   function captureSeq(kind: SeqKind, id: string): SeqSnapshot | null {
      const s = store.schema();
      if (!s) return null;
      if (kind === 'message') {
         const m = s.sequenceMessages.find((x) => x.id === id);
         return m ? { kind, lifelines: [], messages: [{ ...m }] } : null;
      }
      if (kind === 'lifeline') {
         const l = s.lifelines.find((x) => x.id === id);
         if (!l) return null;
         return {
            kind,
            lifelines: [{ ...l }],
            messages: s.sequenceMessages
               .filter((m) => m.fromLifelineId === id || m.toLifelineId === id)
               .map((m) => ({ ...m })),
         };
      }
      const d = s.sequenceDiagrams.find((x) => x.id === id);
      if (!d) return null;
      return {
         kind,
         diagram: { ...d },
         lifelines: s.lifelines.filter((l) => l.diagramId === id).map((l) => ({ ...l })),
         messages: s.sequenceMessages.filter((m) => m.diagramId === id).map((m) => ({ ...m })),
      };
   }

   function seqRootId(snap: SeqSnapshot): string {
      return snap.kind === 'diagram'
         ? snap.diagram!.id
         : snap.kind === 'lifeline'
           ? snap.lifelines[0].id
           : snap.messages[0].id;
   }

   async function createMessageRaw(m: SequenceMessageModel): Promise<void> {
      const projectId = store.projectId();
      if (!projectId) return;
      const copy = await runSave(() =>
         firstValueFrom(
            sequenceApi.createMessage(projectId, {
               diagramId: rid(m.diagramId),
               fromLifelineId: rid(m.fromLifelineId),
               toLifelineId: rid(m.toLifelineId),
               label: m.label,
               y: m.y,
               style: m.style,
               direction: m.direction,
               arrowhead: m.arrowhead,
               color: m.color,
               wrap: m.wrap,
               morphId: m.morphId,
            })
         )
      );
      aliasTo(m.id, copy.id);
      setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
   }

   async function createLifelineRaw(l: LifelineModel): Promise<void> {
      const projectId = store.projectId();
      if (!projectId) return;
      const copy = await runSave(() =>
         firstValueFrom(
            sequenceApi.createLifeline(projectId, {
               diagramId: rid(l.diagramId),
               label: l.label,
               color: l.color,
               lineColor: l.lineColor,
               strokeColor: l.strokeColor,
               textColor: l.textColor,
               morphId: l.morphId,
               x: l.x,
               width: l.width,
               order: l.order,
            })
         )
      );
      aliasTo(l.id, copy.id);
      setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
   }

   async function restoreSeq(snap: SeqSnapshot): Promise<void> {
      const projectId = store.projectId();
      if (!projectId) return;
      if (snap.diagram) {
         const d = snap.diagram;
         const copy = await runSave(() =>
            firstValueFrom(
               sequenceApi.createDiagram(projectId, {
                  originY: d.originY,
                  lifelineSpacing: d.lifelineSpacing,
                  rowSpacing: d.rowSpacing,
                  headerHeight: d.headerHeight,
                  backgroundColor: d.backgroundColor,
                  title: d.title,
                  morphId: d.morphId,
                  zIndex: d.zIndex,
                  slideId: d.slideId,
               })
            )
         );
         aliasTo(d.id, copy.id);
         setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, copy] }));
      }
      for (const l of [...snap.lifelines].sort((a, b) => a.order - b.order)) {
         await createLifelineRaw(l);
      }
      for (const m of snap.messages) {
         await createMessageRaw(m);
      }
   }

   /** Optimistic delete; resolves false (rows restored) when the server rejects it. */
   async function removeSeq(kind: SeqKind, id: string): Promise<boolean> {
      const projectId = store.projectId();
      if (!projectId) return false;
      if (kind === 'message') {
         flushTimers(`msgpos:${id}`, `patch:message:${id}`);
         void optimistic(
            `message:${id}`,
            () => {
               setSchema((s) => ({
                  ...s,
                  sequenceMessages: s.sequenceMessages.filter((m) => m.id !== id),
               }));
               patchState(store, {
                  selectedMessageIds: store.selectedMessageIds().filter((x) => x !== id),
               });
            },
            () => firstValueFrom(sequenceApi.deleteMessage(projectId, id)),
            'delete the message'
         );
         return true;
      }
      if (kind === 'lifeline') {
         flushTimers(`llpos:${id}`, `patch:lifeline:${id}`);
         void optimistic(
            `lifeline:${id}`,
            () => {
               setSchema((s) => ({
                  ...s,
                  lifelines: s.lifelines.filter((l) => l.id !== id),
                  sequenceMessages: s.sequenceMessages.filter((m) => m.fromLifelineId !== id && m.toLifelineId !== id),
               }));
               patchState(store, {
                  selectedLifelineIds: store.selectedLifelineIds().filter((x) => x !== id),
               });
            },
            () => firstValueFrom(sequenceApi.deleteLifeline(projectId, id)),
            'delete the participant'
         );
         return true;
      }
      flushTimers(`patch:diagram:${id}`);
      void optimistic(
         `diagram:${id}`,
         () => {
            setSchema((s) => ({
               ...s,
               sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== id),
               lifelines: s.lifelines.filter((l) => l.diagramId !== id),
               sequenceMessages: s.sequenceMessages.filter((m) => m.diagramId !== id),
            }));
            patchState(store, {
               selectedDiagramIds: store.selectedDiagramIds().filter((x) => x !== id),
               selectedLifelineIds: [],
               selectedMessageIds: [],
            });
         },
         () => firstValueFrom(sequenceApi.deleteDiagram(projectId, id)),
         'delete the sequence diagram'
      );
      return true;
   }

   /** Undo = remove it again; redo = bring it back (state re-captured at undo time). */
   function recordSeqCreate(kind: SeqKind, id: string): void {
      let snap = captureSeq(kind, id);
      if (!snap) return;
      pushHistory({
         undo: async () => {
            snap = captureSeq(kind, rid(id)) ?? snap;
            await removeSeq(kind, rid(id));
         },
         redo: () => restoreSeq(snap!),
      });
   }

   /** Undo = bring the deleted rows back; redo = delete them again. */
   function recordSeqDelete(snap: SeqSnapshot): void {
      const id = seqRootId(snap);
      pushHistory({
         undo: () => restoreSeq(snap),
         redo: async () => {
            await removeSeq(snap.kind, rid(id));
         },
      });
   }
   function resolveRefs(patch: Record<string, unknown>): Record<string, unknown> {
      const out = { ...patch };
      for (const k of ['fromLifelineId', 'toLifelineId']) {
         if (typeof out[k] === 'string') out[k] = rid(out[k] as string);
      }
      return out;
   }

   return { captureSeq, restoreSeq, removeSeq, recordSeqCreate, recordSeqDelete, resolveRefs };
}

export type SequenceOps = ReturnType<typeof createSequenceOps>;
