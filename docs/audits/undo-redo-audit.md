# Undo/redo audit

Client undo/redo lives in `ProjectStore` (`state/project/features/project-history.feature.ts`).
An entry reuses the raw store methods, so applying an undo is itself persisted and broadcast.
`batchHistory(async fn)` and the new `batchHistorySync(fn)` turn everything recorded inside
into one step. Deleted rows are re-created under their own id or aliased via `_history.rid()`.

Status: OK = records a correct, batched entry. FIXED = fixed in this pass. GAP = still open.

## Elements (shapes, text, code, grid, image, embed, lines/arrows, pen)

| Path | Status | Notes |
| --- | --- | --- |
| Create (draw, paste, drop, duplicate) | OK | `addElement` / clone methods record a create entry |
| Delete (single + multi-select, frame contents) | OK | `deleteSelection` runs inside `batchHistory` |
| Move (single + multi-select drag) | OK | `recordElementMove` / `commitElementGeometry` in `batchHistory` |
| Resize / rotate / endpoint / bend | OK | gesture snapshot + `commitElementGeometry` |
| Group resize / group move incl. sequence diagrams | OK | `group-transform.service` `batchHistory` |
| Floating toolbar style edit, one element | OK | `updateElement` |
| Floating toolbar style edit, multi-select (stroke, fill, font, size, wrap, underline, list, code) | FIXED | was one undo step per element; now `batched()` -> `batchHistory` |
| Inline text / shape-label / code edit (typing) | FIXED | live edits use `patchElementLocal`, so `updateElement` at commit captured "before" == after and undo did nothing. Now `commitElementEdit(id, snapshotAtEditStart, patch)` |
| Per-run styling while editing (e.g. text color/stroke inside a shape label) | FIXED | same cause and fix as above: recorded at commit as one step |
| Emptied text deleted on commit | GAP (minor) | undo restores the emptied element, not the pre-edit text |
| Layer order (Ctrl+[ ]) | OK | `reorderElements` records the previous order |
| Group / ungroup | OK | `setGroups(before, after)` |

## ERD

| Path | Status | Notes |
| --- | --- | --- |
| Table create / delete / move / rename / color | OK | `*Raw` twins, same-id restore |
| Column add / update / delete / reorder | OK | |
| Index add / update / delete | OK | |
| Relationship create / update / delete / waypoints | OK | |
| Table scale (`updateTableSilently` in table-node) | OK | the gesture records its own entry |
| Tables moved as companions of a sequence-diagram drag | FIXED | moved and persisted but never recorded; now `recordItemMoves` (tables, elements and routes) |

## Sequence diagrams

| Path | Status | Notes |
| --- | --- | --- |
| Create / duplicate / delete diagram | OK | `recordSeqCreate` / `recordSeqDelete` |
| Move ONE diagram | OK | |
| Move SEVERAL selected diagrams at once | FIXED | each diagram (and the companion elements) pushed its own entry, so Ctrl+Z reverted only the last. The gesture end now runs in `batchHistorySync` |
| Resize / Ctrl-scale / row gap | OK | `recordSequenceLayout` |
| Layout undo after the diagram was deleted and restored | FIXED | `recordSequenceLayout` now resolves ids through `rid()` |
| Participant move / width / rename / color | OK | |
| Message add / move / restyle / delete / reorder | OK | |
| Space evenly / fit to content | OK | one `recordSequenceLayout` step |
| Config (title, colors, spacing) | OK | `updateSequenceConfig` with record=true |

## Frames / slides

| Path | Status | Notes |
| --- | --- | --- |
| Frame create / move / resize / delete | OK | frames are elements |
| Slide layout sync, placeholders, stacking (`*Silently` in slides services) | GAP (by design?) | derived bookkeeping writes skip history. A user action that triggers them can undo to an inconsistent layout. Needs a check by the slides-panel owner |
| Slide zoom / pan | n/a | view state, not undoable |

## Remaining gaps / follow-ups

- `canvas-dblclick.service` deletes stand-in placeholders with `deleteElementSilently`. The paired create is recorded, but the delete is not.
- Undo is a single, project-wide stack per session. Remote edits are not reconciled, so undoing over a collaborator's newer change overwrites it.
- `batchHistory` collects everything pushed while its promise is pending, including unrelated concurrent edits.
