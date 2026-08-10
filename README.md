# DBDesigner

DBDesigner is a fullstack web application for visually designing, documenting, and exporting database schemas. It provides an interactive, canvas-based workspace, similar to [dbdiagram.io](https://dbdiagram.io/) or [Miro](https://miro.com/), where you can lay out entity-relationship diagrams (ERDs), define relationships between tables, annotate your designs, and generate ready-to-run SQL.

## Overview

Modern schema design often happens in disconnected tools: a whiteboard for brainstorming, a SQL file for the real DDL, and a wiki for documentation that quickly goes stale. DBDesigner unifies these into one place. You draw your schema on an infinite canvas, and DBDesigner keeps a structured model of it underneath, so the same design can be visualized, documented, and exported as migration-ready SQL without manual re-typing.

## Key Features

### Multi-Project Workspaces

Create and manage many independent projects, each with its own canvas, tables, relationships, and documentation. Projects are listed on a dashboard, can be renamed, duplicated, archived, and searched, and open into their own isolated design space.

### Interactive Canvas

An infinite, pannable, zoomable canvas for arranging your schema. Tables are draggable nodes that snap and align, relationships are drawn as connectors that route around obstacles, and the whole layout is saved automatically as you work.

### ERD Modeling

Define tables with columns, data types, and constraints (primary keys, foreign keys, unique, not-null, defaults, auto-increment). Draw relationships between tables (one-to-one, one-to-many, and many-to-many) with clear cardinality notation rendered directly on the canvas.

### Relationships & Referential Integrity

Connect columns across tables to express foreign-key relationships. DBDesigner validates that relationship endpoints are type-compatible and flags issues such as dangling references or duplicate keys before you export.

### Documentation Layer

Attach rich-text notes to the project, to individual tables, and to columns. Add free-floating sticky notes and text blocks anywhere on the canvas to explain design decisions, capture open questions, or group related tables visually.

### Sharing & Collaboration

Share any diagram via a link so others can view or edit it. **No account required for the person you share with**. The owner generates a share link with a chosen access level (view-only or edit), can revoke it at any time, and anyone holding the link works on the diagram directly in their browser. Account-based OAuth sign-in (Google, GitHub) is planned so users can own and manage their projects.

### SQL Export

Generate `CREATE TABLE` DDL from your diagram, with MySQL as the primary target dialect. Export the full schema or a selected subset, preview the generated SQL in-app, and download it as a `.sql` file. The architecture is designed so additional dialects (PostgreSQL, SQLite) can be added later.

### Import (Planned)

Parse an existing `.sql` schema file or a DBML definition and reconstruct it as a diagram on the canvas, so you can visualize and document databases you already have.

## Tech Stack

- **Frontend:** Angular + TypeScript, NgRx Signal Store for state, Angular Material + CDK for components and styling. No custom CSS; styling is driven through Angular Material theming and CDK primitives.
- **Canvas:** A diagramming layer built on the Angular CDK (drag-drop, overlays) with SVG for tables, connectors, and cardinality markers.
- **Backend:** NestJS (TypeScript) with a layered controller / policy / service / repository structure, REST API.
- **Database:** SQLite (application data: projects, tables, relationships, share links), accessed via TypeORM.
- **Shared:** A top-level `shared/` TypeScript package imported by both client and server for end-to-end type safety (models, DTOs, enums, and the SQL generator/validation as pure functions).
- **Auth & Sharing:** Anonymous, link-based sharing with view/edit access levels (no account needed for invitees). OAuth sign-in (Google, GitHub) planned for account owners.
- **SQL Generation:** A dedicated schema-model to DDL module, dialect-aware, starting with MySQL.

## Core Concepts

- **Project**: a top-level container owning its tables, relationships, notes, share links, and canvas viewport (pan position and zoom).
- **Canvas**: the visual workspace. Each table and note tracks its own `x`/`y` position; the project tracks the viewport.
- **Table (Node)**: an entity with an ordered list of columns and constraints.
- **Column**: a field on a table with a name, data type, and constraints.
- **Relationship (Edge)**: a typed connection between two columns expressing a foreign-key link and cardinality.

## Project Structure

DBDesigner is an npm-workspaces monorepo with three packages:

- **`client/`** the Angular frontend (Material + CDK, NgRx Signal Store, CDK/SVG canvas).
- **`server/`** the NestJS backend, layered as controller / policy / service / repository, using TypeORM over SQLite.
- **`shared/`** environment-agnostic TypeScript imported by both: models, DTOs, enums, and the SQL generator and validation as pure functions, giving end-to-end type safety.

Root-level scripts (`npm run dev`, `npm run dev:server`, `npm run dev:client`) and matching VS Code tasks let you start either part or the whole app from the repository root.

## Getting Started

```bash
# Clone and install (npm workspaces install client, server, and shared together)
git clone <repo-url> dbdesigner
cd dbdesigner
npm install

# Configure environment
cp server/.env.example server/.env      # set DATABASE_URL (sqlite file) and JWT/session secret
cp client/src/environments/environment.example.ts client/src/environments/environment.ts   # set apiUrl

# Run database migrations (TypeORM)
npm run migration:run -w server

# Start everything from the repo root
npm run dev            # runs server + client together
# or run them individually:
# npm run dev:server
# npm run dev:client
```

VS Code users can instead launch the **Dev: All**, **Dev: Server**, or **Dev: Client** tasks from the task runner.

Then open the app at `http://localhost:4200`.

## Roadmap

- [ ] Project dashboard & CRUD
- [ ] Canvas with draggable table nodes
- [ ] Column & constraint editing
- [ ] Relationship drawing with cardinality
- [ ] Schema validation
- [ ] MySQL export
- [ ] Documentation / notes layer
- [ ] Link-based sharing (view/edit, no account required)
- [ ] OAuth sign-in (Google, GitHub)
- [ ] Real-time collaboration (multi-user editing)
- [ ] SQL / DBML import
- [ ] Additional export dialects (PostgreSQL, SQLite)
- [ ] Version history & diagram snapshots

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
