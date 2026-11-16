# Audit changes, wave by wave

A running summary of what each wave of [00-master-plan.md](00-master-plan.md) changed on the `audit/overhaul` branch, for review later. Step ids (`S1.3`, `P2.4`, `C1.1`, `A0`) refer to the four audits.

---

## Wave 1: urgent security, observability, guardrails

**Commits:** `0f7b601` … `7b820b9` (10 commits)

### Security
- **Stored XSS fixed (H-1, S1.1).**
  - Every value placed inside an SVG attribute by `diagram-svg.helper.ts` is now escaped (285 places).
  - A new `svg-sanitize.helper.ts` strips `script`, `foreignObject`, `on*` handlers and unsafe `href`s.
  - Morph-stage and present mode insert parsed, sanitized nodes instead of using `innerHTML`.
  - A spec tries the attack payload in every color field.
- **Request size limits (S1.3, P1.11).** The global JSON limit is 2 MB and compressed request bodies are refused. Larger limits apply only to import (200 MB), image upload (60 MB), batch/clone (20 MB) and themes (10 MB).
- **Env validation (S1.4).**
  - In production the server won't boot without a proper `JWT_SECRET` (≥32 chars, not the default).
  - JWTs are pinned to HS256.
  - Every env var is validated and given its default in one place (`server/src/config/env.validation.ts`).
- **MCP image fetching (M-6, M-7).** It now:
  - blocks non-public addresses, including IPv4-mapped IPv6;
  - pins the connection to the vetted IP (no DNS rebinding);
  - re-vets each redirect, max 3;
  - streams with a 5 MB cap;
  - only reads files with an image extension and real image magic bytes, optionally confined by `DEVDESIGNER_IMAGE_ROOT`.
- **Upload type check.** The server rejects uploads whose bytes don't match the declared type. This also applies to project import.
- **Small fixes:** owner email no longer appears in the presence list (M-8); legacy `dbd_` API tokens work again (I-1).

### Observability
- Structured logs with nestjs-pino: pretty in dev, JSON in prod. Credentials are redacted, request bodies are never logged, and share tokens are masked in URLs.
- `X-Request-Id` on every response, plus a request context (AsyncLocalStorage) that later waves build on.
- An exception filter that leaves normal error bodies unchanged and returns a generic 500 with a requestId (no stack traces).
- Slow-query logging (`SLOW_QUERY_MS`) and `GET /api/health/ready`.
- Sentry on server and client, inactive until `SENTRY_DSN` / `environment.sentryDsn` is set.
- The MCP logs per-tool timing to stderr.

### Guardrails (all warn-only)
- Client Prettier override (3-space, 120 cols).
- Angular ESLint with `dd` prefix and a11y rules, folder-boundary lint, stylelint `color-no-hex`, madge `check:cycles`.
- Client Jest 30 (`jest-preset-angular`, zoneless). The client is now part of root `npm test`.
- `proxySignal` / `notifySignal` in `client/src/app/shared/helpers/signals/`; `ngx-form-signal` installed and verified on Angular 22.
- Specs: routing / smart-guides / rich-list helpers, and 66 `ProjectStore` characterization tests.

### Chores
- `.gitattributes` normalizes text files to LF.
- Two raw NUL bytes in `morph-stage.ts` are now written as `\u0000` escapes, so git diffs the file as text.

### Verified
- Every workspace builds.
- Server 65, MCP 57 and client 168 tests pass; shared passes 134 of 136. The 2 failures are in `themes.spec.ts`, which already failed before this branch.
- The server boots in dev with no config. In production mode it exits without a valid `JWT_SECRET`.
- 413/415 responses and request ids checked with curl.
- Slide present mode and morph transitions checked in the browser.

### Left for later
- `DATABASE_SYNCHRONIZE` stays on in production. There is no baseline migration and no migration runner yet.
- Railway may start the wrong file: the build writes `dist/src/main.js`, but `start:prod` runs `dist/main.js`.
- Perf baseline (P0) moved to the start of Wave 3.

