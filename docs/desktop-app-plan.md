# Plan: Fully local desktop app (Electron)

Source idea: `docs/future_ideas_and_fixes.md` → Large Features → "Fully local desktop app".

Goals from the idea:
1. Run DevDesigner fully offline in an Electron app.
2. Auto-update (silent or prompted) when online; manual update path.
3. Optional "cloud" sync: push/pull projects to the hosted prod instance **or** a self-hosted DevDesigner server.

## Why this is feasible with little rework

The stack already suits embedding:

- **Server** is NestJS on **SQLite (`better-sqlite3`)** with file paths set by env (`DATABASE_PATH`, media folder, `ANALYTICS_DATABASE_PATH`). It can run inside Electron's main process (or a child Node process) with the paths pointed at `app.getPath('userData')`.
- **Client** is an Angular SPA that reads `apiBaseUrl` / socket origin from `environment.ts`; a desktop build just points them at the local server.
- **MCP** (`mcp/`) already talks to the API with tokens, so it can target the local server unchanged.

So the desktop app = Electron shell + the existing server on `127.0.0.1:<random port>` + the built client. No rewrite of persistence.

## Architecture

```
desktop/ (new npm workspace)
  main.ts        Electron main: pick free port, start server, open window, updater, menus
  server-host.ts fork server/dist/main.js with env (DATABASE_PATH=userData/devdesigner.sqlite, PORT, DESKTOP=1)
  preload.ts     tiny contextBridge: app version, update events, open-file dialogs
  electron-builder.yml
```

- **Run the server as a forked child process** (`utilityProcess.fork`), not in the main process: crashes don't kill the window, and native `better-sqlite3` is rebuilt once for Electron's ABI via `electron-builder install-app-deps`.
- Bind to `127.0.0.1` only, random free port, passed to the renderer via preload (client reads it at startup instead of the compiled `environment.ts`). Add a runtime config hook in the client: `window.devdesigner?.apiBaseUrl ?? environment.apiBaseUrl`.
- Load the client from the server itself (`ServeStaticModule` serving `client/dist`) so it's same-origin — avoids CORS and `file://` routing issues with Angular's path router.

## Phases

