# Audit items not done

Waves 0–6 of [00-master-plan.md](00-master-plan.md) are finished. On 2026-11-19 the items that Wave 6 left open were worked through; see "Done on 2026-11-19" at the end. This file lists what in the four audits is still **not done, done partially, or deliberately changed**, and why. Each line names its step id (`S` = security, `P` = performance, `C` = cleanliness, `A` = analytics). The details for each id are in the matching audit file. [CHANGELOG.md](CHANGELOG.md) records what each wave did.

## 1. Skipped on purpose

| Item | What it was | Why it wasn't done |
|---|---|---|
| **A3b** | Consent banner, PostHog (server sink + browser SDK after consent), privacy page | Optional in the plan. It needs product decisions (whether to use a third-party analytics vendor at all, the consent wording, the privacy policy text) and a PostHog account. Fonts are already self-hosted (desktop phase 4). |
| **A3a uptime monitor** | External uptime check (Better Stack / UptimeRobot) on `/api/health/ready` | It's an account on an outside service, not code. The endpoint exists; you only need to create the monitor. |
| **S0.1 / S0.2** | Check prod env values; reissue local `.mcp.json` tokens | Manual owner tasks with no code. Prod env vars are set in Railway. |

## 2. Still open

| Item | Status | What's left |
|---|---|---|
| **Switch prod to migrations** | The code is ready. A synchronize-created database is adopted on boot (`adoptSynchronizedDatabase`). | An owner step in Railway: follow [docs/database-migrations.md](../database-migrations.md). |
| **Drop `X-Guest-Id`** (S4.3) | The server already adopts the header into the `dd_guest` cookie. | Drop the header once prod data shows most active guests carry the cookie. Dropping it earlier would cut guests off from their projects. |
| **`template/no-call-expression`** (C5.2) | 1,808 warnings in 69 templates. The rule already allows the `$` suffix. | Rename the signals that templates read to `name$`, one feature at a time. It's mechanical, but it touches every component and the services they share, so it should be its own change. |
| **`max-lines`** (C5.2) | 14 files over 600 lines (warning), including `editor.component.ts`, `slides-panel.state.ts`, `deck-compare.component.ts` and `morph-stage.ts`. | The C3.4 editor extraction, plus further splits of the slides store, deck-compare's drag-to-pair code and `MorphStage`'s constructor. |
| **Boundary exceptions** | 5 imports, listed in `client/eslint.config.mjs`. | `canvas-sequence` composes a sibling sub-feature (needs the C3.4 `canvas.component`). The sandbox measures code blocks with an editor helper (C3.1, move to `@devdesigner/shared`). The projects-overlay thumbnails use the editor renderer (needs a shared renderer). |
| **P3.5** | Thumbnails are cached per editor and re-render only the frames whose rows changed. | Keying by project revision is still open, but the remaining win is small. |
| **Home `showTransition`** | Dead code: nothing calls it. It now goes through `EditorComponent.embed` like everything else. | Delete it, or wire it into the Slides showcase. |

## 3. Operational constraints to know (not tasks)

- The throttler, caches, lockouts and session-version cache are in memory, so the server assumes **a single replica**. Scaling out needs Redis or similar.
- The analytics rollup uses a plain timer, not `@nestjs/schedule`, so it runs in every replica (fine with one).
- Hashed share tokens rely on a stable seal key. If `JWT_SECRET` / `SHARE_TOKEN_SECRET` changes, old links keep working, but the share dialog can no longer show them.
- P4.2 extras (deferring the command palette, shortcuts and customize panel, or lazy-loading the projects overlay) were measured in Wave 5 and **rejected**. Each pulled realtime, socket.io and Material into `main`, adding 27–81 kB to the initial bundle.

## Done on 2026-11-19

- **`start:prod`** runs `dist/src/main.js`.
- **Account UI** (S4.2, S4.7): an Account settings dialog with sign out everywhere and delete account (with a password check). It's hidden in the desktop app.
- **Hygiene preview** (A4): a Cleanup preview card on Admin → Storage.
- **C3.5 + P2.6**: the slides panel is a host plus a component-scoped `SlidesPanelState` store, 11 part components and per-component SCSS. Deck-wide work runs once per deck in `deck-layout-sync.service` and `slide-thumbnails.service`, not once per mounted panel.
- **C3.6**:
  - `morph-stage.ts` went from 2,490 to about 1,100 lines, with the rest in `slides/helpers/morph/{model,geometry,text,code,grid}`. The code/grid builders now take a `MorphContext`.
  - Present mode went from 880 to about 545 lines: a `TransitionRunner`, plus `presenter-controls` and `laser-overlay` components.
  - Deck-compare: the `ComparePreviewPlayer` and a model file were extracted.
- **C3.7**: the 11 leaf components that injected `ProjectStore` now inject a narrow facade owned by their sub-feature (`ElementEdits`, `ErdEdits`, `SequenceEdits`, `CanvasContent`), built with `storeMember()`. Their boundary exceptions are gone, so the rule is enforced as an error. *Deliberate change:* these are facades, not pure input/output components. Their dependency on project state is now an explicit list, and the editor template didn't need rewiring.
- **C3.8**: `EditorHostOptions` (`chrome: 'picture'`, `hideSequenceMessages`) and `EditorComponent.embed: EditorEmbedApi`. Home no longer uses `::ng-deep` into the editor or queries the deck-compare play button. Preview play goes through `CompareUiState`.
- **Undo**: ERD edits were mostly not undoable. Now table add, delete, rename and recolor, table drags (with their relationship bends), column edits and reorders, indexes, and relationship add, delete and edit all undo and redo. Deleted rows come back under their own ids, and `rid()` still covers re-created columns. Covered by `ProjectStore ERD history` specs.
- **Migrations**: `adoptSynchronizedDatabase` lets a synchronize-created database switch to migrations safely (specs cover adopted, fresh and refused). See [docs/database-migrations.md](../database-migrations.md).
- **Security extras**:
  - API tokens can expire (30, 90 or 365 days) and can be limited to one project the caller owns. Enforcement: `ProjectAccessGuard` returns 404 for other projects, `OptionalAuthGuard` lets scoped tokens reach only project, public and `@ProjectTokenOk` routes, the project list is filtered, and the realtime gateway refuses other projects. Includes a migration and specs.
  - The guest-project claim prompt now follows every sign-in path (home sign-in used to skip it).
- **Lint (C5.2)**:
  - `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control` and `consistent-type-assertions` are now **errors** at 0. Fixes: keyboard support on list rows, a `ddStopClicks` directive for click-stopping containers, wrapping labels, and `satisfies` where it fits. The remaining deliberate partial rows say why inline.
  - `no-input-rename` is **off**, because the `$`-suffix convention aliases inputs on purpose.
  - Two templates had stray Windows-1252 "…" bytes, shown as "�" in the desktop settings and sync panel. They're fixed.
