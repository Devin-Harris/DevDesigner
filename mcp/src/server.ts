// Builds the MCP server (tools, resources, prompts) for one API client. Shared by the
// stdio entry point (one token from the environment) and the HTTP entry point (one
// server per request, token from the Authorization header).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_VERSION, type DevDesignerApi } from './api';
import { registerResourcesAndPrompts, registerTools } from './tools';

export const INSTRUCTIONS = [
  "Tools to create and edit DevDesigner diagrams (database schemas, sequence diagrams, free drawing).",
  "Workflow: list_projects / create_project, then get_project_summary to see what exists.",
  "Prefer apply_diagram_spec to build a whole diagram in one call; positions are chosen automatically.",
  "Reference tables, columns and participants by NAME; ids are returned for follow-up calls.",
  "Relationships: `from` is the referenced (primary key) side, `to` the foreign key side.",
  "Changes appear live for anyone with the project open. delete_* tools need confirm: true.",
  "Colors: every color argument takes a palette name. Prefer the editor's picker swatches - red, amber, green, sky, blue, violet, pink, slate (plus white/ink) - so users can match them by hand; orange, teal and *-soft tints exist but are not in the pickers. Call list_colors for what suits what. Give tables of one domain the same color; use strong colors for headers and soft tints for fills/backgrounds. Stick to these swatches (they match the app's color pickers) - pass a #hex only when the user asks for a specific color; never invent custom shades. On slide content (shapes, text, code, grid tables and cells, sequence diagrams, backgrounds), use ONLY theme tokens ($heading, $text, $muted, $surface, $background, $accent1-4): they follow the presentation theme when it changes (palette names / hex on a slide ignore the theme; only use them when the user asks for a specific color). Database tables do not take tokens.",
  "Presentations: create_presentation gives the deck a design (theme + layouts; list_designs). Put every slide on a layout (`layout` + `fill`, see list_layouts) instead of laying out title and body by hand, so the deck stays consistent with its design.",
  "Images: add_image places a PNG/JPEG/GIF/WebP/SVG (inline <svg> markup, base64, a file path or a URL) on the canvas; slides take image items the same way. Draw simple icons/illustrations yourself as inline SVG with a viewBox.",
  "Morph: text animates by character by default; set transition.morphBy to word or object to coarsen it. Tag single words with runs[].morph, and sequence participants/messages/diagrams with a morph tag, only when automatic matching (by name and wording) pairs them wrongly; check with preview_morph.",
  "Presentations: every slide uses a 300ms morph transition by default (leave transitions unset). Objects get unique morph ids, so only items you deliberately share a `morph` tag between slides animate; share sparingly, and check with preview_morph.",
  "Slide backgrounds: set `background` on a slide (create_presentation / add_slides) or use set_slide_background - never draw a rectangle behind the content. Recolor existing shapes, text, code blocks and table headers with style_elements (palette swatches).",
  "Layout: after building or editing, run check_layout (overlaps, content past the slide edge, text that does not fit). Fix with fit_to_bounds (slides), scale_tables / scale_items (sizes), compact_layout (tighten gaps), move_items / align_items / distribute_items / arrange_grid (many items in one call; never loop move_element), respace_sequence_diagram, and arrange_layers (front/back; list_layers shows the order).",
  "See your work: render_preview returns a PNG of a slide, region or the canvas (showIds labels items) - look at it after building or rearranging. find_items gives ids WITH positions; get_items_detail gives full properties.",
  "Batch over loops: move_items, delete_items, update_messages, connect_items (many arrows), duplicate_items, group_items/ungroup_items each take many items in one call. Group ids work wherever items are accepted.",
  "Slides: duplicate_slide copies a slide (keeping morph pairing) for step-by-step builds; apply_slide_layout places existing items into named regions (title, two-column, ...).",
  "Schemas from SQL: diff_schema / apply_schema_changes read CREATE TABLE / ALTER TABLE DDL (Postgres, MySQL, SQLite, SQL Server).",
  "Mistakes: undo_last_change reverts the most recent change(s) this session made (list_changes shows them)."
].join('\n');

export function createServer(api: DevDesignerApi): McpServer {
  const server = new McpServer(
    { name: 'devdesigner', version: MCP_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, api);
  registerResourcesAndPrompts(server, api);
  return server;
}
