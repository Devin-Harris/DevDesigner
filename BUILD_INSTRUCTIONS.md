# DBDesigner: Build Instructions for Claude

This document instructs you (Claude) how to build **DBDesigner**, a fullstack web app for diagramming database schemas on an interactive canvas. Read it fully before writing code. Build in the phases listed; do not skip ahead. After each phase, ensure the app runs and the phase's acceptance criteria are met before continuing.

---

## 1. Role & Working Principles

- Act as a senior fullstack engineer. Write clean, typed, production-quality code.
- **TypeScript everywhere**, frontend and backend. No `any` unless truly unavoidable, and comment why.
- **End-to-end type safety.** Shared models, DTO shapes, enums, and pure functions live in the top-level `shared/` workspace and are imported by both `client` and `server`. Never redefine a shared type in one project; import it.
- Prefer small, composable modules over large files. One Angular component per file; use standalone components.
- **No custom CSS.** Style exclusively through Angular Material components, its theming system, and CDK primitives. If a layout genuinely cannot be achieved that way, use Material's layout utilities or a minimal inline style and note why. Do not create `.css`/`.scss` rule sets of your own.
- Keep the schema model (the data structure describing tables/columns/relationships) **decoupled** from the rendering layer. This is the most important architectural rule: SQL export and validation operate on the model, not on canvas nodes.
- **No over-fetching or over-saving.** Endpoints are granular and scoped to the entity being changed (see §5). Do not load or persist an entire project graph to change one column. Fetch and mutate the smallest coherent unit.
- **Enforce business rules in a dedicated layer**, not in controllers (see §7). Access and integrity checks run before any mutation, and can cascade to parent or child entities where relevant.
- Commit logically: one phase equals one coherent set of changes. Provide a short summary after each phase.
- When a decision is ambiguous, pick a sensible default, state the assumption in a comment, and move on. Do not stall.
- Do not use em-dashes in code comments, docs, or UI copy.

## 2. Tech Stack (use exactly this unless told otherwise)

**Frontend**
- Angular (latest, standalone components, TypeScript)
- **NgRx Signal Store** for all client state (`@ngrx/signals`): signal-based stores, not the classic Redux/NgRx store
- **Angular Material + CDK** as the component library and styling system. **No custom CSS.**
- Canvas built with **Angular CDK** (`DragDrop` for moving nodes, `Overlay` for popovers/inspectors) plus **SVG** for rendering tables, relationship connectors, and cardinality markers. Do not pull in a React-oriented diagram library. If a dedicated Angular diagram lib is desired, evaluate one, but the default is CDK + SVG.
- Angular Router for navigation
- Angular `HttpClient` for API calls

