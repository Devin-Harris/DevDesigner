# Master plan: sequencing the four audit passes

This file decides **order and ownership** across the four audits. The details (findings, evidence, per-step file lists) live in each audit:

| # | Audit | Overall | Plan section |
| - | ----- | ------- | ------------ |
| 01 | [Security](01-security.md) | **High risk** (no IDOR found; stored XSS and no resource limits; prod env secrets are set separately) | §6 Phases 0–4 |
| 02 | [Performance](02-performance.md) | Viewport-in-schema re-renders everything on pan/zoom; chatty realtime; global ETag | §5 Phases 0–4 |
| 03 | [Code cleanliness](03-code-cleanliness.md) | Syntax rules mostly met; god files, wrong-way imports, no client tests/lint | §8 Passes 0–5 |
| 04 | [Auditing / analytics](04-auditing-analytics.md) | Nothing exists (no logging, roles, audit trail, error tracking) | §9 Phases 0–4 |

Step ids below refer to those docs: `S1.3` = security step 1.3, `P2.4` = performance 2.4, `C3.3` = cleanliness 3.3, `A0` = analytics phase 0.

## Guiding rules

1. **Urgent security first, in the current layout.** Small fixes ship before any file moves. Refactors carry them along.
2. **Small perf wins before the client decomposition, structural perf work after.** Quick wins shrink the store and are easy to carry. Pointer, culling and slides-panel work goes into the files the split creates, so it isn't written twice.
3. **One owner per contested file per wave** (table at the bottom). Two passes never edit `editor.component.ts`, `project.store.ts`, `realtime.gateway.ts` or `access.service.ts` at the same time.
4. **Reformat once, early**, in a short merge window with no other branches open (C1.1). Rebase every branch by reformatting first.
5. **Build shared pieces once:** `RequestContext` (ALS), config validation, the throttler, the body-size limits, the reorder fix and media storage each appear in two audits. The merged items below say which pass owns each.

## Merged and deduplicated items

| Item | Appears in | Owner | Decision |
| ---- | ---------- | ----- | -------- |
| Per-route body limits (1–2 MB global, larger only for import/upload) | S1.3, P1.11 | Security, Wave 1 | Single change in `main.ts`. Telemetry route gets 8 KB (A1). |
| Env validation, required `JWT_SECRET`, `synchronize=false` | S1.4, C4.1 | Security, Wave 1 | Create `server/src/config/env.validation.ts` now. C4.5 later moves it to `platform/config/`. |
| `RequestContext` (ALS) + exception filter + structured logs | A0.5, C4.2 | Analytics, Wave 1 | Build at `server/src/common/request-context.ts`. C4.2 adds `@Caller()` on top and C4.5 moves it. |
| Declarative `ProjectAccessGuard` | S2.4, C4.3 | **Security-owned, executed inside the backend reorg** (Wave 4) | Security reviews it. `access.service.spec.ts` plus guard specs are the safety net. |
| Element reorder in one transaction + array caps | S1.6, P1.9 | Perf, Wave 3 | Perf 1.9 (server) includes the `@ArrayMaxSize` caps from S1.6. |
| Throttler / rate limits | S3.1, A1 telemetry, P4.6 socket caps | Security, Wave 4 | One `@nestjs/throttler` setup; analytics and admin routes reuse it. P4.6 is folded into S3.4. |
| Realtime gateway hardening + perf | S1.5, S3.3, S3.4, P1.6, P1.8, P4.6 | Perf (P1.8) then Security (S3.x) | Done one after another in Wave 3 by one owner; never run in parallel. |
| Media out of SQLite + allow-list SVG sanitizer + magic bytes | S4.4, S1.8, P4.5 | Perf, Wave 4 (after C4.5) | One storage module (`projects/canvas/images/storage`). The magic-byte check (S1.8) ships early in Wave 1. |
| Theme-color / font-load invalidation | P1.5, P2.2, C1.10 | Cleanliness (C1.10) provides the notifiers | Perf consumes `themeChanged$` / `fontsLoaded$` instead of inventing its own counters. |
| Lazy dialogs / `@defer` | P4.2, C3.10 | Perf | C3.10 skips any step P4.2 has already done. |
| Slides panel duplicate theme saves | P2.6, C3.5 | Cleanliness (C3.5 produces `deck-layout-sync.service`) | If P0 confirms duplicate `PUT /themes`, ship the one-line guard in Wave 3. |
| Dead code: `NotesModule`, OAuth stubs, passport | C1.7 | Cleanliness | Tell Security first: unused auth dependencies are on its inventory. |
| Mirror server validation in the client sandbox | S (other areas) | Security | Every new server validator gets the matching check in `core/sandbox/sandbox-backend.service.ts`. The guide and home seeds must still parse (spec). |

