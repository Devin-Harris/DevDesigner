# DevDesigner

DevDesigner is an infinite-canvas workspace for developers: design database schemas, sketch architecture, draw sequence diagrams, and build presentations, all in one live, shareable project. Under the canvas it keeps a structured model, so a schema you draw can be validated and exported as ready-to-run SQL, and an AI assistant can build or edit any of it through the bundled MCP server.

It runs as a web app, as a self-hosted server, or as a desktop app (Electron) that works offline and syncs with a server.

## Features

### Database schemas (ERD)
- Tables with columns, types and constraints: primary/foreign keys, unique, not-null, defaults, auto-increment, unsigned, composite unique keys.
- Relationships with cardinality notation, routed automatically or manually with pinned sides.
- Validation (dangling references, type mismatches, duplicate keys) and SQL `CREATE TABLE` export.
- Schema import and diffing from SQL DDL (Postgres, MySQL, SQLite, SQL Server).

### Drawing and content
- Shapes, rich text (per-run styling, fonts, scale-on-resize), freehand pen, and arrows that bind to elements.
- Syntax-highlighted code blocks, spreadsheet-style grid tables, images and SVGs (paste or drop), and live frames that embed a URL.
- Sequence diagrams with participants and messages.
- Layer ordering, grouping, alignment, undo/redo, a laser pointer, a minimap and a shared per-project home view.

### Presentations
- Frames become slides, with themes (color and font tokens), layouts with placeholders, and reusable designs.
- Transitions including morph, which animates matching objects and text (by character, word or object) between slides.
- A full-screen present mode.

### Collaboration and sharing
- Accounts with multi-project dashboards.
- Server-authoritative realtime editing with presence: everyone sees changes live.
- Share links with view or edit access, no account needed for the recipient; revocable at any time.
- Project export/import as a JSON file.

