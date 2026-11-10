import type { Signal } from '@angular/core';
import { patchState, signalStoreFeature, type, withProps, type WritableStateSource } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type {
   BatchUpdateDto,
   SchemaModel,
   SequenceDiagramModel,
   TableModel,
   UpdateSequenceDiagramDto,
   UpdateTableDto,
} from '@devdesigner/shared';
import type { ProjectState } from '../models/project-state.model';
import type { ProjectApis, SchemaWriter } from './project-props.feature';

type QueueHost = WritableStateSource<ProjectState> & {
   projectId: Signal<string | null>;
   schema: Signal<SchemaModel | null>;
   _api: ProjectApis;
   _schema: SchemaWriter;
};

export type BatchSection = 'tables' | 'elements' | 'diagrams' | 'lifelines' | 'messages' | 'relationships';

/**
 * The write queue (perf audit "write-queue module"): debounced timers, the per-row request
 * queue with optimistic rollback (`checkpoint` / `optimistic`), merged field patches
 * (`commitPatch`) and the staged batch every move and field edit goes through. Method features
 * reach it as `store._queue`.
 */
function createSaveQueue(store: QueueHost) {
   const { setSchema, mapTable, mapDiagram } = store._schema;
   const { projectsApi, snackBar } = store._api;
   const timers = new Map<string, ReturnType<typeof setTimeout>>();
   const timerFns = new Map<string, () => void>();

   function debounce(key: string, fn: () => void, ms = 500): void {
      const existing = timers.get(key);
      if (existing) {
         clearTimeout(existing);
      }
      timerFns.set(key, fn);
      timers.set(
         key,
         setTimeout(() => {
            timers.delete(key);
            timerFns.delete(key);
            fn();
         }, ms)
      );
   }

   let savesInFlight = 0;
   let saveFailed = false;

   async function runSave<T>(action: () => Promise<T>): Promise<T> {
      savesInFlight++;
      patchState(store, { saveStatus: 'saving' });
      try {
         return await action();
      } catch (err) {
         saveFailed = true;
         throw err;
      } finally {
         savesInFlight--;
         if (!savesInFlight) {
            patchState(store, { saveStatus: saveFailed ? 'error' : 'saved' });
            saveFailed = false;
         }
      }
   }

   // ---- Optimistic writes ----
   // Deletes and moves apply to the local schema immediately; the request is
   // queued per entity (so a move, an edit and a delete of the same row reach the
   // server in order) and the local change is rolled back if the server rejects it.
   const queues = new Map<string, Promise<unknown>>();
   // All writes chain here (a staged batch, a delete and a create of the same
   // row must land in order); `queues` only tracks per-row pending work.
   let writeChain: Promise<unknown> = Promise.resolve();
   // Optimistically created elements the server rejected; later queued ops on
   // them fail too, and their rollbacks must not bring them back.
   const failedCreates = new Set<string>();
   const queueDepth = new Map<string, number>();

   function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const run = writeChain.catch(() => undefined).then(fn);
      const tail = run.catch(() => undefined);
      writeChain = tail;
      queues.set(key, tail);
      queueDepth.set(key, (queueDepth.get(key) ?? 0) + 1);
      void tail.then(() => {
         const depth = (queueDepth.get(key) ?? 1) - 1;
         if (depth) {
            queueDepth.set(key, depth);
         } else {
            queueDepth.delete(key);
            queues.delete(key);
         }
      });
      return run;
   }

   /** True when no request other than the one now finishing is queued for `key`. */
   function queueSettling(key: string): boolean {
      return (queueDepth.get(key) ?? 0) <= 1;
   }

   type Collection = 'tables' | 'relationships' | 'elements' | 'sequenceDiagrams' | 'lifelines' | 'sequenceMessages';
   const COLLECTIONS: Collection[] = [
      'tables',
      'relationships',
      'elements',
      'sequenceDiagrams',
      'lifelines',
      'sequenceMessages',
   ];
   type Row = { id: string };

   /**
    * Snapshot the schema before a local change. The returned `seal` diffs the
    * snapshot against the current schema and returns a rollback that restores
    * the rows the change touched (re-inserting removed ones at their old index),
    * leaving unrelated rows alone. `onlyId` limits it to one row, reverted only
    * while it still exists (a move must not resurrect a since-deleted row).
    */
   function checkpoint(onlyId?: string): () => () => void {
      const before = store.schema();
      return () => {
         const after = store.schema();
         if (!before || !after || before === after) {
            return () => undefined;
         }
         const reverts = COLLECTIONS.map((k) => {
            const prev = before[k] as Row[];
            const done = after[k] as Row[];
            const doneById = new Map(done.map((r) => [r.id, r]));
            const rows =
               prev === done
                  ? []
                  : prev
                       .map((row, index) => ({ row, index }))
                       .filter(
                          ({ row }) =>
                             doneById.get(row.id) !== row && (!onlyId || (row.id === onlyId && doneById.has(row.id)))
                       );
            return { k, rows };
         }).filter((r) => r.rows.length);
         return () =>
            setSchema((s) => {
               let next = s;
               for (const { k, rows } of reverts) {
                  const cur = [...(next[k] as Row[])];
                  for (const { row, index } of rows) {
                     const at = cur.findIndex((r) => r.id === row.id);
                     if (at >= 0) cur[at] = row;
                     else if (!onlyId && !failedCreates.has(row.id)) cur.splice(Math.min(index, cur.length), 0, row);
                  }
                  next = { ...next, [k]: cur };
               }
               return next;
            });
      };
   }

   function notifyFailure(what: string): void {
      snackBar.open(`Couldn't ${what}; the change was reverted.`, 'Dismiss', { duration: 5000 });
   }

   /**
    * Apply `apply` locally now, then persist through the entity's queue. On
    * failure the local change is rolled back and the user told; resolves to
    * `{ value }` on success, `null` on failure.
    */
   async function optimistic<T>(
      queueKey: string,
      apply: () => void,
      persist: () => Promise<T>,
      what: string
   ): Promise<{ value: T } | null> {
      const seal = checkpoint();
      apply();
      const rollback = seal();
      try {
         return { value: await enqueue(queueKey, () => runSave(persist)) };
      } catch {
         rollback();
         notifyFailure(what);
         return null;
      }
   }

   /** Send (instead of waiting out) pending debounced saves, e.g. before a delete. */
   function flushTimers(...keys: string[]): void {
      for (const key of ['batch', ...keys]) {
         const handle = timers.get(key);
         const fn = timerFns.get(key);
         if (handle && fn) {
            clearTimeout(handle);
            timers.delete(key);
            timerFns.delete(key);
            fn();
         }
      }
   }

   // Checkpoints for debounced saves, sealed when the save fires: a rejected
   // save restores the row to its state before the window's first local change.
   const debouncedCheckpoints = new Map<string, () => () => void>();

   /** Debounced optimistic save whose request is built (`take`) when the window closes. */
   function debouncedCommit(
      key: string,
      queueKey: string,
      rowId: string,
      take: () => () => Promise<unknown>,
      what: string,
      ms: number
   ): void {
      if (!debouncedCheckpoints.has(key)) {
         debouncedCheckpoints.set(key, checkpoint(rowId));
      }
      debounce(
         key,
         () => {
            const seal = debouncedCheckpoints.get(key);
            debouncedCheckpoints.delete(key);
            const rollback = seal ? seal() : () => undefined;
            const persist = take();
            void enqueue(queueKey, () => runSave(persist)).catch(() => {
               rollback();
               notifyFailure(what);
            });
         },
         ms
      );
   }

   // Field patches waiting out their debounce window, merged per row.
   const pendingPatches = new Map<string, Record<string, unknown>>();

   /**
    * Local-first edit: the caller has already applied `patch` to the local model
    * (or does so right after); rapid patches to the same row are merged and sent
    * as one request once edits pause. A rejected request restores the row.
    */
   function commitPatch<P extends object>(
      key: string,
      queueKey: string,
      rowId: string,
      patch: P,
      send: (merged: P) => Promise<unknown>,
      what: string,
      ms = 300
   ): void {
      pendingPatches.set(key, { ...(pendingPatches.get(key) ?? {}), ...patch });
      debouncedCommit(
         key,
         queueKey,
         rowId,
         () => {
            const merged = (pendingPatches.get(key) ?? {}) as P;
            pendingPatches.delete(key);
            return () => send(merged);
         },
         what,
         ms
      );
   }

   // ---- Staged batch ----
   // Moves and field edits are staged here, merged per row, and sent as ONE
   // atomic PATCH /projects/:id/batch once edits pause, so dragging a diagram
   // (its participants, messages, tables and shapes) is a single request. A
   // rejected batch restores every row it carried.
   const BATCH_SECTIONS: BatchSection[] = ['tables', 'elements', 'diagrams', 'lifelines', 'messages', 'relationships'];
   const staged = new Map<BatchSection, Map<string, Record<string, unknown>>>(
      BATCH_SECTIONS.map((k) => [k, new Map()])
   );
   const stagedCheckpoints = new Map<string, () => () => void>();

   /** True while a row has edits staged but not yet sent. */
   function isStaged(section: BatchSection, id: string): boolean {
      return staged.get(section)!.has(id);
   }

   /** Stage a patch for a row. Call BEFORE applying it locally (checkpoints the row). */
   function stage(section: BatchSection, id: string, patch: object, ms = 400): void {
      const ck = `${section}:${id}`;
      if (!stagedCheckpoints.has(ck)) {
         stagedCheckpoints.set(ck, checkpoint(id));
      }
      const rows = staged.get(section)!;
      rows.set(id, { ...(rows.get(id) ?? {}), ...patch });
      debounce('batch', flushBatch, ms);
   }

   function flushBatch(): void {
      const projectId = store.projectId();
      const body: BatchUpdateDto = {};
      let count = 0;
      for (const section of BATCH_SECTIONS) {
         const rows = staged.get(section)!;
         if (rows.size) {
            (body as Record<string, unknown>)[section] = [...rows].map(([id, p]) => ({ id, ...p }));
            count += rows.size;
            rows.clear();
         }
      }
      const rollbacks = [...stagedCheckpoints.values()].map((seal) => seal());
      stagedCheckpoints.clear();
      if (!count || !projectId) {
         return;
      }
      void enqueue('batch', () => runSave(() => firstValueFrom(projectsApi.batch(projectId, body)))).catch(() => {
         rollbacks.forEach((rollback) => rollback());
         notifyFailure('save your changes');
      });
   }

   function patchTableLocal(tableId: string, patch: UpdateTableDto): void {
      stage('tables', tableId, patch);
      mapTable(tableId, (t) => ({ ...t, ...(patch as Partial<TableModel>) }));
   }

   function patchDiagramLocal(diagramId: string, patch: UpdateSequenceDiagramDto): void {
      stage('diagrams', diagramId, patch);
      mapDiagram(diagramId, (d) => ({ ...d, ...(patch as Partial<SequenceDiagramModel>) }));
   }

   return {
      debounce,
      flushTimers,
      runSave,
      enqueue,
      queueSettling,
      failedCreates,
      checkpoint,
      notifyFailure,
      optimistic,
      commitPatch,
      stage,
      isStaged,
      patchTableLocal,
      patchDiagramLocal,
   };
}

export type SaveQueue = ReturnType<typeof createSaveQueue>;

/** Adds `_queue`, the shared write queue (see `createSaveQueue`). */
export function withProjectSaveQueue() {
   return signalStoreFeature(
      { state: type<ProjectState>(), props: type<{ _api: ProjectApis; _schema: SchemaWriter }>() },
      withProps((store) => ({ _queue: createSaveQueue(store) }))
   );
}
