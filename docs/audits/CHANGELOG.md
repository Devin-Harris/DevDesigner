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