---

## Wave 2: client reformat window

**Commits:** `0647f5b` … `d8996c9` (4 commits)

- **C1.1:** Prettier reformat of the whole client (202 files, formatting only). The commit is listed in `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs` locally (GitHub applies it automatically).
- **C1.2:** removed 54 redundant `standalone: true`.
- **C1.3:** all 43 `app-*` component selectors are now `dd-*`, including SCSS tag selectors and the home-showcase DOM queries; `[appAutofocus]` is now `[ddAutofocus]`. Selector lint warnings went from 45 to 0.
- **C1.4:** the two autofocus directives are merged into `shared/ui/directives/autofocus.directive.ts`.
  - It uses `afterNextRender` instead of `setTimeout`.
  - `ddAutofocusSelect` keeps each call site's old text-selection behavior.

### Verified
- Type-check, client build and 168 client tests are green.
- Home showcase, guide editor and present mode render in the browser.

---

## Wave 3: quick wins on both tracks

**Commits:** `becb30b` … `929d557` (28 commits, `git log cc891a9..`)

### Server performance
- **Per-project revision ETag (P1.7).**
  - It replaces the global write counter, and `GET /projects/:id` and `GET /shared/:token` answer 304 when nothing changed.
  - Other projects' writes and viewport saves no longer invalidate a project.
  - The access level is part of the tag, so owner and guest copies never mix.
- **No echo to the origin tab (P1.8).**
- **Element reorder (P1.9 + S1.6).** It is one transaction that updates only the changed rows. Request arrays are capped in `common/limits.ts`, for example 20,000 element ids, which covers MCP `arrange_layers`.
- **Leaner reads (P1.10).** The graph read does access check + project row in one query, tables load with `relationLoadStrategy: 'query'`, and SQL export reads only tables and relationships.
- **`?return=none` on batch and clone (P1.13).** It returns `{ ok, revision, ids }` instead of whole rows; the client uses it.
- **Owner index (P1.14).** New `projects(ownerId, archived, updatedAt)` index, plus its migration.

### Realtime security
- **Revocation (S3.3).** Revoking a share link, deleting a project or transferring ownership disconnects the affected sockets. Every socket is also rechecked every 5 minutes.
- **Relay hardening (S3.4, P4.6):**
  - origin check on the handshake, and no-origin connections refused;
  - 64 KB message cap;
  - deflate above 2 KB;
  - 50 sockets per IP and 200 per room;
  - payload shape validation;
  - per-socket token buckets: cursor and laser 30/s, selection 5/s, present 2/s.
- **Server-assigned client ids (L-1).**
  - The server mints each tab's id and sends it in a `session` event.
  - `X-Client-Id` is honored only for the user, guest or link that opened that socket, so an editor can no longer hide writes from someone by spoofing their id.
  - Peers never see each other's ids.
- Bug fixes found along the way: ghost roster entries, and leftover empty rooms.

### Client performance (P0 baseline is in 02-performance.md §7)
| Scenario | Before | After |
|---|---|---|
| Pan, per frame (small / big project) | 6.7 / 16.8 ms + 1 PATCH + cursor emits | 3.5 / 6.6 ms, no requests |
| Zoom tick (small / big) | 7.0 / 14.5 ms + PATCH | 3.8 / 6.0 ms |
| Drag table (small / big) | 7.1 / 14.6 ms | 5.6 / 11.4 ms |
| Typing per char (small) | 9.4 ms | 6.1 ms |
| Idle mouse move | 1.3 ms, ~20 emits/s | 0.35 ms, none |
| Layout edit | 2× PUT + 4× POST, 2 design sets | 1× PUT + 2× POST, 1 set |
| Slide thumbnail re-encode per edit (big) | 120 reads / 5.1 MB | 0 |

- **C1.10 signal utilities.**
  - The editor→top-bar bridge now uses `proxySignal`s, which removed 6 signal-writing effects.
  - `themeChanged$`, `fontsLoaded$` and present-mode `resized$` are `notifySignal`s.
  - A `FontMetricsService` owns the font-load listener.