## Waves

After Wave 2, **server and client work run as two parallel tracks**, since the contested files don't overlap across tracks.

### Wave 0: today (no code, under an hour)

- **S0.1 (optional):** prod env values are set in Railway separately from local `.env` (owner confirmed), so this is only a sanity check: `DATABASE_SYNCHRONIZE=false`, `COOKIE_SECURE=true`, `CORS_ORIGIN` exact. S1.4 later enforces them at boot.
- **S0.2:** reissue the API tokens in your local `.mcp.json`. The `dbd_`→`dd_` rename already killed them (S-I-1).
- **C0.1:** add `.gitattributes` and fix the NUL bytes in `morph-stage.ts` so git can diff the file before anyone edits it.

### Wave 1: urgent security + observability + guardrails (about 1 week, all parallel-safe)

| Stream | Steps | Notes |
| ------ | ----- | ----- |
| Security quick wins | S1.1 (XSS, client SVG escape + DOM sanitize + PoC spec), S1.3 (body limits), S1.4 (env validation), S1.5 (no email in presence), S1.7/S1.8 (MCP SSRF, file read, magic bytes), S1.9 (legacy token prefix) | S1.1 touches `diagram-svg.helper.ts`, `morph-stage.ts` and `present-mode` **before** the reformat: small diff, carried forward. |
| Observability | A0.5 (pino, request id, exception filter, slow queries, `/health/ready`), A3a (Sentry on client and server, uptime monitor) | Lands after S1.3/S1.4 in `main.ts` / `app.module.ts`, in that order. |
| Guardrails | C0.2–C0.9 (Prettier config staged, Angular ESLint + `dd` prefix + a11y **warn**, boundaries lint warn, stylelint, madge, client Jest, characterization specs for the current `ProjectStore`, the `proxySignal`/`notifySignal` helpers and `ngx-form-signal` installed and smoke-tested on Angular 22) | No behavior change. The store characterization specs (C0.8) are the safety net for Waves 3 and 5. |
| Perf measurement | P0 (count requests/renders on drag, pan, typing; confirm duplicate theme saves) | Sets the baseline for every later perf claim. |

**Exit:** XSS PoC spec passes, the app refuses to boot in prod with a missing or default `JWT_SECRET` (defense in depth), Sentry receives a test error, and the baseline numbers are recorded in 02-performance.md.

### Wave 2: client reformat window (1–2 days, nothing else open on the client)

- C1.1 reformat (one commit, added to `.git-blame-ignore-revs`), C1.2 drop `standalone: true`, C1.3 `app-`→`dd-`, C1.4 merge the autofocus directives.

### Wave 3: quick wins on both tracks (about 1–1.5 weeks)