### Phase 0 — Prep in the existing app (do first, benefits the web app too)
- **Migrations.** `DATABASE_SYNCHRONIZE` defaults on and there's no baseline migration. That's unacceptable for a desktop app where every user owns a DB file that must survive upgrades. Generate a baseline migration, turn on `migrationsRun` for desktop, and keep synchronize dev-only. *This is the main blocker.*
- **Desktop mode flag** (`DESKTOP=1`) in `env.validation.ts`: disables Sentry/telemetry beacon (or makes it opt-in), quotas, throttling, admin, email-dependent flows.
- **Auth for a single local user.** Auto-create a local user on first launch and auto-sign-in (server issues a session for the loopback client; reject non-loopback requests). Keep the real auth code paths so sync can reuse them.
- **Runtime API base URL** in the client (above).
- **Hide web-only pages**: in desktop mode exclude the home page, home showcase and `/guide/*` routes (route guard + leave them out of the route table), default route → project list, remove nav links to them. The hidden seeded guide/showcase projects aren't seeded on desktop.
- Audit anything that needs the internet: Google Fonts / CDN assets (bundle them), live frames (fine — they're user URLs), OAuth (n/a offline), share links (hide or mark as "requires sync").

### Status
- **Phase 0 — done** (branch `feat/desktop-phase0`).
- **Phase 1 — MVP done**: `desktop/` workspace, `npm run build:desktop` then `npm run start:desktop`. Server forked on 127.0.0.1:47823 (falls back to a free port), serves the client itself (`CLIENT_DIR`), data in `%APPDATA%/DevDesigner/data`, logs in `.../logs/server.log`, per-install JWT secret, window state, single instance, external links → system browser, sandboxed renderer. Dev runs the server under system `node` (better-sqlite3 is built for Node); packaged builds use `utilityProcess` with Electron-rebuilt natives (Phase 2).
- **Phase 2 — done (unsigned)**: `npm run dist:desktop` → `desktop/release/DevDesigner-Setup-<version>.exe` (~130 MB). `desktop/scripts/stage.mjs` builds a self-contained app folder and installs production deps with Electron prebuilt natives (electron-builder's own rebuild is off: it reached into the workspace and rebuilt its Node copies). Electron pinned to **42.11.18** because better-sqlite3 12.11 (the newest typeorm accepts) ships prebuilts up to Electron 42; better-sqlite3 bumped 11 → 12.11 for web too. Auto-update via electron-updater + GitHub Releases (`.github/workflows/desktop-release.yml`, on tag `vX.Y.Z` = root version): quiet check on launch, background download, "Restart now / Later" prompt (else installs on quit), Help → Check for Updates. Backups: automatic copy on version change before the server opens the DB (keeps 5, `data/backups`), restore-and-restart offer if the upgraded server fails to start, File → Back Up Database (server `VACUUM INTO` via a desktop-only control route + per-launch token).
- **Phase 3 — v1 done (snapshot sync)**: remotes = any DevDesigner server + an API token made there (verified via /auth/me). Local server `SyncModule` (desktop only): `sync_remotes` / `sync_links` tables (migration 1795025528050-AddDesktopSync), per-link base revisions on both sides; every 20 s one project listing per remote, then push (local changed), pull (remote changed) or conflict (both: local wins, remote saved as a local "(<remote> copy <time>)" project). Transfers use the project file format; new `POST /projects/:id/replace-content` on every server swaps a project's content in place and broadcasts `project.replaced` (open editors swap the schema live). Offline = status `offline`, retried next tick. UI: Projects → Sync (servers, download remote projects), per-card Synced/Offline/Sync error badge and Sync now / Stop syncing / Sync to <remote>. Self-hosting: `Dockerfile.selfhost` (web + API, all state in `/data`, secret auto-generated) + docs/self-hosting.md; the server now serves the client whenever `CLIENT_DIR` is set and the client accepts `API_URL=same-origin`. End-to-end tested against two real servers (13 checks); Docker image itself not built here (no daemon).
- **Phase 4 — done**: fonts self-hosted for every build (`client/scripts/fetch-fonts.mjs` → `src/assets/fonts`, 47 latin woff2 faces, ~1.7 MB; no Google requests; SVG export embedding reads the local sheet). Desktop hides Share, account/sign-in/out and the Home page link. Bundled MCP server: the API-tokens dialog gives a ready config that runs `mcp/dist/index.js` through the app's own executable (`ELECTRON_RUN_AS_NODE`), no Node install needed. File type `.devdesigner` (desktop exports use it; same JSON; imports accept both) + `devdesigner://open?project=<id>` links, both registered by the installer and handled on launch / second instance / macOS open-file & open-url, delivered to the page through a ready-gated queue (`DesktopShellService`). File menu: Open Project File (Ctrl+O), Open Recent (desktop control route, most recently edited since analytics is off), Export Project (Ctrl+Shift+E). Crash dumps kept locally only (Help → Open Crash Reports Folder). App icon `desktop/build/icon.svg` → `icon.png` (`scripts/render-icon.mjs`). First-run welcome in the empty projects browser. Verified in the packaged app (11 checks incl. MCP over stdio, file open, link).
- **Built-in hosted remote**: build setting `DEVDESIGNER_HOSTED_URL` (repo variable in desktop-release.yml; env var in dev) is baked into the packaged app (`devdesigner.hostedUrl`) and passed to the local server as `SYNC_DEFAULT_REMOTE_URL`. Sync shows a "DevDesigner Cloud" card that only needs an API token from the hosted web app. Unset = no card.
- **Phase 4 leftovers**: Open Recent menu not exercised end to end (route covered only by the 404 check); initial client bundle is ~8 kB over its 1.1 MB warning budget (error at 1.2 MB); tray icon not added (not needed so far).
- **Phase 3 leftovers**: op-level merge instead of whole-project snapshots (3.2 proper) and live editing against the remote (3.3); per-entity conflict handling; API tokens are stored in the local DB (not the OS keychain); `npx devdesigner-server` and the "desktop as LAN sync server" option; publishing the self-host image (GHCR) from CI; prod must be deployed with `replace-content` before desktops can sync to it.
- **Phase 2 leftovers**: code signing (deferred); real end-to-end update test once a first release is published; restore path only unit-tested.
- **Phase 1 leftovers**: none (MCP snippet, hidden Share/account and offline fonts landed in Phase 4).

### Phase 1 — Electron shell MVP (offline only)
- New `desktop` workspace; scripts `dev:desktop` (runs server + client dev + electron) and `build:desktop`.
- Main process: single-instance lock, window state persistence, native menus (File: New/Open/Import/Export JSON, Edit, View, Help), `will-navigate`/`setWindowOpenHandler` → external links open in the system browser.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP; embed/live frames stay sandboxed iframes.
- Data location: `userData/devdesigner.sqlite`, `userData/media/`. "Reveal data folder" and "Back up database" menu items (SQLite `backup` API).
- Open/save `.devdesigner.json` via the existing export/import endpoints; register the file association so double-clicking opens it.
- MCP: settings page shows the local MCP config snippet (stdio command pointing at bundled `mcp/dist/index.js` + a local API token).

### Phase 2 — Packaging & updates
- `electron-builder` targets: Windows NSIS, macOS dmg (+ notarization), Linux AppImage.
- `electron-updater` with GitHub Releases as the feed.
  - On launch (if online): check silently; download in background; prompt "Restart to update" — or a setting for "auto-install on quit" vs "ask me".
  - Offline: skip silently; "Check for updates" menu item for manual; also allow installing a downloaded installer manually.
- Before applying an update: back up the SQLite file (`devdesigner.sqlite.bak-<version>`); migrations run on next start; on migration failure restore the backup and show an error.
- Code signing: Windows cert (or Azure Trusted Signing) and Apple Developer ID — needed for updater + SmartScreen/Gatekeeper. Budget/decision item.
- CI: GitHub Actions matrix build on tag push, publish release.

### Phase 3b — Remote-backed projects (replaces snapshot sync; done)
Decided 2026-11-18. A synced project (downloaded **or** uploaded) lives on the server; the desktop keeps a local **mirror** with the **same ids**. No merging.

- **Online:** the page talks to the local server as always; for a remote-backed project the local server **forwards** each project write to the remote (API token, `X-Client-Id` = the relay socket's id so the remote doesn't echo it back) and returns the remote's answer. A **relay socket** (local server → remote `/realtime`, API-token auth) receives other people's changes and passes them to the local editor; the mirror is refreshed in the background (id-preserving, no broadcast).
- **Offline:** writes go to the mirror (normal local handling); the editor shows "Offline — editing locally". The link records the remote revision it last mirrored.
- **Reconnect:** local unchanged → refresh mirror from server. Only local changed → push mirror to server (id-preserving replace). Both changed → **conflict**: a visual diff (server vs local, side by side on the canvas, changed items highlighted) with **Use server version** / **Keep mine (overwrite server)**.
- **Server changes needed** (deploy with the desktop release): `POST /projects/:id/mirror-content` (replace content keeping ids; replaces `replace-content`), id-preserving export/import for linking, realtime handshake accepts an API token.
- **Stages:** all done. Two-server end-to-end test covers 21 cases (upload/download ids, live forward incl. brand-new items, relay without echo, offline send, conflict both ways, auto-sync off/on, local delete safety); desktop UI checked (offline/conflict/paused banners, compare view, title bar).
- **Per-project auto-sync** (`PATCH /sync/links/:id {autoSync}`): off = `paused` (no forwarding, relay or background checks; "Sync now" does one push/pull/conflict pass).
- **Known window:** live edits reach the local mirror ~0.4 s (max 2 s) after they hit the server; an outage inside that window followed by offline edits shows as a conflict (the compare view lists the server-only item).
- **Not done:** presence/cursors of server collaborators are not relayed; per-item merge (still whole-project choice in a conflict).
- **Desktop chrome:** own title bar (dd-title-bar, 36 px; OS buttons via titleBarOverlay tinted to the theme; app menu from the title bar button), window always opens maximized.

### Phase 3 — Sync ("cloud" option)
Recommended model: **the desktop app is a client of a remote DevDesigner server, per project**, not raw DB replication.

- Settings → "Sync accounts": add a remote (prod URL or self-hosted URL) + sign in → stores an API token (reuse API tokens built for MCP) in the OS keychain (`safeStorage`).
- Per project: "Local only" or "Synced to <remote>".
- Sync mechanism, in increasing difficulty:
  1. **Manual push/pull** using the existing project export/import JSON (with id remapping). Cheap, good first cut; last-write-wins with a conflict prompt based on a `updatedAt`/revision check.
  2. **Background sync**: local server keeps an outbound change log (the batch/op format the realtime layer already applies) and replays it to the remote when online; pulls remote ops since last revision. Conflicts resolved by the server-authoritative ordering the realtime layer already uses.
  3. **Live**: when online, open the project directly against the remote (the client just points its API/socket at the remote) with a local cache for offline.
- Self-hosting: publish a Docker image / `npx devdesigner-server` of the existing server so people can host their own remote. Note: "external sqlite database" isn't directly reachable over a network — self-hosting means running the DevDesigner server next to that SQLite file, which is what this gives them.

### Phase 4 — Polish
- Offline-capable fonts/icons, recent files list, crash reporter (opt-in), deep links (`devdesigner://open?project=`), tray/menu "Check for updates", first-run onboarding.

## Decisions
1. Code signing: **deferred** — ship unsigned builds first, buy certs before a public release. Without it Windows SmartScreen / macOS Gatekeeper warn or block, and macOS auto-update won't work. Option: ship unsigned Windows/Linux first, sign later.
2. Telemetry: **off** in desktop mode (no Sentry, no usage beacon).
3. Sync v1 goes past manual push/pull: **background sync (3.2) is in v1**. Remote setup must be trivial (see "Remote server setup" below).
4. Desktop and web **share one version number** / release tag.
5. Marketing/docs surfaces (home page, home showcase, `/guide/:tool` guides) are **not reachable in desktop mode**: routes are dropped/guarded, app opens straight to the project list, nav links hidden. Guides may come back later as an offline Help item.

## Remote server setup (goal: as easy as "make a couple of sqlite files")
The server already creates its own SQLite files (`devdesigner.sqlite`, `analytics.sqlite`, `media/`) on first start, so a remote is just the server pointed at a folder:
- `docker run -p 3000:3000 -v ./data:/data devdesigner/server` — one command, data folder is the whole state.
- Or `npx devdesigner-server --data ./data --port 3000` for people without Docker.
- Or the desktop app itself: Settings → "Act as sync server for my other devices" (listens on LAN, same binary).
- First start prints a one-time admin setup link; the desktop app's "Add remote" takes URL + sign-in and stores an API token in the OS keychain.
- Migrations run on start, so upgrading a remote = pull the new image/version.

## Risks
- Schema upgrades on user-owned DB files (→ Phase 0 migrations + pre-update backups).
- Native module ABI (`better-sqlite3`, `@resvg/resvg-js` in MCP) — rebuild per platform in CI.
- App size (~150–200 MB with Chromium); acceptable for this kind of tool.
- Features assuming multi-user/web (sharing, presence, admin) need graceful hiding in local-only mode.

## Rough order of work
Phase 0 (≈1–2 weeks) → Phase 1 (≈1 week) → Phase 2 (≈1 week + signing setup) → Phase 3.1 manual sync + remote packaging (≈1 week) → Phase 3.2 background sync (≈2–3 weeks, v1) → later 3.3 live.