- **P1.1–P1.3.**
  - Viewport, home and themes moved out of `schema`.
  - The viewport is saved to localStorage per project instead of the server.
  - Derived sets use `equal` functions.
- **P1.4–P1.6.** Stable frame boxes for connectors, colors keyed to theme changes, and presence emits only when someone else is in the room.
- **P1.9 / P1.13 client.** Restack sends only the changed rows, and batch/clone ask for the light ack.
- **P1.12.** Image data URLs are cached per file, and slide renders encode only their own images.
- **P2.1–P2.3.**
  - `moveItemsLocal` applies one store write per drag frame.
  - Shape views are memoized, with LRU caches for text width, code tokenizing and grid parsing.
  - Connector routes are memoized per relationship.
- **Layout-save dedupe.** Fixes the duplicate theme saves P0 found.

### Admin (A0)
- New user columns `role`, `lastLoginAt` and `lastSeenAt`, plus activity columns on projects and share links (written from Wave 4).
- `ADMIN_EMAILS` promotes listed users on boot, login or register, and never demotes.
- `AdminGuard` re-reads the role from the DB, rejects API tokens, and returns the same 404 as an unknown route.
- `GET /api/admin/ping`.
- Client:
  - `adminGuard` (`canMatch` + `canActivate`) and a lazy `/admin` chunk that non-admins never download;
  - `features/admin/` is the first feature built in the target folder layout;
  - an "Admin" item in the account menus.

### Client cleanup (C1.5–C1.9)
- **C1.5:** 23 components moved inline templates/styles into `.html`/`.scss` files. `slides-panel.component.ts` went from 4,400 to 2,153 lines.
- **C1.6:** eight thin REST wrappers are renamed `*-api.service.ts` / `*ApiService`, and `api.service` is renamed `api-client.service`. `user-themes` and `element-images` keep their names because they hold state.
- **C1.7:** unused imports/vars/constants removed (`no-unused-vars` 10 → 0).
- **C1.8:** a11y.
  - All 178 icon-only buttons now have an `aria-label`.
  - `type="button"` is on 480 buttons.
  - Focus-mode slide rows and the master card are real `<button>`s, styled with the global `.dd-button-reset`.
- **C1.9:** non-component exports moved out of component files: `PenPrefsService`, the guide sandbox helpers, `FocusUiState`, `SlidesCommand`, `CompareUiState`, and `ease`.
- Lint warnings: 2,726 → 2,141.

### Verified
- Full build OK.
- Tests: server 124, MCP 57, client 216, shared 134/136. The 2 shared failures are in `themes.spec.ts`, as before.
- `test:types` and lint report 0 errors.
- In the browser:
  - pan/zoom, drags, text, slides panel, present mode, deck compare, home showcase and guide sandboxes;
  - P0 before and after numbers, recorded in `02-performance.md` §7.
- A slide-thumbnail `TypeError` seen during testing came from a stale Vite dev bundle after `shared` changed. It disappears after a rebuild; restart `npm run dev` after pulling.

### Behavior changes to know
- Pan/zoom is per browser now; the shared home view is unchanged.
- View-only guests no longer see "Save failed" after panning.
- Text re-lays out once web fonts load.
- `PATCH /projects/:id/viewport` is now only used by the guide sandbox and can be deprecated.

---

## Wave 4: server, backend reorg with authorization, limits, caching, media, analytics

**Commits:** about 20 server/shared/mcp commits since `89f6d34` (`d7ad239` … `81687fc`). Wave 5 client commits are interleaved on the same branch.