**Client track**
- **C1.10 first:** `EditorActionsService` becomes `proxySignal`s (removes about 8 signal-writing editor effects), plus the `themeChanged$`, `fontsLoaded$` and present-mode `resized$` notifiers. P1.5 (theme colors) and P2.2 (render memo) build on these notifiers, so C1.10 must land before them.
- P1.1–P1.6 (viewport out of `schema`, viewport saved locally not PATCHed, `equal` on derived values, `frameBoxes`, theme-color signals, gate cursor/laser emits on peers).
- P2.1 `moveItemsLocal`, P2.2/P2.3 render and route memoization (helpers only, ahead of C3.2's split of `shape-render`).
- P1.12 data-URL cache. Optional: the one-line slides-panel duplicate-save guard.
- Then C1.5–C1.9: inline templates → files, `*-api` renames, dead code, a11y, extract non-component code.

**Server track**
- P1.7 per-project ETag, P1.8 no echo to origin socket, P1.9 reorder (+S1.6 caps), P1.10 graph/export queries, P1.13 batch `?return=none`, P1.14 owner index.
- Then S3.3/S3.4 realtime hardening (revocation, payload validation, token buckets, origin check, server-assigned client id; includes P4.6). Same owner as P1.8.
- A0: `users.role` + `ADMIN_EMAILS` + `AdminGuard` + `/admin` lazy route shell. Ideally after S1.4, so an admin role never sits behind a secret that could silently fall back to the default in a misconfigured environment.

### Wave 4: server, backend reorg with authorization built in (about 2–3 weeks)

In this order:
1. **C4.1–C4.2:** config moves to `platform/config`, `@Caller()` on the existing `RequestContext`.
2. **C4.3 = S2.4:** `@RequiresAccess` + `ProjectAccessGuard` + an entity→project resolver; services drop the `userId, shareToken` parameters. **Security reviews this.**
3. Security structural work, landing in the new guard and DTO layout: S1.2 (`@IsColor` on every color DTO + import parser), S2.1 (no ownerless projects + migration), S2.2 (theme/clone DTO validation), S2.3 (`assertIdsInProject`).
4. **C4.4–C4.6:** patch helper, `graph-loader`, folder regroup (`platform/ identity/ collaboration/ projects/{schema,canvas,batch,project-file,export,common}`), import-writer split.
5. **S3.1 throttler + S3.2 quotas** on the new structure.
6. Perf work that waits for the reorg: P3.3 access cache (with the new guard), P3.4 persisted revision + graph LRU, P3.1/P3.2/P3.6 server halves (patch mutations, client-UUID creates, columns/indexes in batch), **P4.5 + S4.4 media storage** out of SQLite.
7. **A1 event capture:** separate `analytics.sqlite`, buffered interceptor and listeners, domain emits placed in the reorganized services, MCP `X-MCP-Tool` header. Benchmark `PATCH /batch` and drag bursts with `ANALYTICS_ENABLED` on and off (perf owns the numbers).

### Wave 5: client, folder moves and decomposition (about 5–7 weeks, runs alongside Wave 4)

1. **C2.1–C2.7:** pure `git mv` passes (stores into `features/editor/state/project` and `features/workspace/state/projects`, editor sub-features, the `features/editor/index.ts` barrel, `shared/features/*`). Boundaries lint goes to **error**.
2. **A2 admin dashboard:** the first feature built in the target layout (`features/admin/{state,services,models,components,features/*}`). It can start as soon as C2 lands and needs Wave 4 step 7 for data. Overview and storage pages can ship first, because they query the main DB.
3. **C3.1:** dedupe into `@devdesigner/shared` (project-file parser and planner, metrics, stacking, contrast, data-type labels). Do **P4.1 (shared as ESM)** right before this; restart `npm run dev` afterwards (stale Vite cache).
4. **C3.2–C3.10 decomposition**, one sub-feature per PR, tests first. Perf follows each extraction:
   - C3.2 (`shape-render` split) comes after P2.2 has merged.
   - C3.3 `ProjectStore` slices are followed by the P3.1/P3.2/P3.6 client halves (`applyRemote` patches, optimistic creates, batched columns/indexes).
   - C3.4 `EditorComponent` → services is followed by P2.4 (pointer pipeline), P2.5 (culling) and P4.3 (`@defer` children).
   - C3.5 slides-panel → store + components + `deck-layout-sync` is followed by the rest of P2.6.
   - P3.5 (thumbnails by revision) after server P3.4.
5. **C3.11 forms:** auth, API-token, share and projects-overlay dialogs move to Reactive Forms + `formSignal`. Do the auth dialog after S4.7 (generic login errors) or together with it. The inspectors drop `ngModel` inside their own C3.x splits.
6. **P4.2** slim `AppComponent` / lazy dialogs at any point. C3.10 then skips what's already done.

### Wave 6: hardening and lock-in (about 1–2 weeks)

- S4.1–S4.7: helmet + CSP, `tokenVersion` sessions, server-issued guest cookie, hashed share tokens, dependency bumps, then a **separate** Nest 11 upgrade, account hygiene + `DELETE /auth/me`.
- A3b (optional): consent banner, then PostHog, privacy page, self-hosted fonts.
- A4: nightly rollups, 90-day purge, hygiene preview, erase hook on account deletion.
- P4.4: tighten bundle budgets.
- C5.1–C5.3: test backfill, every lint rule to **error**, `npm run verify` in CI.

## Contested-file ownership

| File / area | Wave 1 | Wave 3 | Wave 4/5 |
| ----------- | ------ | ------ | -------- |
| `server/src/main.ts`, `app.module.ts` | Security (S1.3/1.4), then Analytics (A0.5) | Analytics A0 (AdminModule import) | Cleanliness C4.1/4.2, then Security S3.1, then Analytics A1 |
| `server/src/access/*` | Security | (untouched) | Cleanliness + Security (C4.3 = S2.4), then Perf P3.3 |
| `server/src/realtime/realtime.gateway.ts` | Security S1.5 | Perf P1.8, then Security S3.3/3.4 | Cleanliness C4.5 (move only) |
| Server DTO folders | (untouched) | Perf P1.9 caps | Security S1.2/S2.2 after C4.3 |
| `client/.../export/diagram-svg.helper.ts`, `morph-stage.ts`, `present-mode` | Security S1.1 (+ C0.1 NUL fix first) | Cleanliness C1.5 (template files) | Cleanliness C3.6 |
| `client/src/app/stores/project.store.ts` | Cleanliness C0.8 (specs only) | Perf P1.1–1.3, P2.1 | Cleanliness C2.4 move, then C3.3 split, then Perf client P3.x |
| `features/editor/editor.component.ts` | (untouched) | Cleanliness C1.10 (proxy bridge), then Perf P1.4–1.6 (one-liners) | Cleanliness C3.4, then Perf P2.4/2.5/4.3 |
| `slides/slides-panel.component.ts` | (untouched) | Optional one-line guard; C1.5 template move | Cleanliness C3.5, then Perf P2.6 |
| `core/sandbox/sandbox-backend.service.ts` | Mirror S1.x validators | Perf P1.1 | Cleanliness C3.9 |
| `shared/` package | Security S1.2 color validator (Wave 4), S1.8 magic bytes | (untouched) | Perf P4.1 ESM, then Cleanliness C3.1 |

## Rough timeline (one developer)

| Wave | Duration | Can overlap with |
| ---- | -------- | ---------------- |
| 0 | < 1 hour | (none) |
| 1 | ~1 week | (internal streams parallel) |
| 2 | 1–2 days | (none, freeze client) |
| 3 | ~1.5 weeks | client and server tracks in parallel |
| 4 (server) | ~2–3 weeks | Wave 5 |
| 5 (client) | ~5–7 weeks | Wave 4 |
| 6 | ~1–2 weeks | (none) |

The total is roughly 10–14 weeks for one developer. Stopping after **Wave 3** already closes the critical and high security issues, gets observability and an admin wall in place, and delivers the biggest perceived-speed gains.
