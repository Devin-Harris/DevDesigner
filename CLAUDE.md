# DevDesigner

## Verifying work
- Before calling a change done, run `npm run verify` from the repo root (build shared, eslint, client lint + stylelint, cycle checks, all tests, full build). It is the same gate CI runs on every push; fix all errors it reports.
- A tracked `.githooks/pre-push` hook runs `npm run verify` on pushes to `main` (enabled by `npm install` via the `prepare` script, which sets `core.hooksPath`).
