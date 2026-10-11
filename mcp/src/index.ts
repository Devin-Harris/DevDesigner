#!/usr/bin/env node
// DBDesigner MCP server (stdio). Configure with:
//   DBDESIGNER_API_TOKEN  an API token created in DBDesigner (required)
//   DBDESIGNER_API_URL    backend base URL incl. /api (default http://localhost:3000/api)
// Logs go to stderr only: stdout belongs to the MCP protocol.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DbDesignerApi, configFromEnv } from './api';
import { registerResourcesAndPrompts, registerTools } from './tools';

const INSTRUCTIONS = [
  'Tools to create and edit DBDesigner diagrams (database schemas, sequence diagrams, free drawing).',
  'Workflow: list_projects / create_project, then get_project_summary to see what exists.',
  'Prefer apply_diagram_spec to build a whole diagram in one call; positions are chosen automatically.',
  'Reference tables, columns and participants by NAME; ids are returned for follow-up calls.',
  'Relationships: `from` is the referenced (primary key) side, `to` the foreign key side.',
  'Changes appear live for anyone with the project open. delete_* tools need confirm: true.',
  'Colors: every color argument takes a palette name (blue, green, violet, amber, sky, pink, teal, orange, red, slate, a *-soft tint like blue-soft, or ink/charcoal/gray/white) or a #hex; call list_colors for what suits what. Give tables of one domain the same color; use strong colors for headers and soft tints for fills/backgrounds.',
  'Images: add_image places a PNG/JPEG/GIF/WebP/SVG (inline <svg> markup, base64, a file path or a URL) on the canvas; slides take image items the same way. Draw simple icons/illustrations yourself as inline SVG with a viewBox.',
  'Morph: text animates by character by default; set transition.morphBy to word or object to coarsen it. Tag single words with runs[].morph, and sequence participants/messages/diagrams with a morph tag, only when automatic matching (by name and wording) pairs them wrongly; check with preview_morph.',
  'Presentations: every slide uses a 300ms morph transition by default (leave transitions unset). Objects get unique morph ids, so only items you deliberately share a `morph` tag between slides animate; share sparingly, and check with preview_morph.',
].join('\n');

async function main(): Promise<void> {
  const api = new DbDesignerApi(configFromEnv());
  const server = new McpServer(
    { name: 'dbdesigner', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, api);
  registerResourcesAndPrompts(server, api);
  await server.connect(new StdioServerTransport());
  console.error('DBDesigner MCP server ready (stdio).');
}

main().catch((err: unknown) => {
  console.error(`DBDesigner MCP server failed to start: ${(err as Error).message}`);
  process.exit(1);
});
