# 02 - Performance audit (client + server)

Date: 2026-11-09 · Scope: `client/` (Angular 22, zoneless, NgRx Signal Store), `server/` (NestJS + TypeORM + better-sqlite3), `shared/`, `mcp/` · Code at commit `7d5fe3d`.

---

## 1. Summary

The app already has several good basics: zoneless change detection, `OnPush` on every component (51/51), `track id` on all outer `@for`s, an atomic `PATCH /projects/:id/batch` write path that merges edits, staged and optimistic element writes, WAL plus tuned SQLite pragmas, `projectId` indexes on every child table, a graph load with a fixed number of queries (no N+1), gzip, and lazy-loaded prettier and sql-formatter. Most of the remaining cost comes from a few root causes.

**Biggest UI wins**

1. **The viewport lives inside `schema`** (`project.store.ts:532`, `:3046`). Every pan or zoom frame replaces the whole schema object, so every schema-derived `computed` re-runs. Several of them (`slideFrames`, `masterItemIds`, `layoutItemIds`, `themedElements`, `groups`/`groupByItem`) return fresh arrays and Sets, so the editor's `shapeViews` runs the full `buildShapeViews` again on **every pan frame**. That rebuild re-wraps all text, re-tokenizes all code, re-parses all grid JSON and re-routes bound arrows with A*. Moving the viewport into its own state slot is an S-sized fix with the largest perceived-speed gain.
2. **`buildShapeViews` has no memoization** (`shape-render.helper.ts:1380`). Typing one character, or dragging one shape, rebuilds the view of every element. A per-element cache keyed by object identity turns that into O(changed).
3. **Relationship routing re-runs when any element changes** (`editor.component.ts:935`), because it reads `store.elements()` just to get frame boxes.
4. **Multi-select drags cost O(K·N) per frame**: K separate `mapElement` → `patchState` calls (`editor.component.ts:3964-4003`, `project.store.ts:3800`).
5. **`@HostListener('window:pointermove')` runs editor change detection on every mouse move**, even when idle, and calls `getBoundingClientRect` each time (`editor.component.ts:5685`, `:2513`).
6. **Creates wait on the server**: tables, columns, relationships, home and themes (`project.store.ts:2803`, `:2940`, `:3061`, `:1975`).

**Biggest server-load wins**

1. **The graph ETag uses one process-wide write counter** (`common/write-revision.ts`). Any write anywhere, including a viewport pan, invalidates every client's and every MCP agent's cached graph, so the 304 path almost never hits. Switch to a per-project revision.
2. **The client PATCHes the viewport after every pan/zoom settles** (500 ms debounce). Each one is a DB write, a revision bump and a project `updatedAt` bump, and view-only guests get a 403 every time ("Save failed").
3. **Cursors are sent about 25 times a second (laser about 30) even when the user is alone in the room**, and every mutation broadcast is echoed back to the tab that made it (`realtime.gateway.ts:190`).
4. **Opening the Projects dialog downloads the full graph of every listed project**, plus every image as base64, and rebuilds the SVG thumbnails on each open (`project-thumbnail.service.ts:97`).
5. **Every request re-resolves access from the DB**: 2-4 queries per write (`access.service.ts`).
6. **Batch broadcasts and responses carry whole entities** for x/y moves. Moved tables are even reloaded with their columns and indexes (`batch.service.ts:249-275`), and the client ignores the response.
7. **Media (up to 40 MB of video) is stored as SQLite BLOBs** and read through a synchronous driver (it blocks the event loop), uploaded as base64 JSON, with no Range support. The global JSON body limit is 200 MB.

**Bundle**: the initial `main` chunk is **777 kB raw / 188 kB gzip**. It holds Material+CDK (230 kB), the CommonJS `@devdesigner/shared` (96 kB, which cannot be tree-shaken), the whole `ProjectStore` (64 kB) and the canvas/export helpers, all pulled in by `AppComponent`. The `/` home page also loads the 916 kB editor chunk because it mounts the real editor.

---

## 2. Method

- Read the code of the hot paths: the store write layer (`stage`/`flushBatch`/`commitPatch`/`optimistic`), the editor pointer handlers and computed graph, `buildShapeViews`/`computeConnectors`, the slides panel effects, the thumbnail services, the realtime client and gateway, and the server services (projects, batch, access, elements, images, realtime) plus the entities. Background notes in `memory/*.md` were checked against the code. Two notes are out of date: optimistic-saves.md says moves use a 500 ms per-row debounce, but they now go through the 400 ms staged batch; drawing-elements.md says there are no migrations, but `server/migrations/` now holds 34.
- Counted the calls per gesture by tracing handlers. For example, a pan pointermove runs `setViewport` → `patchState(schema)` → invalidation fan-out (traced in section 4, C1).
- Ran `ng build --stats-json` into the scratchpad (about 15 s, nothing written to the repo) and attributed chunk bytes per input module.
- No dev servers were started and no profiler traces were taken. The impact ratings are reasoned estimates; the first step of Phase 0 is to confirm them with a Chrome performance trace.

---

## 3. Findings table

Impact means effect on perceived UX (client) or on server load (server). Effort: S < ½ day, M = 1–3 days, L > 3 days.

### Client

