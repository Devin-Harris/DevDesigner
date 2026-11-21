import { patchState, signalStoreFeature, type, withMethods, withProps, type WritableStateSource } from '@ngrx/signals';
import type { HistoryEntry, ProjectState } from '../models/project-state.model';

/**
 * Undo/redo. Entries reuse the granular store methods so an undo is itself a persisted,
 * broadcast mutation (collaboration-safe). Remote edits and the undo/redo application itself
 * never push new entries. Method features record through `store._history.push`.
 */
function createHistory(store: WritableStateSource<ProjectState>) {
   const undoStack: HistoryEntry[] = [];
   const redoStack: HistoryEntry[] = [];
   let applyingHistory = false;

   function syncHistoryDepth(): void {
      patchState(store, { undoDepth: undoStack.length, redoDepth: redoStack.length });
   }

   // While a batch is open, pushed entries are collected and recorded as one
   // undo step (e.g. deleting a multi-selection).
   let historyBatch: HistoryEntry[] | null = null;

   function pushHistory(entry: HistoryEntry): void {
      if (applyingHistory) {
         return;
      }
      if (historyBatch) {
         historyBatch.push(entry);
         return;
      }
      undoStack.push(entry);
      redoStack.length = 0;
      syncHistoryDepth();
   }

   async function runHistory(action: () => void | Promise<void>): Promise<void> {
      applyingHistory = true;
      try {
         await action();
      } finally {
         applyingHistory = false;
      }
   }

   // ---- Sequence undo/redo ----
   // Undoing a delete re-creates the row with a NEW server id, so history entries
   // refer to rows by their original id and resolve it through this alias chain.
   const idAlias = new Map<string, string>();
   function rid(id: string): string {
      let cur = id;
      for (let i = 0; i < 50 && idAlias.has(cur); i++) cur = idAlias.get(cur)!;
      return cur;
   }
   function aliasTo(oldId: string, newId: string): void {
      idAlias.set(rid(oldId), newId);
      idAlias.set(oldId, newId);
   }

   /** Record a collected batch as one undo step (nothing when empty). */
   function commitBatch(batch: HistoryEntry[]): void {
      if (!batch.length) return;
      if (batch.length === 1) {
         pushHistory(batch[0]);
         return;
      }
      pushHistory({
         undo: async () => {
            for (const e of [...batch].reverse()) await e.undo();
         },
         redo: async () => {
            for (const e of batch) await e.redo();
         },
      });
   }

   /** Run `fn`, recording everything it does as a single undo step. */
   async function batchHistory(fn: () => Promise<unknown>): Promise<void> {
      if (historyBatch) {
         await fn();
         return;
      }
      const batch: HistoryEntry[] = [];
      historyBatch = batch;
      try {
         await fn();
      } finally {
         historyBatch = null;
      }
      commitBatch(batch);
   }

   /**
    * Synchronous twin of `batchHistory`: everything `fn` records before it returns
    * becomes one undo step. Use at gesture ends that record several entries at once
    * (e.g. moving several sequence diagrams plus their companions).
    */
   function batchHistorySync(fn: () => void): void {
      if (historyBatch) {
         fn();
         return;
      }
      const batch: HistoryEntry[] = [];
      historyBatch = batch;
      try {
         fn();
      } finally {
         historyBatch = null;
      }
      commitBatch(batch);
   }

   /** Undo the most recent operation (no-op when the stack is empty). */
   function undo(): void {
      const entry = undoStack.pop();
      if (!entry) {
         return;
      }
      redoStack.push(entry);
      syncHistoryDepth();
      void runHistory(() => entry.undo());
   }

   function redo(): void {
      const entry = redoStack.pop();
      if (!entry) {
         return;
      }
      undoStack.push(entry);
      syncHistoryDepth();
      void runHistory(() => entry.redo());
   }

   return { push: pushHistory, rid, aliasTo, batchHistory, batchHistorySync, undo, redo };
}

export type ProjectHistory = ReturnType<typeof createHistory>;

/** Adds `_history` (push, id aliases) and the public undo/redo/batchHistory methods. */
export function withProjectHistory() {
   return signalStoreFeature(
      { state: type<ProjectState>() },
      withProps((store) => ({ _history: createHistory(store) })),
      withMethods(({ _history }) => ({
         /** Run `fn`, recording everything it does as a single undo step. */
         batchHistory: (fn: () => Promise<unknown>): Promise<void> => _history.batchHistory(fn),
         /** Synchronous `batchHistory`: what `fn` records before returning is one undo step. */
         batchHistorySync: (fn: () => void): void => _history.batchHistorySync(fn),
         /** Undo the most recent element operation (no-op when the stack is empty). */
         undoElement: (): void => _history.undo(),
         redoElement: (): void => _history.redo(),
      }))
   );
}
