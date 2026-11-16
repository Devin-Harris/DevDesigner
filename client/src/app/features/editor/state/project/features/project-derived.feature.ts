import { computed } from '@angular/core';
import { signalStoreFeature, type, withComputed } from '@ngrx/signals';
import { resolveThemedElements, type SchemaModel } from '@devdesigner/shared';
import { sameItems, sameMap, sameSet } from '../../../../../shared/helpers/equality';
import type { GroupMembers, ProjectState } from '../models/project-state.model';

/** Index a schema's groups; a group needs two or more members to count. */
function buildGroups(s: SchemaModel | null): ReadonlyMap<string, GroupMembers> {
   const all = new Map<string, GroupMembers>();
   const add = (gid: string | undefined, key: keyof GroupMembers, id: string): void => {
      if (!gid) return;
      let g = all.get(gid);
      if (!g) {
         g = { tableIds: [], elementIds: [], diagramIds: [] };
         all.set(gid, g);
      }
      g[key].push(id);
   };
   for (const t of s?.tables ?? []) add(t.groupId, 'tableIds', t.id);
   for (const e of s?.elements ?? []) add(e.groupId, 'elementIds', e.id);
   for (const d of s?.sequenceDiagrams ?? []) add(d.groupId, 'diagramIds', d.id);
   for (const [gid, g] of all) {
      if (g.tableIds.length + g.elementIds.length + g.diagramIds.length < 2) all.delete(gid);
   }
   return all;
}

const sameMembers = (a: GroupMembers, b: GroupMembers): boolean =>
   sameItems(a.tableIds, b.tableIds) && sameItems(a.elementIds, b.elementIds) && sameItems(a.diagramIds, b.diagramIds);

/** Schema collections, the single-selection lookups, groups and permission/undo flags. */
export function withProjectDerived() {
   return signalStoreFeature(
      { state: type<ProjectState>() },
      withComputed(
         ({
            schema,
            selectedTableIds,
            selectedRelationshipIds,
            selectedElementIds,
            selectedLifelineIds,
            selectedMessageIds,
            selectedDiagramIds,
            accessMode,
            undoDepth,
            redoDepth,
         }) => {
            /** Live groups (two or more members) and each member's group, built in one pass. */
            const groupIndex = computed(
               () => {
                  const groups = buildGroups(schema());
                  const byItem = new Map<string, string>();
                  for (const [gid, g] of groups) {
                     [...g.tableIds, ...g.elementIds, ...g.diagramIds].forEach((id) => byItem.set(id, gid));
                  }
                  return { groups, byItem: byItem as ReadonlyMap<string, string> };
               },
               { equal: (a, b) => sameMap(a.groups, b.groups, sameMembers) }
            );
            return {
               tables: computed(() => schema()?.tables ?? []),
               relationships: computed(() => schema()?.relationships ?? []),
               /**
                * Column ids that participate in any relationship. A non-PK column in this
                * set is a foreign key (the table node shows it a link glyph); a PK in it is
                * still shown as a key. Kept as a Set for O(1) per-row lookup.
                */
               foreignKeyColumnIds: computed(
                  () => {
                     const ids = new Set<string>();
                     for (const r of schema()?.relationships ?? []) {
                        ids.add(r.sourceColumnId);
                        ids.add(r.targetColumnId);
                     }
                     return ids as ReadonlySet<string>;
                  },
                  { equal: sameSet }
               ),
               elements: computed(() => schema()?.elements ?? []),
               /** Elements with theme tokens (`$accent1`, `$heading`) resolved per presentation: what renderers draw. */
               themedElements: computed(() => resolveThemedElements(schema()?.elements ?? [])),
               /** Selected table ids as a Set, for per-row `has` checks in templates (C3.10). */
               selectedTableIdSet: computed(() => new Set(selectedTableIds()) as ReadonlySet<string>, {
                  equal: sameSet,
               }),
               selectedTable: computed(() => {
                  const ids = selectedTableIds();
                  return ids.length === 1 ? (schema()?.tables.find((t) => t.id === ids[0]) ?? null) : null;
               }),
               selectedRelationship: computed(() => {
                  const ids = selectedRelationshipIds();
                  return ids.length === 1 ? (schema()?.relationships.find((r) => r.id === ids[0]) ?? null) : null;
               }),
               /** The single selected element (only when exactly one is selected), for the inspector. */
               selectedElement: computed(() => {
                  const ids = selectedElementIds();
                  return ids.length === 1 ? (schema()?.elements.find((e) => e.id === ids[0]) ?? null) : null;
               }),
               // ---- Sequence diagrams ----
               sequenceDiagrams: computed(() => schema()?.sequenceDiagrams ?? []),
               lifelines: computed(() => schema()?.lifelines ?? []),
               sequenceMessages: computed(() => schema()?.sequenceMessages ?? []),
               selectedLifeline: computed(() => {
                  const ids = selectedLifelineIds();
                  return ids.length === 1 ? (schema()?.lifelines.find((l) => l.id === ids[0]) ?? null) : null;
               }),
               selectedMessage: computed(() => {
                  const ids = selectedMessageIds();
                  return ids.length === 1 ? (schema()?.sequenceMessages.find((m) => m.id === ids[0]) ?? null) : null;
               }),
               /** The selected diagram (its bounding box), for the inspector. */
               selectedDiagram: computed(() => {
                  const ids = selectedDiagramIds();
                  const id = ids.length === 1 ? ids[0] : null;
                  return id ? (schema()?.sequenceDiagrams.find((d) => d.id === id) ?? null) : null;
               }),
               /** The single selected diagram id (null when none or several are selected). */
               selectedDiagramId: computed(() => (selectedDiagramIds().length === 1 ? selectedDiagramIds()[0] : null)),
               /** True when any sequence diagram's box is selected. */
               sequenceSelected: computed(() => selectedDiagramIds().length > 0),
               /** Live groups (two or more members) keyed by group id. */
               groups: computed(() => groupIndex().groups),
               /** Item id (table / element / diagram) -> the live group it belongs to. */
               groupByItem: computed(() => groupIndex().byItem),
               canEdit: computed(() => accessMode() !== 'VIEW'),
               canUndo: computed(() => undoDepth() > 0),
               canRedo: computed(() => redoDepth() > 0),
            };
         }
      )
   );
}