### Part A: reorg + declarative authorization
- **Layout.** `server/src` is now `platform/` (config, http, database, throttle, quotas, analytics), `identity/` (auth, admin), `collaboration/` (access, sharing, realtime) and `projects/{projects,project-file,schema,canvas,batch,export,common}`. All moves were pure `git mv` commits.
- **`@Caller()`.** Returns user, guest, owner, share token, validated client id and token flag. Every remaining env read now goes through ConfigService.
- **`@RequiresAccess` + `ProjectAccessGuard` + entity→project resolvers (S2.4).**
  - Every route declares its access level (public, caller, admin, owner, write or read).
  - `access-policy.spec.ts` compares every controller handler against a reviewed table.
  - Services no longer take `userId/shareToken/clientId` and no longer re-check access.
- **Validation (S1.2, S2.2, S2.3).**
  - `isColorValue` / `@IsColor` on all 21 color fields and in the import parser.
  - Theme layouts and masters are validated per item, with a 256 KB cap.
  - Clone entries are validated like batch entries.
  - Cross-project references (slideId, bindings, lifelines, index columns) are refused.
- **Ownerless projects (S2.1).** They can't be created (401). Existing ones grant no access, and a migration archives them; no data is deleted.
- **Cleanup.** `applyDefined` patch helper; `GraphLoaderService`; the import writer is split per entity. Dead code removed: NotesModule, OAuth stubs, passport and supertest.
- The SQLite UNIQUE/FK errors now map to 409/400.
- One loosening: SQL export now accepts a share link's read access, which the graph and export-file already allowed.

### Part B: limits, caches, media
- **Rate limits (S3.1).**
  - Global per-caller and per-IP buckets, plus named policies for login, register, create, import, export, upload, share and admin.
  - Login lockout doubles from 30 s up to 15 min, and unknown emails get a dummy bcrypt compare.
  - `trust proxy` uses `TRUST_PROXY_HOPS`.
- **Quotas (S3.2).** Env-configurable; defaults are 500 projects per owner, 5k tables and 20k elements per project, and 1 GiB of images per owner.
- **Caching (P3.3, P3.4).**
  - An access cache with event-driven invalidation.
  - A persisted `projects.revision`; ETags survive restarts and change per deploy.
  - A graph LRU of pre-gzipped bodies.
- **Patch mutations, client ids, batch sections (P3.1, P3.2, P3.6).**
  - Patch mutation types exist, but `REALTIME_PATCH_MUTATIONS` defaults to **off** until the client handles them.
  - Create DTOs accept client UUIDs (409 on conflict).
  - Columns and indexes are batch sections; MCP column loops use them.
- **Media store (P4.5, S4.4).**
  - Content-addressed files under `MEDIA_DIR`, default `media/` next to the DB.
  - Range/206 and hash ETags.
  - Raw-bytes upload route.
  - Allow-list SVG *sanitizer*: uploads are cleaned, not rejected.
  - `npm run media:migrate -w server -- --gc --vacuum`; on a copy of the dev DB, 154 blobs / 7.5 MB became 4.1 MB on disk.
- `proxy-addr` was bumped to fix the critical advisory.

### Part C: analytics Phase 1 (A1)
- **`platform/analytics/`.**
  - A separate `analytics.sqlite`.
  - A buffered service with per-minute aggregates, 10 s / 500-row flushes, a 10k cap and daily retention purge.
  - A request middleware + interceptor recording route templates, actor kind, source (web/api/mcp) and MCP tool.
  - Domain events: auth, projects, sharing, images, tokens, export, realtime/present.
  - Mutation counts per minute, never content.
- **Activity columns.** `lastSeenAt`, `lastOpenedAt` and share-link `useCount` are written through throttled touches.
- **`POST /api/telemetry`.** Allow-listed `client.*` events, 8 KB limit, rate limited.
- **Privacy.** IP hashes are salted and rotated daily, user agents are reduced to their family, and guest/share ids are hashed. The event catalog in `shared/src/analytics` has no free-text props, and a spec enforces this.
- **MCP.** Sends `User-Agent` and a per-tool `X-MCP-Tool` header.
- **Benchmark.** About +0.4 ms p50 per batch request with analytics on. Details are in `04-auditing-analytics.md`.

