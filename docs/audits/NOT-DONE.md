# Audit items not done

Waves 0–6 of [00-master-plan.md](00-master-plan.md) are finished: Waves 0–5 are merged into `main` and Wave 6 is on `audit/wave-6`. This file lists everything in the four audits that was planned but **not done, done partially, or deliberately changed**, and why. Each line names its step id (`S` = security, `P` = performance, `C` = cleanliness, `A` = analytics). The details for each id are in the matching audit file. [CHANGELOG.md](CHANGELOG.md) records what each wave did.

## 1. Skipped on purpose

| Item | What it was | Why it wasn't done |
|---|---|---|
| **A3b** | Consent banner, PostHog (server sink + browser SDK after consent), privacy page, self-hosted fonts | Marked optional in the plan. It needs product decisions (whether to use a third-party analytics vendor at all, the consent wording, the privacy policy text) and a PostHog account. The privacy page and self-hosted fonts are independent and can be done any time. |
| **A3a uptime monitor** | External uptime check (Better Stack / UptimeRobot) on `/api/health/ready` | It's an account on an outside service, not code. The endpoint exists; you only need to create the monitor. |
| **S0.1 / S0.2** | Check prod env values; reissue local `.mcp.json` tokens | Manual owner tasks with no code. Prod env vars are set in Railway. |

## 2. Blocked by uncommitted work at the time (Wave 5)

These touch `editor.component.ts` and the slides/present files, which had uncommitted local changes during Wave 5. The rule was never to edit or commit someone else's dirty files, so they were left alone.

| Item | What it was | Status |
|---|---|---|
| **C3.5** | Split `slides-panel.component.ts` (~2,150 lines) into a slides store, child components and `deck-layout-sync.service` | Not done. Only the one-line duplicate-save guard (P2.6) shipped. |
| **P2.6 (rest)** | Slides-panel perf work that was meant to land in the C3.5 split | Not done; it waits for C3.5. |
| **C3.6** | Decompose present mode, `morph-stage` and deck compare | Not done. |
| **C3.7** | Leaf components take store values as inputs instead of injecting the store | Partial. The remaining leaves are all mounted from `editor.component.ts`. |
| **C3.8 `EditorEmbedApi`** | One embed API for home showcase / guide sandboxes instead of reaching into editor internals | Not done. The home content split (the other half of C3.8) did ship. |
| **Undo bugs** found during the audit | Edge cases in client undo/redo | Some were fixed (re-created ids, sequence diagrams). The rest touched the same dirty editor files. |

**Now that `main` is clean, all of these are unblocked.** C3.5 → P2.6 is the most valuable pair.

## 3. Not reached

| Item | What it was | Why |
|---|---|---|
| **P3.5** | Slide thumbnails keyed by project revision, so they re-render only when content changes | It depends on the C3.5 slides-panel split. Thumbnail re-encoding per edit already dropped to 0 in Wave 3, so the remaining win is smaller. |
| **Migrations instead of `DATABASE_SYNCHRONIZE`** | A baseline migration plus a migration runner, then `synchronize=false` in prod (part of S1.4 / C4.1) | Deferred since Wave 1. Prod depends on synchronize to add new columns (Wave 6 added `users.tokenVersion` and `share_links.tokenSealed` this way). Switching needs a baseline taken from the real prod schema, so it should be its own careful change. |
| **`start:prod` path** | `start:prod` runs `dist/main.js`, but the build writes `dist/src/main.js` | Noted in Wave 1 and never fixed. It doesn't matter if Railway uses a different start command, but it should be fixed or removed. |

## 4. Server routes with no client UI yet

The server side is done and tested, but nothing in the app calls these yet:

- **Log out everywhere:** `POST /auth/logout-all` (S4.2).
- **Delete my account:** `DELETE /auth/me` (S4.7).
- **Hygiene preview:** `POST /api/admin/hygiene/preview` (A4). It belongs on the admin dashboard.
- **Guest cookie:** the client still sends `X-Guest-Id`. The server adopts it into the `dd_guest` cookie, and the header can be dropped once enough guests have the cookie (S4.3).

## 5. Security extras deferred in Wave 6

| Item | Why |
|---|---|
| API-token expiry and per-project scope | Optional in S4.x. It changes the token UI and MCP setup flow, so it needs a design decision. |
| Confirmation step before a guest's projects are claimed on sign-in | Optional. It needs a UI dialog. |
| Hashed share tokens rely on a stable seal key | Not a gap but a constraint. If `JWT_SECRET` / `SHARE_TOKEN_SECRET` changes, old links keep working but the share dialog can no longer show them. |

## 6. Measured and rejected

| Item | Result |
|---|---|
| **P4.2 extras:** defer the command palette / shortcuts / customize panel, lazy-load the projects overlay | Measured in Wave 5 and **reverted**. Each made Angular's chunk optimizer pull realtime/socket.io/material into `main`, adding +27 to +81 kB to the initial bundle. Only the sign-in and API-token dialogs stayed lazy. |

## 7. Lint rules still at warning (C5.2)

Every lint rule was meant to be an error. These stay at warning because each needs hand fixes across many files that Wave 6 didn't otherwise touch:

| Rule | Count | Note |
|---|---|---|
| `template/no-call-expression` | 1,567 | Waits for a `$`-suffix naming convention for signals in templates. Mostly mechanical, but large. |
| `consistent-type-assertions` | 61 | |
| `no-input-rename` | 32 | Renames are part of public component APIs. |
| `click-events-have-key-events` | 17 | Real a11y fixes; each needs keyboard handling. |
| `interactive-supports-focus` | 17 | Same as above. |
| `label-has-associated-control` | 17 | |
| `max-lines` | 14 | The god files waiting on C3.5 / C3.6 / C3.7. |
| Listed boundary exceptions | 18 | Imports that cross folder boundaries, also mostly in the unsplit editor and slides files. |

## 8. Operational constraints to know (not tasks)

- The throttler, caches, lockouts and session-version cache are in memory, so the server assumes **a single replica**. Scaling out needs Redis or similar.
- The analytics rollup uses a plain timer, not `@nestjs/schedule`, so it runs in every replica (fine with one).

## Suggested order if you pick these up

1. Fix the `start:prod` path (minutes).
2. Client UI for log-out-everywhere and account deletion (small; the server is ready).
3. C3.5 → P2.6 → P3.5 (slides panel split, then its perf work).
4. C3.6, C3.7, the C3.8 embed API, then the remaining lint warnings in those files.
5. A migration baseline to replace `DATABASE_SYNCHRONIZE` in prod.
6. A3b, if you decide you want third-party analytics.
