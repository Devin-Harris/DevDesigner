// Builds the MCP server (tools, resources, prompts) for one API client. Shared by the
// stdio entry point (one token from the environment) and the HTTP entry point (one
// server per request, token from the Authorization header).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbDesignerApi } from './api';
import { registerResourcesAndPrompts, registerTools } from './tools';

export const INSTRUCTIONS = [
  "Tools to create and edit DBDesigner diagrams (database schemas, sequence diagrams, free drawing).",
  "Workflow: list_projects / create_project, then get_project_summary to see what exists.",
  "Prefer apply_diagram_spec to build a whole diagram in one call; positions are chosen automatically.",
  "Reference tables, columns and participants by NAME; ids are returned for follow-up calls.",
  "Relationships: `from` is the referenced (primary key) side, `to` the foreign key side.",
  "Changes appear live for anyone with the project open. delete_* tools need confirm: true.",
  "Colors: every color argument takes a palette name (blue, green, violet, amber, sky, pink, teal, orange, red, slate, a *-soft tint like blue-soft, or ink/charcoal/gray/white) or a #hex; call list_colors for what suits what. Give tables of one domain the same color; use strong colors for headers and soft tints for fills/backgrounds.",
  "Images: add_image places a PNG/JPEG/GIF/WebP/SVG (inline <svg> markup, base64, a file path or a URL) on the canvas; slides take image items the same way. Draw simple icons/illustrations yourself as inline SVG with a viewBox.",
  "Morph: text animates by character by default; set transition.morphBy to word or object to coarsen it. Tag single words with runs[].morph, and sequence participants/messages/diagrams with a morph tag, only when automatic matching (by name and wording) pairs them wrongly; check with preview_morph.",
  "Presentations: every slide uses a 300ms morph transition by default (leave transitions unset). Objects get unique morph ids, so only items you deliberately share a `morph` tag between slides animate; share sparingly, and check with preview_morph."
].join('\n');

export function createServer(api: DbDesignerApi): McpServer {
  const server = new McpServer(
    { name: 'dbdesigner', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, api);
  registerResourcesAndPrompts(server, api);
  return server;
}
