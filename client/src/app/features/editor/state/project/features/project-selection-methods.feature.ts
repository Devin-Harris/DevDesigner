import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { GroupAssignment, GroupItemKind } from '../models/project-state.model';
import type { ProjectInternals } from './project-internals';

/**
 * Selection and groups: (multi-)select per kind, a grouped item selects its whole group unless
 * the group is entered, group/ungroup (one undo step each), and the sequence label-edit requests.
 */
export function withProjectSelectionMethods() {
   return signalStoreFeature(
      type<ProjectInternals>(),
      withMethods((store) => {
         const { mapTable, mapElement, mapDiagram } = store._schema;
         const { runSave } = store._queue;
         const { push: pushHistory } = store._history;
         const { tablesApi, elementsApi, sequenceApi } = store._api;

         interface Sel {
            tableIds: string[];
            elementIds: string[];
            diagramIds: string[];
         }

         function currentSel(): Sel {
            return {
               tableIds: [...store.selectedTableIds()],
               elementIds: [...store.selectedElementIds()],
               diagramIds: [...store.selectedDiagramIds()],
            };
         }

         /**
          * Grow a selection to whole groups (the group being edited excepted) and work
          * out which group stays entered: only one the selection still touches.
          */
         function resolveGroups(sel: Sel): { sel: Sel; entered: string | null } {
            const byItem = store.groupByItem();
            const groups = store.groups();
            const gids = new Set<string>();
            for (const id of [...sel.tableIds, ...sel.elementIds, ...sel.diagramIds]) {
               const g = byItem.get(id);
               if (g) gids.add(g);
            }
            let entered = store.enteredGroupId();
            if (entered && !gids.has(entered)) entered = null;
            const t = new Set(sel.tableIds);
            const e = new Set(sel.elementIds);
            const d = new Set(sel.diagramIds);
            for (const gid of gids) {
               const m = groups.get(gid);
               if (!m || gid === entered) continue;
               m.tableIds.forEach((i) => t.add(i));
               m.elementIds.forEach((i) => e.add(i));
               m.diagramIds.forEach((i) => d.add(i));
            }
            return { sel: { tableIds: [...t], elementIds: [...e], diagramIds: [...d] }, entered };
         }

         /** Replace the selection with `sel` (grown to whole groups), clearing other kinds. */
         function applySelection(sel: Sel): void {
            const r = resolveGroups(sel);
            patchState(store, {
               selectedTableIds: r.sel.tableIds,
               selectedElementIds: r.sel.elementIds,
               selectedDiagramIds: r.sel.diagramIds,
               selectedRelationshipIds: [],
               selectedLifelineIds: [],
               selectedMessageIds: [],
               enteredGroupId: r.entered,
            });
         }

         const KIND_KEY: Record<GroupItemKind, keyof Sel> = {
            table: 'tableIds',
            element: 'elementIds',
            diagram: 'diagramIds',
         };

         /** Shift/ctrl-toggle one item; a grouped item toggles its whole group. */
         function toggleItem(kind: GroupItemKind, id: string): void {
            const cur = currentSel();
            const key = KIND_KEY[kind];
            const gid = store.groupByItem().get(id);
            const entered = store.enteredGroupId();
            const single: Sel = { tableIds: [], elementIds: [], diagramIds: [] };
            single[key] = [id];
            const unit: Sel = gid && gid !== entered ? (store.groups().get(gid) as Sel) : single;
            const on = !cur[key].includes(id);
            const next: Sel = { tableIds: [], elementIds: [], diagramIds: [] };
            for (const k of ['tableIds', 'elementIds', 'diagramIds'] as const) {
               next[k] = on ? [...new Set([...cur[k], ...unit[k]])] : cur[k].filter((x) => !unit[k].includes(x));
            }
            const byItem = store.groupByItem();
            const stillEntered =
               !!entered &&
               [...next.tableIds, ...next.elementIds, ...next.diagramIds].some((x) => byItem.get(x) === entered);
            patchState(store, {
               selectedTableIds: next.tableIds,
               selectedElementIds: next.elementIds,
               selectedDiagramIds: next.diagramIds,
               selectedLifelineIds: [],
               selectedMessageIds: [],
               enteredGroupId: stillEntered ? entered : null,
            });
         }

         /** The raw (persisted) group id of an item, whether or not the group is live. */
         function rawGroupId(kind: GroupItemKind, id: string): string | null {
            const s = store.schema();
            if (!s) return null;
            const g =
               kind === 'table'
                  ? s.tables.find((x) => x.id === id)?.groupId
                  : kind === 'element'
                    ? s.elements.find((x) => x.id === id)?.groupId
                    : s.sequenceDiagrams.find((x) => x.id === id)?.groupId;
            return g ?? null;
         }

         /** Apply group membership locally, then persist each item (no history). */
         async function applyGroupAssignments(list: GroupAssignment[]): Promise<void> {
            const projectId = store.projectId();
            for (const a of list) {
               const value = a.groupId ?? undefined;
               if (a.kind === 'table') mapTable(a.id, (t) => ({ ...t, groupId: value }));
               else if (a.kind === 'element') mapElement(a.id, (e) => ({ ...e, groupId: value }));
               else mapDiagram(a.id, (d) => ({ ...d, groupId: value }));
            }
            await Promise.all(
               list.map((a) => {
                  const patch = { groupId: a.groupId };
                  if (a.kind === 'table') {
                     return runSave(() => firstValueFrom(tablesApi.update(a.id, patch)));
                  }
                  if (a.kind === 'element') {
                     return runSave(() => firstValueFrom(elementsApi.update(a.id, patch)));
                  }
                  return projectId
                     ? runSave(() => firstValueFrom(sequenceApi.updateDiagram(projectId, a.id, patch)))
                     : Promise.resolve();
               })
            );
         }

         /** Keep the entered group only when the diagram being selected belongs to it. */
         function enteredFor(diagramId: string | undefined): string | null {
            const entered = store.enteredGroupId();
            return entered && diagramId && store.groupByItem().get(diagramId) === entered ? entered : null;
         }

         function selectedItems(): { kind: GroupItemKind; id: string }[] {
            const sel = currentSel();
            return [
               ...sel.tableIds.map((id) => ({ kind: 'table' as const, id })),
               ...sel.elementIds.map((id) => ({ kind: 'element' as const, id })),
               ...sel.diagramIds.map((id) => ({ kind: 'diagram' as const, id })),
            ];
         }

         async function setGroups(before: GroupAssignment[], after: GroupAssignment[]): Promise<void> {
            pushHistory({
               undo: () => applyGroupAssignments(before),
               redo: () => applyGroupAssignments(after),
            });
            await applyGroupAssignments(after);
         }

         return {
            /** Select a table (or its whole group). additive (ctrl/shift) toggles it within the set. */
            selectTable(tableId: string, additive = false): void {
               if (!additive) {
                  applySelection({ tableIds: [tableId], elementIds: [], diagramIds: [] });
                  return;
               }
               toggleItem('table', tableId);
            },

            selectRelationship(relationshipId: string, additive = false): void {
               if (!additive) {
                  patchState(store, { selectedRelationshipIds: [relationshipId], selectedTableIds: [] });
                  return;
               }
               const current = store.selectedRelationshipIds();
               patchState(store, {
                  selectedRelationshipIds: current.includes(relationshipId)
                     ? current.filter((id) => id !== relationshipId)
                     : [...current, relationshipId],
               });
            },

            /** Select an element (or its whole group). additive (ctrl/shift) toggles it in the set. */
            selectElement(elementId: string, additive = false): void {
               if (!additive) {
                  applySelection({ tableIds: [], elementIds: [elementId], diagramIds: [] });
                  return;
               }
               toggleItem('element', elementId);
            },

            setSelection(
               tableIds: string[],
               relationshipIds: string[],
               elementIds: string[] = [],
               messageIds: string[] = [],
               lifelineIds: string[] = [],
               diagramIds: string[] = []
            ): void {
               // A message/lifeline of a grouped (not entered) diagram selects the diagram.
               const byItem = store.groupByItem();
               const entered = store.enteredGroupId();
               const s = store.schema();
               const diagrams = new Set(diagramIds);
               const lockedDiagram = (id: string | undefined): boolean => {
                  const gid = id ? byItem.get(id) : undefined;
                  return !!id && !!gid && gid !== entered;
               };
               const looseMessages = messageIds.filter((id) => {
                  const d = s?.sequenceMessages.find((m) => m.id === id)?.diagramId;
                  if (!lockedDiagram(d)) return true;
                  diagrams.add(d!);
                  return false;
               });
               const looseLifelines = lifelineIds.filter((id) => {
                  const d = s?.lifelines.find((l) => l.id === id)?.diagramId;
                  if (!lockedDiagram(d)) return true;
                  diagrams.add(d!);
                  return false;
               });
               const r = resolveGroups({ tableIds, elementIds, diagramIds: [...diagrams] });
               patchState(store, {
                  selectedTableIds: r.sel.tableIds,
                  selectedRelationshipIds: relationshipIds,
                  selectedElementIds: r.sel.elementIds,
                  selectedMessageIds: looseMessages,
                  selectedLifelineIds: looseLifelines,
                  selectedDiagramIds: r.sel.diagramIds,
                  enteredGroupId: r.entered,
               });
            },

            clearSelection(): void {
               patchState(store, {
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
                  enteredGroupId: null,
               });
            },

            // ================= Groups =================

            /** The live group an item belongs to (null when ungrouped). */
            groupIdOf(id: string): string | null {
               return store.groupByItem().get(id) ?? null;
            },

            /**
             * Step into an item's group: select just that item, leaving its siblings
             * individually selectable. No-op for an ungrouped item.
             */
            enterGroup(kind: GroupItemKind, id: string): void {
               const gid = store.groupByItem().get(id);
               if (!gid) return;
               patchState(store, {
                  selectedTableIds: kind === 'table' ? [id] : [],
                  selectedElementIds: kind === 'element' ? [id] : [],
                  selectedDiagramIds: kind === 'diagram' ? [id] : [],
                  selectedRelationshipIds: [],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  enteredGroupId: gid,
               });
            },

            /** Group the selected tables, elements and diagrams (existing groups merge in). */
            async groupSelection(): Promise<void> {
               const items = selectedItems();
               const byItem = store.groupByItem();
               const units = new Set(items.map((i) => byItem.get(i.id) ?? i.id));
               if (units.size < 2) return;
               const groupId = crypto.randomUUID();
               const before = items.map((i) => ({ ...i, groupId: rawGroupId(i.kind, i.id) }));
               const after = items.map((i) => ({ ...i, groupId }));
               patchState(store, { enteredGroupId: null });
               await setGroups(before, after);
            },

            /** Dissolve every group the selection touches; the items stay selected. */
            async ungroupSelection(): Promise<void> {
               const byItem = store.groupByItem();
               const groups = store.groups();
               const gids = new Set<string>();
               for (const i of selectedItems()) {
                  const g = byItem.get(i.id);
                  if (g) gids.add(g);
               }
               if (!gids.size) return;
               const members: { kind: GroupItemKind; id: string }[] = [];
               for (const gid of gids) {
                  const m = groups.get(gid);
                  if (!m) continue;
                  m.tableIds.forEach((id) => members.push({ kind: 'table', id }));
                  m.elementIds.forEach((id) => members.push({ kind: 'element', id }));
                  m.diagramIds.forEach((id) => members.push({ kind: 'diagram', id }));
               }
               const before = members.map((i) => ({ ...i, groupId: rawGroupId(i.kind, i.id) }));
               const after = members.map((i) => ({ ...i, groupId: null }));
               patchState(store, { enteredGroupId: null });
               await setGroups(before, after);
            },

            // ================= Sequence diagrams =================

            /** Select one sequence diagram (its bounding box, or its whole group). */
            selectSequence(diagramId: string): void {
               applySelection({ tableIds: [], elementIds: [], diagramIds: [diagramId] });
            },

            /** Add/remove a diagram (or its whole group) from the multi-selection. */
            toggleSequence(diagramId: string): void {
               patchState(store, { selectedRelationshipIds: [] });
               toggleItem('diagram', diagramId);
            },

            selectLifeline(lifelineId: string): void {
               patchState(store, {
                  selectedLifelineIds: [lifelineId],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  enteredGroupId: enteredFor(store.schema()?.lifelines.find((l) => l.id === lifelineId)?.diagramId),
               });
            },

            selectMessage(messageId: string): void {
               patchState(store, {
                  selectedMessageIds: [messageId],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  enteredGroupId: enteredFor(
                     store.schema()?.sequenceMessages.find((m) => m.id === messageId)?.diagramId
                  ),
               });
            },

            /** Add/remove one message from the message selection (shift/ctrl-click). */
            toggleMessage(messageId: string): void {
               const current = store.selectedMessageIds();
               patchState(store, {
                  selectedMessageIds: current.includes(messageId)
                     ? current.filter((id) => id !== messageId)
                     : [...current, messageId],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  enteredGroupId: enteredFor(
                     store.schema()?.sequenceMessages.find((m) => m.id === messageId)?.diagramId
                  ),
               });
            },

            /** Ask the canvas to open a message's inline label editor (toolbar pencil). */
            requestMessageEdit(messageId: string): void {
               patchState(store, { pendingMessageEditId: messageId });
            },
            clearMessageEditRequest(): void {
               patchState(store, { pendingMessageEditId: null });
            },

            /** Ask the canvas to open a lifeline's inline label editor (toolbar pencil). */
            requestLifelineEdit(lifelineId: string): void {
               patchState(store, { pendingLifelineEditId: lifelineId });
            },
            clearLifelineEditRequest(): void {
               patchState(store, { pendingLifelineEditId: null });
            },
         };
      })
   );
}
