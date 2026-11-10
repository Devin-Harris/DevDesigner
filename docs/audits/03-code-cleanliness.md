# 03 - Code cleanliness and maintainability audit

Date: 2026-11-09. Scope: `client/` (Angular 22, zoneless, NgRx Signal Store), `server/` (NestJS 10 + TypeORM/SQLite), `shared/` (`@devdesigner/shared`), `mcp/` (`@devdesigner/mcp`).
Yardstick: the four owner-supplied guideline docs from qManage (`folder-structure.md`, `best-practices.md`, `architecture.md`, `tests.md`), adapted to this repo as described in section 2.
Related audits: [02-performance.md](02-performance.md) and [04-auditing-analytics.md](04-auditing-analytics.md). A security audit (01) is expected to touch the server access layer. Section 9 covers how the plans interact.

All counts were measured on `main` at `7d5fe3d` with grep and small Node/Python scripts. No tooling was installed. `madge` and `ts-prune` are not present in `node_modules`, so I used a homemade import-graph script for the cycle and unused-export checks (Tarjan SCC over runtime relative imports). Treat the counts as accurate to within a few percent. Grep cannot see multi-line constructs perfectly.

---

## 1. Summary

**The codebase is modern but monolithic.** At the API level the client already follows most of best-practices.md:
- zero `@Input`/`@Output`/`@ViewChild` decorators
- 100% `OnPush` (and zoneless)
- no `ViewEncapsulation.None`
- no constructor-parameter injection in Angular classes
- no `any`
- no `*ngIf`/`ngClass`/`ngStyle`
- only 7 manual `.subscribe()` calls

The problems are **size, placement and coupling**, not syntax:

- **God files.** Six files hold about 33% of all client TypeScript:

  | File | Lines | Notes |
  |---|---|---|
  | `features/editor/editor.component.ts` | 9,696 | 32 signals, 66 computeds, 33 effects, ~240 methods, 81 imports |
  | `features/editor/slides/slides-panel.component.ts` | 4,430 | includes about 1,380 lines of inline template and 870 lines of inline styles |
  | `stores/project.store.ts` | 3,997 | |
  | `slides/morph-stage.ts` | 1,955 | |
  | `canvas/helpers/shape-render.helper.ts` | 1,662 | |
  | `slides/present-mode.component.ts` | 1,335 | |

  `deck-compare` (1,214 lines), `home.component` (1,026 ts + 1,342 scss) and `sandbox-backend.service` (734) follow.
- **The layers are inverted.**
  - `stores/` imports from `features/editor/canvas/helpers` (3 imports).
  - `core/services/*` imports `ProjectStore` and editor helpers (15 imports). Eight "core" services are really editor services.
  - Sibling features import each other's internals 14 times. For example, `home` imports `guide.component`'s `prepareSandbox`, `editor/slides/deck-compare`, and `editor/canvas/helpers/code-highlight`.
- **Presentational components are not presentational.** 30 files inject the editor-wide `ProjectStore`, including about 21 leaf components (toolbars, inspectors, table-node, canvas layers) that should take inputs and emit outputs.
- **Conventions are half-adopted.**
  - Prefix: the design system uses `dd-` (9 selectors) and everything else uses `app-` (43 components, 1 directive).
  - Files: 24 components still use inline `template:` (20 with inline `styles:`).
  - `standalone: true` is still written 54 times.
  - The `$` suffix is used 0 times.
  - 22 of the 67 `effect()`s write signals or store state.
  - There are 55 `setTimeout` calls in 18 files.
  - Hex colors appear 119 times in component SCSS and about 104 times in TS (part of the TS count is legitimate canvas data).
- **No client tests and no Angular lint.**
  - `client/package.json` has `"test": "ng test"` and `"lint": "ng lint"`, but `angular.json` defines neither target, so both scripts fail.
  - The root ESLint config is plain `typescript-eslint` with no Angular rules. Prettier is 2-space/100 columns and 136 client files already fail even that config.
  - Server, shared and MCP have Jest. Shared is well covered (12 specs). Server has 5 specs and MCP has 4.
- **The backend is tidy but more repetitive than the README claims.** The README says "controller / policy / service / repository". The reality is: controller → service → (central `AccessService` + raw TypeORM `Repository`).
  - Every controller method hand-plumbs `@CurrentUserId() @ShareToken() @ClientId()` (41 `@ShareToken()` sites).
  - Every service repeats `assertCanWriteX(...)`, then `if (dto.f !== undefined) row.f = dto.f`, then `realtime.emit(...)`.
  - `AccessService` injects 7 repositories and needs a new `assertCanWriteX` for each entity.
  - Dead code: an empty `NotesModule` (with matching `NoteModel`/`CreateNoteDto`/`UpdateNoteDto` and `SchemaModel.notes` in shared), two OAuth `NotImplementedException` stubs, and unused `passport`/`passport-jwt`/`@nestjs/passport`/`supertest` dependencies.
- **Logic is duplicated across packages.**
  - Slide stacking: client `stackLegacySlides` vs shared `stackSlideFrames`.
  - Table metrics: client `canvas.constants` vs shared `TABLE_*`.
  - Text contrast: client `contrast.ts` vs shared `readableTextOn`.
  - Data-type labels: in 3 places.
  - Id remapping, clone and import for project files: server writer, client sandbox, and MCP.
  - Schema → SVG: client export vs MCP `render.ts`.

**What the plan does, in order** (section 8):
0. Add guardrails (lint, format, boundaries, madge, Jest) in warn mode.
1. Run the mechanical codemods, including a one-shot client reformat to 3-space/120 columns.
2. Move folders with pure `git mv` commits.
3. Decompose the god files, with characterization tests first: `ProjectStore` into slice features, `EditorComponent` into gesture services plus sub-feature entries, and `SlidesPanel`, `MorphStage`, `ShapeRender`, `Home` and `SandboxBackend`.
4. Reorganize the backend into domain groups, with a caller-context decorator, an access guard and a patch helper.
5. Backfill tests, then flip the lint rules to error.

Security fixes go first on the server. The perf audit's "before" quick wins go before pass 3. The perf steps that rewrite pointer, culling and slides code go after it.

---

## 2. Guideline adaptations for this repo

The four docs were written for qManage: GraphQL/Apollo, a `qmg-` prefix, multiple Angular projects plus libraries, and classic NgRx alongside Signal Store. Each adaptation is listed below.