**Backend**
- **NestJS** (TypeScript), modular architecture (feature modules, controllers, services, repositories, DTOs)
- **TypeORM** for persistence (the ORM covered by the NestJS docs at https://docs.nestjs.com/techniques/database). Do not use Prisma. Use entities + migrations; access data through repositories injected into services.
- **SQLite** for application data (single-file DB, easy local dev)
- `class-validator` + `class-transformer` for DTO validation (Nest's `ValidationPipe`)
- Session/JWT for owner auth, **anonymous share tokens** for link-based access (see §6)
- `bcrypt` for hashing where passwords/secrets apply

**Shared**
- A top-level `shared/` TypeScript package imported by both `client` and `server`: schema model types, DTO interfaces, enums/unions (access levels, relationship types, data types), and pure functions safe for both environments (validation, the SQL generator). Compiled/emitted so both sides consume the same types.

**Tooling**
- ESLint + Prettier
- npm workspaces so `client`, `server`, and `shared` resolve each other locally
- Root-level npm scripts + VS Code tasks to run either or both apps (see §3.2)
- `.env` files for config; provide `.env.example` for the server
- Jest for unit tests (Nest default, at minimum test the SQL generator and business rules)

## 3. Repository Structure

```
dbdesigner/
├── README.md
├── BUILD_INSTRUCTIONS.md
├── package.json                 # root: npm workspaces + run scripts (§3.2)
├── .vscode/
│   └── tasks.json               # VS Code tasks to run client/server/both
├── shared/                      # shared TS package (imported by client + server)
│   ├── src/
│   │   ├── models/             # SchemaModel, TableModel, ColumnModel, etc.
│   │   ├── dto/                # request/response DTO interfaces
│   │   ├── enums/              # AccessLevel, RelationshipType, data types
│   │   ├── sql/                # dialect-aware SQL generator (pure)
│   │   └── validation/         # pure schema validation
│   ├── package.json
│   └── tsconfig.json
├── client/                      # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/           # api services, guards, interceptors
│   │   │   ├── features/
│   │   │   │   ├── dashboard/  # project list
│   │   │   │   ├── editor/     # canvas, table nodes, inspector, toolbar
│   │   │   │   └── share/      # shared-link entry view
│   │   │   ├── stores/         # NgRx Signal Stores
│   │   │   └── app.config.ts
│   │   ├── environments/
│   │   └── main.ts
│   └── ...
└── server/                      # NestJS backend
    ├── src/
    │   ├── auth/               # owner auth + OAuth (later)
    │   ├── access/             # access-resolution + policy layer (§7)
    │   ├── projects/           # controller, service, entity, dto
    │   ├── tables/             # controller, service, entity, dto
    │   ├── columns/            # controller, service, entity, dto
    │   ├── relationships/      # controller, service, entity, dto
    │   ├── notes/              # controller, service, entity, dto
    │   ├── sharing/            # share links + share guard
    │   ├── export/             # export controller/service (uses shared/sql)
    │   ├── database/           # TypeORM datasource + migrations
    │   └── main.ts
    ├── migrations/
    └── ...
```

> Note: the SQL generator and validation live in `shared/` as pure functions so the **server** uses them canonically and the **client** can call the exact same code for instant previews. One implementation, no drift.

### 3.1 Shared workspace

`shared/` is a real workspace package (e.g. `@dbdesigner/shared`) referenced by both apps through npm workspaces and TypeScript path mappings. It contains only environment-agnostic code: types, enums, DTO interfaces, and pure functions. It must not import Angular, Nest, TypeORM, Node, or browser APIs. The server derives its TypeORM entities and DTO classes from these shared shapes; the client types its store and API calls from them. Changing a shared model updates both sides at compile time.

### 3.2 Root scripts & VS Code tasks

Root `package.json` exposes scripts to run each part or the whole app from the repo root, using `concurrently` for the combined run:

```jsonc
{
  "scripts": {
    "build:shared": "npm run build -w shared",
    "dev:server": "npm run start:dev -w server",
    "dev:client": "npm start -w client",
    "dev": "npm run build:shared && concurrently -n server,client -c blue,green \"npm run dev:server\" \"npm run dev:client\"",
    "build": "npm run build -w shared && npm run build -w server && npm run build -w client",
    "test": "npm run test -w shared && npm run test -w server"
  }
}
```

Provide `.vscode/tasks.json` with tasks: **Dev: All**, **Dev: Server**, **Dev: Client**, and **Build: Shared**, each wired to the matching script so they can be launched from the VS Code command palette / task runner. `Dev: All` should depend on `Build: Shared` running first.

## 4. Data Model

### 4.1 Application database (TypeORM / SQLite)

Define these as TypeORM entities. Note SQLite specifics: no native enums (use `varchar` columns typed in code against shared unions) and prefer real columns over JSON blobs.

- **User**: `id`, `email` (unique, nullable until OAuth), `passwordHash` (nullable), `provider`, `providerId`, `displayName`, `createdAt`. Owns projects; created via a simple account now or OAuth later.
- **Project**: `id`, `ownerId` (FK to User, nullable so anonymously-created diagrams can exist), `name`, `description`, `createdAt`, `updatedAt`, `archived` (bool), plus canvas viewport fields `viewportX`, `viewportY`, `zoom` (defaults `0, 0, 1`). The viewport lives on the project instead of a separate diagram record.
- **Table**: `id`, `projectId` (FK), `name`, `x`, `y`, `color`, `note`. Position is tracked in its own `x`/`y` columns, not a JSON blob.
- **Column**: `id`, `tableId` (FK), `name`, `dataType` (see note below), `isPrimaryKey`, `isNullable`, `isUnique`, `isAutoIncrement`, `defaultValue`, `note`, `orderIndex`.
- **Relationship**: `id`, `projectId` (FK), `sourceColumnId` (FK to Column), `targetColumnId` (FK to Column), `type` (`ONE_TO_ONE` | `ONE_TO_MANY` | `MANY_TO_MANY`), `onDelete`, `onUpdate`.
- **Note**: `id`, `projectId` (FK), `x`, `y`, `width`, `height`, `content`, `color`. Free-floating canvas annotations.
- **ShareLink**: `id`, `projectId` (FK), `token` (unique, unguessable, e.g. 32-char nanoid), `accessLevel` (`VIEW` | `EDIT`), `createdAt`, `revokedAt` (nullable), `expiresAt` (nullable). A project may have multiple active links (e.g. one view link, one edit link).

The `Diagram` entity from the earlier design is removed. Canvas viewport state lives on `Project` (`viewportX`, `viewportY`, `zoom`); each node's position lives on its own `Table`/`Note` row. Nothing about layout is stored as serialized JSON.

`dataType` is the one structured field. Store it as a small set of real columns (`dataTypeName varchar`, `dataTypeLength int nullable`, `dataTypeArgs varchar nullable` for things like `ENUM` values or `DECIMAL(p,s)`), mapped in code to the shared `DataType` type. This keeps it queryable and avoids a JSON string.

Configure cascading deletes at the entity relations: deleting a table removes its columns and dependent relationships; deleting a project removes its tables, notes, relationships, and share links.

### 4.2 The schema model (shared TypeScript types)

Define these in `shared/src/models/` so both apps import them. This is what validation and SQL export consume, and what the client store is typed against:

```ts
type DataType = { name: string; length?: number; args?: string[] };

interface ColumnModel {
  id: string; name: string; dataType: DataType;
  isPrimaryKey: boolean; isNullable: boolean; isUnique: boolean;
  isAutoIncrement: boolean; defaultValue?: string; note?: string;
}
interface TableModel {
  id: string; name: string; columns: ColumnModel[];
  x: number; y: number; color?: string; note?: string;
}
interface RelationshipModel {
  id: string; sourceColumnId: string; targetColumnId: string;
  type: RelationshipType; // shared enum/union
  onDelete?: string; onUpdate?: string;
}
interface NoteModel {
  id: string; x: number; y: number; width: number; height: number;
  content: string; color?: string;
}
interface ViewportModel { x: number; y: number; zoom: number; }

interface SchemaModel {
  tables: TableModel[];
  relationships: RelationshipModel[];
  notes: NoteModel[];
  viewport: ViewportModel;
}
```

`RelationshipType`, `AccessLevel`, and the known data-type names live in `shared/src/enums/` and are imported wherever needed rather than re-declared. `SchemaModel` is a read/assembly shape (e.g. for export or a full project load); it is not what individual write endpoints accept. Writes are granular per §5.

## 5. API Surface (REST)

All routes under `/api`. Access is governed by either an authenticated owner or a valid share token (see §6). A Nest guard resolves access from the JWT/session or an `X-Share-Token` header (or `?token=` on the share entry route) and attaches the effective access level (`OWNER` | `EDIT` | `VIEW`) to the request. Reads require any level; writes require `OWNER` or `EDIT`; project/sharing management requires `OWNER`. Access and business rules are enforced in the policy layer (§7), not inline in controllers.

Endpoints are **granular**: each mutates the smallest coherent entity so the client never over-fetches or over-saves. Child writes carry their parent id in the path so access can cascade to parent and project.

**Auth**
- `POST /auth/register`, `POST /auth/login`: returns JWT/session (simple email+password for now).
- `GET /auth/oauth/:provider`, `GET /auth/oauth/:provider/callback`: **stub now, implement later.**
- `GET /auth/me`: current user (or null for anonymous).

**Projects**
- `GET /projects`: list current user's projects (support `?archived=`). Owner-scoped.
- `POST /projects`: create.
- `GET /projects/:projectId`: full project graph (tables, columns, relationships, notes, viewport) assembled as a `SchemaModel`-shaped payload for initial load. Owner or any share token.
- `PATCH /projects/:projectId`: rename/describe/archive (owner only).
- `PATCH /projects/:projectId/viewport`: update `viewportX`, `viewportY`, `zoom` only. Owner or EDIT. Debounced by the client.
- `POST /projects/:projectId/duplicate`: deep-copy (owner only).
- `DELETE /projects/:projectId` (owner only).
- `GET /projects/:projectId/export?dialect=mysql`: generated SQL as text. Owner or any share.

**Tables**
- `POST /projects/:projectId/tables`: create a table.
- `PATCH /tables/:tableId`: update name/color/note.
- `PATCH /tables/:tableId/position`: update `x`, `y` only (drag autosave, debounced).
- `DELETE /tables/:tableId`: cascade-deletes its columns and dependent relationships.

**Columns**
- `POST /tables/:tableId/columns`: add a column.
- `PATCH /columns/:columnId`: update name, data type, constraints, note.
- `PATCH /tables/:tableId/columns/reorder`: body `{ orderedColumnIds: string[] }` to persist reordering in one small call.
- `DELETE /columns/:columnId`: also removes relationships referencing it.

**Relationships**
- `POST /projects/:projectId/relationships`: create; body references source/target column ids, type, cascade rules.
- `PATCH /relationships/:relationshipId`: update type/`onDelete`/`onUpdate`.
- `DELETE /relationships/:relationshipId`.

**Notes**
- `POST /projects/:projectId/notes`, `PATCH /notes/:noteId`, `DELETE /notes/:noteId`. Position/size updates go through `PATCH` and are debounced client-side.

**Sharing**
- `POST /projects/:projectId/share`: owner creates a link; body `{ accessLevel: 'VIEW' | 'EDIT', expiresAt? }`, returns `{ token, url }`.
- `GET /projects/:projectId/share`: list active links (owner only).
- `DELETE /projects/:projectId/share/:linkId`: revoke a link (owner only).
- `GET /shared/:token`: resolve a token, returns the project payload + effective access level. Entry point for shared clients; no account needed.

Validate all payloads with DTOs + `ValidationPipe`. DTO interfaces are declared in `shared/` and the server's DTO classes implement them, so the client sends exactly what the server expects.

## 6. Sharing & Access Control

Sharing is a core feature, not an afterthought. Design it in from Phase 1's data model even though the UI lands later.

**Model.** An owner can generate share links for a project. Each link carries an `accessLevel` (`VIEW` or `EDIT`) and an unguessable `token`. Anyone with the link can open the diagram **without an account**.

**Access resolution.** A single Nest guard determines the caller's effective access to a project:
- Authenticated owner of the project: `OWNER` (full control incl. sharing settings).
- Valid, non-revoked, non-expired share token matching the project: the token's level (`EDIT` or `VIEW`).
- Otherwise: `403`.

The client sends the share token via an `X-Share-Token` header on API calls when operating in shared mode. Never put the token in logs or in the schema payload.

**Rules.**
- Only `OWNER` can create/list/revoke share links, rename, duplicate, archive, or delete the project.
- `EDIT` can read and write the schema/canvas and export SQL, but cannot manage sharing or delete the project.
- `VIEW` can read and export SQL only; the editor renders read-only (disable inspector inputs, dragging persists nothing, hide save indicator).
- Revoking a link (`revokedAt`) immediately invalidates it. Expired links (`expiresAt`) are rejected.
- Tokens are generated with a CSPRNG (e.g. `nanoid(32)`) and are unique.

**Shared entry flow.** Visiting `/shared/:token` in the client calls `GET /shared/:token`, loads the project, sets the store into shared mode with the returned access level, and routes into the editor. No login screen is shown.

**OAuth (later).** Provider sign-in (Google, GitHub) is stubbed now and implemented in a later phase. It only affects **owner** identity; sharing continues to work anonymously regardless.

## 7. Backend Layering & Business Rules

Do not put logic in controllers. Controllers only parse/validate input (DTOs) and delegate. Enforce access and integrity in dedicated layers so rules are consistent across every endpoint that touches an entity.

**Layers (per feature module):**
- **Controller**: routing, DTO validation, returns responses. No business logic.
- **Policy / access layer** (`access/`): resolves the caller's effective access and authorizes the specific action against the target entity and its ancestry. This is where "can this caller edit this column?" is answered.
- **Service**: business logic and orchestration. Calls the policy layer first, then performs the mutation via repositories. Owns integrity rules (e.g. relationship endpoints must be type-compatible; a column being deleted takes its relationships with it).
- **Repository** (TypeORM): data access only.

**Ancestry-aware authorization.** Access is defined at the project level, but writes target children (tables, columns, relationships, notes). Before any child mutation, the policy layer resolves the chain to its owning project and checks the caller's access there. Concretely: editing a column requires EDIT (or OWNER) on the column's parent table's parent project. Provide a helper that, given any entity id, resolves its project id and the caller's effective access in one query path, and reject early with `403` when insufficient. Because child routes carry parent ids in the path (§5), this resolution is cheap and does not require loading the whole graph.

**Cascading rule execution.** Support running rules across an entity's parents and children where it makes sense, without loading everything:
- **Downward (parent to children).** A parent action can validate or cascade to its children. Deleting a table runs the delete rule for each of its columns and any relationships attached to those columns. Changing a column's data type triggers revalidation of relationships that reference it (type-compatibility), flagging or blocking as configured.
- **Upward (child to parents).** A child action can trigger a parent-level rule. Adding/removing a column can update the parent table's "has a primary key" validation state; a relationship change can mark the project's validation summary dirty.
- Implement these as small, composable rule functions the service invokes, scoped to the affected entities only. Query children/relationships by foreign key when a cascade needs them, rather than fetching the entire project. This keeps each operation minimal while still enforcing rules across the relevant slice of the graph.

**Why granular, not bulk.** Because rules run per entity with ancestry checks, a single small mutation is the natural unit. This is deliberately the opposite of a bulk "save the whole project" endpoint: it avoids over-fetching, over-saving, and makes every write independently authorizable and rule-checked.

## 8. Frontend Requirements

Build the UI with Angular Material components throughout: `mat-toolbar`, `mat-sidenav`, `mat-card`, `mat-form-field`, `mat-select`, `mat-menu`, `mat-dialog`, `mat-slide-toggle`, `mat-icon`, and so on. No hand-written CSS rule sets.

### 8.1 Dashboard (`/`)
A `mat-toolbar` plus a grid of `mat-card` project cards (name, description, updated date). Create, rename, duplicate, archive, delete, and search. Actions live in a `mat-menu` per card; create/rename use `mat-dialog`. Clicking a card opens the editor.

### 8.2 Project Editor (`/projects/:projectId`)
Layout via `mat-sidenav-container`: left sidenav (tables list / add table), center canvas, right inspector panel (edits the selected table/column/relationship/note). Top `mat-toolbar` holds project name, save indicator, **Share** button, and **Export** button.

**Canvas (Angular CDK + SVG):**
- Render the diagram as an SVG surface inside a pannable/zoomable viewport. Manage pan/zoom via transform state held in the store, persisted through `PATCH /projects/:projectId/viewport`.
- **Table node**: an SVG group (or absolutely-positioned CDK drag element) with a header showing the table name (inline-editable via an overlay input) and a row per column showing name, type, and constraint badges (🔑 PK, `NN`, `UQ`, `AI`). Each column row exposes a small connection handle for drawing relationships.
- Use CDK `DragDrop` to move tables; on drop, persist via `PATCH /tables/:tableId/position` (debounced). Support multi-select and delete via keyboard.
- Background grid; a minimap is nice-to-have (Phase 8 polish).
- Drawing a connector from one column handle to another creates a **Relationship**; open a CDK `Overlay` popover to set its type and cardinality.
- Render cardinality markers on connectors (crow's-foot notation preferred) as SVG path markers.
- Free-floating **Note** elements (sticky notes / text) that are not part of the schema, also CDK-draggable.

**Inspector panel:**
- Table selected: edit name, color, note; add/remove/reorder columns (CDK drag-drop list); per-column edit name, data type (`mat-select`), and all constraints (`mat-checkbox`/`mat-slide-toggle`).
- Relationship selected: edit type, `onDelete`/`onUpdate`.
- In `VIEW` shared mode, render all inputs disabled/read-only.

**Saving (granular, debounced).** Each edit calls the specific endpoint for the entity it changed (create/patch/delete a table, column, relationship, note; patch position/viewport). Debounce high-frequency changes (drag, typing, pan/zoom) around 400 to 800ms and coalesce repeated patches to the same field. Do not save the whole project graph. Show a subtle "Saved / Saving..." indicator driven by in-flight request state. Saving is disabled in `VIEW` mode.

**Share:** the Share button (owner only) opens a `mat-dialog` to create a link with a `VIEW`/`EDIT` toggle, list existing links with copy-to-clipboard, and revoke them. The dialog shows the full shareable URL (`/shared/:token`).

**Export:** a button opens a `mat-dialog` that calls the export endpoint, shows the generated SQL (monospace, read-only text area or a highlighted block), and offers **Copy** and **Download .sql**.

### 8.3 Shared View (`/shared/:token`)
Resolves the token, loads the project into the store in shared mode with the returned access level, and renders the same editor component. No login required. `EDIT` behaves like the owner editor minus sharing/delete; `VIEW` is fully read-only.

### 8.4 State (NgRx Signal Store)
Use **NgRx Signal Store** (`@ngrx/signals`) to hold the loaded project (tables, columns, relationships, notes), viewport, selection, access mode (`OWNER`/`EDIT`/`VIEW`), and per-entity save status. Type the store against the `shared/` models. Expose computed signals for derived rendering data (e.g. resolved relationship geometry). All edits go through store methods that call the matching granular endpoint and update local state optimistically. The store is the single source of truth; SVG rendering derives from it, never the reverse.

## 9. SQL Generator (critical module)

Build `generateMySQL(schema: SchemaModel): string` in `shared/src/sql/` so both server (canonical export) and client (instant preview) call the same code. Requirements:

- Emit `CREATE TABLE` statements with backtick-quoted identifiers.
- Map the shared `DataType` to MySQL types; support at least: `INT`, `BIGINT`, `VARCHAR(n)`, `TEXT`, `BOOLEAN/TINYINT(1)`, `DATE`, `DATETIME`, `TIMESTAMP`, `DECIMAL(p,s)`, `FLOAT`, `JSON`, `ENUM(...)`.
- Column clauses: type, `NOT NULL`, `AUTO_INCREMENT`, `DEFAULT`, `UNIQUE`.
- `PRIMARY KEY (...)` including composite keys.
- Foreign keys from relationships: `CONSTRAINT fk_... FOREIGN KEY (col) REFERENCES other(col)` with `ON DELETE` / `ON UPDATE` clauses. For `MANY_TO_MANY`, note it requires a junction table: either generate one or add a `-- TODO` comment, and document the choice.
- **Ordering:** topologically sort tables so referenced tables are created first; if cycles exist, emit FKs as `ALTER TABLE` statements after all `CREATE TABLE`s.
- Deterministic output (stable ordering) so exports diff cleanly.
- Write **Jest unit tests** covering: single table, PK/constraints, a one-to-many FK, a composite PK, and correct ordering.

Design the signature so `generatePostgres` / `generateSQLite` can be added later behind a `dialect` switch.

## 10. Validation

Validation lives in `shared/src/validation/` as pure functions, so the client shows inline warnings and the server can enforce the same rules before export or mutation:
- Every table has a name and at least one column; names are unique per project and valid identifiers.
- Column names unique within a table.
- Each table should have a primary key (warn if missing).
- Relationship endpoints exist and are type-compatible; warn on mismatched types.
- No duplicate relationships between the same column pair.

Return structured issues (`error` | `warning`, message, target id) and surface them in the UI.

## 11. Build Order (phases)

**Phase 0: Scaffolding.** npm-workspaces monorepo with `shared` (TS package), `client` (Angular + Material + CDK + NgRx Signal Store), and `server` (NestJS + TypeORM connected to SQLite). Wire path mappings so both apps import `shared`. Add root run scripts and `.vscode/tasks.json` (§3.2), ESLint/Prettier, `.env.example` (server) and `environment.example.ts` (client). Set up the Material theme here so no custom CSS is needed later.
*Acceptance:* `npm run dev` from root starts both apps; the Angular app shows a themed placeholder importing a value from `shared`; `GET /api/health` returns ok.

**Phase 1: Auth + Projects + access skeleton.** User entity, simple email/password register/login (JWT/session), the access-resolution guard and policy layer stubbed for project-level checks, project CRUD via granular endpoints, dashboard UI (create/list/open/rename/delete). Include the `ShareLink` entity in the schema now even though its UI comes later. Stub OAuth routes.
*Acceptance:* a user can register, log in, create projects, and see them on the dashboard; project writes are authorized through the policy layer.

**Phase 2: Canvas + Tables + Columns.** CDK+SVG canvas; table create/move/delete and column add/edit/reorder/delete through their granular endpoints; ancestry-aware authorization enforced (editing a column checks the parent table's parent project). Table position and project viewport persist via their dedicated patch endpoints. Signal Store wired with optimistic updates.
*Acceptance:* a user can build a table with columns visually; each change persists via its own endpoint and survives reload; an EDIT-less caller is rejected.

**Phase 3: Relationships.** Draw connectors between column handles, set type/cardinality, render crow's-foot markers, edit/delete relationships, cascade rules. Data-type changes trigger relationship revalidation (downward/upward rules from §7).
*Acceptance:* a one-to-many relationship can be drawn, saved, and reloaded correctly; changing a referenced column's type flags incompatible relationships.

**Phase 4: SQL Export.** Shared MySQL generator + tests, server export endpoint, export dialog with preview/copy/download.
*Acceptance:* a schema with 2 or more related tables exports to valid, runnable MySQL DDL.

**Phase 5: Sharing.** Share-link CRUD endpoints, the access-resolution guard extended for share tokens, the share `mat-dialog` (create/list/revoke VIEW/EDIT links), the `/shared/:token` entry route, and shared/read-only modes wired through the Signal Store.
*Acceptance:* an owner creates an EDIT link; a second browser with no account opens it, edits the diagram, and changes persist. A VIEW link is fully read-only. A revoked link is rejected.

**Phase 6: Documentation layer.** Table/column notes and free-floating sticky notes and text blocks on the canvas, each through granular note endpoints.
*Acceptance:* notes persist and render on the canvas and in the inspector.

**Phase 7: Validation & polish.** Shared validation surfaced as UI warnings, project duplicate/archive/search, loading/empty/error states, minimap, keyboard shortcuts.
*Acceptance:* invalid schemas show clear warnings; app feels complete and stable.

**Phase 8: OAuth (later).** Implement Google/GitHub sign-in behind the stubbed routes, linking to the `User` entity. Sharing remains unchanged and account-free for invitees.
*Acceptance:* a user can sign in with a provider and owns their projects.

## 12. Definition of Done (per phase)
- Type-checks and lints clean across `shared`, `client`, and `server`.
- No custom CSS rule sets; styling via Angular Material/CDK only.
- No em-dashes in code, docs, or UI copy.
- App runs from root with the documented scripts from a fresh clone.
- Writes go through granular endpoints and the policy layer; no bulk project save.
- New behavior is manually verifiable and, for the SQL generator and business rules, unit-tested.
- A short written summary of what changed and how to try it.

## 13. Out of Scope (for now, do not build unless asked)
Real-time multi-user live collaboration (simultaneous cursors/CRDT sync), SQL/DBML import, non-MySQL export dialects, and version history/snapshots. Link-based sharing and OAuth **are** in scope (Phases 5 and 8). Keep the architecture open to the rest, but do not implement them yet.

---

**Start with Phase 0.** After scaffolding runs, confirm the acceptance criteria, summarize, then proceed to Phase 1.