### New env vars (all optional; documented in `server/.env.example`)
- **Proxy and rate limits:** `TRUST_PROXY_HOPS`, `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PER_MIN`, `RATE_LIMIT_IP_PER_MIN`.
- **Quotas:** `QUOTA_*`.
- **Caches:** `ACCESS_CACHE_TTL_MS`, `GRAPH_CACHE_MAX_BYTES`.
- **Realtime:** `REALTIME_PATCH_MUTATIONS`.
- **Media:** `MEDIA_DRIVER`, `MEDIA_DIR`.
- **Analytics:** `ANALYTICS_ENABLED`, `ANALYTICS_DATABASE_PATH`, `ANALYTICS_SALT_SECRET` (set it in prod), `ANALYTICS_GET_SAMPLE`, `SLOW_REQUEST_MS`, `ANALYTICS_RAW_RETENTION_DAYS`.

### Verified
- Server tests went from 124 to 278; MCP has 59.
- Shared passes apart from the 2 failures in `themes.spec.ts`, which predate this branch.
- Built-server smoke checks passed: 34, 33 + 21 and 33 across the three parts.

### Deploy notes
- Make sure `DATABASE_PATH` and `MEDIA_DIR` are on the Railway volume.
- After deploying, run `npm run media:migrate -w server -- --gc --vacuum` (build first).
- Set `ANALYTICS_SALT_SECRET`.
- Deploy the server before pointing the new MCP build at production.
- The in-memory throttle, caches and lockouts assume a single replica.
- The project list now orders by last content change.

---

## Wave 5 (client), later batch

### Write layer (P3.1, P3.2, P3.6 client halves)
- **Patch mutations.** `SchemaPatchMutation` is now part of `SchemaMutation` (`RealtimeMutation` stays as an alias). `applySchemaMutation` merges every `*.patched` kind; elements re-sort when a patch changes `zIndex`. `REALTIME_PATCH_MUTATIONS` now defaults to **on**.
- **Optimistic creates.** Tables, columns, indexes, relationships, participants and messages show at once under a client UUID (`createOptimistic` in the save queue). A refused create is dropped and never restored by a later rollback. `setHome` and `setCustomThemes` roll back on failure.
- **Batch sections.** Column and index edits go through the staged `PATCH /batch` (`columns` / `indexes`) instead of a PATCH per row.
- **Raw media upload.** The editor posts file bytes to `POST /projects/:id/images/raw` (no base64). Guide sandboxes keep the JSON route.

### Cleanup (C3.8–C3.11)
- The sandbox backend is split into `sandbox.helpers.ts`, `sandbox-schema.helpers.ts` and `sandbox-routes.helpers.ts`; the service keeps routing and storage.
- Home: static copy, seeds and MCP snippets moved to `home/helpers/home-content.ts`; one `sleep` helper instead of eleven.
- Dialogs and UI primitives use `--dd-on-accent` / `--dd-shade` tokens instead of hex colors.
- Table selection in the canvas template uses a `selectedTableIdSet` computed.
- Auth, API-token, share and projects-overlay dialogs use Reactive Forms (+ `formSignal`) instead of `ngModel`.

### Bundle (P4.2)
- Sign-in and API-token dialogs load on first use (`AccountDialogsService`): initial 477.8 kB → 448.7 kB at the time.
- Deferring the command palette / shortcuts / customize panel and lazy-loading the projects overlay were measured and **not** kept. Each one made the Angular chunk optimizer fold realtime/socket.io/material into `main` (+27 to +81 kB initial).

### Telemetry (A2)
- `client.present` (start/end), `client.export_image`, `client.guide_tab`, `client.laser` and `client.error`.
- Errors are counted by kind only: a wrapping `ErrorHandler` that still delegates to Sentry or the default, plus window `error` / `unhandledrejection` listeners.

### Not done here
- C3.7 leaf components and the C3.8 `EditorEmbedApi`. Every remaining leaf is mounted from `editor.component.ts`, which had uncommitted work.
- C3.5/C3.6 (slides panel, present, morph, deck compare).