| ID | Finding | Impact | Effort | Primary files |
|---|---|---|---|---|
| C1 | Viewport is stored inside `schema`; every pan/zoom frame invalidates every schema-derived computed, including `shapeViews` | **High** | S | `stores/project.store.ts:532,3046`; `editor.component.ts:5741,9335` |
| C2 | Viewport PATCHed to the server after every pan/zoom settles (also for VIEW guests → 403 → "Save failed") | **High** (server) / Med (UX) | S | `project.store.ts:3046-3059`; server `projects.service.ts:146` |
| C3 | `buildShapeViews` not memoized: per-element text wrap/`measureText`, `tokenizeCode`, `parseGrid`, A* bound-arrow routing on every rebuild | **High** | M | `canvas/helpers/shape-render.helper.ts:259,637,1141,1369,1380`; `editor.component.ts:1244` |
| C4 | Store computeds return fresh Sets/arrays with no `equal` (masterItemIds, layoutItemIds, slideFrames, hiddenBySlides, groups ×2) → downstream cascades | High | S | `project.store.ts:365-590` |
| C5 | `connectors` (A* for all relationships) depends on `store.elements()` just for frame boxes | High (ERD-heavy) | S | `editor.component.ts:935-946` |
| C6 | Multi-item drag: K separate `moveElement`/`moveTable` → K full-array maps + K `patchState` per frame | Med-High | S | `editor.component.ts:3964-4003`; `project.store.ts:694,2824,3800` |
| C7 | `window:pointermove` HostListener runs editor CD on every mouse move (zoneless listener marks dirty) + `getBoundingClientRect` per move via `toWorld` | Med-High | M | `editor.component.ts:5685,2513` |
| C8 | `getComputedStyle` inside the `shapeViews` computed (`themeColors()`) forces style recalc on every rebuild | Med | S | `editor.component.ts:1316-1327` |
| C9 | No viewport culling: every element/table/connector is in the DOM and re-bound on every rebuild | Med (large canvases) | M | `canvas-shapes.component.ts:67`; `editor.component.html:27,168` |
| C10 | Cursor (25 Hz), laser (30 Hz) and selection emitted even when alone in the room | Med (server) | S | `editor.component.ts:2499,2671,2332`; `core/services/realtime.service.ts:156` |
| C11 | Slides panel: two instances per deck (`list` + `settings`) plus focus-mode instances, each running the thumbnail effect and the `watchLayouts`/`checkLayouts` saver → duplicate work and possibly duplicate `PUT /themes` + `POST /me/themes` | Med | M | `slides/slides-panel.component.ts:3213,3815,3849,3520`; `editor.component.html:372,387,456,467` |
| C12 | Thumbnail rendering re-encodes **every image in the project** to base64 on each refresh (no data-URL cache, not limited to dirty slides) | Med-High (image-heavy decks) | S | `slides/slide-render.service.ts:143,417`; `core/services/element-images.service.ts:84-103,253` |
| C13 | Projects dialog builds thumbnails by GETting each project's **full graph** plus all its images, rebuilt on every open | **High** (server) / Med (UX) | M | `workspace/projects-overlay/project-thumbnail.service.ts:55-131` |
| C14 | Table/column/relationship creates, `setHome` and `setCustomThemes` await the server round trip | Med-High (UX, deployed) | M | `project.store.ts:2803,2940,3061,1975,1985` |
| C15 | Element reorder sends the whole project's id list; the server issues N un-transacted UPDATEs | Med | S | `project.store.ts:3833-3858`; server `elements.service.ts:184` |
| C16 | Batch response (full models) is downloaded and ignored | Low-Med | S | `project.store.ts:1276-1300` |
| C17 | Bundle: initial 777 kB raw (Material/CDK 230 kB, CJS shared 96 kB, ProjectStore 64 kB, canvas/export helpers about 60 kB); `/` loads the 916 kB editor chunk; slides code 315 kB is eager in the editor chunk | Med (first load) | M-L | `app.component.ts:1-33`; `workspace.component.ts:5-6`; `shared/package.json` (CJS); `angular.json:32` |
| C18 | `groups` and `groupByItem` each call `buildGroups(schema())` (double work) | Low | S | `project.store.ts:582-590` |
| C19 | Minimap redraw calls `getComputedStyle` every draw (per pan frame) | Low | S | `minimap/minimap.component.ts:225` |

### Server

| ID | Finding | Impact | Effort | Primary files |
|---|---|---|---|---|
| S1 | Graph ETag is one process-wide write counter → near-zero 304 hit rate with >1 active user or any MCP agent; the shared-link graph route has no ETag at all | **High** | S | `common/write-revision.ts`; `projects/projects.controller.ts:128`; `sharing/sharing.controller.ts:53` |
| S2 | Access is resolved from the DB on every request (project row + share link; child writes add ancestry lookups: column → table → project) | Med-High | M | `access/access.service.ts:48-236` |
| S3 | Batch: move-only patches reload tables with columns+indexes and broadcast/return **full** table and element models (text, runs, slide JSON, grid JSON); `repo.save()` re-selects rows already loaded | **High** (bandwidth/CPU under collab) | M | `batch/batch.service.ts:152-158,186-275` |
| S4 | Mutation broadcasts go to the whole room including the origin tab (which discards them) | Med | S | `realtime/realtime.gateway.ts:190-199` |
| S5 | Media up to 40 MB stored as SQLite BLOBs; synchronous driver blocks the event loop on read; base64-in-JSON uploads; no Range/streaming; 200 MB JSON body limit on **every** route | Med-High | L (storage) / S (limits) | `images/images.service.ts:55-69`; `images/images.controller.ts:24`; `main.ts:15`; `shared/src/enums/index.ts:193` |
| S6 | `getGraph` reads the project row twice (access check + `findOrThrow`) | Low | S | `projects/projects.service.ts:113-114` |
| S7 | Tables load uses a single JOIN of columns × indexes (row explosion per table) | Low-Med | S | `tables/tables.service.ts:33-40` |
| S8 | No serialized-graph cache: every 200 rebuilds models, `JSON.stringify` and gzip (thumbnails, MCP, reconnects, shared links) | Med | M | `projects/projects.service.ts:107-140` |
| S9 | Element reorder: N UPDATEs via `Promise.all`, not in one transaction, all rows even when unchanged | Med | S | `elements/elements.service.ts:184-201` |
| S10 | `projects.ownerId` unindexed (list query scans); `updatedAt` bumped by viewport writes but not by child edits | Low | S | `projects/project.entity.ts:26,82`; `projects.service.ts:72` |
| S11 | MCP: about 110 full-graph fetch sites, sequential per-item POST/PATCH/DELETE loops; its ETag cache (`mcp/src/api.ts:48`) is defeated by S1 | Med | M | `mcp/src/agent-tools.ts:142-143,893,944`; `design-tools.ts:233,402`; `tools.ts:1088` |
| S12 | SQL export loads the full graph (elements, sequences) though it only needs tables + relationships | Low | S | `export/export.service.ts` |
| S13 | Presence relays (cursor/laser) have no server-side rate cap; socket.io `perMessageDeflate` is off, so large mutation frames go uncompressed | Low | S | `realtime/realtime.gateway.ts:141-170` |

---

## 4. Detailed findings

### Client: network chattiness

**C2 - Viewport persistence.** `setViewport` (store `:3046`) writes the schema locally and debounces `PATCH /projects/:id/viewport` by 500 ms. Panning, wheel-zooming, `animateViewport`, focus-mode `fitFocus` (`editor.component.ts:6727`), and the home-view jump (`:2303`) each produce a write once motion stops. Server side (`projects.service.ts:146`), every one of these writes:

- runs `assertCanWrite`, which fails with 403 for VIEW share links. `runSave` then sets `saveStatus='error'`, so view-only guests see "Save failed" after panning.
- runs an UPDATE, which bumps `projects.updatedAt` (so panning reorders the Projects list).
- bumps the global ETag revision (see S1), invalidating every cached graph on the server.

It is also shared state: EDIT guests overwrite the owner's saved view, even though sharing-realtime.md says viewport is intentionally per-participant.
**Fix:** store the viewport client-side per project (`localStorage['dd.viewport.'+projectId]`, written with a trailing 1 s debounce plus `pagehide`) and drop the server write. If cross-device restore matters, send it only for `accessMode==='OWNER'`, with a ≥2 s debounce, and exclude it from revision bumps. Effort S.

