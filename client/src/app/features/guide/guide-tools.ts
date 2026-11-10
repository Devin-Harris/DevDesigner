import type { EditorTool } from '../editor/shape-toolbar/shape-toolbar.component';

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

export const GUIDE_TOOLS: GuideTool[] = [
   {
      id: 'select',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Select & Hand',
      keys: 'V · H',
      icon: 'near_me',
      tone: 'blue',
      tagline: 'Pick things up, line them up, move around the board.',
      intro: 'Select is the default tool. Click to select one item, Shift-click to add more, or drag a box across empty canvas to marquee-select. Hand pans the view without touching anything, which is handy on a crowded board.',
      tryIt: [
         'Drag a box around the three services.',
         'Open Align in the bar that appears and choose Center vertically.',
         'Hold Space and drag to pan, or scroll with Ctrl to zoom.',
      ],
      howTo: [
         { title: 'Select', body: 'Click an item, or drag across empty canvas to select everything the box touches.' },
         {
            title: 'Move & resize',
            body: 'Drag a selection to move it. Drag a corner handle to resize; hold Shift to keep the aspect ratio.',
         },
         {
            title: 'Align & distribute',
            body: 'With two or more items selected, the floating bar offers align, distribute and tidy (equal 40px gaps).',
         },
         { title: 'Arrange', body: 'Bring forward or send backward to change which item draws on top.' },
      ],
      options: [
         {
            title: 'Smart guides',
            body: 'Pink guide lines show when an edge or center lines up with a neighbour, and the item snaps to it.',
         },
         { title: 'Snap to grid', body: 'Toggle in the bottom-left view bar to snap positions to the dot grid.' },
         {
            title: 'Home view',
            body: 'Set the current view as the project home; everyone opening the project starts there.',
         },
         { title: 'Minimap', body: 'Bottom-right overview of the whole board. Click it to jump.' },
      ],
      shortcuts: [
         { keys: 'V', action: 'Select tool' },
         { keys: 'H / Space', action: 'Hand (pan)' },
         { keys: 'Ctrl G', action: 'Group selection' },
         { keys: 'Ctrl Shift G', action: 'Ungroup' },
         { keys: 'Ctrl [ / ]', action: 'Send backward / bring forward' },
         { keys: 'Shift 1', action: 'Zoom to fit' },
         { keys: 'Shift 2', action: 'Zoom to selection' },
      ],
      tips: [
         'Press Home to jump back to the project’s home view.',
         'Press ? anywhere in the editor for the full shortcut sheet.',
      ],
   },
   {
      id: 'tables',
      group: 'Canvas',
      editorTool: 'select',
      name: 'ERD tables',
      keys: 'E',
      icon: 'table_chart',
      tone: 'blue',
      tagline: 'Data models with types, keys and relationships.',
      intro: 'Tables model a database schema. Each table has typed columns with primary key, unique, nullable and auto-increment flags. Drag from one column to another to create a relationship; the connector shows its cardinality and re-routes as tables move.',
      tryIt: [
         'Double-click a column name in “orders” to rename it.',
         'Drag from users.id onto a column in another table to link them.',
         'Click a relationship line to change its cardinality.',
      ],
      howTo: [
         { title: 'Add a table', body: 'Press E, then click on the canvas. The table starts with an id primary key.' },
         { title: 'Columns', body: 'Use the + row to add a column. Set the type and flags in the inspector.' },
         {
            title: 'Relationships',
            body: 'Drag from a column handle to the column it references. One-to-one, one-to-many and many-to-many are supported.',
         },
         {
            title: 'SQL out',
            body: 'Export the model as SQL DDL (Main menu → Export → SQL). AI assistants connected over MCP can also read CREATE TABLE statements and apply them.',
         },
      ],
      options: [
         { title: 'Header color', body: 'Color tables by domain so related ones read together.' },
         {
            title: 'Connector routing',
            body: 'Auto routing picks the shortest sides; manual pins a side and keeps it there.',
         },
         { title: 'Indexes', body: 'Add composite and unique indexes from the table inspector.' },
      ],
      shortcuts: [
         { keys: 'E', action: 'Table tool' },
         { keys: 'Enter', action: 'Edit selected column' },
         { keys: 'Delete', action: 'Delete selected table or relationship' },
      ],
      tips: ['Key glyphs mark primary and unique keys at a glance.', 'Tables can sit on slides like any other item.'],
   },
   {
      id: 'sequence',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Sequence diagrams',
      keys: 'Q',
      icon: 'timeline',
      tone: 'teal',
      tagline: 'Participants and messages that respace themselves.',
      intro: 'A sequence diagram shows a request moving between services over time. Participants are columns; messages are rows that run top to bottom. Insert or reorder a message and the rest move out of the way.',
      tryIt: [
         'Click a message label and rename it.',
         'Hover between two messages and use + to insert a new one.',
         'Drag a participant header left or right to reorder.',
      ],
      howTo: [
         {
            title: 'Create',
            body: 'Press Q (or pick Sequence in the toolbar) and click on the canvas to start a diagram.',
         },
         {
            title: 'Participants',
            body: 'Add participants from the diagram toolbar; each gets a header and a lifeline.',
         },
         {
            title: 'Messages',
            body: 'Drag from one lifeline to another to add a call. Solid is a call, dashed a return, break a divider.',
         },
      ],
      options: [
         {
            title: 'Colors',
            body: 'Color a participant header, its lifeline or a single message (red for the error path).',
         },
         { title: 'Spacing', body: 'Adjust row and column spacing for the whole diagram from its toolbar.' },
         { title: 'Title & background', body: 'Each diagram has a title and an optional tinted box behind it.' },
      ],
      shortcuts: [
         { keys: 'Q', action: 'Sequence tool' },
         { keys: 'Delete', action: 'Delete selected message or participant' },
      ],
      tips: ['Messages morph between slides when their wording matches.'],
   },
   {
      id: 'shapes',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Shapes & arrows',
      keys: 'R O D · A L',
      icon: 'crop_square',
      tone: 'amber',
      tagline: 'Boxes, ovals, diamonds and arrows that stay bound.',
      intro: 'Shapes are the whiteboard layer: rectangles, ellipses and diamonds with an optional centered label. Arrows and lines bind to whatever they start and end on, so they follow when you rearrange.',
      tryIt: [
         'Drag “Web app” around: the arrow stays attached.',
         'Select the dashed arrow and switch it to Elbow.',
         'Press R, drag out a new box, then type a label.',
      ],
      howTo: [
         {
            title: 'Draw a shape',
            body: 'Press R, O or D (press again to cycle) and drag on the canvas. Click without dragging for a default size.',
         },
         { title: 'Label it', body: 'Double-click a shape, or just start typing while it is selected.' },
         {
            title: 'Connect',
            body: 'Press A for an arrow or L for a line and drag from one shape to another to bind it.',
         },
      ],
      options: [
         { title: 'Fill & stroke', body: 'Palette swatches, stroke width, solid / dashed / dotted, and opacity.' },
         { title: 'Corner radius', body: 'Rectangles take a custom radius, or elliptic corners for an oval-ish look.' },
         { title: 'Arrow routing', body: 'Straight, curved or elbow; choose arrowheads per end and reverse them.' },
         { title: 'Clip image', body: 'Use a shape as a mask for an image dropped on it.' },
      ],
      shortcuts: [
         { keys: 'R / O / D', action: 'Rectangle / ellipse / diamond' },
         { keys: 'A / L', action: 'Arrow / line' },
         { keys: 'Shift drag', action: 'Square / circle, or 45° arrows' },
      ],
      tips: ['Drag the middle handle of an arrow to bend it into a curve.'],
   },
   {
      id: 'text',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Text',
      keys: 'T',
      icon: 'text_tool',
      tone: 'slate',
      tagline: 'Rich text with per-word styling.',
      intro: 'Text blocks size to their content. Select words inside a block to make them bold, italic or a different color; resize the block to scale the text, or switch on wrap to keep a fixed width.',
      tryIt: [
         'Double-click the rich-text line and select a word: restyle it.',
         'Compare the font samples, then change one from the font menu.',
         'Edit the list: press Enter, then Tab to nest an item.',
         'Drag a corner of the title to scale it.',
      ],
      howTo: [
         { title: 'Add', body: 'Press T and click where the text should go. Start typing.' },
         {
            title: 'Style runs',
            body: 'Select part of the text to style just that run: bold, italic, underline, color.',
         },
         { title: 'Lists', body: 'Bulleted and numbered lists from the text toolbar.' },
      ],
      options: [
         { title: 'Font & size', body: 'Sans, serif, handwritten or mono; any size.' },
         { title: 'Alignment', body: 'Left, center or right, plus line spacing.' },
         { title: 'Wrap', body: 'Fixed width with wrapping, or auto width that grows as you type.' },
      ],
      shortcuts: [
         { keys: 'T', action: 'Text tool' },
         { keys: 'Ctrl B / I / U', action: 'Bold / italic / underline' },
         { keys: 'Esc', action: 'Finish editing' },
      ],
      tips: [
         'Paste plain text onto the canvas to create a text block.',
         'Text inside slides can follow the deck theme: pick the Heading or Body theme font.',
      ],
      deepDive: [
         {
            title: 'Rich text, per word',
            body: 'A text block is a list of styled runs. Select any span while editing and the floating toolbar styles only that span, so one line can mix weights, italics, underlines and colors.',
            points: [
               'Bold, italic, underline: Ctrl B / I / U',
               'Color: any palette swatch, per run',
               'Clear styling by selecting the span and toggling again',
            ],
         },
         {
            title: 'Fonts',
            body: 'Every font in the sandbox is available from the font menu: Inter, Poppins, Serif, Display, Condensed, Hand, Caveat, Marker and Code. Inside a presentation you can also pick the theme’s Heading or Body font so the text restyles when the theme changes.',
         },
         {
            title: 'Lists',
            points: [
               'Start a line with “• ” or “1. ”, or use the list buttons in the toolbar.',
               'Enter continues the list; Enter on an empty item ends it.',
               'Tab nests an item, Shift Tab un-nests it; numbers renumber themselves.',
            ],
         },
         {
            title: 'Sizing',
            points: [
               'Auto width: the block grows as you type.',
               'Wrap: drag a side handle to fix the width; the height follows the text.',
               'Scale: drag a corner to scale the font with the box.',
               'Line spacing and alignment live in the paragraph menu.',
            ],
         },
      ],
   },
   {
      id: 'draw',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Draw',
      keys: 'P',
      icon: 'pen',
      tone: 'red',
      tagline: 'Freehand pen for quick sketches and callouts.',
      intro: 'The pen draws smooth freehand strokes. Use it to circle something, sketch an idea before formalising it, or annotate a screenshot.',
      tryIt: ['Press P and scribble around the loop.', 'Change the color in the pen bar, then draw again.'],
      howTo: [
         { title: 'Draw', body: 'Press P, then click and drag. Each stroke becomes its own item.' },
         { title: 'Edit', body: 'Switch to Select (V) to move, recolor, resize or delete strokes.' },
      ],
      options: [
         { title: 'Color & width', body: 'Set in the pen options bar that shows while the tool is active.' },
         { title: 'Opacity', body: 'Lower it for a highlighter effect.' },
      ],
      shortcuts: [
         { keys: 'P', action: 'Pen tool' },
         { keys: 'Esc', action: 'Back to Select' },
      ],
      tips: ['Group strokes with Ctrl G so a sketch moves as one.'],
   },
   {
      id: 'code',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Code block',
      keys: 'C',
      icon: 'code',
      tone: 'violet',
      tagline: 'Syntax-highlighted code that reads like an IDE.',
      intro: 'Code blocks highlight TypeScript, SQL, JSON, Python, C#, Java, HTML, CSS and Bash. Give a block a file name for a title bar, and add a changed version to show a split or inline diff.',
      tryIt: [
         'Double-click the first block and edit the code.',
         'Switch the diff block between split and inline.',
         'Change the language from the block toolbar.',
      ],
      howTo: [
         { title: 'Add', body: 'Press C and click on the canvas, or paste code while nothing is being edited.' },
         { title: 'Edit', body: 'Double-click to edit in place. Tab indents; Esc leaves.' },
         { title: 'Diff', body: 'Turn on diff to edit the changed side; additions and removals are highlighted.' },
      ],
      options: [
         { title: 'Language', body: 'Choose the highlighter; plain text turns it off.' },
         { title: 'File name', body: 'Shown in a title bar, like a tab in an editor.' },
         { title: 'Collapse', body: 'Fold a block to its title bar to save space.' },
      ],
      shortcuts: [
         { keys: 'C', action: 'Code tool' },
         { keys: 'Shift Alt F', action: 'Format code' },
      ],
      tips: ['Whitespace-only changes are hidden from diffs unless you turn them on.'],
   },
   {
      id: 'grid',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Grid table',
      keys: 'G',
      icon: 'grid_view',
      tone: 'teal',
      tagline: 'Spreadsheet-style tables for comparisons and specs.',
      intro: 'A grid is a table of text, not a database table: rows and columns, an optional bold header, merged cells and per-cell color. Rows grow to fit wrapped text.',
      tryIt: [
         'Double-click a cell in the comparison table and type.',
         'Drag the border between two columns to resize them.',
         'Select two empty cells in the sprint table and merge them.',
         'Give a cell a soft fill from the cell toolbar.',
      ],
      howTo: [
         { title: 'Add', body: 'Press G and click on the canvas for a 3×3 grid.' },
         { title: 'Edit cells', body: 'Double-click a cell; Tab moves to the next one, Enter to the row below.' },
         { title: 'Rows & columns', body: 'Insert or delete from the grid toolbar or the cell menu.' },
      ],
      options: [
         { title: 'Cell style', body: 'Fill, text color, bold, italic, horizontal and vertical alignment.' },
         { title: 'Merge', body: 'Merge a block of cells into one; split it again later.' },
         { title: 'Header', body: 'Toggle the bold first row.' },
      ],
      shortcuts: [
         { keys: 'G', action: 'Grid tool' },
         { keys: 'Tab / Enter', action: 'Next cell / cell below' },
      ],
      tips: [
         'Grid cells take theme colors on slides, so a table restyles with its deck.',
         'Ask an MCP assistant to fill or restyle a grid in one go (edit_grid_table).',
      ],
      deepDive: [
         {
            title: 'Styling that reads well',
            points: [
               'Use one strong fill (blue, slate) with white text for the title or header row.',
               'Use soft tints (green-soft, amber-soft) to highlight a few cells, not whole tables.',
               'Merge across the top for a table title.',
               'Center short numeric columns; keep prose left-aligned.',
            ],
         },
         {
            title: 'Sizing',
            body: 'Drag a column’s right border or a row’s bottom border to resize it. Drag the table’s corner to scale everything; text wraps and rows grow to fit.',
         },
      ],
   },
   {
      id: 'media',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Image & video',
      icon: 'image',
      tone: 'slate',
      tagline: 'Screenshots, diagrams and clips you can crop and clip.',
      intro: 'Drop or paste images (PNG, JPEG, GIF, WebP, SVG) and videos onto the canvas. They are stored with the project, so they export and present with it.',
      tryIt: [
         'Double-click the original image and crop it.',
         'Select the circle and switch its clip to diamond, or release it.',
         'Drop a GIF or a short video onto the placeholder box.',
         'Paste a screenshot from your clipboard.',
      ],
      deepDive: [
         {
            title: 'Crop',
            body: 'Double-click an image (or use Crop in its toolbar) to drag the visible region. The full picture is kept, so you can re-crop later or reset it.',
         },
         {
            title: 'Clip to a shape',
            points: [
               'Rounded rectangle (set the corner radius), circle or diamond from the clip menu.',
               'Or drop an image onto a shape and choose Clip to shape.',
               'Release the clip to get the plain image back.',
            ],
         },
         {
            title: 'GIFs and video',
            points: [
               'GIFs are still until clicked by default; set playback to auto or hover.',
               'Videos play from their own controls; set autoplay, loop, mute, and trim start and end.',
               'Playback settings apply when presenting too, so a slide can start a clip automatically.',
            ],
         },
         {
            title: 'Storage and export',
            body: 'Uploads are stored with the project, so they come along in exports and project files. SVGs are cleaned on upload.',
         },
      ],
      howTo: [
         {
            title: 'Add',
            body: 'Drag a file onto the canvas, paste from the clipboard, or use the image button in the toolbar.',
         },
         { title: 'Crop', body: 'Double-click an image to crop; drag the handles, then press Enter.' },
         { title: 'Clip', body: 'Clip an image to a rounded rectangle, circle or another shape.' },
      ],
      options: [
         { title: 'Video playback', body: 'Autoplay, loop and mute when presenting.' },
         { title: 'Opacity & border', body: 'Fade an image or give it a stroke.' },
      ],
      shortcuts: [
         { keys: 'Ctrl V', action: 'Paste image' },
         { keys: 'Enter', action: 'Apply crop' },
      ],
      tips: ['SVGs are sanitised on upload, so scripts and external links are removed.'],
   },
   {
      id: 'frame',
      group: 'Canvas',
      editorTool: 'select',
      name: 'Frame',
      keys: 'F',
      icon: 'crop',
      tone: 'violet',
      tagline: 'Group an area of the board, or turn it into a slide.',
      intro: 'A frame is a titled area. Anything inside moves with it. Frames can clip what sticks out past their edges, and any frame can become a slide in a presentation.',
      tryIt: ['Drag the frame by its title: the shapes come along.', 'Resize the frame and turn on clip content.'],
      howTo: [
         { title: 'Add', body: 'Press F and drag out an area, or select items and wrap them in a frame.' },
         { title: 'Rename', body: 'Double-click the title above the frame.' },
         { title: 'Make a slide', body: 'Add the frame to a presentation from the frame toolbar.' },
      ],
      options: [
         { title: 'Clip content', body: 'Hide the parts of shapes that stick out past the frame.' },
         { title: 'Background', body: 'Give the frame a fill color.' },
      ],
      shortcuts: [
         { keys: 'F', action: 'Frame tool' },
         { keys: 'S', action: 'Slide tool' },
      ],
      tips: ['Slides are frames too, so everything here applies to presentations.'],
   },
   {
      id: 'laser',
      group: 'Canvas',
      editorTool: 'laser',
      name: 'Laser & collaboration',
      keys: 'K',
      icon: 'highlight',
      tone: 'red',
      tagline: 'Point things out live; the trail fades on its own.',
      intro: 'The laser draws a short-lived trail that everyone in the project sees, without changing the board. It works in view-only shares too, which makes it ideal for walkthroughs. Collaborators’ cursors show live as they move.',
      tryIt: [
         'Press K and drag across the shapes.',
         'Open this project in a second window and watch the trail appear there.',
      ],
      howTo: [
         { title: 'Point', body: 'Press K, then click and drag. Release to let the trail fade.' },
         {
            title: 'Share',
            body: 'Use Share to invite people with edit or view access; each sees the others’ cursors.',
         },
      ],
      options: [{ title: 'View-only', body: 'Viewers can use the laser but can not change anything.' }],
      shortcuts: [
         { keys: 'K', action: 'Laser' },
         { keys: 'Esc', action: 'Back to Select' },
      ],
      tips: ['Pair the laser with Present mode for live demos.'],
   },
   // ---------------------------------------------------------------- Presentations
   {
      id: 'presentations',
      group: 'Presentations',
      editorTool: 'select',
      seed: 'presentations',
      name: 'Decks on the canvas',
      keys: 'S',
      icon: 'slideshow',
      tone: 'violet',
      tagline: 'Build slides from the same board you design on.',
      intro: 'A presentation is a stack of 16:9 slide frames that lives on the canvas next to everything else. Its slide list sits beside it and its settings panel on the other side. Only the current slide is shown in its spot, so you can drag diagrams, code and tables straight in from the board.',
      tryIt: [
         'Click a slide in the deck’s slide list to show it.',
         'Drag something onto the slide: it joins that slide.',
         'Press New in the slide list to add a slide.',
         'Press F5 to present, then use the arrow keys.',
      ],
      howTo: [
         {
            title: 'Start a deck',
            body: 'Press S and click on the canvas. A new presentation appears with its first slide, a slide list and a settings panel.',
         },
         {
            title: 'Add content',
            body: 'Use any tool on the shown slide, or drag existing items onto it. Items whose center lands on the slide become part of it.',
         },
         {
            title: 'Add and order slides',
            body: 'New adds a slide; duplicate a slide to build a step-by-step sequence. Drag slides in the list to reorder them.',
         },
         {
            title: 'Several decks',
            body: 'A project can hold any number of presentations, each with its own spot, list and settings. Rename one from its slide list header.',
         },
      ],
      options: [
         {
            title: 'Speaker notes',
            body: 'Each slide has notes in the settings panel; press N while presenting to show them.',
         },
         { title: 'Hidden slides', body: 'Hide a slide to skip it when presenting without deleting it.' },
         { title: 'Background', body: 'Set a slide’s background from the settings panel, or let the theme decide.' },
         {
            title: 'Focus mode',
            body: 'Shift F focuses the selected deck: the board dims and the deck gets full-size panels plus screens for layouts, transitions and animations (see Presenting & morph).',
         },
      ],
      shortcuts: [
         { keys: 'S', action: 'New presentation' },
         { keys: 'Shift F', action: 'Focus / leave focus' },
         { keys: 'F5', action: 'Present from the start' },
         { keys: 'Shift F5', action: 'Present from this slide' },
      ],
      tips: [
         'Ctrl scroll over a slide zooms just that slide, showing a staging area around it for items that morph in from off-slide.',
         'Export → All slides (PDF pages) saves the deck as a PDF.',
      ],
      deepDive: [
         {
            title: 'How slides own their content',
            body: 'Slides stack in one spot and only the shown slide is drawn. Everything on a slide belongs to it: switching slides swaps the content without moving your view. Drag an item fully off the slide to release it back onto the board.',
         },
         {
            title: 'Building a talk from a board',
            points: [
               'Sketch the system on the canvas first.',
               'Start a deck beside it and drag the pieces you want onto slides.',
               'Duplicate a slide and change one thing to build a diagram up step by step: with morph, the shared parts glide.',
               'Present live with your team; they can follow along from their own screens.',
            ],
         },
      ],
   },
   {
      id: 'design',
      group: 'Presentations',
      editorTool: 'select',
      seed: 'presentations',
      name: 'Layouts & themes',
      icon: 'template',
      tone: 'teal',
      tagline: 'Consistent slides: layouts, a master, and theme colors and fonts.',
      intro: 'Every deck has a design: a set of slide layouts, a master, and a theme. Layouts hold placeholders (title, body, columns) and decorations; the theme supplies colors and fonts as tokens, so changing it restyles the whole deck at once.',
      tryIt: [
         'Select the deck and open the Design tab in its settings panel.',
         'Switch the theme from Ocean to Midnight and watch every slide restyle.',
         'Change the current slide’s layout to Two columns.',
      ],
      howTo: [
         {
            title: 'Pick a layout',
            body: 'Blank, Title, Section header, Title and content, Two columns, Three columns, Comparison, Statement or Quote. Placeholders show a prompt until you type in them and are never exported empty.',
         },
         {
            title: 'Edit a layout or the master',
            body: 'Open a layout from the Design tab to edit it on the canvas. Items on the master appear under every slide; items on a layout appear under the slides that use it.',
         },
         {
            title: 'Override on one slide',
            body: 'Double-click a master or layout item on a slide to make a slide-only copy; Revert puts the original back.',
         },
         {
            title: 'Theme',
            body: 'Built-in themes: Default, Midnight, Paper, Ocean and Bold. Customize colors and fonts to save your own; custom themes are kept in My themes for other projects too.',
         },
      ],
      options: [
         {
            title: 'Designs',
            body: 'Default, Sidebar, Centered and Banner arrange the same layout kinds differently, so switching keeps every slide.',
         },
         {
            title: 'Theme tokens',
            body: 'Heading, Text, Muted, Surface and Accent 1–4 colors, plus Heading and Body fonts. Use them on shapes, text, code, grids and sequence diagrams.',
         },
         { title: 'Fields', body: 'Text such as {{slide}} fills in per slide, handy for page numbers on a layout.' },
      ],
      shortcuts: [{ keys: 'Shift F', action: 'Focus the deck while designing' }],
      tips: [
         'Use theme tokens rather than fixed colors on slides; fixed colors stay put when the theme changes.',
         'ERD tables keep their own header colors and ignore theme tokens.',
      ],
   },
   {
      id: 'present',
      group: 'Presentations',
      editorTool: 'select',
      seed: 'presentations',
      name: 'Presenting & morph',
      icon: 'play_circle',
      tone: 'red',
      tagline: 'Focus mode, transitions, morph pairing, build steps and live presenting.',
      intro: 'Present mode plays the deck full screen. Each slide has a transition into it; the default is a quick morph, which animates anything the two slides share: boxes glide and resize, text animates letter by letter, and sequence messages slide into place.',
      tryIt: [
         'Select the deck and press Shift F to enter focus mode.',
         'Show slide 6 (“Pick one out”), open its Transition tab and press Refine to map the pairs.',
         'Drag from a square on the left to a different square on the right to re-pair it, then Preview.',
         'Press F5 and step through slides 4–7: the squares glide, fade and reflow.',
      ],
      howTo: [
         {
            title: 'Transitions',
            body: 'None, fade, slide (with a direction), zoom or morph, with duration and easing, set per slide in the settings panel.',
         },
         {
            title: 'Morph',
            body: 'Items pair between slides by lineage (copies of the same item) and by name or wording. Morph by character (default), word or object controls how changed text animates.',
         },
         {
            title: 'Morph tags',
            body: 'In the Build tab, give two items on neighbouring slides the same tag to force them to pair, even if they look different. The Orders box in this deck is tagged “orders”.',
         },
         {
            title: 'Build steps',
            body: 'Give an item a step number and it appears on that click instead of with the slide.',
         },
      ],
      options: [
         { title: 'Laser while presenting', body: 'Press K and drag; everyone watching sees it.' },
         {
            title: 'Follow the presenter',
            body: 'Collaborators can follow your presentation live from their own screens.',
         },
         {
            title: 'Reverse playback',
            body: 'Going back plays the morph in reverse, so stepping back and forth stays smooth.',
         },
      ],
      shortcuts: [
         { keys: 'F5 / Shift F5', action: 'Present from start / this slide' },
         { keys: '→ · Space', action: 'Next step or slide' },
         { keys: '←', action: 'Previous' },
         { keys: 'G', action: 'All slides' },
         { keys: 'N', action: 'Speaker notes' },
         { keys: 'K', action: 'Laser pointer' },
         { keys: 'Esc', action: 'Stop presenting' },
      ],
      tips: [
         'Duplicate a slide before changing it: copies share lineage, so they morph without any tags.',
         'Park an item just off the slide (Ctrl scroll to see the staging area) to have it slide in.',
         'When a morph looks wrong, open Refine before reaching for tags: the map shows exactly why each pair was made.',
      ],
      deepDive: [
         {
            title: 'Focus mode',
            body: 'Shift F dims the rest of the board and locks the view to the deck. It has four screens, all on the live canvas, so you keep editing the real slide:',
            points: [
               'Slides: the slide list on the left and the slide’s settings on the right (Slide, Transition and Animations tabs), with Theme, Design, Layouts & master, slide size, Export PDF and Present in the top bar.',
               'Layouts & master: edit a layout or the master in place; an amber banner says how many slides use it. Done returns to your slides.',
               'Transition: the morph pairing map for one slide (below).',
               'Animations: build steps and per-object animations for the slide, with a Preview slide button.',
               'Esc, or ← Canvas, leaves focus mode.',
            ],
         },
         {
            title: 'How morph pairs objects',
            body: 'For each transition, every object on the slide before is matched with at most one object on the slide after. Paired objects animate between their two poses; anything left over fades out (before) or fades in (after). Pairs are found in this order:',
            points: [
               'Tag: objects carrying the same morph tag always pair, and tagged objects pair only by tag.',
               'Lineage: a copy pairs with what it was copied from, which is why duplicating a slide “just works”. The squares in this deck share lineage across slides 4–7.',
               'Name or text: tables pair by name; text and labels pair by matching wording.',
               'Look-alike: remaining objects of the same kind and similar size and place.',
               'Text that changed morphs by character (default), word or object: set this per transition.',
            ],
         },
         {
            title: 'The pairing map (Refine)',
            body: 'Open a slide’s Transition tab and press Refine, or switch to the Transition screen in focus mode. The two slides sit side by side with numbered outlines and lines joining each pair; the list on the right says why each pair was made (tag, name, text, look-alike, fades in, fades out).',
            points: [
               'Compare N → N+1 at the top steps through the deck’s transitions; ‹ and › move one at a time.',
               'Drag from an object (or a line’s end) to the object on the other slide it should morph into. Hand-made pairs are saved on those objects.',
               'Click an object to see what it does and its options; × on a line removes that pair, so both sides fade.',
               'No transition: the object simply switches at the start of the transition, with no fade and no morph.',
               'Reset to automatic drops your changes for that pair.',
               'Map pairs / Preview switches between the map and a playback of the transition; play it full screen to see it as presented.',
               '↩ / ↪ markers show objects that also morph from the slide before or into the next one.',
            ],
         },
         {
            title: 'Recipe: build a grid step by step',
            points: [
               'Lay out the full grid on one slide.',
               'Duplicate the slide and change one thing: move a square, recolor it, delete one.',
               'Repeat; every copy keeps its lineage, so each square glides to its new place.',
               'If two look-alikes pair the wrong way after heavy edits, fix it in Refine or give both the same tag.',
            ],
         },
      ],
   },
   // ---------------------------------------------------------------- Project
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
