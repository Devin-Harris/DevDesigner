import { runtimeConfig } from '../../../../../core/config/runtime-config';

// Static copy and seed loaders of the home page (C3.8): data only, no Angular.

/** Bump when the showcase seeds change, so a browser session drops its old copies. */
export const SHOWCASE_VERSION = 27;

/** Showcase examples: small real projects made for the home page (see seeds/). */
export const SHOWCASE_SEEDS: Record<string, () => Promise<{ default: unknown }>> = {
   whiteboard: () => import('../seeds/whiteboard.json'),
   sequence: () => import('../seeds/sequence.json'),
   code: () => import('../seeds/code.json'),
   tables: () => import('../seeds/tables.json'),
   slides: () => import('../seeds/slides.json'),
   more: () => import('../seeds/more.json'),
};

export interface HomeFeature {
   icon: string;
   tone: string;
   title: string;
   body: string;
}

export const HOME_FEATURES: readonly HomeFeature[] = [
   {
      icon: 'crop_square',
      tone: 'amber',
      title: 'Whiteboard & architecture',
      body: 'Shapes, arrows that stay bound to what they connect, freehand pen and rich text.',
   },
   {
      icon: 'timeline',
      tone: 'teal',
      title: 'Sequence diagrams',
      body: 'Participants and messages that respace themselves as the flow grows.',
   },
   {
      icon: 'code',
      tone: 'violet',
      title: 'Code that reads like an IDE',
      body: 'Syntax-highlighted blocks, file names, formatting and side-by-side or inline diffs.',
   },
   {
      icon: 'table_chart',
      tone: 'blue',
      title: 'Data models',
      body: 'Tables with types, keys and indexes. Import CREATE TABLE SQL, export it back out.',
   },
   {
      icon: 'image',
      tone: 'slate',
      title: 'Grids, images & video',
      body: 'Spreadsheet-style grids with merged cells, plus media you can crop and clip.',
   },
   {
      icon: 'slideshow',
      tone: 'red',
      title: 'Decks from the board',
      body: 'Any number of presentations per project, with layouts, themes, animations and morph.',
   },
];

export const HOME_USES: readonly { title: string; body: string }[] = [
   { title: 'Design reviews', body: 'Proposal, diagrams and the diff in one place.' },
   { title: 'Onboarding', body: 'A living map of the system new people can click through.' },
   { title: 'Incident walkthroughs', body: 'Replay the request path step by step with the laser.' },
   { title: 'Talks & demos', body: 'Morphing slides built from the same board you designed on.' },
];

/** Auto-rotating tool showcase under the hero. */

export const HOME_SHOWCASE = [
   {
      id: 'draw',
      icon: 'crop_square',
      label: 'Whiteboard',
      guide: 'shapes',
      seed: 'whiteboard',
      title: 'Sketch it fast',
      body: 'Drag out shapes, type straight into them, and connect them with arrows that stay attached.',
   },
   {
      id: 'seq',
      icon: 'timeline',
      label: 'Sequence',
      guide: 'sequence',
      seed: 'sequence',
      title: 'Walk the request path',
      body: 'Add participants, then drag messages between them. The diagram grows and respaces as you go.',
   },
   {
      id: 'code',
      icon: 'code',
      label: 'Code',
      guide: 'code',
      seed: 'code',
      title: 'Show the diff that matters',
      body: 'Paste or type code into a highlighted block, then flip it to a side-by-side diff.',
   },
   {
      id: 'data',
      icon: 'table_chart',
      label: 'Data model',
      guide: 'tables',
      seed: 'tables',
      title: 'Model the data',
      body: 'Add tables and columns, then drag one key onto another to relate them.',
   },
   {
      id: 'slides',
      icon: 'slideshow',
      label: 'Slides',
      guide: 'presentations',
      seed: 'slides',
      title: 'Build slides on the board',
      body: 'Draw a frame and it becomes a slide. Add a second one, and shared objects morph between them. Check every pair before you present.',
   },
   {
      id: 'more',
      icon: 'auto_fix',
      label: 'And more',
      guide: 'select',
      seed: 'more',
      title: 'A project, coming together',
      body: '',
   },
] as const;

// MCP endpoint from the build env (scripts/set-env.mjs `mcpUrl`). Unset: deployed builds
// fall back to the production server, local dev to the local HTTP MCP (npm run start:mcp:http).
export const MCP_URL =
   runtimeConfig.mcpUrl ||
   (runtimeConfig.production ? 'https://devdesignermcp-production.up.railway.app/mcp' : 'http://localhost:3001/mcp');

/** `.mcp.json` snippet for the hosted MCP server. */
export const MCP_CONFIG = JSON.stringify(
   {
      mcpServers: {
         devdesigner: {
            type: 'http',
            url: MCP_URL,
            headers: { Authorization: 'Bearer dd_...' },
         },
      },
   },
   null,
   2
);

/** Claude Code CLI one-liner for the same server. */
export const MCP_COMMAND = `claude mcp add --transport http devdesigner ${MCP_URL} --header "Authorization: Bearer dd_..."`;
