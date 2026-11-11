# 04 - Auditing, Analytics and Observability

Audit date: 2026-11-09. Scope: `server/` (NestJS 10 + TypeORM + better-sqlite3), `client/` (Angular 22 zoneless, NgRx Signal Store), `shared/`, `mcp/`. Deployed on Railway (API, client, and a separate MCP HTTP service).

---

## 1. Summary

DevDesigner records almost nothing about how it is used today. There is no request logging, no error tracking, no audit trail, no roles, and no client telemetry. Only `users`, `projects`, `share_links`, `project_images`, `api_tokens` and `user_themes` have a `createdAt`. `projects.updatedAt` does not change when the project's content is edited, so it can't tell you which projects are active. The one usage signal that exists is `api_tokens.lastUsedAt`, written at most once a minute.

The good news is that the right hooks already exist:

- Every persisted change already passes through one place: `RealtimePublisher` emits on the in-process EventEmitter2 bus, and `emit()` is synchronous.
- Every REST write already passes through a global interceptor (`WriteRevisionInterceptor`).
- The realtime gateway already resolves who is in each room.
- `ApiTokenService` already contains a throttled "touch" pattern that can be reused for `lastSeenAt` and `lastOpenedAt`.

**Recommendation (one path, not a survey):**

1. **First-party event capture is the source of truth.** Add an `AnalyticsModule` that buffers events in memory and batch-inserts them every 10 s into a separate SQLite file (`analytics.sqlite`). A separate file means analytics never competes with the app database's single writer lock. Inputs:
   - a global HTTP interceptor (route template, status, latency, actor type, MCP tool name);
   - `@OnEvent` listeners on the existing mutation bus (entity writes by kind, pre-aggregated per minute);
   - a few explicit domain events (signup, login, share link created or opened, export/import, realtime join, present).
   Data is rolled up nightly into a `analytics_daily` table. Raw events are purged after 90 days. No diagram content and no raw IPs are ever stored.
2. **Admin wall:** add `users.role` (`'user' | 'admin'`), bootstrapped from an `ADMIN_EMAILS` env allowlist, and an `AdminGuard` on `/api/admin/*`. The guard requires a cookie session (never an API token), re-checks the role in the database, and is rate limited. On the client, `/admin` is lazy-loaded behind `canMatch` and `canActivate` guards, so non-admins never download the chunk. Charts are hand-rolled SVG built on the `--dd-*` tokens; no chart library.
3. **External services (env-gated, off in dev):**
   - **Sentry**, free Developer plan: errors for Nest and Angular.
   - **Better Stack** or **UptimeRobot**, free tier: uptime checks on `/api/health/ready` and the MCP `/health`.
   - **PostHog Cloud (EU)**, free tier: optional and added last. Fed server-side from the same AnalyticsService sink. Browser capture and session replay only behind a consent banner.
   - Skip Umami and Plausible: first-party plus PostHog already cover page analytics.
4. **Observability basics first:** `nestjs-pino` structured JSON logs with request ids, a global exception filter, slow-query logging, and split liveness/readiness health checks. Railway's log viewer and metrics then become useful with no other tooling.

**Where it lands in the overall sequence:**

- Observability basics (pino, request id, exception filter, readiness, Sentry) go early. They are cheap and help verify every other pass.
- The admin role and guard (phase 0) go immediately after the security pass.
- Event capture (phase 1) goes with or after the performance pass.
- The admin dashboard (phase 2) is built as the first feature in the target `features/admin/...` structure from the cleanliness refactor.

---

## 2. Current state (evidence)

### 2.1 Logging

| Finding | Evidence |
|---|---|
| A single `console.log` at boot is the only server log line | `server/src/main.ts:53` |
| `Logger` is set up in the realtime gateway but never called (no `this.logger.` uses) | `server/src/realtime/realtime.gateway.ts:15,72` |
| No request logging, no request id, no Nest logger configuration | `server/src/main.ts:10-54` (only compression, prefix, `WriteRevisionInterceptor`, `ValidationPipe`, CORS) |
| TypeORM query logging is off, with no slow-query threshold | `server/src/database/data-source.ts:19` (`logging: false`) |
| The MCP service logs only with `console.error` (start-up and failed requests) | `mcp/src/http.ts:92,100`, `mcp/src/index.ts:29,33` |
| The client has no `ErrorHandler` override and no `window.onerror`/`unhandledrejection` hook | grep over `client/src` finds nothing. `client/src/app/app.config.ts:16-23` registers only the router, animations and HTTP interceptors |

### 2.2 Error tracking
- There is no global exception filter (`APP_FILTER`, `@UseFilters`, `ExceptionFilter`: no hits in `server/src`), so unhandled 500s only reach Nest's default console output.
- There is no Sentry or other error SDK in `server/package.json` or `client/package.json`.

### 2.3 Health
- `GET /api/health` returns `{status:'ok', timestamp}` without touching the database (`server/src/health/health.controller.ts:1-9`). It is a liveness check only. Nothing reports database reachability, migration state, volume free space or uptime.
- The MCP service has `/health` (`mcp/src/http.ts`, `path === '/health'`).

### 2.4 Timestamps on entities

| Table | createdAt | updatedAt | Other |
|---|---|---|---|
| `users` | yes (`server/src/auth/user.entity.ts:34-35`) | no | no `lastLoginAt` / `lastSeenAt` |
| `projects` | yes (`project.entity.ts:79-80`) | `@UpdateDateColumn` (`:82-83`) | no `lastOpenedAt` |
| `share_links` | yes (`share-link.entity.ts:35-36`) | no | `revokedAt`, `expiresAt` (`:38-42`). No `lastUsedAt` or use count |
| `project_images` | yes (`project-image.entity.ts:42-43`) | no | `sha256` dedupe (`:39-40`) |
| `api_tokens` | yes (`api-token.entity.ts:34-35`) | no | `lastUsedAt` (`:37-38`), `revokedAt` |
| `user_themes` | yes (`user-theme.entity.ts:20-21`) | no | |
| `tables`, `columns`, `indexes`, `relationships`, `elements`, `sequence_diagrams`, `lifelines`, `sequence_messages` | **none** | **none** | |

**Important:** `projects.updatedAt` changes only when the project row itself is saved, for example a rename, archive, viewport, home or themes change. Writes to tables, elements and the like never touch the project row. Grep finds `updatedAt` used only for ordering at `projects.service.ts:74` and in the response mapping at `:383`, and there is no "touch project" helper. So "last activity" and "dormant project" can't be derived from what is stored today.

### 2.5 Roles / admin
- There is no role concept at all. `User` has `id, email, passwordHash, provider, providerId, displayName, createdAt` (`server/src/auth/user.entity.ts:12-36`).
- `AuthUser` is `{id, email, viaToken?}` (`server/src/auth/auth.types.ts`, interface `AuthUser`).
- Grep for `isAdmin|ADMIN|role` in `server/src` finds only slide placeholder roles (`elements/dto/slide.dto.ts:179`).
- The session is a JWT in an httpOnly cookie. It is checked without a database lookup (`auth.service.ts:77-88`) and lasts 7 days (`auth.types.ts`, `SESSION_MAX_AGE_MS`).
- The guard is optional and global (`server/src/auth/auth.module.ts:34`, `optional-auth.guard.ts:21-52`). Bearer API tokens are resolved first, and read-scoped tokens are limited to safe HTTP methods.
- OAuth is stubbed (`auth.controller.ts:106-120`), so all real accounts are email/password accounts.