**C10 - Presence emits.** `broadcastCursor` (`editor.component.ts:2499`) throttles to 40 ms but only checks `realtime.connected()`. Every open editor tab streams about 25 msgs/s while the mouse moves, even with nobody else in the room. Laser does the same at 33 ms (`:2671`). The selection effect (`:2332`) emits on every selection change. **Fix:** gate all three on `realtime.participants().length > 1` (a `hasPeers` computed in `RealtimeService`). Send a fresh cursor/selection when the roster grows. Cursor sends could also skip when the mouse moved less than about 2 world px. Effort S.

**C13 - Projects dialog thumbnails.** `ProjectThumbnailService.build` (`:97`) calls `GET /projects/:id` (the full graph) for each visible card, 3 at a time. It then downloads every image (`imageData`, `:149`) and converts them to base64, and runs `buildDiagramSvg` on the main thread. `invalidate()` on each dialog open rebuilds all of them. With S1 most of those GETs are full 200s. A user with 30 projects therefore pulls 30 graphs plus all their images on each open. **Fix (layered):**
- (a) Once S1 lands, key cache entries by the per-project revision and expose it on `ProjectSummary` (`revision`/`contentUpdatedAt`). Rebuild only cards whose revision changed, and persist the SVGs in IndexedDB.
- (b) Add a lean `GET /projects/:id/preview` that returns only boxes/colors (no text bodies, runs or slide JSON), or a server-rendered cached thumbnail regenerated a few seconds after edits go idle.
- (c) Downscale images for thumbnails (a cached 256 px bitmap per fileId).

Effort M.

**C14 - Awaiting creates.** `addTable` (`project.store.ts:2803`), `addColumn` (`:2940`), `addRelationship` (`:3061`), sequence creates/duplicates, `setHome` (`:1985`) and `setCustomThemes` (`:1975`) await the round trip before the UI updates (optimistic-saves.md lists these as "still awaiting"). In the deployed environment that is one RTT of lag per click. **Fix:** do what elements already do. Client generates UUIDs, the server accepts an optional `id` and returns 409 on collision (as `CreateElementDto.id` does), and the store inserts locally then `enqueue`s with a `failedCreates` rollback. Columns would be created with a client id and `orderIndex`. Effort M (server DTOs for tables/columns/relationships/lifelines/messages need `id?`).

