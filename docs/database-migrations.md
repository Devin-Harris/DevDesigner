# Database schema: synchronize vs migrations

The app database (SQLite) gets its schema one of two ways:

| Mode | Env | Used by |
|---|---|---|
| **synchronize** | `DATABASE_SYNCHRONIZE=true`, `DATABASE_MIGRATIONS_RUN=false` (the defaults) | local dev, and prod until it is switched |
| **migrations** | `DATABASE_MIGRATIONS_RUN=true` (synchronize is then off) | desktop app (forced), self-host, and prod once switched |

Migrations live in `server/src/platform/database/migrations`: `Baseline` creates the full schema, and every entity change since then has its own migration. `migrations.spec.ts` fails when an entity changes without one. Generate a migration with `npx ts-node --transpile-only server/scripts/generate-migration.ts Name`.

## Switching an existing database (prod) to migrations

A database created by synchronize already has every table, so the baseline must not run on it. On boot with migrations on, `adoptSynchronizedDatabase` (`server/src/platform/database/adopt-synchronized-database.ts`) checks the database:

- **Empty**: the migrations build it.
- **Already records migrations**: they run as usual.
- **Created by synchronize, matching the current entities**: every migration is recorded as applied, and nothing is changed.
- **Created by synchronize but out of date**: the server refuses to start and prints the SQL synchronize would still run.

To switch prod:

1. Deploy the release you want to switch on **with synchronize still on**, so the live schema matches its entities.
2. Back up the database file.
3. In Railway, set `DATABASE_MIGRATIONS_RUN=true` and `DATABASE_SYNCHRONIZE=false`, then redeploy the **same** release. The log says "Adopted a synchronize-created database".
4. From then on, ship every schema change as a migration.

If step 3 refuses to start, the schema was not current. Go back to step 1.

The old patches in the root `server/migrations` folder date from before the baseline and are never loaded at runtime.