### 2.6 Audit trail of writes
- There is no persisted record of who changed what.
- **Hook 1, the realtime bus.** Every feature service calls `RealtimePublisher.emit()` or `emitMany()` after persisting (`server/src/realtime/realtime.publisher.ts:22-36`). The payload is `MutationEvent {projectId, originClientId, mutation}` (`shared/src/realtime/index.ts:122-126`), and `SchemaMutation` is a 34-variant `kind` union (`:86-119`). The **actor is not in the payload.** `originClientId` is only a per-tab id, set to `'mcp-server'` for MCP calls (`mcp/src/api.ts:84,112`). EventEmitter2's `emit` is synchronous, so a listener runs inside the request's async context. An `AsyncLocalStorage` request context can therefore attribute the actor without changing the broadcast shape (and without leaking user ids to peers).
- **Hook 2, `WriteRevisionInterceptor`.** It already sees every non-GET request (`server/src/common/write-revision.ts:21-31`, registered at `main.ts:30`). It is the model for an analytics interceptor.
- **Hook 3, the MCP journal.** `mcp/src/journal.ts:19-45` keeps a before/after `SchemaModel` per tool call, in memory only and capped at 25 per project (`MAX_ENTRIES`). It is recorded in the `tool()` wrapper (`mcp/src/tools.ts:186-231`, push at `:223`). It is undo state, not an audit log, and it is lost when the process restarts. The tool name **is not sent to the API**: the headers are only `Authorization` and `X-Client-Id: mcp-server` (`mcp/src/api.ts:110-116`), so the server can't attribute requests to MCP tools today.

### 2.7 Data retention
- Project delete is a hard delete with FK cascade (`projects.service.ts:350-356`; cascades in `share-link.entity.ts:23`, `project-image.entity.ts:28`).
- Archive is a soft flag (`project.entity.ts:34-35`).
- Nothing purges dormant guest projects, orphaned images, expired or revoked share links, or revoked API tokens.
- There is **no account-deletion endpoint** (auth routes are `register`, `login`, `logout`, `me`, `api-tokens`, `oauth`: `auth.controller.ts:43-115`).
- `DATABASE_SYNCHRONIZE` defaults to `'true'` (`server/src/database/database.module.ts:21`). New analytics tables need real migrations, and prod must run with synchronize off.

### 2.8 Guest-user tracking
- Guests are identified by a random id in localStorage `dd.guestId` (`client/src/app/core/services/share-session.service.ts:12-22`), sent as `X-Guest-Id`.
- Guest projects are owned by `guest:<id>` (`server/src/auth/guest-id.ts`).
- Guest projects can be counted (`projects.controller.ts`, `guest-count`) and claimed on signup (`claim-guest`). This means "guests", "guest projects" and "guest-to-signup conversion" are derivable, but only as a current snapshot. No history of conversions is kept.
- Share-link guests on the realtime socket get roster names but nothing is persisted (`realtime.gateway.ts:88-114`).

### 2.9 API token usage tracking
- `lastUsedAt` is written at most once a minute per token, fire-and-forget (`server/src/auth/api-token.service.ts:98-106`). This is a good pattern to reuse.
- The in-memory per-token rate limit defaults to 600/min (`:13,31,84-96`).
- There are no per-route or per-tool counts, error counts or call history.
- Tokens can't reach the admin area because there is none yet. Admin routes must explicitly reject `viaToken` callers.

### 2.10 Client-side telemetry and privacy
- **No telemetry:** no gtag, PostHog, Sentry, Umami or Plausible (grep over `client/src`).
- **No cookie or consent banner, and no privacy page.** Cookies in use: the httpOnly session cookie `access_token`, partitioned (CHIPS) when cross-site (`auth.controller.ts`, `cookieOptions`).
- **localStorage:** `dd.guestId` (a persistent pseudonymous identifier) plus UI preferences (`editor.component.ts:329-346,1101`, `minimap.component.ts:41,184`). Sandbox state lives in sessionStorage.
- **Third-party request on every page load:** Google Fonts from `fonts.googleapis.com` (`client/src/index.html:14,19`). This sends the visitor's IP to Google, which is a known GDPR risk in the EU. Self-hosting the fonts removes it.
- **PII held:** email, displayName and bcrypt hash (`user.entity.ts`); IPs are not stored anywhere. Diagram content can contain anything a user types (table and column names, notes, code blocks, images), so analytics must never capture payloads.
- **Pseudo-projects to exclude from metrics:** guide sandboxes are client-memory only, but legacy database-backed ones carry `description = 'dbd-guide-sandbox'` (memory note `canvas-guide.md`, `GUIDE_SANDBOX_MARK`).

---

## 3. Gaps

1. **No identity of activity.** There are no last-seen or last-opened timestamps and no event history, so DAU/WAU/MAU, retention, active or dormant projects, and feature adoption can't be computed.
2. **No actor attribution on writes**, and the MCP tool name never reaches the server.
3. **No admin concept:** no role, no guard, no admin UI.
4. **No error visibility:** no exception filter, no client `ErrorHandler`, no error SDK, unstructured logs.
5. **No storage insight:** sizes per entity type, image bytes and largest projects require ad-hoc SQL on the Railway volume.
6. **No retention policy** for guests, images, expired links or revoked tokens, and no account deletion (also a GDPR gap).
7. **Shallow health check:** liveness only, no readiness check.
8. **Privacy groundwork missing:** no privacy page or consent mechanism, and Google Fonts leaks IPs. Both are needed before any third-party browser analytics is added.
9. **Present mode, PNG/SVG image export and guide visits are client-only.** The server only sees `present` socket messages when collaborating (`realtime.gateway.ts:164-176`), so these need a first-party client beacon.

---

## 4. Recommended architecture

### 4.1 Overview

```
 HTTP request ──► RequestContextMiddleware (ALS: requestId, actor, ipHash, ua, mcpTool)
                    │
                    ▼
            OptionalAuthGuard (existing) ──► AnalyticsInterceptor (route tpl, status, ms)
                    │                                │  (no DB I/O; push to buffer)
                    ▼                                ▼
           Feature services ──emit──► EventEmitter2 ──► AnalyticsListeners (@OnEvent)
           (RealtimePublisher, AuthService,             │   mutation kinds -> per-minute counters
            ProjectsService, SharingService …)          │   domain events  -> rows
                                                        ▼
 Socket gateway ──emit 'analytics.rt.*'──►      AnalyticsService (in-memory ring buffer
                                                 + minute aggregators, cap 10k, drop-oldest)
 Client beacon POST /api/telemetry ──►                  │ every 10 s or 500 rows
                                                        ▼
                                  analytics.sqlite (separate file, WAL, own DataSource)
                                   analytics_events ─nightly─► analytics_daily / analytics_actor_days
                                                        │                    analytics_project_snapshots
                                                        └─ optional sinks: PostHog (posthog-node), Sentry breadcrumbs
```

Design rules:
- **Nothing on the hot path waits on analytics.** Capture means pushing to an array. The flush runs on a `setInterval` timer as one transaction with one prepared multi-row INSERT. On shutdown, `app.enableShutdownHooks()` plus `onApplicationShutdown` flush the buffer.
- **Separate SQLite file** (`ANALYTICS_DATABASE_PATH`, default next to `DATABASE_PATH` on the Railway volume) through a second named TypeORM connection (`'analytics'`). SQLite allows one writer per file, so this keeps analytics inserts and nightly rollups out of the app database's write lock. It also gives analytics its own WAL and VACUUM schedule, and lets analytics be wiped without touching user data. Cross-database storage queries (section 5) run against the app connection, read-only.
- **Kill switch:** `ANALYTICS_ENABLED` (default `false` in dev, `true` in prod). When off, `track()` does nothing.
- **Allowlisted props only.** `track(name, props)` type-checks props against a per-event schema in `shared/src/analytics/events.ts`. Unknown keys are dropped, and props are capped at 1 KB.