| # | Guideline (qManage) | Adaptation for DevDesigner | Why |
|---|---|---|---|
| A1 | `queries/` part with `*.graphql.ts` + generated Apollo services; "use generated Apollo services, never hand-written gql" | **No `queries/` part.** REST calls live in `services/<thing>-api.service.ts` (rename today's `tables.service.ts` → `tables-api.service.ts`, and so on; 12 files). Request/response types come from `@devdesigner/shared` DTOs and models, never hand-declared in the client. The "codegen" analog is the shared package: change the DTO in `shared/src/dto`, rebuild, and the server class-validator DTO `implements` it. All 45 server DTO classes already do. | REST + shared TS package instead of GraphQL |
| A2 | Import-rule table lists `queries` | Drop the `queries` column. `models/` may import `models` and `@devdesigner/shared`. Every part may import `@devdesigner/shared`, which plays the role of the generated types (the lowest layer). | Same layering, one fewer part |
| A3 | Selector prefix `qmg-` / directives `qmgCamelCase`; CSS vars `--qmg-<component>-…` | **`dd-` / `ddCamelCase`**, which the design system already uses (`dd-icon`, `ddPopoverTrigger`). Rename the 43 `app-*` components and `[appAutofocus]`. Component CSS vars: `--dd-<component>-<element>-<property>`. Global theme tokens keep `--dd-<token>`. Set `angular.json` `"prefix": "dd"`. | Ends the mixed `app-`/`dd-` prefix. The memory notes mention `dbd-`, but the code uses `dd-`. |
| A4 | Projects/libraries: `qManage` / `reporting` / `tvdashboards` apps; `core`, `ui`, `reports`, `report-output`, `signalr`, `styles` libs | One Angular app. The library layers map to folders and packages:<br>• **`@devdesigner/shared`** (npm workspace) = the lowest layer, like `@lcs/shared`. Pure TS, no Angular, no Nest. Used by client, server and MCP.<br>• **`client/src/app/shared/ui`** = the `ui` library analog. Domain-agnostic `dd-*` design system. Must not import `features/**`, `core/**` or domain models (it already doesn't).<br>• **`client/src/app/core`** = the `core` library analog, slimmed to app-wide infrastructure only: HTTP client and interceptors, auth, theme, realtime transport, sandbox, guards, telemetry. No editor logic.<br>• **`client/src/app/shared/{models,helpers,features}`** = app-wide shared features (rule 4 of "where code should live").<br>• `styles.scss` = the `styles` lib. | No multi-app workspace; boundaries are enforced by lint on folders instead of tsconfig aliases |
| A5 | "Sibling features never import each other" | `editor` is embedded by four top-level features (`workspace`, `share`, `guide`, `home`). The rules would push it to `app/shared/features/editor`. **Choice: keep it at `features/editor/` as a *hostable feature* with a public surface** (`features/editor/index.ts` exporting `EditorComponent`, `EditorHostOptions` and `provideEditor()`). Hosts may import **only** that barrel. This is the one documented exception, enforced by `eslint-plugin-boundaries`. | Moving the biggest feature under `shared/` would bury it; the barrel keeps the same guarantee |
| A6 | Signal store layout `state/<name>/features/<name>-{props,state,derived,methods,event-handlers}.feature.ts`; `withCallState`, `withKeyed`, `withSelectors`, `featuresType`, `signal-store-slice` skill | Keep the five-part layout. Because `ProjectStore` is about 4k lines, **split `methods` (and `derived`) per domain** (`project-tables-methods.feature.ts` and so on). The qManage helpers don't exist here:<br>• Use `@ngrx/signals` `withProps`, `withEntities` and `signalStoreFeature({ state: type<…>(), props: type<…>() }, …)` input typing in place of `featuresType`.<br>• Add a 30-line local `withCallState()` in `app/shared/state/`.<br>• `*.events.ts` + event handlers use `@ngrx/signals/events`.<br>• There is no `signal-store-slice` skill; the folder template is in §4.4. | Same intent, NgRx-native APIs |
| A7 | Legacy classic NgRx coexists | Not applicable: there is no `@ngrx/store`. Both stores are Signal Stores. The `stores/` folder is the "older layout" to migrate. | |
| A8 | `proxySignal`, `formSignal`, `notifySignal` utilities | **Adopt all three** (see §4.6). `proxySignal`/`writableProxySignal` and `notifySignal` are copied into `client/src/app/shared/helpers/signals/` (`proxy-signal.ts`, `notify-signal.ts`, with specs). `formSignal`/`deepFormSignal` come from the **`ngx-form-signal`** npm package (v2.18.0, peers `@angular/* >=18`; check it works on Angular 22 in pass 0). `formSignal` wraps **Reactive Forms**, and the client has none today (it uses `ngModel` in 11 files), so it applies only where a real form is introduced. Order of preference: `computed` → `linkedSignal` (local state reset from a source) → `proxySignal` (a source chosen or registered *later* by another owner) → `notifySignal` (re-run when something outside the signal graph changes). | Matches qManage; the forms piece needs Reactive Forms first |
| A9 | `ChangeDetectionStrategy.Eager` banned | Already moot: the app is zoneless (`provideZonelessChangeDetection`) and 51/51 components are OnPush. Keep `prefer-on-push-component-change-detection` as a lint guard. | |
| A10 | "Theme colors only from tokens; no hex/rgb/named colors; light and dark" | Applies to **chrome** (SCSS and UI TS). **Canvas content colors are user data**: element `strokeColor`/`backgroundColor`, palette swatches in `shared/src/palette`, syntax-highlight palettes, and literal colors baked into exported SVG/PNG/PDF. These must stay literal hex and are excluded. They should still come from `shared` palette constants, not ad-hoc literals. Stylelint `color-no-hex` is enforced on `client/src/app/**/*.scss` except `styles.scss` (the token file). | Exported files can't resolve CSS vars |
| A11 | "Lazy load dialogs (dynamic import / injectAsync)" | `injectAsync` is qManage-specific. Use `await import('./x-dialog.component')` before `MatDialog.open`, or `@defer` for in-template panels. MatDialog stays for now (ui-redesign keeps restyled Material dialogs). | |
| A12 | Prettier: 3-space, 120 columns, single quotes, semicolons, `es5` trailing commas, curly arrow bodies | Apply **to `client/` only**, through a Prettier `overrides` entry. Server, shared and MCP keep 2-space/100/`all` (backend teams aren't covered by these docs, and it avoids 3× the churn). "Arrow functions always use curly braces" isn't a Prettier option; it's ESLint `arrow-body-style: ['error','always']` (client only, warn first; very high churn, see §7). | Limits blast radius |
| A13 | "Don't self-close component tags" | Adopt as written; Angular's `prefer-self-closing-tags` stays off. 11 self-closed component tags exist today (3 files). | |
| A14 | Jest with `jest-preset-angular`; `setup-jest.ts` shims; `provideMockStore` | **Jest** for the client too, so all four workspaces share one runner (server, shared and MCP are already on Jest 29). Use `jest-preset-angular` (zoneless env: `setupZonelessTestEnv`). Drop `provideMockStore` (no classic store). Fallback if `jest-preset-angular` lags Angular 22: Angular CLI's built-in `@angular/build:unit-test` (Vitest), with Jest-compatible APIs. Decide in pass 0. | |
| A15 | `npm run build:analyze`, budgets, madge | Add `client` script `build:analyze` (`ng build --stats-json` + esbuild analyzer) and root `check:cycles` (`madge --circular --ts-config client/tsconfig.app.json client/src`). Budgets are already in `angular.json`; perf audit step 4.4 tightens them. | |
| A16 | "Specs next to files"; "don't test generated code" | Same. The "generated code" analog is `shared/dist`. Don't test it; test `shared/src`. | |
| A17 | Architecture "dependency direction" diagram | Our version:<br>`features/* → shared/features → shared/{ui,helpers,models} → core → @devdesigner/shared`<br>`shared/ui → @devdesigner/shared` (types only), never `core` or `features`<br>`core → @devdesigner/shared` only (no `features`, no `ProjectStore`)<br>`server → @devdesigner/shared`; `mcp → @devdesigner/shared` + REST (never server or client)<br>`@devdesigner/shared` → nothing in the repo | |

---

## 3. Frontend scorecard

Base: `client/src/app` has 195 source files: 134 `.ts`, about 48,970 lines of TS and 13,300 lines of HTML and SCSS. Components: 51. Directives: 3. Pipes: 0. `@Injectable`s: 33. Signal stores: 2.

| Guideline (best-practices.md) | Metric | Count | Grade |
|---|---|---|---|
| `input()/output()/viewChild()/contentChild()` functions, not decorators | `@Input`/`@Output`/`@ViewChild`/`@ContentChild` decorators | **0 / 0 / 0 / 0** (vs `input()` 124, `output()` 55, `viewChild()` 18, `model()` 1) | ✅ |
| (related) host listeners | `@HostListener` | 14 in 7 files (editor 7; `host:` metadata used 5×) | 🟡 prefer `host: {}` |
| `$` suffix on signals and observables; inputs aliased | Fields named `*$` | **0** of about 680 `readonly x = signal/computed/input(...)` fields | ❌ (see §7: adopt per file in pass 3, not by bulk rename) |
| Separate `.ts`/`.html`/`.scss` files | Inline `template:` / inline `styles:` | **24 / 20 files**. Largest: `slides-panel` (~1,380 template + ~870 style lines), `deck-compare` (~217 + ~140), `present-mode` (~176 + ~260), `animation-pane` (~153 + ~190), all 9 `shared/ui` components | ❌ |
| Don't inline types, functions and components together | Exported helper types/functions/classes in component files | e.g. `slides-panel` exports `FocusUiState` class + `SlidesCommand`; `pen-options-bar` exports `PenPrefsService` + 4 constants; `guide.component` exports `prepareSandbox`, `readStored`, `writeStored`, `SEEDS`; `present-mode` exports `ease` | ❌ ~12 files |
| Presentational components (only entry components touch stores) | Files injecting `ProjectStore` | **30**, of which about 21 are leaf components (toolbars, inspectors, table-node, canvas layers, minimap neighbours) | ❌ |
| OnPush | `ChangeDetectionStrategy.OnPush` | **51 / 51** (zoneless app) | ✅ |
| No `ViewEncapsulation.None` | | **0** | ✅ |
| `::ng-deep` only under `:host` | `::ng-deep` uses / bare | 12 uses in 5 files. `home.component.scss` reaches into the editor's internals (`app-slides-panel`, `app-sequence-diagram`, `app-sequence-message-toolbar`). `editor.component.scss:26` uses `app-table-node ::ng-deep *` (not `:host`-scoped) | 🟡 |
| Don't write `standalone: true` | | **54** | ❌ (mechanical) |
| `inject()` over constructor params | Constructor-param injection in Angular classes | **0** (`inject(` 191×. The 20 `constructor()` bodies wire effects; the only parameter constructor is the plain `SandboxError` class.) | ✅ |
| `takeUntilDestroyed` on every `.subscribe()` | `.subscribe(` / `takeUntilDestroyed` | **7 / 0**. All are one-shot (`afterClosed()`, CDK overlay `backdropClick`/`keydownEvents` in `popover-trigger.directive.ts:128-129`), plus a fire-and-forget `tablesApi.update(...).subscribe()` inside the store (`project.store.ts:2884`). Low risk, but the overlay ones should use `takeUntilDestroyed` or close-on-detach. | 🟡 |
| No `any`; minimal `as` | `: any` / `as any` / `<any>` | **0 / 0 / 0**. `as X` casts: about 258 (plus 54 `as const`) | ✅ / 🟡 |
| No method calls in templates | Calls with arguments in property bindings, interpolations and control flow | about **82** in `.html` + **67** in inline templates (e.g. `lastSlideOf(...)` ×7, `deckSlideCount(...)` ×4, `stackOf`, `markerUrl`, `isSwatch`, `indexColumnNames`). Event-handler calls are excluded. | ❌ |
| `track` stable ids | `track $index` | **28** in `.html` (17 in `canvas-shapes.component.html`: text lines/spans/tokens, which are fine as static lists) + 5 inline. About 6–8 are on reorderable model lists (editor/home html). | 🟡 |
| Effects only for side effects | `effect()` total / effects that `.set()`/`.update()`/`patchState` | **67 / 22** (editor 10, slides-panel 4, sequence-diagram 2, plus one each in image-crop, media-video, shape-toolbar, deck-compare, table-node, home). `linkedSignal` used 0×; `untracked(` 38× (a smell that effects are doing derivation) | ❌ |
| `[class.x]`/`[style.x]` over `ngClass`/`ngStyle` | | **0 / 0** (and 0 `*ngIf`/`*ngFor`) | ✅ |
| No `setTimeout` hacks | `setTimeout` | **55 in 18 files** (home 15, slides-panel 12, present-mode 8, editor 5, deck-compare 4). Some are legitimate debounce/animation timers. Others are CD/focus workarounds, e.g. `features/editor/autofocus.directive.ts` and select/popover focus. `afterNextRender` is used 8× already. | 🟡 |
| a11y: icon-only buttons have `aria-label`; native buttons | Icon-only `<button>` without `aria-label` / clickable `div|span|li` | **74 of 155** icon-only buttons lack `aria-label` (72 have a `matTooltip`/`title` that can be copied over). **17** clickable `div/span/li` elements. | 🟡 |
| Theme tokens, no hex | Hex in component SCSS / hex in TS / `rgb(a)(` in SCSS/TS | **119** (16 files; home 43, editor 19, table-node 14, guide 11) / **~104** (19 files; mostly legitimate canvas/export data, see A10, but e.g. `sequence-diagram/contrast.ts`, `minimap`, `home` are chrome) / **18 / 47** | 🟡 |
| Lazy-load dialogs | `MatDialog.open` with static imports | **7 call sites, 0 lazy** (`app.component.ts` ×3, `editor` ×2, `home`, `projects-overlay.service`) | ❌ |
| Prettier 3-space/120/es5 | Files differing from target config | **194 / 195 files; ~51,100 of 62,900 lines change** (indentation). Even the *current* config: 101 files / ~3,000 lines differ. 463 lines exceed 120 columns. | ❌ |
| Selector prefix | `app-` vs `dd-` | **43 `app-` components + 1 `[appAutofocus]`** vs **9 `dd-` + `[ddPopoverTrigger]`** | ❌ |
| No self-closed component tags | `<app-x … />` / `<dd-x … />` | 11 (3 files) | 🟡 |
| No `NgModule` | | 0 | ✅ |
| Comments 1–3 lines | Comment blocks over 3 lines | **130** of 2,669 blocks; comments are 9% of TS lines. Many reference `BUILD_INSTRUCTIONS.md section N` (41 refs across client and server). | 🟡 |
| `const`/`readonly` | `let` vs `const`; non-readonly class fields | 435 vs 5,848; about 135 non-readonly fields (many are gesture-state fields in the editor: a symptom of the god component) | 🟡 |
| Variable grouping; alphabetical inputs/outputs in templates | | Not measured. Enforce with `@angular-eslint/template/attributes-order` (warn). | ? |
| Circular deps | SCCs over runtime imports | **1 cycle**: `shape-render.helper.ts ↔ text-metrics.ts ↔ element-geometry.helper.ts` | 🟡 |
| Cross-project/layer import rules | Upward/sideways imports | `stores → features` 3; `core → features|stores` 15; feature → sibling feature 14; `shared/ui → anything` 0 ✅ | ❌ |
| Unit tests (tests.md) | Client spec files / test runner | **0 / none** (`ng test` has no target) | ❌ |
| Lint | Angular lint rules | None. The root config is generic TS: 71 findings repo-wide (5 errors: 2× `no-control-regex` in morph-stage, 2× `no-unused-expressions`, 1× `prefer-const` in MCP) | ❌ |

Other hygiene findings:
- **Literal NUL bytes in source.** `morph-stage.ts:1908` contains two raw `\x00` characters inside a template literal. Git classifies the file as **binary** (`git ls-files --eol` → `-text`), so it shows no diffs or blame. Replace them with `\u0000`.
- **Line endings are mixed** (176 files CRLF, 275 LF, 6 mixed) and there is no `.gitattributes`.
- **Duplicate directive.** Two different `AutofocusDirective`s share the selector `[appAutofocus]` (`core/directives/` focuses immediately; `features/editor/` defers with `setTimeout`). Both are in use.
- **Over-exported symbols.** About 70 exported symbols are used only inside their own file (e.g. `layoutPlaceholders`, `svgToPngBlob`, `measureTextBox`, `segmentHitsBox`, `roundedPath`, `LINK_SNAP_PX`, `GUIDE_SANDBOX_MARK`). No truly dead values were found in the client. The unused-variable findings are mostly rest-destructure omits. Add `ignoreRestSiblings: true` to the lint rule.
- **Unused imports.** ESLint flags unused imports and constants: `themeToken` (editor:58), `CW_10` (diagram-svg:36), `x1/y1` (shape-render:1147), `CreateLifelineDto`/`CreateSequenceMessageDto` (store), `input` (toggle, checkbox), and two types in home.
- **Empty placeholder folders**: `core/guards/.gitkeep`, `core/interceptors/.gitkeep` (the latter has files now), `server/src/common/.gitkeep`.

---

## 4. Frontend findings and target structure

### 4.1 What is where today

```
app/
├── app.component.*            296-line shell: top bar, account menu, 3 dialogs, editor islands; injects ProjectStore
├── core/
│   ├── directives/autofocus   (duplicate of features/editor/autofocus)
│   ├── interceptors/          share-token, with-credentials
│   ├── sandbox/               734-line in-memory REST backend for guide/home sandboxes
│   └── services/              21 services: 9 REST wrappers + 12 editor/domain services (code-actions,
│                              grid-table, media-actions, rich-text-session, editor-actions, laser,
│                              element-images, realtime, project-file, ...) that import ProjectStore/editor helpers
├── features/
│   ├── auth/  command-palette/  guide/  home/  share/  shortcuts/  workspace/
│   └── editor/                ~30 flat sibling folders + canvas/{constants,helpers(21),models} + slides/(12 files) + export/
├── shared/ui/                 9 dd-* primitives + popover directive (clean, but all inline templates)
└── stores/                    ProjectStore (editor) + ProjectsStore (workspace), both providedIn: 'root'
```

**Structural problems**
1. **`ProjectStore` is an editor store provided in root.** That works only because exactly one editor is ever live (home and guide sandboxes reuse it). `app.component` reads it for the top bar, so the shell depends on the editor's state. Target: provide it from the editor entry (`provideEditor()`), and have the shell talk to the editor through the existing `EditorActionsService` bridge (which moves to `core/editor-bridge/`).
2. **`core/` is a dumping ground.** Of 21 services, only `api`, `auth`, `theme`, `user-themes`, `share-session`, `realtime` (transport part) and `sandbox` are app-wide. The rest belong to `features/editor/**`.
3. **There are no sub-feature boundaries in `features/editor`.** About 30 sibling folders sit flat (`sequence-diagram`, `sequence-diagram-toolbar`, `sequence-inspector`, `sequence-message-toolbar`, `sequence-participant-toolbar` …) when they should be one `sequence-diagram/` sub-feature with `components/`.
4. **Home embeds the editor and restyles its internals** with `::ng-deep` (hides chrome, forces `display: revert`). It also calls `EditorComponent.showTransitionScreen()`/`leaveDeckFocus()` as public embed hooks. Target: `EditorHostOptions { chrome: 'full' | 'embed' | 'none', readOnly, … }` and a typed `EditorEmbedApi` returned through an output or `viewChild`, so nothing needs to reach into the editor's DOM.
5. **The sandbox is split across features.** `prepareSandbox` lives in `guide.component.ts` and `home` imports it. It belongs in `core/sandbox/sandbox-seeds.service.ts`.

### 4.2 God-file decomposition

#### `features/editor/editor.component.ts` (9,696 lines) → entry around 500 lines plus services and sub-features

Sections by the file's own `// ---` markers (line ranges are approximate):

| Lines | Concern | Target |
|---|---|---|
| 1–946 | 32 signals / 66 computeds: shown items, outer views, connectors, frame boxes, slide regions, outlines | `features/editor/features/canvas/state/canvas-view/` (derived feature over `ProjectStore` + viewport). This is where perf 2.5 (culling) lands. |
| 947–2120 | Drawing-tool state, gesture state fields, grid-cell editor, file-name editing, theme colors | Split: `toolbar/state/tool.store.ts` (active tool, sticky style), `elements/features/grid-table/`, `elements/features/code-block/` |
| 2120–2486 | **Constructor with 33 effects** | Each effect moves to the service or store that owns its concern. Effects that write signals become `computed`/`linkedSignal` (10 of the 22 offenders are here). |
| 2486–2554, 2554–2631, 5668–6110 | Canvas pointer (pan/marquee), global pointer move/up, marquee commit | `canvas/services/pointer-gesture.service.ts` (the dispatcher: perf 2.4 rAF coalescing lands here), `canvas/services/marquee.service.ts`, `canvas/services/pan-zoom.service.ts` (8450–8700: `onWheel`, `zoomIn/Out`, `animateViewport`, `zoomToFit/Selection`) |
| 2631–2682 | Laser | `features/collaboration/services/laser-input.service.ts` (+ existing `LaserService`) |
| 2682–3168 | Drawing new elements, erase | `canvas/services/draw-tool.service.ts`, `canvas/services/eraser.service.ts` |
| 3168–4386 | **Element pointer: select/move/resize/rotate/endpoint/bend, group resize, sequence spacing (~1,220 lines)** | `canvas/services/element-drag.service.ts`, `element-transform.service.ts` (resize/rotate/snap), `connector-edit.service.ts` (endpoints/bends/binding targets), `sequence-diagram/services/sequence-gesture.service.ts` |
| 4386–5161 | Inline text + rich text (contenteditable) (~775 lines) | `elements/features/text-editing/` with `inline-text-editor.component` (entry) + `services/rich-text-editor.service.ts` (merge with `core/services/rich-text-session.service.ts`) |
| 5161–5499 | Table node pointer, duplicate-and-drag | `erd/services/table-drag.service.ts` |
| 5499–5668 | Relationship linking and segment drag | `erd/services/relationship-link.service.ts`, `erd/services/segment-drag.service.ts` |
| 6110–6388 | `onKeyDown` (280 lines) + `deleteSelection` | `editor/services/editor-shortcuts.service.ts` with a declarative keymap table (shared with `shortcuts-sheet`, so the sheet and the handler can't drift) |
| 6459–7841 | Slides, deck focus, follow presenter, slide adoption/stacking, add/duplicate slides (~1,380 lines) | `slides/services/deck-focus.service.ts`, `slides/services/slide-placement.service.ts`. Move `stackLegacySlides`/`separateStackedPresentations`/`shiftSlide` **into `@devdesigner/shared`**, next to `stackSlideFrames`/`shiftPresentation` (already used by MCP), so one rule fixes decks everywhere. `collaboration/services/follow.service.ts` |
| 7841–8200 | Copy/paste, image drop/paste | `canvas/services/clipboard.service.ts`, `elements/features/media/services/image-drop.service.ts` |
| 8192–8874 | Toolbar add/zoom/grid/home/smart guides | `pan-zoom.service`, `canvas/services/smart-guides.service.ts` |
| 8874–9335 | Export scope, SQL, image/PDF, frames (~460 lines) | `export/services/export.service.ts` (+ existing helpers; `core/services/project-file.service.ts` moves here) |
| 9344–9696 | Relationship toolbar handlers, alignment, `followRoutes` | `erd/` handlers and `canvas/helpers/align.helper.ts` (pure, testable) |

The entry component keeps the layout template, `provideEditor()` wiring, and the sub-feature composition. The ~240 methods become calls on about 15 services scoped to the editor (`providers: [...]` on the editor entry, not root). The template (933 lines) splits along the same lines into sub-feature entry components (`<dd-canvas>`, `<dd-erd-layer>`, `<dd-slides-rail>`, `<dd-editor-overlays>`).

#### `features/editor/slides/slides-panel.component.ts` (4,430 lines)
- Step 1 (mechanical): move the inline template (lines 218–1597) and styles (1598–2469) into `.html`/`.scss`. That alone takes the `.ts` to about 2,000 lines.
- Step 2: convert `FocusUiState` (an exported class used as UI state) into `slides/state/slides-panel/` (five-part store).
- Step 3: split the template into presentational components under `slides/features/slides-panel/components/`: `presentation-picker`, `slide-list` (+ `slide-thumb`), `transition-settings`, `theme-picker`, `layout-tab`, `design-focus`. Move the layout save/sync logic into `slides/services/deck-layout-sync.service.ts`, the name the perf audit (step 2.6) expects.
- Effects that write state: 4. `setTimeout`: 12.

#### `features/editor/slides/morph-stage.ts` (1,955 lines, one exported `MorphStage` class)
- Fix the NUL bytes first.
- Split into `present/helpers/morph-geometry.helper.ts` (box/rotation interpolation), `morph-text.helper.ts` (char/word diffing; anything DOM-free moves to `shared/src/slides/` beside `matchMorphItems`), `morph-code.helper.ts` (code/diff morph, line ~1908), and `present/services/morph-stage.ts` (DOM orchestration only).

#### `present-mode.component.ts` (1,335) and `deck-compare.component.ts` (1,214)
Both have inline template and styles. Extract them to files, and split:
- `present/components/{presenter-controls, slide-layer, laser-overlay}`.
- `deck-compare` becomes a sub-feature `slides/features/deck-compare/` with `state/` (its `CompareUiState`) and `components/`. Home imports it today: home must use it through the editor's public barrel or get its own showcase variant.

#### `canvas/helpers/shape-render.helper.ts` (1,662 lines, 27 exported functions)
Split by element kind into `canvas/helpers/render/`:
- `shape.render.ts`
- `text.render.ts` (+ `fontWeightFor`, `baselineInLine`)
- `code.render.ts` (the `code*` metrics, about 12 functions)
- `grid.render.ts` (`gridFont`, `gridRowNeeds`)
- `image.render.ts` (`imageView`, `rectCornerRadius`)
- `fonts.helper.ts` (`FONT_STACKS`, `FONT_OPTIONS`, `fontStack`)
- `theme-colors.helper.ts`

This also breaks the only cycle (`shape-render ↔ text-metrics ↔ element-geometry`): `fonts.helper` becomes the leaf that both depend on. Perf 2.2 (memoize `buildShapeViews`) can land before or after; it is independent.

#### `stores/project.store.ts` (3,997 lines) → see §4.4

#### `features/home/home.component.ts` (1,026 ts + 1,342 scss + 902-line `showcase-player.ts`)
- `home/components/{site-header, hero, recent-projects, feature-band, use-cases, ai-section, site-footer}`: each `<section>` in `home.component.html` (lines 2, 38, 226, 245, 264, 273, 320).
- `home/features/showcase/` (entry `showcase.component`, lines 97–225 of the html). It holds `services/showcase-player.service.ts` (from `showcase-player.ts`), `helpers/showcase-geometry.helper.ts` (`toWorld`, `toScreen`, `contentBounds`, `glideTo`), and `components/{fake-cursor, sql-preview, tab-strip}`. Its 15 `setTimeout`s become one scheduler in the player service (a timeline with cancellation).
- The SCSS splits with the components. Its 43 hex colors become tokens (the marketing palette goes into `--dd-home-*` tokens).

#### `core/sandbox/sandbox-backend.service.ts` (734)
Split into:
- `sandbox-router.ts` (the `case 'viewport' | 'tables' | …` dispatch)
- `handlers/{project,tables,columns,elements,sequence,batch}.handler.ts`
- `sandbox-store.ts` (sessionStorage persistence)

Move `remapIds`, `clone` and `importContent` planning to `@devdesigner/shared` (`shared/src/project-file/`), shared with the server writer (§6). It also imports `codeElementContentSize` from editor helpers: that becomes a shared/editor public helper.

### 4.3 Target folder tree for `client/src/app`

```
client/src/app/
├── app.component.ts|html|scss          shell: router-outlet, global top bar host, toasts (no ProjectStore)
├── app.config.ts
├── app.routes.ts                        '' → workspace, 'projects/:projectId' → workspace,
│                                        'shared/:token' → share, 'guide/:tool' → guide, 'admin' → admin (04 audit)
├── core/                                app-wide infrastructure, no UI, no editor knowledge
│   ├── http/                            api-client.service.ts (was api.service), interceptors/{with-credentials,share-token}.interceptor.ts
│   ├── auth/                            auth.service.ts, auth-api.service.ts, api-tokens-api.service.ts
│   ├── guards/                          admin.guard.ts (04 audit)
│   ├── realtime/                        realtime-socket.service.ts (transport only; emits realtimeEvents)
│   ├── theme/                           theme.service.ts, user-themes-api.service.ts
│   ├── sandbox/                         sandbox-backend.service.ts, sandbox.interceptor.ts, sandbox-seeds.service.ts (was guide's prepareSandbox),
│   │                                    router/, handlers/, store/
│   ├── editor-bridge/                   editor-actions.service.ts (shell ↔ live editor contract, typed)
│   └── telemetry/                       telemetry.service.ts (04 audit)
├── shared/                              app-wide shared feature (consumed by ≥2 top-level features)
│   ├── ui/                              domain-agnostic design system (dd-*), the "ui library"
│   │   ├── components/                  icon/ input/ select/ checkbox/ toggle/ segmented/ tag-input/ color-swatches/
│   │   │                                confirm-dialog/ (from workspace) kbd/ ... each with .ts/.html/.scss
│   │   ├── directives/                  popover-trigger.directive.ts, autofocus.directive.ts (one, merged)
│   │   ├── pipes/
│   │   └── models/                      SelectOption, SegmentedOption ...
│   ├── state/                           with-call-state.feature.ts (generic signal-store features)
│   ├── helpers/                         download.helper.ts (downloadBlob/Text), signals helpers if any
│   └── features/
│       ├── auth-dialogs/                auth-dialog/, api-tokens-dialog/ (used by shell + home)
│       └── projects-overlay/            (opened by shell, home, command palette)
├── features/
│   ├── workspace/                       route '' and 'projects/:projectId'
│   │   ├── state/projects/              projects.store.ts + features/ (from stores/projects.store.ts)
│   │   ├── services/                    projects-api.service.ts, project-file.service.ts (import/export JSON)
│   │   ├── features/
│   │   │   ├── templates/               templates.service.ts, models/project-templates.ts
│   │   │   └── home/                    landing (moved under workspace: it is the '' route's empty state)
│   │   │       ├── components/          site-header/ hero/ recent-projects/ feature-band/ use-cases/ ai-section/ site-footer/
│   │   │       ├── features/showcase/   showcase.component.*, services/showcase-player.service.ts, helpers/, components/, seeds/
│   │   │       └── home.component.*
│   │   └── workspace.component.*        hosts <dd-editor> (via features/editor barrel) or <dd-home>
│   ├── share/                           route 'shared/:token': share.component.* hosts the editor in shared mode
│   ├── guide/                           route 'guide/:tool'
│   │   ├── models/guide-tools.ts        (content tables)
│   │   ├── seeds/*.json
│   │   ├── components/                  guide-rail/ guide-article/ shortcut-table/
│   │   └── guide.component.*
│   ├── command-palette/                 command-palette.component.*, helpers/palette-items.helper.ts
│   ├── shortcuts/                       shortcuts-sheet (reads editor keymap via the editor barrel)
│   ├── admin/                           (new, per 04 audit; first feature built to this structure)
│   └── editor/                          hostable feature; public surface = index.ts
│       ├── index.ts                     export { EditorComponent, provideEditor, EditorHostOptions, EditorEmbedApi, EDITOR_KEYMAP }
│       ├── editor.component.ts|html|scss   entry: layout + composition only (~500 lines)
│       ├── editor.providers.ts          provideEditor(): ProjectStore + editor-scoped services
│       ├── state/
│       │   ├── project/                 ProjectStore (see §4.4)
│       │   ├── viewport/                viewport.store.ts (pan/zoom/home, local-first per perf C1/C2)
│       │   └── tool/                    tool.store.ts (active tool, sticky element style, pen prefs)
│       ├── services/                    *-api.service.ts: tables, columns, indexes, relationships, elements, sequence,
│       │                                element-images, share-links, batch; editor-shortcuts.service.ts; project-history.service.ts
│       ├── models/                      geometry.model, connector.model, shape-view.model, toolbar-actions, editor-host.model
│       ├── helpers/                     cross-sub-feature pure helpers: element-geometry, node-metrics, svg-path, route, routing,
│       │                                smart-guides, text-metrics, frame-contents, slide-zoom, align.helper ...
│       ├── shared/                      used by the editor and all its sub-features
│       │   ├── constants/               canvas.constants.ts (imports metrics from @devdesigner/shared), frame-presets.ts
│       │   └── components/              floating-toolbar-shell/, swatch-popover/ (repeated toolbar chrome)
│       └── features/
│           ├── canvas/                  pointer + viewport + rendering layers
│           │   ├── state/canvas-view/   derived views (shown/outer items, connectors, culling)
│           │   ├── services/            pointer-gesture, pan-zoom, marquee, element-drag, element-transform,
│           │   │                        connector-edit, draw-tool, eraser, clipboard, smart-guides
│           │   ├── helpers/render/      shape/text/code/grid/image render + fonts + theme-colors (from shape-render.helper)
│           │   ├── helpers/             connectors, freedraw-path, link-snap, message-box ...
│           │   ├── components/          canvas-shapes/ canvas-connectors/ canvas-sequence/ marquee/ smart-guides-overlay/
│           │   └── canvas.component.*   entry (the <svg> stage)
│           ├── erd/                     tables + relationships
│           │   ├── services/            table-drag, relationship-link, segment-drag
│           │   ├── components/          table-node/ table-toolbar/ table-inspector/ (was inspector/)
│           │   │                        relationship-inspector/ relationship-toolbar/
│           │   └── erd-layer.component.*
│           ├── elements/                free-drawing elements
│           │   ├── components/          element-floating-toolbar/ element-inspector/ multi-select-bar/
│           │   ├── features/text-editing/   inline-text-editor.component.*, services/rich-text-editor.service.ts,
│           │   │                            helpers/rich-text.helper.ts, rich-list.helper.ts
│           │   ├── features/code-block/     services/code-actions.service.ts, helpers/code-{highlight,format,diff}.helper.ts
│           │   ├── features/grid-table/     services/grid-table.service.ts, helpers/grid-table.helper.ts, components/grid-cell-editor/
│           │   └── features/media/          image-crop-overlay/, media-video/, slide-media-layer/, services/{media-actions,image-drop}.service.ts
│           ├── sequence-diagram/
│           │   ├── services/            sequence-gesture.service.ts
│           │   ├── helpers/             contrast → removed (use shared readableTextOn)
│           │   ├── components/          diagram-toolbar/ message-toolbar/ participant-toolbar/ sequence-inspector/
│           │   └── sequence-diagram.component.*
│           ├── toolbar/                 dock
│           │   ├── services/            toolbar-prefs.service.ts
│           │   ├── components/          shape-flyout/ customize-panel/ pen-options-bar/
│           │   └── toolbar.component.*  (was shape-toolbar)
│           ├── slides/
│           │   ├── state/slides-panel/  (was FocusUiState)
│           │   ├── services/            deck-focus, slide-placement, deck-layout-sync, slide-render, morph-tag-suggestions
│           │   ├── helpers/             layout-placeholders, standard-layouts, deck-defaults
│           │   ├── features/
│           │   │   ├── slides-panel/    components/{presentation-picker,slide-list,slide-thumb,transition-settings,theme-picker,layout-tab,design-focus}
│           │   │   ├── animation-pane/
│           │   │   ├── deck-compare/    state/ components/
│           │   │   └── present/         present.component.*, services/morph-stage.ts, helpers/{morph-geometry,morph-text,morph-code}.helper.ts,
│           │   │                        step-animator.helper.ts, components/{presenter-controls,slide-layer}
│           │   └── slides.component.*   entry (rail + panels)
│           ├── export/                  export-dialog/ frame-order-dialog/ (lazy-loaded), services/export.service.ts,
│           │                            helpers/{diagram-svg,image-export,font-embed}.helper.ts
│           ├── share-dialog/            (lazy-loaded)
│           ├── collaboration/           laser-layer/, services/{laser,follow,cursors}.service.ts
│           └── minimap/
```

What moves where (summary):
- `stores/projects.store.ts` → `features/workspace/state/projects/`
- `stores/project.store.ts` → `features/editor/state/project/`
- From `core/services/` into the editor: `code-actions`, `grid-table`, `media-actions`, `rich-text-session`, `laser`, `element-images` and the 7 entity REST services
- `workspace/confirm-dialog` → `shared/ui/components/confirm-dialog`
- `features/auth` → `shared/features/auth-dialogs` (used by the shell and home)
- `home` → `workspace/features/home` (home is the empty state of the `''` route, and only `workspace` mounts it)

### 4.4 `ProjectStore` slicing

`ProjectStore` today has five regions:
- the state interface (lines 1–345)
- `withComputed`: about 60 derived values (349–596)
- one `withMethods` closure (597–3968) holding:
  - private infrastructure: timers, undo/redo stacks of closures, `optimistic`/`enqueue`/`checkpoint`/`commitPatch`/`debounce`/`debouncedCommit`, `mapElement`/`mapTable`
  - about 120 public methods
- a second `withMethods` for `importFile` (3970–3997)

Public methods by domain (line numbers):
- **load/remote**: `load` 1669, `loadShared` 1693, `applyRemoteBatch` 1726, `applyRemote` 1742–1975 (230 lines)
- **selection and groups**: 1995–2235 (`selectTable` … `ungroupSelection`, `select/toggle Sequence|Lifeline|Message`)
- **sequence diagrams**: 2235–2803 (about 570 lines)
- **tables, columns, indexes**: 2803–3046
- **viewport**: 3046
- **relationships**: 3061–3187
- **slides**: 3187–3254 (`assignSlide`, `setActiveSlide`, `setSlideZoom`, `selectPresentation`)
- **elements**: 3254–3968 (about 700 lines: add/update/clone/duplicate/move/resize/reorder/arrange, history recorders, undo/redo)

Target, following the folder-structure state layout (adaptation A6):

```
features/editor/state/project/
├── project.store.ts                          signalStore({ providedIn: null }, ...features in order below)
├── project.events.ts                         eventGroup: projectLoaded, mutationsReceived (realtime), saveFailed,
│                                             itemsDeleted (lets selection/slides react without direct calls)
├── models/                                   ProjectState, SaveStatus, HistoryEntry, TableGeometry, SequenceLayoutSnapshot, GroupMembers
├── helpers/                                  schema-mutation.helper.ts (pure reducers: apply one SchemaMutation to SchemaModel, the
│                                             body of applyRemote, unit-testable; perf 3.1 patch mutations land here),
│                                             element-dto.helper.ts (elementToCreateDto, mapElement, mapTable), checkpoint.helper.ts
└── features/
    ├── project-props.feature.ts              withProps: injected *-api services, MatSnackBar, SaveQueue instance, History instance
    ├── project-state.feature.ts              withState: projectId, schema, accessMode, shared, loading, error, saveStatus,
    │                                         elementStyle (moves to tool.store later)
    ├── project-selection-state.feature.ts    selected*Ids, enteredGroupId, pending*EditId
    ├── project-slides-state.feature.ts       activeSlideKey, selectedPresentationKey, shownByPresentationKey, slideZoom
    ├── project-derived.feature.ts            tables, relationships, elements, themedElements, canEdit, foreignKeyColumnIds, ...
    ├── project-selection-derived.feature.ts  selectedTable/Element/..., groups, groupByItem (perf 1.3 equal fns)
    ├── project-slides-derived.feature.ts     presentationFrames, masterItemIds, layoutItemIds, hiddenBySlides, activeSlideId ...
    ├── project-save-queue.feature.ts         "write-queue module" (perf audit name): optimistic, enqueue, commitPatch, debounce,
    │                                         flushTimers, failedCreates, runSave → exposes a small typed API to method features
    ├── project-history.feature.ts            undo/redo stacks, batchHistory, pushHistory, canUndo/canRedo, record* helpers
    ├── project-load-methods.feature.ts       load, loadShared, setSchema, importFile
    ├── project-selection-methods.feature.ts  select*/setSelection/clearSelection/enterGroup/group/ungroup
    ├── project-tables-methods.feature.ts     tables + columns + indexes + relationships (ERD)
    ├── project-elements-methods.feature.ts   add/update/clone/duplicate/move/resize/reorder/arrange (perf 2.1 moveItemsLocal)
    ├── project-sequence-methods.feature.ts   diagrams, lifelines, messages, layout snapshots
    ├── project-slides-methods.feature.ts     assignSlide, setActiveSlide, setSlideZoom, selectPresentation
    └── project-event-handlers.feature.ts     on mutationsReceived → helpers/schema-mutation reducer (perf 3.1 lands here);
                                              on itemsDeleted → prune selection; on saveFailed → snackbar
```

- Viewport, home and themes move out of `schema` into `state/viewport/viewport.store.ts`. This is the same change as perf 1.1/1.2 (C1/C2), which is listed as "before".
- Cross-slice ordering uses `signalStoreFeature` input typing, so each methods feature declares what it needs (`{ state: type<ProjectState>(), props: type<{ saveQueue: SaveQueue; history: History }>() }`). That is the `featuresType` analog.
- `provideEditor()` provides the store (not `providedIn: 'root'`). Consumers outside the editor (shell top bar, command palette, home showcase) go through `core/editor-bridge` or the editor barrel's `EditorEmbedApi`.
- Size target: no feature file over 600 lines. The `elements` and `sequence` methods may need a second split (`…-elements-geometry-methods` vs `…-elements-crud-methods`).
- Tests come first (pass 3 pre-step): characterization specs for `schema-mutation.helper` (every `SchemaMutation` kind), optimistic rollback (`checkpoint`), history batching, and `importFile` selection, written against the current store and then kept green through the split.

### 4.5 Other frontend findings
- **Presentational purity.** About 21 leaf components inject `ProjectStore`. Toolbars, inspectors, `table-node`, `canvas-*`, `minimap` and `laser-layer` should take `input()`s and emit `output()`s. The sub-feature entry (`erd-layer`, `sequence-diagram`, `elements`) is the only store reader. Do this per sub-feature during pass 3, not as a separate sweep.
- **Effects that write state** (22): convert them to `computed`/`linkedSignal`, or to store methods called from the event source. Highest value in the editor (10) and the slides panel (4). Home's showcase effect must stay `untracked` (memory note: showcase restarts otherwise).
- **Template method calls** (about 149): convert per component to `computed` maps (e.g. `lastSlideOf` → `lastSlideByPresentation = computed(() => Map)`), or to pure pipes in `editor/shared/pipes/` (`slideCount`, `markerUrl`). Add `@angular-eslint/template/no-call-expression` as a warning with `allowList` for event bindings.
- **Lazy dialogs**: auth, api-tokens, confirm (shell), share and export (editor), projects-overlay. Use `const { ExportDialogComponent } = await import('…')`. This overlaps perf 4.2 (`AppComponent` slimming); do it once, under perf ownership.
- **a11y**: copy `matTooltip` text to `aria-label` on 72 icon-only buttons (scriptable), fix 2 that have neither, and convert 17 clickable `div/span/li` elements to `<button type="button">` (styles need a reset class in `shared/ui`).
- **Hex colors (chrome)**:
  - `home.component.scss` (43), `editor.component.scss` (19), `table-node` (14), `guide` (11), `app.component.scss` (6): move to `--dd-*` tokens defined for both Paper and Graphite.
  - `sequence-diagram/contrast.ts`: delete it and use shared `readableTextOn`/`isLightFill`.
  - `minimap` colors: use theme tokens (the perf audit already makes them a signal, C19).
- **Duplicate `AutofocusDirective`**: merge into `shared/ui/directives/autofocus.directive.ts` with an `afterNextRender`-based focus (no `setTimeout`) and a `select` option.

### 4.6 Signal utilities: `proxySignal`, `notifySignal`, `formSignal`

These come from the owner's qManage utilities: `proxySignal`/`writableProxySignal` and `notifySignal` are source files to copy in; `formSignal` comes from the `ngx-form-signal` package. Here is where each one fits in this codebase, from a code survey (counts are from grep).

**`proxySignal`: the editor ↔ app-chrome bridge (best fit).**
`core/services/editor-actions.service.ts` exposes 9 writable signals: `following`, `focusedDeck`, `decks`, `hasTableSelection`, `canExportSql`, `presentationName`, `hasPlainFrames`, `hasSelection` and `active`. The editor copies its own state into them through effects (`editor.component.ts:2368-2449`), and those account for most of the editor's 10 "effects that write signals". With proxies:
- The service declares `readonly hasSelection$ = proxySignal(false)` and so on.
- The editor, on init, calls `editorActions.hasSelection$.register(this.hasSelection$)` (or a `computed` from the store).
- On destroy it calls `.reset()`.
- `active` becomes `registered` on one of the proxies, or a computed over them.
- That removes about 8 effects and every manual reset in `clear()`. The handlers object (`register(handlers)`) stays as is, because functions aren't state.

The same pattern fits the **editor embed API** (C3.8, `EditorEmbedApi` for home showcase and guide sandboxes). The host reads editor state through proxies the embedded editor registers, instead of `::ng-deep` or polling. In C3.5, `writableProxySignal` lets the slides-panel store expose a selected-slide signal that the editor's deck-focus service owns.
- Don't use it where `computed`/`linkedSignal` suffices: when the producer is known at construction time, inject it and compute.
- Gotcha: `writableProxySignal.set()` is a silent no-op while unregistered. Callers must not write before the owner registers.

**`notifySignal`: re-derive when non-signal inputs change.**
| Where | Today | With `notifySignal` |
|---|---|---|
| `present-mode.component.ts:521/555` | `resized = signal(0)` bumped with `n => n + 1` on `window:resize` | `resized$ = notifySignal()`; the host listener calls `resized$.notify()` |
| `canvas/helpers/text-metrics.ts:212-214` | `document.fonts` `loadingdone` clears `inkCache`, but nothing reactive re-runs, so text measured before fonts load stays stale until the next edit | Export `fontsLoaded$ = notifySignal()` (owned by a small `FontMetricsService` in `editor/services/`, since helpers stay pure); shape-view computeds read it. **Required by perf P2.2**: its memo key must include this notifier, or cached wraps never refresh after fonts load. |
| `editor.component.ts:1317` `themeColors()`, `:2687/2699`, `minimap.component.ts:225` | `getComputedStyle` read inside computeds/templates; it doesn't track theme changes, so the result is either stale or recomputed every time | `ThemeService.themeChanged$ = notifySignal()` notified when Paper/Graphite toggles; the theme-color computeds read it, then `getComputedStyle`. This is the concrete shape of **perf P1.5/C19**. |
| Canvas rect cache (perf P2.4) | `getBoundingClientRect` per pointermove | Cache the rect in a computed keyed on a `layoutChanged$` notifier (ResizeObserver plus scroll) |

**`formSignal` (`ngx-form-signal`): only with Reactive Forms.**
The client uses no Reactive Forms today; every input is template-driven `ngModel`, mostly one-way `[ngModel]` + `(ngModelChange)` that commits straight to the store. So:
- **Convert to Reactive Forms + `formSignal`**: the real submit-and-validate forms. These are:
  - `features/auth/auth-dialog` (login/register: email and password validity, pending, submit-disabled)
  - `features/auth/api-tokens-dialog` (create token: name and scope)
  - `features/editor/share-dialog` (access level, link options)
  - `features/workspace/projects-overlay` (search, rename and create fields; check which are actual forms)

  Typed `FormGroup` + `formSignal(form)` gives `valid()`, `dirty()`, `value()` to `computed`s, for example `canSubmit$ = computed(() => form$.valid() && !saving$())`, with no `valueChanges` subscriptions.
- **Do not convert**: the inspectors (`inspector`, `relationship-inspector`, `sequence-inspector`), `animation-pane` and the slides-panel settings (39 `ngModel` uses). They are live property editors with no submit or validation, so a form model would duplicate the store. During their pass-3 splits, swap `[ngModel]`/`(ngModelChange)` for the design-system inputs' `value` input + `valueChange` output (`shared/ui/input`, `checkbox`, and the select), and drop `FormsModule` from them.
- If a pass-3 component turns out to need grouped validation (for example the theme editor), use a `FormGroup` + `deepFormSignal`.
- `formSignal` uses effects internally, so call it in an injection context (a field initializer) or pass `{ injector }`.

---

## 5. Backend findings and target structure

### 5.1 Findings

| Area | Finding | Evidence |
|---|---|---|
| Layering vs README | README says controller / policy / service / repository. Actual: controller → service; the service calls the central `AccessService` (policy) and injected TypeORM `Repository`s directly. There are no repository classes. | `@InjectRepository` in 13 services. `AccessService` has 7. `app.module.ts` comment repeats the claim. |
| Duplicated caller plumbing | Every write route declares `@CurrentUserId() userId, @ShareToken() shareToken, @ClientId() clientId` and passes them positionally: `create(tableId, dto, userId, shareToken, clientId)`. | 41 `@ShareToken()` across 9 controllers (sequence 11, projects 6, elements 5, columns/indexes/tables 4 each) |
| Duplicated access checks | Each service method starts with `await this.access.assertCanWrite…(id, userId, shareToken)`. Adding an entity means a new `assertCanWriteX` + `projectIdForX` and a new repo in `AccessService` (memory note: the spec constructs it positionally). | 47 calls: `assertCanWrite` 22, `…Table` 7, `assertOwner` 6, `…Element` 3, `…Read` 3, `…Relationship`/`…Index`/`…Column` 2 each |
| Patch boilerplate | `if (dto.x !== undefined) row.x = dto.x` repeated per field in every update | e.g. `columns.service.ts` `update` (9 fields), elements, tables, sequence |
| Emit boilerplate | `this.realtime.emit(projectId, clientId, { kind, … })` after each write | 36 call sites |
| Error handling | Consistent Nest `HttpException`s (47 NotFound, 35 BadRequest, 6 Unauthorized, 4 Forbidden, 4 Conflict). No raw `Error` in production code. **No global exception filter**: TypeORM/SQLite errors (constraint violations) surface as 500s with default bodies. | `grep throw new` |
| DTO placement | Good: interfaces in `shared/src/dto`, class-validator classes in `server/src/<module>/dto` that `implements` them (45/45). Duplicates: `PointDto` exists twice (`elements/dto/point.dto.ts`, `relationships/dto/point.dto.ts`; only the comment differs). Slide validation exists twice: `elements/dto/slide.dto.ts` (369 lines of class-validator) and `projects/project-import.parser.ts` (`slide`, `slideTheme`, `slideAnimations`, `media`, `placeholder`, hand-rolled). | |
| Large files | `project-import.writer.ts` 620 lines, with `writeSchemaInto` one function of about 460 lines (135–595). `project-import.parser.ts` 581 lines: pure apart from `BadRequestException`. `projects.service.ts` 397, `sequence.service.ts` 362, `elements.service.ts` 343, `batch/*.service.ts` 300 each. | |
| Cross-module coupling | `ExportService` and `SharingService` depend on `ProjectsService` (graph assembly). `AccessService` knows every entity. Entity cycle `tables ↔ columns ↔ indexes` (TypeORM relations; benign, lazy). | graph script |
| Dead code | `NotesModule` (empty `@Module({})`, still imported in `AppModule`) plus shared `NoteModel`/`CreateNoteDto`/`UpdateNoteDto`/`SchemaModel.notes`. OAuth `oauthStart`/`oauthCallback` stubs throwing `NotImplementedException` (`auth.controller.ts:106-121`). Unused deps: `passport`, `passport-jwt`, `@nestjs/passport`, `@types/passport-jwt`, `supertest`/`@types/supertest` (no e2e tests). Unused exports: `AppDataSource` (used by the TypeORM CLI, so keep it), `SlideTransitionDto`/`SlideAnimationDto` (used only internally), `API_TOKEN_PREFIX`. | |
| Stale comments | "Access control is deferred to the policy layer with the rest of the app (anonymous phase)" (`export.service.ts`), "stubbed now, implemented in Phase 8", 41 `BUILD_INSTRUCTIONS.md section N` references across client and server | |
| Config | Mostly `ConfigService`, but `API_TOKEN_RATE_LIMIT` (`api-token.service.ts:31`) and `CORS_ORIGIN` (`realtime.gateway.ts:54`) read `process.env` directly. `CORS_ORIGIN` is read twice with the same default. `DATABASE_SYNCHRONIZE` **defaults to `'true'`** with a comment saying to turn it off "before any real deployment". `JWT_SECRET` falls back to `'change-me-in-production'`. No config schema or validation at boot. | Security-relevant (hand to the security pass) |
| Migrations | 34 migrations, timestamp-named, consistent `AddX` naming. Because `synchronize` defaults on, local DBs are created by sync, so migrations aren't exercised in dev. Stale local `server/dbdesigner.sqlite*` files (old product name) sit next to `devdesigner.sqlite*` (both gitignored). | |
| Tests | 5 specs: `access.service`, `elements.service`, `svg-safety`, `project-import`, `sharing.service`. No controller, guard, batch, clone or sequence specs. No e2e despite `supertest` in devDependencies. | |
| Module consistency | Per-domain folders are consistent (`<x>.controller/.service/.module/.entity/.mapper`, `dto/`). Outliers: `batch/` (controller + 2 services, cross-entity), `common/` (decorators + a global interceptor in `write-revision.ts`), `export/` (one route), `realtime/` (gateway + publisher). | |

### 5.2 Target backend structure

```
server/src/
├── main.ts                              bootstrap only (pipes/filters/interceptors registered in platform/)
├── app.module.ts                        imports the 4 domain groups
├── platform/                            cross-cutting, no domain knowledge
│   ├── config/                          config.schema.ts (validate env at boot: PORT, DATABASE_*, JWT_*, CORS_ORIGIN,
│   │                                    COOKIE_*, API_TOKEN_RATE_LIMIT, ANALYTICS_*), typed AppConfig
│   ├── database/                        database.module.ts, data-source.ts (synchronize default false), migrations path
│   ├── http/
│   │   ├── request-context.ts           AsyncLocalStorage<RequestCtx> (shared with the 04 audit's analytics actor)
│   │   ├── caller.decorator.ts          @Caller() → { userId, shareToken, guestId, clientId, viaToken } (replaces 3 decorators)
│   │   ├── write-revision.interceptor.ts
│   │   ├── http-exception.filter.ts     maps TypeORM QueryFailedError (UNIQUE/FK) → 409/400; uniform error body
│   │   └── validation.pipe.ts
│   ├── realtime/                        realtime.gateway.ts, realtime.publisher.ts
│   └── health/
├── identity/                            who you are
│   ├── auth/                            auth.controller/service, optional-auth.guard, current-user.decorator, guest-id, dto/
│   ├── api-tokens/                      api-token.entity/service, controller (split from auth.controller)
│   └── user-themes/
├── collaboration/                       who may do what
│   ├── access/                          access.service.ts (resolveProjectAccess), project-access.guard.ts,
│   │                                    @RequiresAccess('write', { entity: 'column', param: 'columnId' }) decorator,
│   │                                    entity-project-resolver.ts (registry: entity → projectId lookup; new entities register here,
│   │                                    AccessService stops injecting every repo)
│   └── sharing/                         share links (controller/service/entity)
├── projects/                            the project aggregate
│   ├── projects/                        projects.controller/service/entity (CRUD, viewport/home/themes, duplicate)
│   ├── schema/                          ERD
│   │   ├── tables/  columns/  indexes/  relationships/
│   ├── canvas/
│   │   ├── elements/                    (dto/point.dto.ts shared with relationships → projects/common/dto/point.dto.ts)
│   │   ├── images/                      (svg-safety, image-hash; perf 4.5 storage module lands here)
│   │   └── sequence/
│   ├── batch/                           batch + clone (cross-entity write API)
│   ├── project-file/                    import/export: controller routes (import, import-content, export-file),
│   │                                    project-file.writer.ts split into writers/{tables,elements,sequence,images}.writer.ts;
│   │                                    the parser itself moves to @devdesigner/shared (§6)
│   ├── export/                          SQL export
│   └── common/                          apply-patch.helper.ts (applyDefined(row, dto, fields)), point.dto.ts, graph-loader.service.ts
│                                        (graph assembly used by projects/export/sharing, so they stop depending on ProjectsService)
├── admin/  analytics/                   (new, per 04 audit)
```

Common building blocks:
- `@Caller()` + `RequestContext`: remove about 120 decorator parameters and the positional `(userId, shareToken, clientId)` arguments. Services take `caller: Caller`, or read it from ALS.
- `@RequiresAccess` + `ProjectAccessGuard`: authorization moves out of service bodies. Services receive the resolved `projectId` from the request context (no second lookup).
- `applyDefined(row, dto, keys)`: replaces the per-field `!== undefined` blocks.
- `HttpExceptionFilter`: one error shape `{ statusCode, error, message, path, requestId }`.
- `ConfigSchema` validation: fail fast on a missing `JWT_SECRET` in production, and default `synchronize` to `false`.

Because the guard and the context change *how* authorization runs, **pass 4a (access guard) is a security change** and must be owned or reviewed by the security pass (§9).

---

## 6. Shared and MCP

**Boundaries are clean.**
- `@devdesigner/shared` imports nothing from the repo and contains no Angular or Nest code.
- `mcp/` depends only on `@devdesigner/shared` plus REST (no imports from server or client).
- Shared has no internal cycles. 77 of its 392 exports are unused outside shared. Most are internal types or constants that could simply stop being exported; the dead ones are the Note types listed below.
- The client consumes shared in 72 files.

**Duplication and misplacement**

| Duplicate / misplaced logic | Locations | Action |
|---|---|---|
| Table card metrics | client `canvas/constants/canvas.constants.ts` (`NODE_WIDTH 280`, `HEADER_H 40`, `ROW_H 34`) vs shared `diagram-spec` (`TABLE_NODE_WIDTH`, `TABLE_HEADER_H`, `TABLE_ROW_H`, plus estimators). The memory note says "keep in sync with canvas.constants.ts" by hand. `TABLE_NODE_WIDTH` is unused outside shared. | Client imports metrics from shared and re-exports locally. Move the remaining client-only widths (`ROW_FIXED_W`, `VARCHAR_FIXED_W`, `UNSIGNED_CHIP_W`, `NAME_CHAR_W` …) into shared too, so MCP estimates match exactly. |
| Slide stacking / shifting | client `editor.component.ts` `stackLegacySlides` (7177), `separateStackedPresentations` (7322), `shiftSlide`/`shiftItems` vs shared `stackSlideFrames` / `shiftPresentation` (used only by MCP) | One implementation in `shared/src/diagram-spec/presentation.ts` (or `shared/src/slides/stacking.ts`). The client calls it on load and writes through the batch API. |
| Text contrast | client `sequence-diagram/contrast.ts` (hand-rolled luminance + slate hexes) vs shared `palette` `readableTextOn`, `isLightFill`, `contrastRatio` | Delete the client copy. If it needs the muted/soft variants, add `readableTextSet(fill)` to shared. |
| Data-type display | MCP `model.ts` `formatDataType`; client `export/diagram-svg.helper.ts` `typeLabel`; table-node/inspector inline formatting | `formatDataType` into `shared/src/sql` (next to `parseDataType`). |
| Project-file id remap / clone / import planning | server `project-import.writer.ts` (remap + `offsetToAnchor`), client `core/sandbox/sandbox-backend.service.ts` (`remapIds` 703, `clone` 498, `importContent` 580), MCP import stacking | `shared/src/project-file/`: `parseProjectExport` (moved from the server parser; throws a shared `ProjectFileError` that the server maps to 400), `remapProjectIds`, `offsetToAnchor`, `planClone`. The server writer persists; the sandbox and MCP reuse the same planner. This is also where the "keep parser + writer in sync" rule (memory) becomes one place. |
| Schema → SVG | client `export/diagram-svg.helper.ts` (1,008 lines, export fidelity) vs MCP `render.ts` (441, preview) | Medium term: shared DOM-free `render-svg` core (tables, relationships, sequence) so MCP previews match exports. Fonts and images stay host-specific. Not urgent. |
| Code tokenizer | client `code-highlight.helper.ts` (pure, 406 lines; used by editor and home) | Move to `shared/src/code/` if MCP previews should draw highlighted code. Otherwise, keep it in the editor's code-block feature and have home import it via the editor barrel. |
| REST paths | client `*-api.service.ts` and MCP `tools.ts`/`agent-tools.ts` repeat path strings (`/projects/${id}/import-content`, `/tables/${id}` …) | Optional: `shared/src/api/routes.ts` path builders used by both. Server decorators stay literal. |
| Notes (dead) | shared `NoteModel`, `CreateNoteDto`, `UpdateNoteDto`, `SchemaModel.notes`; server `NotesModule` | Remove (check that the export file parser tolerates an absent `notes`). |
| Shared barrels | `dto/index.ts` 628, `models/index.ts` 513, `diagram-spec/index.ts` 834 lines in single files | Split per domain (`dto/tables.dto.ts`, `models/canvas.model.ts` …), keeping `index.ts` re-exports so imports don't change. |

**MCP internal cleanliness**
- Files: `presentation-tools.ts` 1,535 lines, `layout-tools.ts` 1,481, `tools.ts` 1,227, `agent-tools.ts` 955, `design-tools.ts` 843.
- The tool registration pattern is consistent. Pure planners are separated from REST writes (`layout.ts` vs `layout-tools.ts`), which matches the "pure helpers" guideline well.
- Suggested split: `tools/<domain>/{index.ts, <tool>.tool.ts}` once a file passes about 600 lines.
- 27 unused-var warnings (19 in `design-tools.ts`, mostly rest-omits) and 1 `prefer-const` error (`layout.ts:726`).

---

## 7. Tooling and tests

**Current state**
- **Prettier.** The root `.prettierrc.json` is 2-space / 100 columns / `trailingComma: all`. The client is already drifting: 101 files fail the current config.
- **ESLint.** The root flat config (`@eslint/js` + `typescript-eslint` recommended) has no Angular plugin, no template lint, no import or boundary rules, and `no-explicit-any` set to warn. `client`'s `ng lint` has no target.
- **Tests.**
  - Shared: 12 specs. Server: 5. MCP: 4. All on Jest 29 + ts-jest.
  - The client has none, and `ng test` has no builder configured.
  - Root `npm test` skips the client.
- **Cycles and dead code.** No madge, knip or ts-prune installed.
- **Line endings.** No `.gitattributes`. The NUL-byte file is treated as binary.

**Target configuration** (pass 0)
- `.prettierrc.json`: keep the current settings for backend and shared, and add `overrides: [{ files: 'client/**', options: { tabWidth: 3, printWidth: 120, trailingComma: 'es5' } }]`.
- `.gitattributes`: `* text=auto eol=lf`.
- `.git-blame-ignore-revs`: add the reformat commit.
- `client/eslint.config.mjs` (extends the root config):
  - `angular-eslint`, with:
    - `component-selector` / `directive-selector`: `dd` (kebab / camelCase)
    - `prefer-on-push-component-change-detection`
    - `prefer-signals`, `no-input-rename` (allow `$` aliasing)
    - `use-lifecycle-interface`
    - `template/no-call-expression`, `template/attributes-order`
    - `template/button-has-type`, `template/interactive-supports-focus`, `template/click-events-have-key-events`, `template/elements-content`, `template/label-has-associated-control`
    - `template/prefer-control-flow`
  - `no-restricted-syntax` banning `standalone: true` and `ViewEncapsulation.None`
  - `@typescript-eslint/no-explicit-any: error`
  - `@typescript-eslint/consistent-type-assertions` (warn)
  - `no-unused-vars` with `ignoreRestSiblings`
  - `max-lines` 600 (warn, ratchet)
  - `arrow-body-style: always` (warn; very noisy, so enable last)
- `eslint-plugin-boundaries`. Element types:
  - `core`, `shared-ui`, `shared`, `feature-entry`, `feature-part:{state,services,models,helpers,pipes,directives,components}`, `editor-public` (`features/editor/index.ts`)
  - Rules: those of folder-structure.md plus A5 and A17. Warn first.
  - Admin rule from the 04 audit: nothing outside `features/admin/**` imports it.
- Stylelint (`stylelint-config-standard-scss`) with `color-no-hex` + `color-named: never` on `client/src/app/**/*.scss` (exclude `styles.scss`).
- `madge` (devDependency) + root script `check:cycles`. `knip` (optional) + `check:dead`.
- Client Jest: `jest`, `jest-preset-angular`, `@types/jest`, `client/jest.config.ts`, `client/setup-jest.ts` (zoneless env + the jsdom shims listed in tests.md: `matchMedia`, `ResizeObserver`, `structuredClone`, `scrollIntoView`, `getComputedStyle`; plus `DOMMatrix`/`SVGElement.getBBox` stubs for canvas helpers). `"test": "jest"`, and root `npm test` gains `-w client`.

**Reformat churn**: about 51,100 lines in 194 client files (the indentation change alone touches nearly every line). Do it as one commit, with no other changes, listed in `.git-blame-ignore-revs`. Open branches rebase with "reformat-then-rebase": check out the branch, run `prettier --write` with the new config, commit, then rebase. The conflicts then collapse to real changes.

**The `$` suffix**: a bulk rename of about 680 fields plus every template read is not safe with a TS-only rename (templates aren't covered), and it would conflict with every open branch. Adopt it **per file during pass 3** (every new or decomposed file follows it). Add `@typescript-eslint/naming-convention` for `*$` on signal-typed members only once the editor split is done.

**Test priorities** (tests.md order, mapped to this repo)
1. **Pure helpers (cheapest, highest value).**
   - Client: `canvas/helpers/{routing,route,connectors,smart-guides,element-geometry,rich-text,rich-list,code-diff,code-highlight,grid-table,frame-contents,slide-zoom,link-snap,media}`, `slides/{layout-placeholders,standard-layouts,step-animator}`, the new `align.helper`, the new `schema-mutation.helper`.
   - Shared: `project-file/*` (moved parser/remap).
2. **Stores.** The `ProjectStore` features after the split: `save-queue` (optimistic, rollback, `failedCreates`), `history` (batching, `applyingHistory` guard), event handlers (`mutationsReceived` for every kind), selection pruning, `ProjectsStore`.
3. **Services with logic.** Sandbox handlers, `editor-shortcuts` keymap, `export.service` scope selection, `deck-layout-sync`.
4. **Pipes.** The new pipes.
5. **Components.** Only `table-node` (inline edit commit rules) and `select`/`tag-input` (keyboard behavior).

Server additions: `access` guard + resolver registry, `batch.service`, `clone.service`, `sequence.service` (self-message rejection), the HTTP exception filter, and one supertest e2e smoke run per domain group (auth cookie + share token + bearer token), or remove `supertest`.

---

## 8. Phased plan

Each pass leaves `npm run build` and `npm test` green and the app behaving the same. Each numbered step is one PR. Lint rules start as warnings and are flipped to errors at the end of the pass that clears them.

### Pass 0: Guardrails (about 2–3 days, no behavior change)
| Step | Change | Files |
|---|---|---|
| 0.1 | `.gitattributes` (LF); fix NUL bytes (`\x00` → `\u0000`) | `.gitattributes` (new), `client/src/app/features/editor/slides/morph-stage.ts:1908` |
| 0.2 | Prettier overrides for client (not applied yet); `.git-blame-ignore-revs` stub | `.prettierrc.json`, `.prettierignore` |
| 0.3 | Angular ESLint + template a11y rules + `dd` prefix rules (warn); `ignoreRestSiblings`; `any` → error | `client/eslint.config.mjs` (new), `eslint.config.mjs`, `client/package.json` (`lint`), `client/angular.json` (`prefix: dd`, lint target) |
| 0.4 | Boundaries lint (warn) encoding §2 A5/A17 and folder-structure import rules | `client/eslint.config.mjs` |
| 0.5 | Stylelint (`color-no-hex` on component SCSS, warn) | `client/.stylelintrc.json`, `client/package.json` |
| 0.6 | madge + `check:cycles`; optional knip + `check:dead` | root `package.json` |
| 0.7 | Client Jest harness + first pure-helper specs (routing, smart-guides, rich-list) | `client/jest.config.ts`, `client/setup-jest.ts`, `client/tsconfig.spec.json`, `client/package.json`, root `package.json` (`test`) |
| 0.8 | Characterization specs for store behavior on the **current** store: `applyRemote` per mutation kind, optimistic rollback, history batch, `importFile` selection | `client/src/app/stores/project.store.spec.ts` |

| 0.9 | Signal utilities (§4.6): add `shared/helpers/signals/{proxy-signal,notify-signal}.ts` + specs (register/reset/registered, writable no-op before register, notify re-runs a computed); `npm i ngx-form-signal -w client` and a smoke spec on Angular 22 (fallback if it breaks: pin and report upstream, since it's the owner's package) | `client/src/app/shared/helpers/signals/*` (new), `client/package.json` |

### Pass 1: Mechanical codemods (about 3–4 days; coordinate a short merge window)
| Step | Change | Files |
|---|---|---|
| 1.1 | **Reformat client** with the new Prettier config (one commit, blame-ignored) | all `client/src/**/*.{ts,html,scss}` (~194 files) |
| 1.2 | Drop `standalone: true` | 54 component and directive files |
| 1.3 | Prefix `app-` → `dd-` (43 components; `[appAutofocus]` → `[ddAutofocus]`), including SCSS selectors that target tags (`editor.component.scss:26-27`, `home.component.scss:1061/1202/1313`) and showcase DOM queries | all `*.component.ts/html/scss`; `features/home/*` |
| 1.4 | Merge the duplicate autofocus directives into `shared/ui/directives/autofocus.directive.ts` (`afterNextRender`) | `core/directives/autofocus.directive.ts`, `features/editor/autofocus.directive.ts`, 6 importers |
| 1.5 | Inline templates/styles → files (24 components; `slides-panel` alone moves about 2,250 lines) | `slides/{slides-panel,present-mode,deck-compare,animation-pane}.component.ts`, `minimap`, `media/*`, `multi-select-bar`, `pen-options-bar`, `shape-toolbar/toolbar-customize-panel`, `table-toolbar`, `sequence-diagram-toolbar`, `export/frame-order-dialog`, `shortcuts-sheet`, `shared/ui/*` (9) |
| 1.6 | Rename REST wrappers `*.service.ts` → `*-api.service.ts` (class names `TablesApiService` …) | `core/services/{projects,tables,columns,indexes,relationships,elements,sequence,share-links,user-themes,element-images}.service.ts`, `api.service.ts` → `api-client.service.ts` |
| 1.7 | Dead code: unused imports and constants (eslint list), `NotesModule` + shared Note types, duplicate `PointDto`, OAuth stubs (or keep them behind a feature flag if planned), unused server deps | see §3, §5.1 |
| 1.8 | a11y quick wins: `aria-label` from tooltip (scripted), 17 clickable non-buttons → `<button>` | 22 template files |
| 1.9 | Move exported non-component code out of component files (`PenPrefsService`, `prepareSandbox`/`readStored`/`writeStored`, `FocusUiState`, `ease`, `SlidesCommand`, `CompareUiState`) into `services/`/`helpers/`/`models/` beside them | `pen-options-bar`, `guide.component`, `slides-panel`, `present-mode`, `deck-compare` |
| 1.10 | Signal-utility adoption that needs no decomposition (§4.6): `EditorActionsService` → `proxySignal`s registered by the editor (removes about 8 signal-writing effects at `editor.component.ts:2368-2449`); `present-mode` `resized` → `notifySignal`; `ThemeService.themeChanged$` + `FontMetricsService.fontsLoaded$` notifiers (consumed by perf P1.5 and P2.2) | `core/services/editor-actions.service.ts`, `core/services/theme.service.ts`, `editor.component.ts` (constructor effects, `clear`), `app.component.*`, `command-palette`, `slides/present-mode.component.ts`, `canvas/helpers/text-metrics.ts` + new `editor/services/font-metrics.service.ts` |

### Pass 2: Folder moves (about 3–4 days; pure `git mv` + import rewrites; no logic edits in the same commit)
| Step | Change | Files |
|---|---|---|
| 2.1 | `shared/ui/` → `shared/ui/components/*` + `shared/ui/directives/*`; `workspace/confirm-dialog` → `shared/ui/components/confirm-dialog` | `shared/ui/**`, `features/workspace/confirm-dialog/**` |
| 2.2 | `core/` regrouped: `http/`, `auth/`, `theme/`, `realtime/`, `sandbox/`, `editor-bridge/` (`editor-actions.service.ts`) | `core/**` |
| 2.3 | Editor services out of core → `features/editor/services/` (temporarily flat): code-actions, grid-table, media-actions, rich-text-session, laser, element-images, entity `*-api` services | `core/services/*` (12 files) |
| 2.4 | Stores: `stores/project.store.ts` → `features/editor/state/project/project.store.ts`; `stores/projects.store.ts` → `features/workspace/state/projects/projects.store.ts` (still `providedIn: 'root'`) | `stores/*` |
| 2.5 | Editor sub-feature folders per §4.3 (canvas, erd, elements/*, sequence-diagram, toolbar, slides/*, export, share-dialog, collaboration, minimap); `canvas/helpers` split into `editor/helpers` vs `canvas/helpers`; `canvas/constants` → `editor/shared/constants` | `features/editor/**` |
| 2.6 | `features/editor/index.ts` public barrel; hosts (`workspace`, `share`, `guide`, `home`) import only it; `prepareSandbox` → `core/sandbox/sandbox-seeds.service.ts`; `features/auth` → `shared/features/auth-dialogs`; `projects-overlay` → `shared/features/projects-overlay`; `home` → `workspace/features/home` | `features/{home,guide,share,workspace,auth,command-palette}/**` |
| 2.7 | Flip boundaries lint to **error** for everything except the known pass-3 items (editor's leaf components injecting the store) | `client/eslint.config.mjs` |

Git rename detection keeps pass 2 cheap to merge with content-only branches, as long as each commit is a pure move (similarity above 90%).

### Pass 3: Decomposition (about 4–6 weeks; one sub-feature per PR, tests first)
| Step | Change | Files |
|---|---|---|
| 3.1 | Pure dedupe into `@devdesigner/shared`: table metrics, slide stacking (`stackLegacySlides` → `stackSlideFrames`), `readableTextOn` (delete `contrast.ts`), `formatDataType`, `project-file/` (parser + remap + clone planner) | `shared/src/{diagram-spec,slides,palette,sql,project-file}/*`, `client/.../canvas.constants.ts`, `editor.component.ts` (7177–7360), `sequence-diagram/contrast.ts`, `core/sandbox/sandbox-backend.service.ts`, `server/src/projects/project-import.{parser,writer}.ts`, `mcp/src/model.ts` |
| 3.2 | `shape-render.helper.ts` → `canvas/helpers/render/*` (breaks the cycle) | `features/editor/features/canvas/helpers/**` |
| 3.3 | `ProjectStore` slicing per §4.4: helpers first (`schema-mutation.helper`, `element-dto.helper`), then save-queue and history features, then per-domain methods, then events and event handlers; `provideEditor()` + `providedIn: null` last | `features/editor/state/project/**`, `features/editor/editor.providers.ts`, `app.component.ts` (via the editor bridge), `command-palette`, `home` |
| 3.4 | `EditorComponent` extraction per §4.2, in this order: keyboard/shortcuts → export → clipboard/images → pan-zoom → slides/deck-focus/placement → text editing → ERD gestures → element gestures → pointer dispatcher. Each extraction moves effects with it and converts signal-writing effects. | `features/editor/editor.component.{ts,html,scss}` + new services/components under `features/editor/features/**` |
| 3.5 | `slides-panel` → store + 7 components + `deck-layout-sync.service` | `features/editor/features/slides/**` |
| 3.6 | `present-mode`, `morph-stage`, `deck-compare` splits | `features/editor/features/slides/features/{present,deck-compare}/**` |
| 3.7 | Presentational purity per sub-feature: leaf components lose `ProjectStore`; entries pass inputs and outputs. Flip `boundaries` rule "components may not import state" to error. | about 21 component files |
| 3.8 | `home` → components + `showcase` sub-feature; editor embed via `EditorHostOptions`/`EditorEmbedApi` (no `::ng-deep` into the editor) | `features/workspace/features/home/**`, `features/editor/editor.component.ts` (embed API) |
| 3.9 | `sandbox-backend` → router + handlers + store (reusing shared `project-file`) | `core/sandbox/**` |
| 3.10 | Template method calls → computed/pipes; `track` ids; lazy dialogs (if perf 4.2 hasn't already); hex → tokens; remaining `setTimeout` → `afterNextRender`/scheduler. Flip the corresponding lint rules to error. | component templates and SCSS repo-wide |
| 3.11 | Forms (§4.6): `auth-dialog`, `api-tokens-dialog`, `share-dialog`, `projects-overlay` → typed Reactive Forms + `formSignal` (`canSubmit$` etc. as computeds); inspectors/animation-pane/slides settings drop `FormsModule` for design-system `value`/`valueChange` inside their own 3.x split | `features/auth/*`, `share-dialog/*`, `projects-overlay/*` |

### Pass 4: Backend reorganization (about 1.5–2 weeks; after security fixes land)
| Step | Change | Files |
|---|---|---|
| 4.1 | `platform/config` schema validation; `process.env` reads moved to `ConfigService`; `synchronize` default false | `server/src/platform/config/*`, `database/*`, `auth/api-token.service.ts:31`, `realtime/realtime.gateway.ts:54`, `main.ts` |
| 4.2 | `platform/http`: `RequestContext` (ALS, shared with the 04 audit), `@Caller()`, `HttpExceptionFilter` | `server/src/platform/http/*`, `common/*` (moved), `main.ts` |
| 4.3 | **Access guard**: `@RequiresAccess` + `ProjectAccessGuard` + entity→project resolver registry; services drop the `assertCanWrite*` preambles and the `(userId, shareToken, clientId)` parameters | `access/*`, all 9 controllers, 12 services, `access.service.spec.ts` |
| 4.4 | `applyDefined` patch helper; `projects/common/graph-loader.service.ts` (export and sharing stop depending on `ProjectsService`) | `*/**.service.ts`, `export/*`, `sharing/*` |
| 4.5 | Folder regroup: `platform/ identity/ collaboration/ projects/{projects,schema,canvas,batch,project-file,export,common}` (pure moves) | `server/src/**` |
| 4.6 | `project-file` writer split per entity; parser removed (now in shared) | `projects/project-import.writer.ts` → `projects/project-file/writers/*` |

### Pass 5: Test backfill and lock-in (ongoing, finishing about 1 week after pass 4)
| Step | Change | Files |
|---|---|---|
| 5.1 | Client helper and store coverage per §7 priorities | `client/src/app/**/*.spec.ts` |
| 5.2 | Server guard, batch, clone, sequence specs; e2e smoke run (or drop supertest) | `server/src/**/*.spec.ts`, `server/test/*.e2e-spec.ts` |
| 5.3 | Flip remaining lint rules to error (`max-lines`, `no-call-expression`, `naming-convention` for `$`, `arrow-body-style`); add `npm run verify` (lint + stylelint + check:cycles + test + build) to CI | configs, root `package.json` |

---

## 9. Cross-area dependencies

### 9.1 Security pass (expected to touch the server access layer)

**Conflicting files**:
- `server/src/access/access.service.ts`
- `auth/optional-auth.guard.ts`
- `auth/api-token.service.ts`
- `auth/auth.controller.ts`
- `sharing/*`
- all 9 controllers (the `@ShareToken`/`@CurrentUserId` plumbing)
- every service's `assertCanWrite*` preamble
- `realtime/realtime.gateway.ts` (room auth, CORS)
- `images/*` (`svg-safety`)
- `export/export.service.ts`, which calls `getGraph(projectId, userId)` without a share token (check whether that is intentional)
- `auth.module.ts` (`JWT_SECRET` default)
- `database.module.ts` (`synchronize` default)

**Recommendation**:
- Land security fixes **first, in the current layout**, as small patches. Pass 4 then moves fixed code.
- If the security pass wants to centralize authorization, pass **4.2/4.3 (RequestContext, `@Caller`, access guard) should be done *as* the security work**, owned by that pass, with `access.service.spec.ts` + new guard specs as the safety net. Don't do 4.3 as a cleanliness-only change before security has reviewed it.
- 4.1 (config validation, `synchronize` false, required `JWT_SECRET`) is security-adjacent. Hand it to the security pass or do it with their sign-off.
- Pass 1.7 dead-code removal of `NotesModule`, the OAuth stubs and passport deps is safe at any time, but tell the security pass, since unused auth deps are part of its inventory.
- Client-side security fixes (share-token interceptor, sandbox interceptor) don't conflict beyond pass 2.2 moves. Land them before pass 2 or rebase across pure moves.

### 9.2 Performance pass (02-performance.md)

**Conflicting files**:
- `features/editor/editor.component.ts`
- `stores/project.store.ts`
- `slides/slides-panel.component.ts`
- `core/services/realtime.service.ts`
- `canvas-shapes`, `minimap`, `shape-render.helper.ts`
- server `projects.service.ts`, `write-revision.ts`, `realtime.gateway/publisher.ts`, `batch.service.ts`, `elements.service.ts`

**Agreed ordering** (both audits use the same names for extracted modules: "write-queue module" = `project-save-queue.feature.ts`, "`applyRemote`/realtime-reducer file" = `helpers/schema-mutation.helper.ts` + `project-event-handlers.feature.ts`, "pointer-gesture service" = `canvas/services/pointer-gesture.service.ts`, "canvas-view computeds" = `canvas/state/canvas-view/`, `DeckLayoutSyncService` = `slides/services/deck-layout-sync.service.ts`):

1. **Perf phase 0–1 quick wins before cleanliness pass 3.** Steps 1.1–1.3 (viewport out of schema, equality functions), 1.4–1.6 (editor one-liners), 1.7–1.14 (server). They are small, they shrink the store's invalidation surface, and the server ones land before pass 4 moves those files.
2. **Perf 2.1 (`moveItemsLocal`)** goes before pass 3.3/3.4 if pass 3 starts more than about a week later. Otherwise it is implemented inside the new `project-elements-methods.feature.ts`.
3. **Perf 2.2/2.3 (render memoization)** are independent of the split. They can go any time, but do 2.2 **before** pass 3.2 (`shape-render` split) or right after it, not concurrently.
4. **Perf 2.4 (pointer pipeline), 2.5 (culling), 2.6 (slides sync), 3.1/3.2/3.6 (client parts) and 4.3 (deferred children)** go **after** pass 3.3–3.5, inside the extracted files.
5. **Pass 1.1 (client reformat)** should land **before** perf phase 1 starts, or right after it merges, never in the middle. Every perf branch open at reformat time needs the "reformat-then-rebase" step (§7).
6. Pass 2 (pure moves) can run between perf PRs. Rename detection keeps conflicts small, but announce each move PR so in-flight perf branches rebase promptly.
7. Perf 3.3 (access cache) goes **after** pass 4.3, because the cache belongs with the new access guard and resolver.
8. Perf 4.5 (media storage) goes after pass 4.5 (it creates `projects/canvas/images/storage`).
9. Perf 4.1 (shared as ESM) and pass 3.1 (moving logic into shared) both change `shared/`. Do 4.1 first or coordinate. After either, restart `npm run dev` (stale Vite cache gotcha).

### 9.3 Auditing/analytics pass (04-auditing-analytics.md)
- `RequestContext` (ALS) is the same component in both plans. Build it once, in pass 4.2 / analytics phase 0.5, at `server/src/platform/http/request-context.ts`. The 04 audit says `common/`; it moves with pass 4.5.
- The admin dashboard should be the **first feature built in the target layout** (`features/admin/{state,services,models,components,features}`), with `core/guards/admin.guard.ts`. Starting it after pass 0 (lint + boundaries) is enough; it doesn't need to wait for the editor split.

### 9.4 Recommended global sequence
1. Pass 0 (guardrails, warn-only) **and** security fixes (server), in parallel.
2. Pass 1.1–1.4 (reformat, `standalone`, prefix, autofocus) in one short merge window.
3. Perf phase 0–1 quick wins (+ perf 2.1, 2.2).
4. Pass 1.5–1.9, then pass 2 (moves), interleaved with remaining perf phase-1 PRs.
5. Pass 3 (decomposition, tests first). Perf 2.4–2.6, 3.x and 4.3 follow each extracted area.
6. Pass 4 (backend reorg) after security is merged. 4.2/4.3 are co-owned with security. Perf 3.3 and 4.5 follow.
7. Pass 5 lock-in, which raises every rule to error and adds CI `verify`.
