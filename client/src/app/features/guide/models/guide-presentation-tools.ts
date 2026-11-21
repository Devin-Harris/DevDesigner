import type { GuideTool } from './guide-tools';

/** Guide pages for presentations. */
export const PRESENTATION_TOOLS: GuideTool[] = [
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
            body: 'Default, Sidebar, Centered and Banner arrange the same layout kinds differently; Spotlight, Editorial, Split and Frame each bring their own look and theme. Every design has the same layout kinds, so switching keeps every slide.',
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
];
