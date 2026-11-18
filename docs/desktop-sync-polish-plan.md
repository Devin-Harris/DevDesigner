# Plan: desktop sync + polish updates

Follows on from [desktop-app-remaining.md](desktop-app-remaining.md), sections 3 and 4. Each stage below is a separate branch with its own tests.

## Status (2026-11-18, branch `feat/desktop-sync-polish`): all stages done
- **A:** API tokens are encrypted with AES-GCM. The key is kept by OS `safeStorage` in `token-key.enc`. Plain tokens left from older versions are encrypted on boot.
  - Servers can be edited (name, URL, token). A new URL or token is checked against the server before it's saved.
  - Deleting a synced project always asks for confirmation.
  - The desktop-only screens load on demand, so the web initial bundle went from 1.108 MB to 857 kB.
- **B:** folded into D. A three-way merge on reconnect removes the mirror-lag false conflict.
- **C:** the relay passes the remote roster, cursors, selection and laser into the local room, and sends local presence back up.
- **D:** shared `mergeSchemas` (base = `sync_links.baseSchema`). Disjoint changes merge automatically. The compare view has a Mine/Server pick for each item changed on both sides, plus a Merge button.
- **E:** Settings (File > Settings, Ctrl+,) with General (updates, MCP tokens), Sync servers, Data & backups (keep N, restore) and About tabs.
- **F:** guides are back on desktop (Help > Guides). Synced projects get "Open on <server>". The web home page has a Desktop app download section.
  - Release files now have version-less names, so `releases/latest/download/...` links stay valid.
- **G:** the GHCR image workflow, `npm run build:selfhost` + `npx devdesigner-server` (repo only, not published to npm), and on a fresh self-hosted server the first account becomes admin.
- **Not done:**
  - "Copy share link" through the remote's API.
  - A default auto-sync setting for new links.
  - Publishing `devdesigner-server` to npm.
  - The macOS dmg names assume both arm64 and x64 builds.
- **Verified:**
  - Two-server e2e test, 35/35.
  - Packaged-app UI check, 12/12 (Settings, edit server, merge picks, guides).
  - Unit tests: shared 206, server 347, client 366, desktop 27.
  - Lint shows 0 errors.

## Stage A — Safety and quick wins (about 2 days)
1. **Store API tokens in the OS keychain.**
   - Add a desktop control route that encrypts and decrypts with Electron `safeStorage`.
   - Encrypt the tokens with it. The local server keeps only the ciphertext in `sync_remotes.token`, and a migration encrypts the existing rows.
   - If `safeStorage` isn't available (Linux without a keyring), keep plain text and log a warning.
2. **Removing a remote turns its linked projects into local projects.** Set `remoteId = null`, delete the link and keep the mirror. Add a test.
3. **Confirm before deleting a remote-backed project.** It's easy to delete one by accident, and that seems to be what happened to "TV Dashboards". The dialog should say "This deletes your local copy only; the server copy stays", with an option to delete it on the server too.
4. **Open Recent:** add an e2e test against the packaged app.
5. **Bundle budget:** lazy-load the desktop-only code (sync panel, compare dialog, schema diff, title bar) through `@defer` or lazy routes, so the web bundle drops back under 1.1 MB.

## Stage B — Close the mirror-lag window (about 2 days)
- **Problem:** the mirror is refreshed by a debounced full export (0.4 s, 2 s at most). An outage inside that window, followed by offline edits, shows up as a false conflict.
- **Fix:** `SyncRelay` passes each remote mutation to the local mutation applier (the same path `applyRemote` uses), so the mirror updates in step with the server. `mirroredRevision` takes the revision carried by the mutation. The full refresh stays as a fallback for gaps, when the revision skips a number.
- **Tests:** extend the two-server e2e with "kill the remote immediately after an edit, then edit offline, then reconnect", which should not produce a conflict.

## Stage C — Presence relay (about 2–3 days)
- **Relay socket:** passes the remote's `presence:*` events (cursors, selection, laser) on to local editors, labelled with the collaborator's name. Local presence goes up to the remote as the desktop user's remote identity, using the API token's user.
- **Client:** use the existing presence layer; only the event source changes. Hide presence when the project is offline or paused.
- **Throttle:** keep the throttling the web client uses, so the desktop doesn't flood the remote.

## Stage D — Per-item conflict merge (about 1 week)
- **Server:** extend `diffSchemas` into a three-way diff that uses the last mirrored snapshot as the base. Keep a copy of the mirror at `localRevisionAtMirror` in a new `sync_snapshots` table (one row per link, gzipped project JSON).
- **Auto-resolve:** changes on only one side need no prompt. Only items changed on both sides are real conflicts.
- **Compare dialog:** a list of the conflicting items with a server/mine choice for each, and "all server" / "all mine" shortcuts. The canvas preview highlights the item that's selected.
- **Apply:** build the merged project, then `mirror-content` it to the server and refresh the local copy.
- **Tests:** unit tests for the three-way diff in `shared`, plus e2e cases (one-sided changes on both sides merge with no prompt; one item edited on both sides gets one choice).

## Stage E — Desktop settings page (about 2 days)
- **Placement:** a Settings item in the title bar menu opens an overlay (desktop only).
- **Updates:** "Ask me" / "Install on quit" / "Off", and the update channel later.
- **Data:** open the data folder; set how many backups to keep (5 by default); "Back up now"; restore from a backup (pick from a list, then restart).
- **Sync:** default auto-sync for new links, check interval, and the remotes list (moved here from Projects → Sync, which keeps a link to it).
- **About:** version, licences, open the crash reports folder.
- **Storage:** a `settings` JSON file in userData, read by the main process. The page reaches it through preload IPC (`dd:get-settings`, `dd:set-settings`).

## Stage F — Offline help and share links (about 2 days)
- **Help → Guides:** bring back the `/guide/:tool` pages on desktop as a read-only view. Leave out the sandbox editors (they need seeded hidden projects) or seed them locally on first open.
- **Remote-backed projects:** add "Open on <server>" and "Copy share link" to the card menu and the editor. They call the remote's share API through the local server.

## Stage G — Self-hosting distribution (about 2 days, with CI)
- **GHCR image:** a GitHub Actions job builds `Dockerfile.selfhost` on tag and publishes `ghcr.io/<owner>/devdesigner`.
- **`npx devdesigner-server`:** a thin bin in `server/` that sets `DATA_DIR`, `PORT` and `CLIENT_DIR`, runs the migrations and starts. Publish it to npm.
- **First start:** print a one-time admin setup link when the server has no users.
- **Docs:** update `docs/self-hosting.md`.

## Out of scope / later
- Desktop as a LAN sync server.
- Tray icon.
- Opt-in crash upload (telemetry stays off).
- macOS/Linux builds and code signing, which are tracked in the release blockers.

## Order
A → B → C → E → D → F → G. A and B are about trust in the data and should land first. D is the biggest piece; E is quick and visible.
