import { CANVAS_TOOLS } from './guide-canvas-tools';
import { PRESENTATION_TOOLS } from './guide-presentation-tools';
import { PROJECT_TOOLS } from './guide-project-tools';
import type { EditorTool } from '../../editor';

/** Content for the canvas guide: one entry per tool, each with its own sandbox seed. */

export interface GuideStep {
   title: string;
   body: string;
}

export interface GuideShortcut {
   keys: string;
   action: string;
}

export interface GuideTool {
   /** URL slug (/guide/:id) and the seed file name in seeds/<id>.json. */
   id: string;
   name: string;
   /** Primary keyboard shortcut(s) shown on the tab. */
   keys?: string;
   icon: string;
   tone: 'blue' | 'teal' | 'amber' | 'violet' | 'red' | 'slate';
   tagline: string;
   intro: string;
   /** What to try first in the sandbox. */
   tryIt: string[];
   howTo: GuideStep[];
   options: GuideStep[];
   shortcuts: GuideShortcut[];
   tips: string[];
   /** Rail section the tab sits under. */
   group: 'Canvas' | 'Presentations' | 'Project';
   /** Tool selected in the sandbox when it opens. */
   editorTool?: EditorTool;
   /** Seed file name when several tabs share one (default: `id`). */
   seed?: string;
   /** Longer topics: each a heading with paragraphs or bullet points. */
   deepDive?: { title: string; body?: string; points?: string[] }[];
   /** Extra buttons on the sandbox bar (export/import actions). */
   sandboxActions?: 'export';
}

export const GUIDE_GROUPS: GuideTool['group'][] = ['Canvas', 'Presentations', 'Project'];

export const GUIDE_TOOLS: GuideTool[] = [...CANVAS_TOOLS, ...PRESENTATION_TOOLS, ...PROJECT_TOOLS];
