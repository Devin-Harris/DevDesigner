import type { GuideTool } from './guide-tools';

/** Guide pages for project-level features. */
export const PROJECT_TOOLS: GuideTool[] = [
   {
      id: 'export',
      group: 'Project',
      editorTool: 'select',
      name: 'Export & import',
      icon: 'ios_share',
      tone: 'blue',
      tagline: 'Images, PDFs, SQL and portable project files.',
      intro: 'Everything on the board can leave as an image, a PDF or SQL, and whole projects (or just a selection) travel as a .devdesigner.json file you can import anywhere. The buttons on this sandbox’s bar run the same actions as Export in the main menu.',
      tryIt: [
         'Press PNG on the sandbox bar to export the canvas.',
         'Select two shapes and press Selection.',
         'Press Import and choose that file: the items are added again.',
         'Copy items with Ctrl C and paste them into another project.',
      ],
      howTo: [
         {
            title: 'Images',
            body: 'PNG, SVG or PDF of the whole canvas, or of the selection when something is selected. Frames also have their own export in the frame toolbar.',
         },
         {
            title: 'Decks',
            body: 'All slides (PDF pages) exports the current presentation, one slide per page; All frames exports plain frames the same way.',
         },
         { title: 'SQL', body: 'Generates CREATE TABLE DDL for the ERD tables (table names must be unique).' },
         {
            title: 'Project files',
            body: 'Project file (.json) saves everything: tables, drawings, images, sequence diagrams, decks and themes. Selection only (.json) saves just what is selected.',
         },
         {
            title: 'Import',
            body: 'Import (.json) in the main menu merges a file into the open project; dropping a .json file onto the canvas does the same at the drop point. Import in the projects list creates a new project instead.',
         },
      ],
      options: [
         {
            title: 'Paste anything',
            body: 'Paste images, video, code and text straight onto the canvas; each becomes the matching element.',
         },
         { title: 'Copy between projects', body: 'Ctrl C / Ctrl V works across projects and browser tabs.' },
         {
            title: 'MCP',
            body: 'AI assistants can export the project file, generate SQL and import files through the MCP server.',
         },
      ],
      shortcuts: [
         { keys: 'Ctrl C · Ctrl V', action: 'Copy · paste' },
         { keys: 'Ctrl K', action: 'Projects & commands' },
      ],
      tips: [
         'Imported items get fresh ids, so importing the same file twice gives two independent copies.',
         'Images are embedded in project files, so a file is self-contained.',
      ],
      sandboxActions: 'export',
   },
];
