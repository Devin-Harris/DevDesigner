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