### AI assistants (MCP)
- An MCP server (`mcp/`) exposes projects, schemas, drawings and presentations to Claude and other MCP clients, authenticated with per-user API tokens. See [MCP server](#mcp-server).

### Desktop app and self-hosting
- `desktop/` packages DevDesigner as an Electron app with local projects, auto-updates, and snapshot sync to a server.
- A single-process self-hosted server (Docker image or Node), with all state in one data folder. See [docs/self-hosting.md](docs/self-hosting.md).

### Guides
- In-app tool guides at `/guide/:tool`, each with a sandbox editor to try the tool.

## Tech stack

- **Frontend:** Angular (standalone components, signals) with a bespoke design system, SVG/HTML canvas rendering.
- **Backend:** NestJS, REST plus a realtime websocket channel, layered as controller / policy / service / repository.
- **Database:** SQLite via TypeORM (better-sqlite3).
- **Shared:** `shared/` TypeScript package used by client, server, MCP and desktop: models, DTOs, enums, SQL generation and validation.
- **MCP:** `@modelcontextprotocol` server over stdio or Streamable HTTP.
- **Desktop:** Electron with electron-builder.

## Repository layout

npm-workspaces monorepo:

| Package | What it is |
| --- | --- |
| `client/` | Angular web app |
| `server/` | NestJS API, realtime gateway, migrations |
| `shared/` | Code shared by every package |
| `mcp/` | MCP server for AI assistants |
| `desktop/` | Electron desktop app |
| `docs/` | Plans, audits and the self-hosting guide |

## Getting started

Requires Node 22+.

```bash
git clone <repo-url> devdesigner
cd devdesigner
npm install

cp server/.env.example server/.env
cp client/src/environments/environment.example.ts client/src/environments/environment.ts

npm run dev            # shared (watch) + server + client
# Windows: npm run dev:windows
```

The client runs at `http://localhost:4242` and the API at `http://localhost:3000/api`.

### Useful scripts

| Command | Does |
| --- | --- |
| `npm run dev:server` / `npm run dev:client` | Run one side only |
| `npm test` | Tests for every workspace |
| `npm run verify` | Build shared, lint, check import cycles, test, build |
| `npm run build:mcp` | Build the MCP server |
| `npm run start:desktop` | Run the desktop app from source |
| `npm run dist:desktop` | Build desktop installers |
| `npm run build:selfhost` / `npm run start:selfhost` | Build and run the self-hosted server |

## MCP server

The `mcp/` package exposes DevDesigner to AI assistants (Claude Desktop, Claude Code, any MCP client) so you can say "design a schema for a blog" and watch it appear live.

1. Run the app, sign in, open **Account → API tokens** and create a token (read & write, or read only). Copy the token and the generated config.
2. Build the server once: `npm run build:mcp`.
3. Register it with your client, e.g. Claude Desktop / Claude Code:

```json
{
  "mcpServers": {
    "devdesigner": {
      "command": "node",
      "args": ["<path to DevDesigner>/mcp/dist/index.js"],
      "env": {
        "DEVDESIGNER_API_URL": "http://localhost:3000/api",
        "DEVDESIGNER_API_TOKEN": "dd_..."
      }
    }
  }
}
```

The server talks only to the REST API as the token's owner, so permissions, validation and realtime collaboration are the same as in the UI. Tools cover projects, tables/columns/relationships, sequence diagrams, drawing shapes/text/arrows, bulk `apply_diagram_spec` (atomic, auto-laid-out), import/export, `auto_layout`, `validate_project` and `generate_sql`, images and SVGs (`add_image`: inline `<svg>`, base64, a file path or a URL; slides take image items too), a named color palette (`list_colors`: strong header colors, soft tints, neutrals; every color argument takes a name or hex), and presentations (`create_presentation`, `add_slides`, `add_to_slide`, `update_slide`, `reorder_slides`, `delete_slide`, morph tags via `set_morph_tag` / `update_participant` / `update_message` / `preview_morph`...). Morph transitions can animate text by character, word or object (`transition.morphBy`), individual words can be tagged (`runs[].morph`), and sequence participants/messages/diagrams pair across slides by name and wording or by an explicit tag; `delete_*` tools require `confirm: true`. Tokens are rate limited (`API_TOKEN_RATE_LIMIT`, default 600 requests/min).

**Remote (HTTP) MCP:** `npm run build:mcp && npm run start:mcp:http` (or `MCP_TRANSPORT=http`) serves a stateless Streamable HTTP endpoint at `POST /mcp` (health: `GET /health`) on `PORT` (default 3001). Set `DEVDESIGNER_API_URL` to the API (incl. `/api`). Each request sends its own `Authorization: Bearer dd_...`, so one deployment serves many users. In this mode `filePath` images are disabled and image URLs may not point at private addresses. Claude Code: `claude mcp add --transport http devdesigner https://YOUR-HOST/mcp --header "Authorization: Bearer dd_..."`.

### Connecting to the production DevDesigner MCP

No build needed: the hosted server runs at `https://devdesignermcp-production.up.railway.app/mcp`.

1. Sign in to the production app, open **Account → API tokens** and create a token (read & write, or read only).
2. Add it to a `.mcp.json` at your project root (Claude Code picks this up automatically; approve the server when prompted):

```json
{
  "mcpServers": {
    "devdesigner-prod": {
      "type": "http",
      "url": "https://devdesignermcp-production.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer dd_..."
      }
    }
  }
}
```

   Or from the CLI: `claude mcp add --transport http --scope project devdesigner-prod https://devdesignermcp-production.up.railway.app/mcp --header "Authorization: Bearer dd_..."`.
3. Restart the client (or run `/mcp` in Claude Code) and check that `devdesigner-prod` shows as connected; `list_projects` should return your projects.

You can keep a local entry (stdio, as above) and the prod entry side by side under different names. `.mcp.json` holds your token, so keep it out of git (add it to `.gitignore`) or use an env var: `"Authorization": "Bearer ${DEVDESIGNER_API_TOKEN}"`.

## License

MIT License

Copyright (c) 2025 Devin-Harris

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
