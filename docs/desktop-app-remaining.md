# Desktop app — what's left

Status as of 2026-11-18. Phases 0–4 and remote-backed sync (3b) are merged to `main`. Background and design: [desktop-app-plan.md](desktop-app-plan.md).

## 1. Before the first public release (blockers)

| # | Item | Why it matters | Notes |
|---|------|----------------|-------|
| 1.1 | ✅ **Deployed 2026-11-18.** **Deploy the server changes to prod** | Desktop sync to the hosted server fails until prod has them. | Needed: `POST /projects/:id/mirror-content`, id-preserving export/import (`keepIds`), realtime handshake that accepts `Authorization: Bearer <api token>` on Origin-less sockets, and the `project.replaced` mutation with the full schema. |
| 1.2 | **Set `DEVDESIGNER_HOSTED_URL`** | Without it there's no "DevDesigner Cloud" card in Sync. | Repo variable used by `.github/workflows/desktop-release.yml`. |
| 1.3 | **First tagged release and a real update test** | The electron-updater path has only been tested against a mock. | Tag `vX.Y.Z` (the root version). Install version N, publish N+1, then check the download, the "Restart now" prompt, the pre-update backup and the migrations on restart. |
| 1.4 | **Test restoring a backup** | Restore-and-restart after a failed migration is only unit-tested. | Force a failing migration in a test build and check that the backup is restored and the app starts. |
| 1.5 | ✅ **Resolved: the user deleted it.** A delete confirmation for synced projects is planned in desktop-sync-polish-plan.md, Stage A. **Investigate the lost project** | A project ("TV Dashboards") was deleted right after the first launch of an updated build. | Recovered from the WAL. The cause is still unknown, and a silent delete on upgrade is a release blocker if it can happen again. Check the `RemoteBackedSync` migration (it clears `sync_links`) and the "local delete safety" path in `DELETE /projects/:id` for linked projects. Add a test that upgrades a DB with linked projects and checks that no project rows are removed. |
| 1.6 | **Code signing** | Without it, SmartScreen warns on Windows, Gatekeeper blocks on macOS, and macOS auto-update doesn't work. | Deferred on purpose. Options: Windows certificate or Azure Trusted Signing, plus an Apple Developer ID with notarization. It can ship unsigned on Windows first. |

## 2. Platforms

- **macOS build:** dmg target, notarization and the `open-file`/`open-url` handling are written but have never been built or run on a Mac.
- **Linux build:** the AppImage target hasn't been built or run.
- **CI matrix:** the release workflow should build all three platforms. Native modules (`better-sqlite3`, `@resvg/resvg-js` in MCP) need Electron prebuilds for each platform.
- **Electron is pinned to 42.11.18** to match the better-sqlite3 12.11 prebuilds. Upgrade when better-sqlite3/typeorm support a newer Electron ABI.
- **Install speed:** the quick `install:desktop` path is Windows-only (robocopy). Adding a macOS/Linux version is optional.

## 3. Sync

- **Presence and cursors:** collaborators' cursors and selections aren't passed from the remote to the desktop editor. Only data changes are.
- **Per-item merge:** a conflict is still a choice of one whole project or the other ("Use server version" / "Keep mine"). The next step is per-item picks in the compare view.
- **Mirror-lag window:** live edits reach the local mirror about 0.4 s after the server (2 s at most). An outage inside that window, followed by offline edits, shows up as a false conflict. One fix is to apply relayed mutations straight to the mirror instead of refreshing it after a debounce.
- **API tokens are stored in plain text** in the local SQLite DB. Move them to the OS keychain with Electron `safeStorage`.
- **Removing a remote:** check what happens to its linked projects. They should become local copies, never be deleted.
- **Self-hosting:**
  - Publish `Dockerfile.selfhost` to GHCR from CI. The image hasn't been built yet because there's no Docker daemon here.
  - Add `npx devdesigner-server --data ./data --port 3000`.
  - Optional: let the desktop app act as a LAN sync server for your other devices.
  - Optional: print a one-time admin setup link on a remote's first start.

## 4. Polish and smaller gaps

- **Open Recent:** not tested end to end, only the route's 404 check.
- **Client bundle:** about 8 kB over the 1.1 MB warning budget (the error limit is 1.2 MB). Lazy-load the sync/compare UI, which is desktop-only.
- **Offline help:** guides are hidden on desktop. They could come back as a bundled Help → Guides item.
- **Share links:** hidden on desktop. For remote-backed projects, offer "Open on server / copy share link".
- **Tray icon:** not added and not needed so far.
- **Settings page:** there's nowhere for desktop preferences (update behaviour such as "ask" vs "install on quit", the data folder, backups to keep). Today these are menu items or hard-coded.
- **Crash reports:** dumps stay local. An opt-in "send report" isn't built, which matches the telemetry-off decision.

## 5. Docs

- Add the speed work to `desktop-app-plan.md`: asar packaging, the staged dependency cache (`.deps-stamp`, `--clean`), the quick `install:desktop` path (`--dir` plus a robocopy mirror) and the startup splash.
- Write user-facing install and sync docs for the README or the release notes: SmartScreen "More info → Run anyway" while builds are unsigned, how to get an API token, and what the offline and conflict banners mean.

## Suggested order

1.5 → 1.1 → 1.2 → 1.3/1.4 → first unsigned Windows release → keychain tokens → macOS/Linux builds + signing → per-item merge and presence.