### 4.2 Request context (ALS)
`server/src/common/request-context.ts` holds an `AsyncLocalStorage<RequestCtx>`. Middleware (or `nestjs-pino`'s `genReqId` plus a small middleware) sets:
- `requestId`: incoming `X-Request-Id` if it is a valid UUID, else `randomUUID()`. Echoed back in the response header.
- `actor`: filled after auth by the interceptor. One of:
  - `{type:'user', id}`
  - `{type:'token', id:userId, tokenId}`
  - `{type:'guest', id: hash(guestId)}`
  - `{type:'share', id: hash(shareToken)}`
  - `{type:'anon'}`
- `source`: `'mcp'` if `X-Client-Id === 'mcp-server'` or an `X-MCP-Tool` header is present, `'api'` if bearer without MCP, else `'web'`.
- `mcpTool`: from the new `X-MCP-Tool` header, validated as `^[a-z_]{1,48}$`.
- `ipHash`: `sha256(dailySalt + ip).slice(0,16)`. The salt rotates daily, is kept in memory, and is derived from `ANALYTICS_SALT_SECRET` plus the date. Raw IPs are never stored.
- `ua`: reduced to `browserFamily/osFamily` (for example `chrome/windows`) with a 20-line regex. No full user-agent string.

Because `RealtimePublisher.emit()` calls `EventEmitter2.emit()` synchronously, `@OnEvent` listeners run in the same ALS context. Attribution therefore needs **no change to `MutationEvent`**, and nothing new is broadcast to peers.

### 4.3 Event catalog (initial)

| name | source of capture | props (allowlisted) |
|---|---|---|
| `auth.signup` | `AuthService.register` emits `analytics.auth` | `method:'password'\|provider`, `hadGuestProjects:boolean` |
| `auth.login` / `auth.login_failed` | `AuthService.login` | `method` (failed: no actor id, only ipHash, which is useful for abuse detection) |
| `auth.logout` | controller | — |
| `guest.claimed` | `projects.controller` `claim-guest` | `count` |
| `project.created` / `.duplicated` / `.deleted` / `.archived` | `ProjectsService` | `type`, `fromTemplate?:boolean` |
| `project.opened` | interceptor on `GET /projects/:id`, **200 only (not 304)**, throttled once per (actor, project) per 30 min | `via:'owner'\|'share'\|'anon'` |
| `entity.write` | `@OnEvent(PROJECT_MUTATION(S)_EVENT)` | aggregated: `kind` (for example `element.created`), `elementType` for element kinds, `count` |
| `share.created` / `.revoked` | `SharingService` | `accessLevel`, `hasExpiry` |
| `share.opened` | `SharingService.getSharedGraph`, throttled per (link, ipHash) per hour | `accessLevel`, `linkId` (the link's uuid, never the token) |
| `realtime.joined` / `realtime.left` | gateway emits internal `analytics.rt` | `accessLevel`, `roomSize`, `sessionMs` (on leave) |
| `present.started` / `present.ended` | gateway `onPresent` (collaborative) + client beacon (solo) | `slides`, `durationMs`, `transitionKinds` |
| `export.file` / `export.sql` / `export.image` | `export-file`, `/export` routes; image export via client beacon | `format`, `dialect` |
| `import.file` / `import.content` | `projects.controller` `import`, `import-content` | `entityCounts` (numbers only), `imageCount`, `bytes` |
| `image.uploaded` | `ImagesService` | `mimeType`, `bytes`, `deduped:boolean` |
| `api.request` | interceptor | `route` (template, for example `PATCH /projects/:projectId/batch`), `status`, `ms`, `tokenId`, `mcpTool` (sampled, see 4.5) |
| `api.error` | exception filter | `route`, `status`, `errorClass`, `fingerprint` (hash of class + route + first stack frame). Never the message body when it might contain user content |
| `client.*` | `POST /api/telemetry` beacon | `client.pageview` (route template only), `client.present`, `client.export_image`, `client.guide_tab`, `client.error` (if Sentry is not used) |
| `token.created` / `token.revoked` | `ApiTokenService` | `scope` |

### 4.4 Schema (analytics.sqlite)

```sql
CREATE TABLE analytics_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,            -- epoch ms
  name        VARCHAR(48) NOT NULL,
  source      VARCHAR(8)  NOT NULL,        -- web | mcp | api | server | client
  actorType   VARCHAR(8)  NOT NULL,        -- user | token | guest | share | anon | system
  actorId     VARCHAR(64),                 -- userId, or hashed guest/share id
  tokenId     VARCHAR(36),
  projectId   VARCHAR(36),
  route       VARCHAR(96),                 -- route template, never a concrete path
  status      SMALLINT,
  durationMs  INTEGER,
  count       INTEGER NOT NULL DEFAULT 1,  -- >1 for pre-aggregated rows
  props       TEXT,                        -- JSON, allowlisted, <= 1 KB
  ipHash      CHAR(16),
  ua          VARCHAR(32),
  requestId   CHAR(36)
);
CREATE INDEX idx_ae_ts          ON analytics_events (ts);
CREATE INDEX idx_ae_name_ts     ON analytics_events (name, ts);
CREATE INDEX idx_ae_actor_ts    ON analytics_events (actorId, ts);
CREATE INDEX idx_ae_project_ts  ON analytics_events (projectId, ts);

CREATE TABLE analytics_daily (            -- forever; tiny
  day        CHAR(10) NOT NULL,           -- 'YYYY-MM-DD' UTC
  name       VARCHAR(48) NOT NULL,
  dim        VARCHAR(96) NOT NULL DEFAULT '',  -- kind / route / mcpTool / elementType
  source     VARCHAR(8)  NOT NULL DEFAULT '',
  events     INTEGER NOT NULL,            -- SUM(count)
  actors     INTEGER NOT NULL,            -- COUNT(DISTINCT actorId)
  errors     INTEGER NOT NULL DEFAULT 0,
  p50Ms      INTEGER, p95Ms INTEGER,
  PRIMARY KEY (day, name, dim, source)
);

CREATE TABLE analytics_actor_days (       -- DAU/WAU/MAU + retention cohorts after raw purge
  day CHAR(10) NOT NULL, actorType VARCHAR(8) NOT NULL, actorId VARCHAR(64) NOT NULL,
  source VARCHAR(8) NOT NULL,
  PRIMARY KEY (day, actorType, actorId, source)
) WITHOUT ROWID;

CREATE TABLE analytics_project_snapshots ( -- nightly storage snapshot (section 5)
  day CHAR(10) NOT NULL, projectId VARCHAR(36) NOT NULL, ownerKind VARCHAR(8) NOT NULL,
  tables INTEGER, columns INTEGER, relationships INTEGER, elements INTEGER,
  elementsByType TEXT, sequenceItems INTEGER, slides INTEGER,
  images INTEGER, imageBytes INTEGER, textBytes INTEGER, approxBytes INTEGER,
  lastOpenedAt INTEGER, shareLinksActive INTEGER,
  PRIMARY KEY (day, projectId)
) WITHOUT ROWID;
```

App database changes (migrations in `server/migrations/`):
- `users.role VARCHAR(16) NOT NULL DEFAULT 'user'`, `users.lastSeenAt DATETIME NULL`, `users.lastLoginAt DATETIME NULL`
- `projects.lastOpenedAt DATETIME NULL`
- `share_links.lastUsedAt DATETIME NULL`, `share_links.useCount INTEGER NOT NULL DEFAULT 0`

All of these use the throttled fire-and-forget pattern from `ApiTokenService.touch` (`api-token.service.ts:98-106`), with an in-memory map and at most one UPDATE per row per 10-60 minutes. The share-link counter is incremented in memory and flushed with the analytics batch, as one `UPDATE ... SET useCount = useCount + ?` per link.

### 4.5 Load control (sampling, aggregation, batching)
- **Mutations:** `entity.write` is never one row per mutation. Listeners increment `Map<minute|projectId|actorKey|kind|elementType, count>`, and the flush converts each key into one row with `count = N`. A 500-element `batch` PATCH becomes a handful of rows.
- **Move kinds** (`table.moved`, `element.moved`, `lifeline.moved`, `message.moved`) are counted the same way. They are the noisiest kinds, which is why aggregation is mandatory.
- **`api.request`:**
  - Recorded for every non-GET request, every request with status ≥ 400, every request slower than `SLOW_REQUEST_MS` (default 1000), and every token or MCP request.
  - Other successful GETs are sampled at `ANALYTICS_GET_SAMPLE` (default 0.05), and the sample rate is stored in props so counts can be scaled back up.
  - 304 responses are counted in memory only (a per-minute counter row).
- **Socket traffic:** cursor, laser and selection events are never recorded. Only `realtime.joined`/`left` and `present` are.
- **Buffer limits:** the buffer holds at most 10,000 rows. When full it drops the oldest and increments an `analytics.dropped` counter, which is itself flushed as a row.
- **Flush:** every 10 s, or immediately at 500 buffered rows, using `queueMicrotask` so the triggering request is never blocked. better-sqlite3 is synchronous, so the flush runs on the event loop: keep each batch at 500 rows or fewer, which takes about 1-3 ms in WAL mode.
- **Client beacon:**
  - `navigator.sendBeacon` with batches of up to 20 events, flushed every 15 s and on `visibilitychange`.
  - Server side: rate limited per ipHash to 60 events/min, JSON body capped at 8 KB, event names checked against the allowlist.

### 4.6 Retention and rollups
- `@nestjs/schedule` cron at 02:10 UTC, in `AnalyticsRollupService`:
  1. Upsert `analytics_daily` and `analytics_actor_days` for yesterday and the day before (late flushes are idempotent because these are upserts).
  2. Write `analytics_project_snapshots` (section 5), in batches of 200 projects using read-only queries on the app connection.
  3. Purge `analytics_events` older than `ANALYTICS_RAW_RETENTION_DAYS` (90). Purge `api.error` rows after 30 days. Keep project snapshots for 30 days, plus one per month forever.
  4. `PRAGMA incremental_vacuum` (set `auto_vacuum=INCREMENTAL` at creation).
- Account deletion (new, see Privacy) also deletes `analytics_events` and `analytics_actor_days` rows for that `actorId`.
- Optional app-data hygiene jobs, reported in the dashboard but **not auto-run** until the owner opts in:
  - guest projects not opened in 180 days;
  - images whose `fileId` is no longer referenced by any element;
  - share links expired or revoked for more than 90 days.

### 4.7 Observability basics
- **Structured logs:** `nestjs-pino` (`pino-http`) in `app.module.ts` with:
  - `genReqId` taken from the request context;
  - `customProps` adding `actorType`, `source`, `mcpTool`, `projectId`;
  - redaction of `req.headers.authorization`, `cookie`, `x-share-token`, `x-guest-id`, and request and response bodies;
  - `autoLogging.ignore` for `/api/health`.
  JSON output in prod; `pino-pretty` only in dev. Use it as the Nest logger via `app.useLogger(app.get(Logger))`, and replace `console.log` at `main.ts:53`.
- **Request id:** echo `X-Request-Id`, add it to CORS `exposedHeaders`, and have the client show it in error toasts ("ref: ab12cd") so a user report can be matched to a log line.
- **Exception filter:** `AllExceptionsFilter` (`APP_FILTER`). For 5xx it logs at error level with the stack, sends to Sentry, and tracks `api.error`. For 4xx it logs at debug or info only. The response shape stays the same as Nest's default.
- **Slow queries:** set TypeORM `maxQueryExecutionTime: Number(env.SLOW_QUERY_MS ?? 200)` with a custom logger that forwards `logQuerySlow` to pino at warn level. Leave `logging` off, but always allow `['error','warn']`.
- **Health checks:**
  - `GET /api/health` stays liveness (no database).
  - New `GET /api/health/ready` runs `SELECT 1` on both connections, checks for pending migrations (`dataSource.showMigrations()`, cached), and reports `{db:'ok', analytics:'ok', bufferDepth, uptimeS, version}`. It returns 503 on failure.
  - Point Railway's healthcheck path at `/api/health/ready`.
  - Optionally use `@nestjs/terminus` instead of hand-rolling it.
- **MCP service:** add the same JSON logging (pino) and log `tool`, `ms` and `ok` per call in the `tool()` wrapper (`mcp/src/tools.ts:207-228`). It already measures before and after.

---

## 5. Data-stored insights (storage queries)

These run against the **app** database, read-only, from `AdminStorageService`. The expensive ones run only in the nightly snapshot or on an explicit "Refresh" (rate limited to once per 5 minutes). Every query excludes guide sandboxes with `WHERE p.description IS NOT 'dbd-guide-sandbox'`.

```sql
-- Row counts per entity type
SELECT 'users' t, COUNT(*) n FROM users UNION ALL
SELECT 'projects', COUNT(*) FROM projects UNION ALL
SELECT 'tables', COUNT(*) FROM tables UNION ALL
SELECT 'columns', COUNT(*) FROM columns UNION ALL
SELECT 'indexes', COUNT(*) FROM indexes UNION ALL
SELECT 'relationships', COUNT(*) FROM relationships UNION ALL
SELECT 'elements', COUNT(*) FROM elements UNION ALL
SELECT 'sequence_diagrams', COUNT(*) FROM sequence_diagrams UNION ALL
SELECT 'lifelines', COUNT(*) FROM lifelines UNION ALL
SELECT 'sequence_messages', COUNT(*) FROM sequence_messages UNION ALL
SELECT 'project_images', COUNT(*) FROM project_images UNION ALL
SELECT 'share_links', COUNT(*) FROM share_links UNION ALL
SELECT 'api_tokens', COUNT(*) FROM api_tokens UNION ALL
SELECT 'user_themes', COUNT(*) FROM user_themes;

-- On-disk bytes per table + index (better-sqlite3 bundles SQLite with DBSTAT; verify with
-- `SELECT * FROM dbstat LIMIT 1`, fall back to SUM(LENGTH(...)) estimates if absent)
SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC;
-- Whole DB: PRAGMA page_count; PRAGMA page_size; PRAGMA freelist_count; + fs.stat of the -wal file.

-- Elements by type (feature adoption by stored content: shape/text/pen/arrow/image/code/grid/frame…)
SELECT type, COUNT(*) n, SUM(LENGTH(COALESCE(text,''))) textBytes FROM elements GROUP BY type ORDER BY n DESC;
-- Slides: SELECT COUNT(*) FROM elements WHERE type='frame' AND slideJson IS NOT NULL;

-- Images
SELECT mimeType, COUNT(*) n, SUM(LENGTH(data)) bytes, COUNT(DISTINCT sha256) uniq
FROM project_images GROUP BY mimeType;
-- Orphans (uploaded but no element references them)
SELECT COUNT(*), SUM(LENGTH(i.data)) FROM project_images i
WHERE NOT EXISTS (SELECT 1 FROM elements e WHERE e.fileId = i.id);

-- Largest projects (nightly snapshot; do NOT run on every dashboard load)
SELECT p.id, p.name, p.ownerId,
  (SELECT COUNT(*) FROM tables t WHERE t.projectId=p.id) tables,
  (SELECT COUNT(*) FROM elements e WHERE e.projectId=p.id) elements,
  (SELECT COALESCE(SUM(LENGTH(e.text)),0) FROM elements e WHERE e.projectId=p.id) textBytes,
  (SELECT COALESCE(SUM(LENGTH(i.data)),0) FROM project_images i WHERE i.projectId=p.id) imageBytes
FROM projects p ORDER BY imageBytes + textBytes DESC LIMIT 25;

-- Active vs dormant (needs the new projects.lastOpenedAt; until then fall back to updatedAt and label it "approx")
SELECT CASE
  WHEN COALESCE(lastOpenedAt, updatedAt) >= datetime('now','-7 days')  THEN 'active_7d'
  WHEN COALESCE(lastOpenedAt, updatedAt) >= datetime('now','-30 days') THEN 'active_30d'
  WHEN COALESCE(lastOpenedAt, updatedAt) >= datetime('now','-180 days') THEN 'idle'
  ELSE 'dormant' END bucket,
  COUNT(*) FROM projects GROUP BY bucket;

-- Users by auth type (+ guests and ownerless)
SELECT CASE WHEN provider IS NOT NULL THEN provider
            WHEN passwordHash IS NOT NULL THEN 'password' ELSE 'unknown' END method, COUNT(*)
FROM users GROUP BY method;
SELECT COUNT(DISTINCT ownerId) guests, COUNT(*) guestProjects FROM projects WHERE ownerId LIKE 'guest:%';
SELECT COUNT(*) FROM projects WHERE ownerId IS NULL;          -- legacy anonymous

-- Share links active by level
SELECT accessLevel, COUNT(*) FROM share_links
WHERE revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > datetime('now'))
GROUP BY accessLevel;

-- API tokens
SELECT scope, COUNT(*) total,
  SUM(revokedAt IS NULL) active,
  SUM(lastUsedAt >= datetime('now','-7 days')) used7d
FROM api_tokens GROUP BY scope;

-- Projects per user distribution
SELECT bucket, COUNT(*) FROM (SELECT ownerId, CASE WHEN COUNT(*)=1 THEN '1' WHEN COUNT(*)<=5 THEN '2-5'
  WHEN COUNT(*)<=20 THEN '6-20' ELSE '21+' END bucket FROM projects WHERE ownerId NOT LIKE 'guest:%'
  AND ownerId IS NOT NULL GROUP BY ownerId) GROUP BY bucket;
```

Check `elements`, `tables` and similar for a `projectId` index first, and add one if missing. The performance pass should own that. Without it, every per-project subquery is a full scan.

---

## 6. Admin wall and dashboard spec

### 6.1 Role and guard (server)
- **Role:** add `users.role` (`'user' | 'admin'`, default `'user'`).
- **Bootstrap:** on boot, `AdminBootstrapService` promotes any existing user whose normalized email is in `ADMIN_EMAILS` (comma separated) and logs this. On register or login, a matching email is also promoted. The env allowlist is a bootstrap only; the database column is authoritative, so an admin can be demoted by removing them from the env and running the demote endpoint or a SQL update.
- **Not in the JWT:** the role is not put in the JWT, so demotion takes effect immediately and a leaked old token can't carry admin rights. `AdminGuard`:
  1. requires `request.user`, and requires `!request.user.viaToken` (API tokens can never reach admin routes, even admin-owned ones);
  2. loads `role` by id, with a 60 s in-memory cache;
  3. throws **404** (not 403) for non-admins so the admin surface isn't discoverable;
  4. requires the CSRF posture the security pass defines for cookie-authenticated mutating routes (admin is almost all GET);
  5. applies a stricter rate limit (for example 120 requests/min per admin) through the security pass's throttler.
- **Placement:** `server/src/admin/` (`AdminModule`) with `@Controller('admin')` and `@UseGuards(AdminGuard)` at class level. Admin routes are **read-only** in v1. Admin never grants project access: there is no "open any project" bypass of `AccessService`. Project names are shown; content is not.
- **Auditing admins:** every admin request is itself tracked (`admin.viewed`, with route).
- **Client flag:** `CurrentUserResponse` (shared) gains `isAdmin?: boolean`, returned by `/auth/me` only when true.

### 6.2 Endpoints (`/api/admin/*`, all GET unless noted)

| Endpoint | Returns |
|---|---|
| `overview?range=7d\|30d\|90d` | KPIs: DAU / WAU / MAU (users + guests separately), new signups, guest→signup conversions (`guest.claimed`), projects created, active projects, MCP calls, error rate (5xx ÷ requests), p95 latency, DB size; each with previous-period delta |
| `timeseries?metric=&dim=&from=&to=` | daily series from `analytics_daily` / `analytics_actor_days` (`active_users`, `signups`, `projects_created`, `entity_writes`, `mcp_calls`, `errors`, `share_opens`, `realtime_joins`, `presents`, `exports`) |
| `features?range=` | feature adoption: entity writes by kind and `elementType` (shapes, text, pen, image, code, grid, frame/slide, sequence…), % of active users using each, presents, exports by format, imports, laser (client beacon count) |
| `retention?cohort=week` | weekly signup cohorts × weeks-active matrix (from `analytics_actor_days`) |
| `users?q=&sort=createdAt\|lastSeenAt\|projects\|bytes&page=` | email, displayName, method, createdAt, lastSeenAt, projects count, storage bytes, active tokens |
| `users/:id` | the above plus a 90-day activity sparkline and top features. No project content |
| `projects?sort=size\|lastOpened\|writes&page=` | id, name, ownerKind (user / guest / anon), sizes from latest snapshot, lastOpenedAt, active share links, writes over 30 days |
| `storage` | row counts, dbstat bytes per table, image bytes by MIME type, orphan images, DB + WAL file size, analytics DB size, snapshot date + `POST storage/refresh` (rate limited) |
| `api-tokens?range=` | per token (prefix, owner email, scope): calls, errors, last used, top MCP tools / routes; global MCP tool leaderboard |
| `errors?range=` | grouped by fingerprint: route, status, count, first seen / last seen, sample requestId (+ Sentry link if configured) |
| `realtime` | live (in-memory from gateway): open rooms, participants, presenters; plus 30-day joins / session length |
| `events?name=&from=&to=&cursor=` | raw event explorer (paged, max 200), for debugging capture |

Response DTOs live in `shared/src/admin/` so client and server share the types.

### 6.3 Client
- **Route:** add an entry to `client/src/app/app.routes.ts` before `**`:
  ```ts
  { path: 'admin', canMatch: [adminGuard], canActivate: [adminGuard],
    loadChildren: () => import('./features/admin/admin.routes').then(m => m.ADMIN_ROUTES) }
  ```
  `canMatch` stops the router from matching, and so from downloading the lazy chunk, for non-admins, who fall through to `**` and the home page. `canActivate` re-checks on in-app navigation.
- **Guard:** `adminGuard` lives in `client/src/app/core/guards/admin.guard.ts`, a folder that already exists but is empty. It must stay outside the lazy chunk because it runs before the chunk loads. It awaits `AuthService.currentUser()` and returns `user?.isAdmin === true`.
- **Code splitting:** nothing in the main bundle imports from `features/admin/**`. Lint this with an `eslint no-restricted-imports` rule.
- **Entry point:** an "Admin" item in the account menu (`client/src/app/app.component.html:219-224`), shown only when `isAdmin`.
- **Folder structure** (target layout from the cleanliness pass):
  ```
  features/admin/
    admin.routes.ts                 ADMIN_ROUTES (shell + children)
    admin-shell.component.*         left rail (Overview, Usage, Users, Projects, Storage, API & MCP, Errors, Realtime, Events) + range picker
    state/admin.store.ts            signalStore: range, filters, cached responses per endpoint, loading/error
    services/admin-api.service.ts   HttpClient wrappers for /api/admin/*
    models/admin.models.ts          view models (re-export shared/src/admin DTOs)
    components/
      kpi-tile/                     value, delta, sparkline
      line-chart/                   hand-rolled SVG area/line, multi-series, hover crosshair + tooltip
      bar-list/                     horizontal bars (top N)
      cohort-grid/                  retention heat grid
      data-table/                   sortable, paged table
      stat-bar/                     stacked proportion bar (auth types, share levels)
    features/
      overview/  usage/  users/  user-detail/  projects/  storage/  api-tokens/  errors/  realtime/  events/
  ```
- **Design system:** reuse `shared/ui` (`dd-icon`, `dd-segmented` for the range picker, `dd-select`, `dd-input` for search, `dd-popover`), MatTooltip, and the `--dd-*` tokens for both themes (Paper and Graphite). See the memory notes on the UI redesign and the design-system artifact. There are no table, card or tab primitives in `shared/ui` yet, so `data-table` and `kpi-tile` start in `features/admin/components`. They can be promoted to `shared/ui` if another feature needs them.
- **Charts:** hand-rolled SVG components (about 150-250 lines each) using `viewBox` scaling, `--dd-*` stroke and fill tokens, and `@for` over points. The data is small (≤ 365 points × a few series), so no library is warranted, and the dashboard stays out of bundle-budget concerns. If richer charts are needed later, use **uPlot** (~50 KB, framework-free) inside the lazy chunk only.
- **Telemetry beacon:** `client/src/app/core/services/telemetry.service.ts`, under 2 KB and in the main bundle.
  - Methods: `track(name, props)` against the shared allowlist, plus a pageview on `NavigationEnd` that sends the **route template** (`/projects/:projectId`), never ids.
  - Uses `sendBeacon`; disabled unless `environment.telemetry === true`.
  - Called from the present overlay start/end, client-side image export, guide tab changes, and the laser tool toggle.

---

## 7. External services

Recommended combination, all **env-gated** (no key means the SDK is never initialized, which is the state in dev and local):

| Service | Why | How it plugs in | Free tier (verify current limits) |
|---|---|---|---|
| **Sentry** (recommended, phase 3a) | Best-in-class error grouping, stack traces with source maps, release tracking for **both** Angular and Nest; links from the admin Errors page | Server: `@sentry/nestjs` init in a `server/src/instrument.ts` imported first in `main.ts`, `SentryModule.forRoot()`, capture in `AllExceptionsFilter`; env `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (Railway git SHA). Client: `@sentry/angular` `ErrorHandler` + `TraceService` in `app.config.ts`, `environment.sentryDsn`; upload source maps in the Railway build. `sendDefaultPii:false`, `beforeSend` strips request bodies + `X-Share-Token`/cookies; no Session Replay; traces sample 0.05 | Developer plan: 1 user, ~5k errors/mo |
| **Better Stack Uptime** or **UptimeRobot** (recommended, phase 3a) | External view of availability; alerts by email | Monitors on `https://<api>/api/health/ready` (expect 200 + `"db":"ok"`), client root, and MCP `/health`; optional public status page | Better Stack free: 10 monitors, 3-min checks; UptimeRobot free: 50 monitors, 5-min |
| **PostHog Cloud EU** (optional, phase 3b) | Funnels, retention, path analysis and dashboards beyond what the hand-built admin offers; Node SDK lets the server forward the **same** sanitized events | `posthog-node` as a second sink in `AnalyticsService.flush()` (`POSTHOG_KEY`, `POSTHOG_HOST=https://eu.i.posthog.com`), `distinctId` = userId or hashed guest id, `$process_person_profile:false` for guests. Browser SDK only **after consent**, with `persistence:'memory'` until consent, `autocapture:false`, `disable_session_recording:true` by default; never capture element text (`mask_all_text`) | ~1M events/mo, 5k session recordings/mo |
| **Railway metrics + logs** (already there) | CPU/RAM/network per service; with pino JSON the log explorer becomes filterable by `requestId`, `level`, `route` | No code beyond phase 0.5 logging | Included |

Not recommended now:
- **Umami / Plausible.** Page analytics is already covered by the first-party `client.pageview` plus the admin dashboard, and PostHog if enabled. Self-hosting Umami on Railway would add a service and a Postgres to maintain. Reconsider only if the owner wants a public-facing, cookie-free stats page.
- **Grafana Cloud.** Overkill at this scale. Revisit if pino logs need longer retention than Railway keeps. The free tier includes logs (Loki) and a pino transport exists.

---

## 8. Privacy

- **No content capture:** events carry ids, counts, kinds, route templates and durations. They never carry table or column names, text, code, image bytes, share tokens, emails or raw URLs. This is enforced by the shared allowlist and a unit test that fails if any event schema declares a free-text field.
- **IPs:** only `sha256(dailySalt + ip)` truncated to 16 hex characters. Because the salt rotates daily and isn't persisted, hashes can't be linked across days and can't be reversed. They are used only for rate limiting and same-day unique counts. User-agent strings are reduced to browser and OS family.
- **Pseudonymous ids:** guest ids and share tokens are hashed before storage. User ids are stored, since they are needed for DAU and per-user admin views.
- **Retention:** raw events 90 days, errors 30 days, aggregates indefinitely (anonymous counts only, apart from `analytics_actor_days`, which is deleted along with the user).
- **Account deletion** (new requirement surfaced by this audit): `DELETE /api/auth/me` deletes the user, their projects (cascade) and their tokens, and erases their analytics rows. This is needed for GDPR erasure. It's a security or product task, but analytics must hook it.
- **Consent:**
  - First-party, cookieless, aggregated analytics for operating the service (security, capacity, feature usage) can rely on legitimate interest, with disclosure in a privacy page.
  - The client beacon uses no cookies or localStorage. It reuses the existing `dd.guestId` only after hashing on the server.
  - **Before enabling the PostHog browser SDK or any session replay, add a consent banner** (reject is as easy as accept, nothing loads before a choice, and the choice is stored in localStorage). Sentry on the client without replay and without PII is generally fine under legitimate interest, but disclose it.
- **Google Fonts:** self-host the fonts (`@fontsource/*` packages or copy the woff2 files into `client/src/assets/fonts`) to stop sending visitor IPs to Google (`client/src/index.html:14,19`).
- **Admin access to data:** admins see aggregate data, user emails and project names and sizes, but not project content. Admin views are tracked as events, which gives an audit trail of the admins themselves.
- **Privacy page:** a `/privacy` route or static page listing the data stored (account, projects, guest id), analytics (what, how long), processors (Railway; Sentry and PostHog if enabled), and a contact for deletion.

---

## 9. Phased plan

Each phase can ship on its own. Names in parentheses mark changes to existing files; everything else is new.

### Phase 0: admin role, guard and observability basics (about 1-2 days)
Admin and role:
- `server/migrations/17939xxxxxxxxx-AddUserRoleAndActivity.ts`: `users.role`, `users.lastSeenAt`, `users.lastLoginAt`, `projects.lastOpenedAt`, `share_links.lastUsedAt`, `share_links.useCount`
- (`server/src/auth/user.entity.ts`): `role`, `lastSeenAt`, `lastLoginAt`
- (`server/src/projects/project.entity.ts`): `lastOpenedAt`
- (`server/src/sharing/share-link.entity.ts`): `lastUsedAt`, `useCount`
- `server/src/admin/admin.module.ts`, `server/src/admin/admin.guard.ts`, `server/src/admin/admin-bootstrap.service.ts` (`ADMIN_EMAILS`)
- `server/src/admin/admin.controller.ts`, with only `GET admin/ping` to start
- (`server/src/auth/auth.service.ts`): `isAdmin` in `toResponse`; promote on register or login if allowlisted; set `lastLoginAt`
- (`shared/src/...` `CurrentUserResponse`): `isAdmin?: boolean`
- (`server/src/app.module.ts`): import `AdminModule`
- `client/src/app/core/guards/admin.guard.ts`
- (`client/src/app/app.routes.ts`): `admin` lazy route with `canMatch` and `canActivate`
- `client/src/app/features/admin/admin.routes.ts` and `admin-shell.component.*` (placeholder)
- (`client/src/app/app.component.html` / `.ts`): "Admin" item in the account menu

Observability basics (phase 0.5):
- `server/src/common/request-context.ts` (ALS) and `server/src/common/request-context.middleware.ts`
- (`server/src/app.module.ts`): `LoggerModule.forRoot` from `nestjs-pino`
- (`server/src/main.ts`): `useLogger`, `enableShutdownHooks`, remove `console.log`, CORS `exposedHeaders: ['X-Request-Id']`
- `server/src/common/all-exceptions.filter.ts` (`APP_FILTER`)
- (`server/src/database/data-source.ts`): `maxQueryExecutionTime` plus a pino `typeorm-logger.ts`
- (`server/src/health/health.controller.ts`): `GET health/ready`
- (`server/package.json`): `nestjs-pino`, `pino-http`, `pino-pretty` (dev)
- (`mcp/src/http.ts`, `mcp/src/tools.ts`): pino logs and per-tool timing

### Phase 1: event capture (about 3-4 days)
Server analytics module:
- `server/src/database/analytics-data-source.ts`: named `'analytics'` connection, `ANALYTICS_DATABASE_PATH`
- `server/migrations-analytics/17940xxxxxxxxx-CreateAnalytics.ts`
- `server/src/analytics/analytics.module.ts`, `analytics.service.ts` (buffer, aggregators, flush, sinks interface)
- `server/src/analytics/entities/analytics-event.entity.ts`, `analytics-daily.entity.ts`, `analytics-actor-day.entity.ts`, `analytics-project-snapshot.entity.ts`
- `server/src/analytics/analytics.interceptor.ts` (global, after the auth guard)
- `server/src/analytics/analytics.listeners.ts` (`@OnEvent` on `PROJECT_MUTATION_EVENT`, `PROJECT_MUTATIONS_EVENT`, and `analytics.*` domain events)
- `server/src/analytics/activity-touch.service.ts`: throttled `lastSeenAt`, `lastOpenedAt`, share-link `lastUsedAt`/`useCount`, generalizing the `ApiTokenService.touch` pattern
- `server/src/analytics/telemetry.controller.ts`: `POST /api/telemetry`, rate limited, allowlist
- `server/src/analytics/privacy.ts`: ip hash, ua family, guest/share hash

Shared:
- `shared/src/analytics/events.ts`: event names and prop schemas, used by server, client and MCP
- `shared/src/analytics/index.ts` (and the shared barrel)

Domain emits (one-line `emitter.emit('analytics.*', ...)` calls, no awaits):
- (`server/src/auth/auth.service.ts`, `auth.controller.ts`)
- (`server/src/projects/projects.service.ts`, `projects.controller.ts`: open, create, duplicate, delete, archive, import, export, claim-guest)
- (`server/src/sharing/sharing.service.ts`)
- (`server/src/images/images.service.ts`)
- (`server/src/auth/api-token.service.ts`)
- (`server/src/export/export.controller.ts` or its service)
- (`server/src/realtime/realtime.gateway.ts`): join, leave and present emits on the internal bus (no DB)

MCP:
- (`mcp/src/api.ts`): `X-MCP-Tool` and `User-Agent: devdesigner-mcp/<version>` headers; the API client takes a `currentTool` setter
- (`mcp/src/tools.ts`): set the tool name in the `tool()` wrapper before `run`

Client:
- `client/src/app/core/services/telemetry.service.ts`
- (`client/src/environments/environment*.ts`): `telemetry`, `sentryDsn`, `posthogKey` flags
- Hooks in the present overlay, the image-export path in `features/editor/export`, the guide component and the laser tool

Config and tests:
- (`server/src/main.ts`): CORS `allowedHeaders` unchanged; the beacon is same-origin JSON
- Env: `ANALYTICS_ENABLED`, `ANALYTICS_DATABASE_PATH`, `ANALYTICS_SALT_SECRET`, `ANALYTICS_GET_SAMPLE`, `SLOW_REQUEST_MS`, `ANALYTICS_RAW_RETENTION_DAYS`
- `server/src/analytics/analytics.service.spec.ts`: aggregation, flush batching, buffer cap, allowlist and no-content checks

### Phase 2: admin dashboard (about 4-5 days)
Server:
- `server/src/admin/admin-analytics.service.ts`: overview, timeseries, features, retention, api-tokens, errors, events; reads `analytics_daily`/`actor_days` plus raw events for ranges under 90 days
- `server/src/admin/admin-storage.service.ts`: the section 5 queries, snapshot reads, refresh
- `server/src/admin/admin-users.service.ts`: users list and detail, projects list
- (`server/src/admin/admin.controller.ts`): endpoints from 6.2
- (`server/src/realtime/realtime.gateway.ts`): read-only `snapshot()` accessor for live rooms

Shared:
- `shared/src/admin/*.ts`: response DTOs

Client:
- `client/src/app/features/admin/state/admin.store.ts`, `services/admin-api.service.ts`, `models/admin.models.ts`
- `features/admin/components/{kpi-tile,line-chart,bar-list,cohort-grid,data-table,stat-bar}/`
- `features/admin/features/{overview,usage,users,user-detail,projects,storage,api-tokens,errors,realtime,events}/`
- (`client/eslint.config` / root `eslint.config.mjs`): `no-restricted-imports` that blocks `features/admin/**` imports from outside `features/admin`

### Phase 3: external integrations (about 1-2 days)
3a (recommended):
- Sentry:
  - `server/src/instrument.ts`; (`server/src/main.ts`) imports it first
  - (`server/src/app.module.ts`): `SentryModule`
  - (`server/src/common/all-exceptions.filter.ts`): capture
  - (`client/src/app/app.config.ts`): Sentry `ErrorHandler` and `TraceService`
  - `client/src/app/core/sentry.ts`: init, gated on `environment.sentryDsn`
  - Railway build step: source-map upload with `SENTRY_AUTH_TOKEN` as a build-only secret
- Uptime monitors: dashboard configuration only, no code. Set the Railway healthcheck path to `/api/health/ready`.

3b (optional):
- PostHog:
  - `server/src/analytics/sinks/posthog.sink.ts` (`posthog-node`, gated on `POSTHOG_KEY`)
  - Client: `client/src/app/core/consent/consent.service.ts` and `consent-banner.component.*` (must ship first)
  - `client/src/app/core/services/posthog.service.ts`: lazy `import('posthog-js')` only after consent
- Privacy: `/privacy` page (`client/src/app/features/legal/privacy.component.*` plus a route) and self-hosted fonts (`client/src/index.html`, `client/src/styles.scss`, `client/src/assets/fonts/`)

### Phase 4: retention, rollups and hygiene (about 1-2 days)
- (`server/package.json`): `@nestjs/schedule`; (`server/src/app.module.ts`): `ScheduleModule.forRoot()`
- `server/src/analytics/analytics-rollup.service.ts`: nightly daily and actor-day upserts, project snapshots, purge, incremental vacuum
- (`server/src/admin/admin-storage.service.ts`): read snapshots, "last rollup" status
- `server/src/admin/admin-hygiene.service.ts` plus `POST admin/hygiene/preview` (dry-run counts only; actual deletes stay manual or opt-in)
- Account deletion hook: an `analytics.erase(userId)` call from the security pass's `DELETE /auth/me`

---

## 10. Cross-area dependencies

**Security pass (must come first for phase 0):**
- `AdminGuard` sits on the hardened auth layer. It depends on:
  - JWT secret enforcement (`auth.module.ts:28` currently defaults to `'change-me-in-production'`, which must fail fast in prod);
  - the session cookie options;
  - the CSRF stance for cookie-authenticated routes.
- Prod sets its own `JWT_SECRET` in Railway (owner confirmed), so the default is not live there. Still land the fail-fast check (security S1.4) before or with the admin role, so an environment that forgets the variable can't expose admin sessions.
- Rate limiting: reuse the security pass's global throttler (for example `@nestjs/throttler`) for `/api/admin/*` (strict) and `POST /api/telemetry` (per ipHash). Don't build a second limiter. The in-memory API-token limiter (`api-token.service.ts:84-96`) is per process; note this if Railway ever scales beyond one replica.
- Account deletion (`DELETE /auth/me`) and the privacy page belong to security/privacy work. Analytics adds the erase hook.
- The 200 MB JSON body limit (`main.ts:15`) must **not** apply to `/api/telemetry`. Mount a route-specific small limit (8 KB).
- API tokens must never reach admin routes. The guard enforces this, and the security pass should add a test for it.

**Performance pass:**
- Event capture must not add synchronous database writes on hot paths. The design guarantees this with buffered, aggregated, separate-file batch inserts. The performance pass should still benchmark `PATCH /projects/:id/batch` and drag-move bursts with `ANALYTICS_ENABLED=true` and false, and set the flush interval and batch size.
- `lastOpenedAt`/`lastSeenAt` touches must stay throttled and fire-and-forget.
- `projectId` indexes on child tables (needed by the section 5 queries and the nightly snapshot) belong to the performance pass. Snapshots run off-peak in batches.
- The ETag/304 path on `GET /projects/:id` (`projects.controller.ts:120-144`) must stay cheap: `project.opened` is recorded only on 200 responses, and 304s are counted in memory.

**Cleanliness refactor:**
- Build the frontend admin feature in the target layout `features/admin/{state,services,models,components,features/...}`. The admin dashboard is a good first feature to establish that convention. Global state today lives in `client/src/app/stores/`; admin state stays local to `features/admin/state`.
- The guard goes in `core/guards/` (eagerly available); the telemetry service goes in `core/services/`.
- Backend: `server/src/admin/` and `server/src/analytics/` as top-level feature modules, matching the existing per-feature folders (`auth/`, `projects/`, `sharing/`). Request context and the exception filter go in `server/src/common/`. If the refactor introduces `server/src/modules/*` or `core/` folders, these move with it; keep their imports narrow (analytics depends only on the shared event catalog and `EventEmitter2`, not on feature services).
- Shared types go in `shared/src/analytics/` and `shared/src/admin/`, alongside the existing `shared/src/realtime/`.

**Recommended placement in the overall sequence:**
1. **Observability basics (phase 0.5) and Sentry (3a):** as early as possible, ideally right after or with the security pass. They make every later pass measurable and debuggable.
2. **Security pass**, then **phase 0** (role and guard).
3. **Performance pass and phase 1** (event capture) together, so capture is benchmarked against the optimized hot paths.
4. **Cleanliness refactor skeleton**, then **phase 2** (dashboard), built as an exemplar of the new structure.
5. **Phase 3b** (PostHog, consent, privacy page) and **phase 4** (rollups, retention) last. The privacy page and font self-hosting can move earlier at any time because they are independent.

---

## Phase 1 benchmark

Measured 2026-11-10 on the built server (`tsc -p server/tsconfig.build.json`, `NODE_ENV=production`, `RATE_LIMIT_ENABLED=false`, port 3104, fresh app and analytics SQLite files per boot, never `server/devdesigner.sqlite`). Windows 11 dev machine, Node 24; a client build was running on the same machine, so absolute numbers are noisy. 4 boots per mode, alternating off/on; the table shows the median across boots of each run's statistic.

Each run: a guest project with 200 text elements, 50 warm-up batches, then:
- **batch**: 500 sequential `PATCH /projects/:id/batch` moving 20 elements each;
- **burst**: 200 `PATCH /elements/:id/position` fired concurrently (latency includes queueing behind the others);
- **drag**: 200 sequential position saves of one element.

| Scenario | `ANALYTICS_ENABLED=false` | `ANALYTICS_ENABLED=true` | Delta |
|---|---|---|---|
| batch p50 / p95 (ms) | 3.52 / 4.89 | 3.94 / 5.26 | +0.4 / +0.4 |
| burst p50 / p95 (ms) | 101.4 / 160.1 | 113.1 / 163.4 | +11.7 / +3.3 |
| burst wall time, 200 requests (ms) | 175.4 | 178.0 | +2.6 (+1.5%) |
| drag p50 / p95 (ms) | 0.73 / 1.45 | 0.96 / 1.41 | +0.2 / -0.04 |

Per boot, one run wrote 1,151 `api.request` rows, but the 11,600 element moves became only **5 `entity.write` rows** (per-minute aggregation). With analytics off, no `analytics.sqlite` is created.

Flush cost, measured directly on a file-backed analytics DB (`DbAnalyticsSink.write`, 500 rows per transaction, 40 flushes): p50 2.9 ms, p95 22.5 ms, max 67 ms. The tail comes from WAL auto-checkpoints, which happen at most once per 10 s flush. Because better-sqlite3 is synchronous, this is the one event-loop stall analytics adds.

Reading:
- The per-request cost is about 0.2-0.4 ms: building the ALS facts, hashing the IP, and two `track`/`count` pushes. It is within run-to-run noise at p95. Burst wall time is unchanged.
- The defaults (10 s or 500 rows, 10k-row cap) stand. If the checkpoint tail ever shows up in production p99, raise `wal_autocheckpoint` on the analytics connection or split each flush into 100-row chunks yielded with `setImmediate`.