**C15 - Reorder.** `reorderElements` sends `orderedElementIds` for the whole project (Ctrl+[ ] on one shape sends every id). The server updates every row with `Promise.all` and no transaction (`elements.service.ts:184`), i.e. N autocommits. **Fix:** server side, update only rows whose `zIndex` changed, inside one transaction (`CASE` UPDATE or a loop inside `dataSource.transaction`). Client side, send only the moved ids plus their new zIndex through the batch endpoint (`elements: [{id, zIndex}]` is already allowed by `UpdateElementDto`, as the editor's layer moves show). Effort S.

**C16 - Batch response.** `flushBatch` (`project.store.ts:1276`) ignores the `BatchUpdateResponse`, which carries every touched row in full. **Fix:** add `?return=none` (or make it the default for the client) so the server returns `{ok:true}`. See S3 for the broadcast side. Effort S.

**What is already good:** element, table, diagram, lifeline, message and relationship edits are staged and flushed as one batch after 400 ms idle (`stage`/`flushBatch`, `:1266-1300`). Text, rich text, code and grid typing is local-only via `patchElementLocal` and committed at the end of the edit through `updateElement` → `stage`, so there are no per-keystroke HTTP calls. Deletes flush the batch first (`flushTimers`). Laser and cursor are throttled client-side. `applyRemoteBatch` collapses remote batches into one state write. Columns and indexes still use per-row `commitPatch` (300 ms); moving them into the batch section is a small follow-up.

### Client: rendering

**C1 - Viewport in schema (root cause of most pan jank).** `viewport: computed(() => schema()?.viewport)` (`:532`), and `setViewport` does `setSchema(s => ({...s, viewport}))`. On every pan pointermove (`editor.component.ts:5741-5745`) and every wheel tick (`applyZoom`, `:9335`), a new `schema` object causes:

- `slideFrames` (`:365`) to re-filter and re-sequence, returning a **new array**. `presentations`, `shownByPresentation` (new Map), `shownSlideIds` (new Set), `layoutsUnderShown` (new Set), `hiddenBySlides`, `presentationFrames` and `presentationLayoutFrames` all follow.
- `masterItemIds` and `layoutItemIds` (`:435-446`) to return **new Sets**. `shapeViews` reads both (`editor.component.ts:1251,1262`), so `buildShapeViews` runs in full on every frame.
- `themedElements` (`:464`) to map all elements again.
- `groups` and `groupByItem` to run `buildGroups` twice (C18).
- `foreignKeyColumnIds` to make a new Set, which re-renders table nodes that bind it.
- In the editor, `zoomedItems`, `slideViews`, `outerShapeViews`, `slideViewLayers`, `minimapItems` and others to cascade.

**Fix:** add a top-level `viewport` state slot (`withState({... viewport: DEFAULT_VIEWPORT})`). Have `load`/`loadShared` copy `graph.schema.viewport` into it, and have `setViewport` patch only that slot. Only `store.viewport()` is read anywhere (56 call sites, one accessor), plus the sandbox backend, so the change is mechanical. Do the same for `home` and `themes` (rarely changed, but they also churn `schema`). Effort S. Expected result: panning recomputes only `worldTransform`, `slideSets`, `remoteCursors`, `minimapView` and the overlays.

**C4 - Equality on derived collections.** Even after C1, any element edit produces new `slideFrames`, `masterItemIds`, `layoutItemIds` and `hiddenBySlides` objects although their contents rarely change. **Fix:** pass `equal` to these computeds: a shallow array equality by element reference for `slideFrames`, and set equality for the Sets. Fold `groupByItem` into `groups` (build once, return both). Effort S.

**C3 - Memoize `buildShapeViews`.** One call maps every element. For each element it runs `contrastSafe`/`fillOf`, wraps text with `measureWidth` (it sets `ctx.font` and calls `measureText` per word, `shape-render.helper.ts:259-266`), tokenizes code (`:637`), `JSON.parse`s grid text (`:1141`), runs perfect-freehand for pen strokes, and routes bound connectors with A* over all shapes (`:1369`, `:1520`). It is invoked from `shapeViews` (`editor.component.ts:1244`) on any element, table, selection, focus, editing-id, theme or message-box change, and also from `slide-render.service`, the thumbnails and the export. **Fix:**

- A module-level `WeakMap<CanvasElementModel, {key, view}>` cache. The key covers the selected flag, theme-guard colors, `diffEditingId === id`, and, for bound lines, the target boxes' coordinates. Return the cached `ShapeView` when the key matches, so `@for track s.id` sees the same object and Angular skips re-binding.
- Separately, cache `wrapParagraph` results by `(text, font, width)` with a small LRU, cache `tokenizeCode` by `(code, language)`, and cache `parseGrid` per text string.
- Route bound connectors only when an endpoint target's box changed.

Effort M. This also speeds up typing, because only the edited element is laid out.

**C5 - Connector routing fan-out.** `connectors = computed(() => computeConnectors(visibleTables(), relationships(), selected, store.elements().filter(frame).map(elementBox)))`. Typing in a text box or dragging a shape re-routes **every** relationship with A*. **Fix:** a `frameBoxes` computed with an array-of-boxes equality, used here. Optionally memoize per relationship by `(sBox, tBox, obstacle boxes hash, waypoints, sides)` so a table drag re-routes only its own relationships plus the ones whose obstacle region it crosses. Also drop the duplicate `buildColumnLocations` (`:933` and inside `computeConnectors`). Effort S (equality) / M (per-relationship memo).

**C6 - Bulk local moves.** `moveElements` calls `store.moveElement` per selected item, and `moveTable`, `setWaypoints` and `shiftSequence` the same way. Each call is `stage` + `mapElement` → `elements.map(...)` → `patchState`. With K selected items in N elements that is O(K·N) work and K signal writes per frame (and K checkpoints at the first frame). **Fix:** add `store.moveItemsLocal({elements: Map, tables: Map, waypoints: Map, sequences})` that builds one new schema (one pass per collection) and stages all rows with one debounce. Use it from `moveElements`, `moveNodeExtras`, the group drag and undo/redo of moves (`recordElementMove` uses `Promise.all` of single updates). Effort S.

**C7 - Pointer handling outside Angular's listener.** In zoneless Angular a `@HostListener`/template listener marks the view dirty and schedules a tick on every event. `window:pointermove` (`editor.component.ts:5685`) therefore runs CD for the editor template (933 lines) on every mouse move, even when idle. `toWorld` → `canvasRect()` calls `getBoundingClientRect` on each move, which forces a synchronous layout after the previous frame's DOM writes. **Fix:**

- Register `pointermove` with a plain `addEventListener` (via `afterNextRender` + `DestroyRef`) so idle moves cost nothing. The handlers already write signals, which schedule CD only when something changes.
- Coalesce to one update per `requestAnimationFrame` (keep the latest event; use `getCoalescedEvents()` only for the pen).
- Cache the canvas rect in the existing `ResizeObserver` effect (`:2321`) plus a `scroll`/`resize` listener, instead of reading it per move.

Effort M (the handler is about 130 lines with many modes; it is the main extraction target of the planned editor split).

**C8.** `themeColors()` calls `getComputedStyle` inside the `shapeViews` computed. **Fix:** a `themeColors` signal recomputed in an effect on `theme.dark()` (and on deck theme change). Same for `defaultStroke`/`themeVar` (`:2685-2701`) and the minimap (C19). Effort S.

**C9 - Culling.** `canvas-shapes` renders every shape in the layer and the editor renders every table and connector. **Fix:** after C1/C3, filter `outerShapeViews`, `outerTables` and `displayConnectors` by the visible world rect plus a margin. Only do this when the item count is above a threshold (for example 300), so small diagrams keep identical DOM, and never cull selected or editing items. Effort M (selection outlines, minimap, export and smart guides must keep using the unculled lists).

**C11 - Slides panel instances.** Each shown presentation mounts `<app-slides-panel part="list">` and `part="settings">` (`editor.component.html:372,387`); focus mode adds up to 6 more. Every instance runs:

- The thumbnail effect (`slides-panel.component.ts:3213`). Non-list parts render master + layout thumbnails on each change.
- The `watchLayouts` effect (`:3815`) → `checkLayouts` (`:3849`) 800 ms after any element change. Each instance keeps its own `layoutBaseline` and `applying` flag, so two instances can both detect the same layout edit and both call `saveRecords` (`:3520`): a duplicate `PUT /projects/:id/themes` (whole library) and `POST /me/themes`. In the built-in case they may create two "… custom" sets. This was not reproduced in a browser; verify it with a network trace before fixing.
- 42 computeds, plus `loadMyThemes` (cheap, since the service caches).

**Fix:** move layout-change detection and saving into a single injectable (`DeckLayoutSyncService`, keyed per deck) and run thumbnails only in parts that display them (`list`, `focus-list`, `design-layouts`), sharing one `thumbs` cache per deck. Effort M.

**C12 - Thumbnail images.** `SlideRenderService.render` calls `imageData(allElements)` (`:143`, `:417`), which runs `stillDataUrl` → `FileReader` base64 for **every image in the project** on each render, then embeds them via `encodeURIComponent` into a `data:` URL per slide (`dataUrl`, `:262`). With a few MB of images this is tens of MB of string work every 350 ms after an edit. **Fix:** cache data URLs per fileId in `ElementImagesService`, collect only the fileIds referenced by the dirty slides' content, and use a downscaled (for example ≤512 px) bitmap for thumbnails. Export keeps full resolution. Effort S.

### Client: bundle and loading

Build (prod, `ng build --stats-json`, 15 s):

| Chunk | Raw | Gzip (est.) | Main contents |
|---|---|---|---|
| `main` (initial) | 777 kB | 188 kB | @angular/material 125 kB, @angular/cdk 105 kB, **shared dist 96 kB (CJS)**, router 90 kB, editor canvas helpers 72 kB, `project.store.ts` 64 kB, app.component 34 kB, projects-overlay 33 kB, export helpers 28 kB, engine.io 23 kB |
| editor (lazy, via workspace) | 916 kB | 182 kB | slides/* 315 kB, editor.component 279 kB, cdk 70 kB, floating toolbar 62 kB, sequence 52 kB |
| angular core (lazy split) | 169 kB | 50 kB | |
| prettier typescript/babel/estree/html/postcss | 0.9 MB / 319 / 212 / 162 / 158 kB | | lazy (on format only), good |
| sql-formatter | 294 kB | 61 kB | lazy, good |
| more-json / presentations-json / slides-json | 58 / 51 / 13 kB | | lazy seeds, good |

Observations:

- `@devdesigner/shared` is CommonJS ("is not ESM" build warning), so it cannot be tree-shaken and lands whole in `main`. **Fix:** emit ESM (`"module": "ES2022"` plus an `exports` map with `import` → `dist/esm`) for the client, keeping CJS for server/mcp. Effort S-M.
- `AppComponent` statically imports `ProjectStore`, `RealtimeService` (socket.io), the auth/api-token dialogs, command palette, shortcuts sheet, toolbar-customize panel and projects overlay. These pull the store, shape-render and diagram-svg helpers into `main`. **Fix:** open dialogs with `await import()`; mount the command palette, shortcuts sheet and customize panel with `@defer (on interaction/idle)`; have `RealtimeService` connect lazily (it is only needed in the editor). Effort M.
- `WorkspaceComponent` imports both `EditorComponent` and `HomeComponent`, so `/` downloads the editor chunk for the landing page. That is needed for the showcase, but the editor can be `@defer (on viewport; prefetch on idle)` inside the home showcase. Present mode, deck compare, morph stage, animation pane and the PDF/export code can be `@defer`/dynamic-imported inside the editor (slides/* alone is 315 kB). Effort M.
- `angular.json` budgets: initial warn 1 MB / error 2 MB are loose for a 777 kB main. Tighten to about 600 kB warn after the fixes. `anyComponentStyle` warns on 7 files (home 28 kB, slides-panel 20 kB, editor 14 kB). Style-only, low impact.
- Fonts come from a Google Fonts `<link>` (drawing-elements.md). Add `preconnect` to fonts.gstatic and `display=swap` if missing (not verified).

### Server

**S1 - Per-project revision.** `WriteRevisionInterceptor` bumps a single global counter after any non-GET request, including failed ones, unrelated projects, `/auth`, `/me/themes`, viewport pans and MCP writes. So `If-None-Match` rarely matches. Both the browser (HttpClient goes through the HTTP cache, which revalidates `private, no-cache` + ETag) and the MCP client (`mcp/src/api.ts:48`) depend on this path. **Fix:**

- Keep a `Map<projectId, number>` (plus the boot id). Bump it from `RealtimePublisher.emit/emitMany` (every persisted schema change already flows through it) and from the project-row writes (`updateHome`, `updateThemes`, `update`). Do not bump it for viewport.
- Use `W/"p-${boot}-${projectId}-${rev}"`, and add the same handling to `GET /shared/:token`.
- Persisting `revision` as a column on `projects` (incremented in the same places) also gives the Projects list a real "content changed" signal for C13 and a correct `updatedAt` ordering (S10).

Effort S (in-memory) / M (column + migration).

**S2 - Access cache.** `resolveProjectAccess` reads `projects(id, ownerId)` and, for guests, `share_links` by token, on every REST call. Child writes add 1-2 ancestry reads (`projectIdForColumn` → `projectIdForTable`). A column PATCH is about 4 SELECTs before the UPDATE; batch and graph are 1-2. **Fix:** a small in-process LRU with a TTL (for example 30 s): `projectId → ownerId`, `token → {projectId, level, expiresAt, revokedAt}`, `tableId/elementId/... → projectId`. Child ids never change project, so those entries can be cached long-term and evicted on delete. Invalidate on share revoke/create, ownership transfer (`claimGuest`) and project delete, all of which live in this codebase. Effort M. The cache needs tests (security-sensitive); keep the TTL short so a missed invalidation stays bounded.

**S3 - Batch payloads.** For a drag of 20 shapes plus 3 tables, `BatchService.apply`:

- loads the rows,
- `save()`s them (TypeORM `save` re-selects by id before updating),
- reloads the 3 tables with `relations: {columns, indexes}`,
- maps everything to full models.

It then broadcasts them to the room (`emitMany`) **and** returns them to the client, which ignores them. Element models include `text`, `runs`, slide JSON, grid JSON and diff text, so the broadcast payload is often 100× the size of the x/y change. **Fix:**

- Add patch mutations to `SchemaMutation` (`element.patched {id, patch}`, `table.patched`, etc.) built from the validated DTOs. Teach `applyRemote` to merge them (`mapElement(id, e => ({...e, ...patch}))`), keeping the full-model kinds for creates and for patches that change derived server fields.
- Write with `m.update(Entity, {id, projectId}, columnsFromPatch)` instead of load+save where the patch maps 1:1 to columns.
- Return `{count}` unless the caller asks for models (MCP may want them).

Effort M; it touches `shared` (mutation types), `batch.service`, `project.store.applyRemote` and the MCP batch helper.

**S4 - Echo suppression.** The gateway emits to `roomOf(projectId)`, including the origin socket. It already stores `clientId` per socket (`SocketData.clientId`). **Fix:** keep `clientId → Set<socketId>`, and in `handleMutation(s)` emit with `this.server.to(room).except([...socketsOf(originClientId)])`. The client-side filter stays as a safety net. Effort S.

**S5 - Media.** Images are ≤5 MB and videos ≤40 MB (`shared/src/enums/index.ts:187-193`). They are uploaded as base64 JSON (+33 %, parsed into memory), stored as BLOBs, and `read()` loads the whole BLOB through better-sqlite3, which is synchronous and stalls every socket and request while it copies 40 MB. There is no Range support, so `<video>` cannot seek without the full download. Thumbnails/`stillDataUrl` download the whole video to get a poster. The good part: `Cache-Control: private, max-age=31536000, immutable` is set and SHA-256 dedup exists. **Fix:**

- (a) S: set the global JSON limit to about 2 MB and register a larger parser only on `POST /projects/:id/images` (~60 MB), `/projects/import` and `/import-content`.
- (b) L: move bytes to the filesystem or an object store (keyed by sha256) and keep metadata in SQLite. Serve with `res.sendFile`/stream + Range, accept multipart/raw uploads, and generate and store a poster frame at upload.
- (c) S: authorize `GET /images/:id` with a single join query (meta + project owner) instead of 3-4 queries.

**S6/S7/S12 - Query tidy-ups.**

- `getGraph` should take the project row from the access check (have `resolveProjectAccess` optionally return the row) instead of reading it again.
- Use `relationLoadStrategy: 'query'` (or load columns and indexes with two `IN (tableIds)` queries) to avoid the columns×indexes cartesian JOIN.
- SQL export should load only tables + relationships.

Effort S each.

**S8 - Graph cache.** Once S1 exists, cache `{rev, json, gzip}` per project in an LRU (bounded by bytes, for example 64 MB). A request with a matching rev serves the pre-compressed buffer, skipping the queries, mapping, `JSON.stringify` and compression. This helps thumbnails, MCP agents (which call `graph()` in nearly every tool), reconnects and shared links. Effort M.

**S9 - Reorder.** See C15. Wrap in `dataSource.transaction` and update only changed rows. Effort S.

**S10 - Projects list.** Add an index `(ownerId, archived, updatedAt)` via a migration, and stop the viewport from bumping `updatedAt` (C2), or bump `updatedAt`/`revision` from child writes (S1). Effort S.

**S11 - MCP chattiness.** The MCP server already has the right building blocks: an ETag cache, a `BatchBuilder` → `/batch`, and `import-content` for bulk creates. Remaining hotspots:

- Per-column loops: `agent-tools.ts:142-143` (delete/patch each column), `:893` (patch each column), `:944` (delete each column).
- Per-item element POST loops: `design-tools.ts:233` and `:402`.
- Per-table position PATCH: `tools.ts:1088`.
- A full graph fetch at the start of most tools (about 110 call sites).

**Fix:**

- (a) S1+S8 make the repeated graph fetches 304s.
- (b) Add `columns` and `indexes` sections and an `elements.create` section to `/batch` (or reuse `/clone`/`import-content`) so these loops become one request.
- (c) Within one tool call, reuse the graph returned by the first fetch instead of refetching after each sub-step where possible.

The API-token rate limiter (`api-token.service.ts:checkRate`) will otherwise throttle agents on large designs. Effort M.

**S13 - Socket hygiene.** Add a per-socket token bucket on `cursor`/`laser` (drop above about 40/s). Enable `perMessageDeflate: { threshold: 2048 }` on the gateway (mutation frames with text/runs compress well; cursor frames stay under the threshold). Effort S.

**Verified as fine (no action):**

- WAL, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-32000` and `temp_store=MEMORY` (`database/data-source.ts:19-26`).
- `@Index()` on every `projectId`/`tableId`/`diagramId` FK and on `sourceColumnId`/`targetColumnId`, and a unique index on share tokens and API-token hashes.
- The graph is about 9 queries regardless of size (no N+1).
- Import, clone and batch run in transactions.
- gzip is on with a 1 kB threshold, skipping raster images.
- Sessions are verified from the JWT with no DB hit.
- API-token `lastUsedAt` writes are throttled to once a minute.
- Image orphan pruning is rate-limited to every 10 min per project.

`DATABASE_SYNCHRONIZE` defaults to `'true'` in `database.module.ts`. That is not a runtime-performance issue, but production should run migrations only.

---

## 5. Phased plan

Each step is sized to be its own pass. The "Refactor" column says whether to do it **before** or **after** the planned frontend cleanliness/folder-structure refactor (which splits `editor.component.ts`, `project.store.ts` and `slides-panel.component.ts`) or the backend reorganization. ★ marks files those refactors will split or move.

### Phase 0 - Measure (½ day)
- P0.1 Record Chrome performance traces of (a) a 3 s pan on a 200-element deck, (b) dragging 10 selected shapes, (c) typing 30 characters in a text box, and (d) opening the Projects dialog with 20 projects. Log the request count per gesture from the Network panel. Save them to `docs/audits/perf-baseline/` and re-run after each phase.

### Phase 1 - Quick wins (each S; about 3-4 days total)

| Step | Change | Files | Refactor |
|---|---|---|---|
| 1.1 | Move `viewport` (and `home`, `themes`) out of `schema` into their own state slots (C1) | ★`client/src/app/stores/project.store.ts` (state, `load`, `loadShared`, `setViewport`, `setHome`, `setCustomThemes`, `viewport`/`home`/`customThemes` computeds), `core/sandbox/sandbox-backend.service.ts` | **Before**: tiny, mechanical, biggest win; it also simplifies the store split |
| 1.2 | Viewport saved locally per project; no server PATCH (or OWNER-only, ≥2 s) (C2) | ★`project.store.ts` (`setViewport`), `core/services/projects.service.ts` | Before (with 1.1) |
| 1.3 | `equal` functions on derived Sets/arrays; merge `groups`/`groupByItem` (C4, C18) | ★`project.store.ts` (withComputed block) | Before |
| 1.4 | `frameBoxes` computed with box-array equality, used by `connectors`; drop duplicate `buildColumnLocations` (C5) | ★`features/editor/editor.component.ts` (`:933-946`) | Before (3-line change) or with the canvas extraction |
| 1.5 | `themeColors` as a signal updated on theme change; same for minimap colors (C8, C19) | ★`editor.component.ts` (`:1316`, `:2685`), `features/editor/minimap/minimap.component.ts` | Before |
| 1.6 | Gate cursor/laser/selection emits on `hasPeers` (C10) | `core/services/realtime.service.ts`, ★`editor.component.ts` (`broadcastCursor`, `addLaserSample`, selection effect), `slides/present-mode.component.ts` | Before (service-level; editor touch is 3 lines) |
| 1.7 | Per-project revision ETag (in-memory first), ETag on `GET /shared/:token`, viewport excluded (S1) | `server/src/common/write-revision.ts`, `realtime/realtime.publisher.ts`, `projects/projects.controller.ts`, `projects/projects.service.ts`, `sharing/sharing.controller.ts` | Before backend reorg (small; the publisher is the natural hook) |
| 1.8 | Exclude origin sockets from mutation broadcasts (S4) | `server/src/realtime/realtime.gateway.ts` | Before backend reorg |
| 1.9 | Reorder: one transaction, changed rows only; client sends only moved ids (C15, S9) | `server/src/elements/elements.service.ts`, ★`project.store.ts` (`reorderElements`, `arrangeSelection`) | Server: before. Client: either |
| 1.10 | `getGraph` single project read; `relationLoadStrategy: 'query'` for tables; SQL export reads only tables + relationships (S6, S7, S12) | `server/src/projects/projects.service.ts`, `access/access.service.ts`, `tables/tables.service.ts`, `export/export.service.ts` | Before backend reorg |
| 1.11 | JSON body limit ~2 MB globally, larger only on image/import routes; single-query image auth (S5a, S5c) | `server/src/main.ts`, `images/images.controller.ts`, `images/images.service.ts`, `projects/projects.controller.ts` | Before |
| 1.12 | Data-URL cache per fileId; thumbnail renders collect only dirty slides' images (C12) | `core/services/element-images.service.ts`, `features/editor/slides/slide-render.service.ts` | Either (neither file is in the split list) |
| 1.13 | Batch: `?return=none` for the client (C16) | `server/src/batch/batch.controller.ts`, `batch.service.ts`, `core/services/projects.service.ts` | Before |
| 1.14 | Index `projects(ownerId, archived, updatedAt)` migration (S10) | `server/migrations/<new>-AddProjectOwnerIndex.ts`, `projects/project.entity.ts` | Either |

### Phase 2 - Rendering structure (about 1.5-2 weeks)

| Step | Change | Files | Refactor |
|---|---|---|---|
| 2.1 | Bulk local move API `moveItemsLocal` (one `setSchema` per frame) and use it in all drag paths and move undo/redo (C6) | ★`project.store.ts`, ★`editor.component.ts` (`moveElements`, `moveNodeExtras`, group drag, `recordElementMove`) | **Before** if the store split happens later than ~1 week out (small API); otherwise implement in the extracted "write layer"/"local mutations" file |
| 2.2 | Memoize `buildShapeViews` per element (WeakMap + key), LRU caches for text wrap, `tokenizeCode`, `parseGrid`; route bound arrows only on target change (C3) | `features/editor/canvas/helpers/shape-render.helper.ts`, `code-highlight.helper.ts`, `text-metrics.ts`, `shared/src/grid/index.ts` (parse cache) | **Independent** of the split (helpers are not split); can go first |
| 2.3 | Per-relationship route memo in `computeConnectors` (C5 part 2) | `canvas/helpers/connectors.helper.ts`, `routing.helper.ts` | Independent |
| 2.4 | Pointer pipeline: native `pointermove` listener + rAF coalescing + cached canvas rect (C7) | ★`editor.component.ts` (`onPointerMove`/`handlePointerMove`, `toWorld`, `canvasRect`) | **After** the editor split: this is the gesture/interaction code the refactor will extract into a pointer-gesture service; doing it first creates a large merge conflict |
| 2.5 | Viewport culling of shape/table/connector lists above an item threshold (C9) | ★`editor.component.ts` (`outerShapeViews`, `outerTables`, `outerConnectors`), `canvas-shapes/canvas-shapes.component.ts` | After the editor split (lands in the extracted canvas-view computeds) |
| 2.6 | Slides panel: a single `DeckLayoutSyncService` for layout-change saving; thumbnails only in displaying parts with a shared per-deck cache (C11) | ★`features/editor/slides/slides-panel.component.ts` (`:3213`, `:3815-3884`, `:3520`), new `slides/deck-layout-sync.service.ts`, `slides/slide-render.service.ts` | **After** the slides-panel split (the refactor will separate the list/settings/design parts; the sync service is a natural output of it). If duplicate `PUT /themes` is confirmed in P0, ship a minimal guard first (only `part==='settings'` runs `watchLayouts`) |

### Phase 3 - Write layer and server caching (about 2 weeks)

| Step | Change | Files | Refactor |
|---|---|---|---|
| 3.1 | Patch mutations (`element.patched`, `table.patched`, ...) in shared; batch builds them from DTOs and writes with `update()`; `applyRemote` merges (S3) | `shared/src/...` (mutation types), `server/src/batch/batch.service.ts`, ★`client/src/app/stores/project.store.ts` (`applyRemote`), `mcp/src/batch.ts` | Server side: before or with the backend reorg. Client side: **after** the store split (it lands in the extracted `applyRemote`/realtime-reducer file) |
| 3.2 | Optimistic creates for tables, columns, relationships, lifelines, messages (client UUIDs; server accepts `id`, returns 409), plus optimistic `setHome`/`setCustomThemes` (C14) | server `tables|columns|relationships|sequence/dto/create-*.dto.ts` + services; ★`project.store.ts` | Server DTOs: before. Store: **after** the store split (reuse `optimistic`/`enqueue` from the extracted write-queue module) |
| 3.3 | Access cache with invalidation hooks (S2) | `server/src/access/access.service.ts` (+ new `access-cache.ts`), `sharing/sharing.service.ts`, `projects/projects.service.ts` (`transferOwnership`, `remove`) | **After** the backend reorg if it moves access/sharing; otherwise before. Needs specs |
| 3.4 | Persisted `projects.revision` column + graph LRU with pre-gzipped bodies (S1 part 2, S8) | `server/src/projects/project.entity.ts`, migration, `projects.service.ts`, `projects.controller.ts`, `realtime/realtime.publisher.ts`, `shared` (`ProjectSummary.revision`) | After 1.7. Before/after backend reorg is neutral; put the cache in `common/` |
| 3.5 | Projects dialog thumbnails keyed by revision, persisted in IndexedDB; optional lean `/projects/:id/preview` (C13) | `features/workspace/projects-overlay/project-thumbnail.service.ts`, `projects-overlay.component.ts`, server `projects.controller.ts`/`projects.service.ts` | After 3.4 |
| 3.6 | Columns and indexes into the batch (sections) instead of per-row `commitPatch`; MCP column/element loops use them (S11) | `server/src/batch/batch.service.ts`, ★`project.store.ts` (`updateColumn`, `updateIndex`), `mcp/src/agent-tools.ts`, `design-tools.ts`, `tools.ts` | Server: either. Store: after the split |

### Phase 4 - Bundle and media (about 1-2 weeks, independent)

| Step | Change | Files | Refactor |
|---|---|---|---|
| 4.1 | Ship `shared` as ESM for the client (dual build) | `shared/package.json`, `shared/tsconfig*.json`, possibly `client/tsconfig.json` paths | Independent; coordinate with any `shared` folder moves |
| 4.2 | Slim `AppComponent`: dynamic-import dialogs; `@defer` palette/shortcuts/customize panel; lazy `RealtimeService` | `client/src/app/app.component.ts/.html`, `core/services/realtime.service.ts` | Independent of the editor split |
| 4.3 | `@defer` the editor inside the home showcase; `@defer`/dynamic-import present mode, deck compare, morph stage, animation pane, PDF/image export | `features/workspace/workspace.component.ts`, `features/home/home.component.*`, ★`editor.component.html/.ts` (template blocks), `slides/*` | **After** the editor split (the split decides where those children are mounted) |
| 4.4 | Tighten `angular.json` budgets (initial ~600 kB warn) to lock in gains | `client/angular.json` | Last |
| 4.5 | Media out of SQLite: filesystem/object store by sha256, streaming + Range, multipart/raw upload, poster frame at upload (S5b) | `server/src/images/*`, migration, `core/services/element-images.service.ts`, `core/services/media-actions.service.ts`, `projects/project-import.writer.ts`, export path | **After** the backend reorg (new storage module) |
| 4.6 | Socket hygiene: per-socket rate cap for cursor/laser, `perMessageDeflate` threshold (S13) | `server/src/realtime/realtime.gateway.ts` | Either |

### Not recommended (yet)
- **Web Workers for connector routing / morph-stage / auto layout.** After 2.2-2.3 (memoization) only the changed routes run per frame, which should fit easily in the frame budget. Workers would add structured-clone cost on every schema change. Revisit only if P0 traces after Phase 2 still show more than 8 ms per frame in `routeOrthogonal`. Image/PDF export (`buildDiagramSvg` + rasterization) is a better worker candidate, but it is user-initiated and rare.
- **Replacing NgRx Signal Store or slicing the store into many stores.** C1 + C4 + per-element memoization remove most of the fan-out; slicing is a refactor concern, not a perf prerequisite.

---

## 6. Cross-area dependencies

**Files the frontend refactor will split** (★ above):

| File | Perf steps touching it | Recommendation |
|---|---|---|
| `client/src/app/stores/project.store.ts` (4k lines) | 1.1, 1.2, 1.3, 1.9 (client), 2.1, 3.1 (client), 3.2 (client), 3.6 (client) | **Do 1.1-1.3 and 2.1 first**: small, local, and they shrink the invalidation surface the refactor has to reason about. Do 3.1/3.2/3.6 **after** the split, inside the extracted write-queue / `applyRemote` / entity-slice modules. |
| `client/src/app/features/editor/editor.component.ts` (9.7k lines) | 1.4, 1.5, 1.6, 2.1 (callers), 2.4, 2.5, 4.3 | Do the one-liners (1.4-1.6) and the 2.1 call-site swap **before**. Do **2.4 (pointer pipeline), 2.5 (culling) and 4.3 (deferred children) after** the split, since they rewrite exactly the code that will move. |
| `client/src/app/features/editor/slides/slides-panel.component.ts` (4.4k lines) | 2.6 | **After** the split, except a one-line guard if P0 confirms duplicate theme saves. |
| `editor.component.html` | 4.3 | After the split. |

**Server files a backend reorganization would move:**

| Area | Perf steps | Recommendation |
|---|---|---|
| `common/write-revision.ts`, `realtime/*` | 1.7, 1.8, 3.4, 4.6 | **Before**: small and self-contained; the reorg then just moves them. |
| `projects/*`, `export/*`, `tables/*` | 1.10, 1.11, 3.4, 3.5 | 1.10/1.11 **before** (tiny); 3.4/3.5 either. |
| `access/*`, `sharing/*` | 3.3 | **After**, if the reorg restructures the policy layer; the cache should live wherever access ends up. |
| `batch/*` | 1.13, 3.1, 3.6 | 1.13 before; 3.1/3.6 can lead the reorg (they define the write API shape). |
| `images/*` | 1.11, 4.5 | 1.11 before; 4.5 after (new storage module). |

**Shared/MCP coupling.** 3.1 (patch mutations), 3.4 (`ProjectSummary.revision`) and 4.1 (ESM build) change `shared`. Rebuild shared and clear the Vite deps cache after these (see code-blocks.md and grid-tables.md for the stale-cache gotcha). The MCP benefits automatically from 1.7/3.4 (ETag) and needs a small update for 3.1 (`mcp/src/batch.ts` reads batch responses) and 3.6.

**Feature coupling to re-test:**
- Undo/redo of moves (2.1 changes `recordElementMove`).
- Optimistic rollback (`checkpoint` diffs per collection; 1.1 removes viewport/home/themes from that diff, which is correct).
- Home showcase (`showcase-player.ts` drives `store.applyRemoteBatch` and viewport; check it after 1.1 and 3.1).
- Present-mode followers (`sendPresenting` keeps working regardless of 1.6, since it is not gated on peers; gating it is optional).
- The guide sandbox (sandbox backend handles `viewport` PATCH; drop or keep it consistent with 1.2).

---

## 7. Baseline (P0)

Measured 2026-11-09 at the start of Wave 3, before any Wave 3 client change. Dev build (`ng serve`, so Angular's dev-mode checks are included), Chromium browser pane emulating 1280×800, backend on a throwaway copy of the local DB, one participant in the room.

**Projects** (each imported twice from an export file, one copy per run so both runs start from identical data, viewport and home):

- **small**: "test 1": 238 elements (151 rectangles, 36 text, 8 code, 30 frames), 14 tables, 16 relationships, 27 slides, 1 deck.
- **big**: "TV Dashboards — Knowledge Share": 1,314 elements (728 text, 53 code, 14 grids, 60 images, 203 frames), 39 tables, 38 relationships, 203 slides, 3 decks.

**Method.** A page-side harness (no app code changed) dispatches synthetic pointer/wheel/input events, one per animation frame. For each event it measures *work* = the synchronous handler + Angular's change-detection tick (zoneless; it runs in the `setTimeout(0)` the scheduler queues) + a forced style/layout read. Paint is not included. Each gesture starts from the project's home view and runs 3 times; the table shows the median run's mean (and p95). `fetch`/XHR calls (minus socket.io polling) and socket.io emits (`WebSocket.send`) are counted from the gesture's start until 2.5 s after it ends.

| Scenario | Baseline (P0) | After Wave 3 |
|---|---|---|
| (a) small: pan 2 s (120 frames), work per frame | 6.7 ms (p95 8.1) | _pending_ |
| (a) small: pan, requests / socket emits | 1 `PATCH /viewport`; ~40 `presence:cursor` | _pending_ |
| (b) small: zoom (24 wheel ticks), work per tick | 7.0 ms (p95 10.3) | _pending_ |
| (b) small: zoom, requests | 1 `PATCH /viewport` | _pending_ |
| (c) small: drag a table (60 frames), work per frame | 7.1 ms (p95 9.6) | _pending_ |
| (c) small: drag a shape (60 frames), work per frame | 6.7 ms (p95 9.8) | _pending_ |
| (c) drag, requests / socket emits | 1 `PATCH /batch`; 20 `presence:cursor` + 1 `presence:selection` | _pending_ |
| (d) small: type 20 characters in a text element, work per character | 9.4 ms (p95 11.6) | _pending_ |
| (d) typing, requests | none while typing; 1 `PATCH /batch` on commit | _pending_ |
| (e) show a layout + move one of its items: theme saves | **2× `PUT /themes` + 4× `POST /me/themes`; one edit created two new "Default custom N" designs** | _pending_ |
| Idle mouse move (no button), work per move / emits | 1.3 ms; ~20 `presence:cursor` per second | _pending_ |
| big: pan, work per frame | **16.8 ms** (p95 18.6): over the 16.7 ms frame budget | _pending_ |
| big: zoom, work per tick | 14.5 ms (p95 18.2) | _pending_ |
| big: drag a table, work per frame | 14.6 ms (p95 16.3) | _pending_ |
| big: type in a slide text element, work per character | 18.9 ms p50 (mean 21.9, p95 63) | _pending_ |
| big: one committed text edit on a slide → images re-encoded for thumbnails | **120 `readAsDataURL` calls, 5.1 MB** (60 images × 2 panel instances) | _pending_ |

**What P0 confirms:**

- C1/C3: pan and zoom cost grows with the project size even though nothing but the viewport changes (6.7 → 16.8 ms per frame).
- C2: every pan and every zoom gesture ends in a `PATCH /viewport`.
- C10: cursors are streamed at ~20/s while alone in the room.
- C11: the duplicate layout save is real. Both slides-panel instances (`list` and `settings`) save the same layout edit, and on built-in layouts each creates its own custom design set (the test DB already held six such pairs). So the one-line guard from P2.6 ships in Wave 3.
- C12: thumbnails re-encode every image in the project, twice, after any slide edit.
