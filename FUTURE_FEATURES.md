# Future Features

Planned features that are **not yet implemented**. Each entry captures the intent, proposed behavior, and open questions so it can be picked up later. Verify against the current code before starting, since the canvas, sharing, and drawing layers may have changed.

---

## 1. Laser pointer tool

**Status: implemented.** Dock button (last in the dock) or `K` (`L` was already the line tool) activates the `laser` tool, which works in view-only and edit mode. While the pointer is held, a glowing dot leaves a ~1s fading trail always red (not tinted per user). Nothing is persisted (no undo entries, no dirty state). Samples are throttled to ~30Hz and relayed as ephemeral `presence:laser` socket events (`PresenceLaser` in shared, `LaserService` + `app-laser-layer` on the client), same path as cursors, so view-only guests can broadcast too.

Decisions: a transparent capture surface is mounted only while the tool is active so it never grabs tables/shapes/connectors; middle-button and space-drag still pan and the wheel still zooms mid-laser.

Still open: restricting guest lasers to editors if that is ever wanted, and configurable trail length.

---

## 2. Better project preview in the Projects dialog

**Status: implemented.** `ProjectThumbnailService` (client, `projects-overlay/`) loads each project's graph and renders it with the export SVG builder (`buildDiagramSvg`), shown via `<img>` from an object URL. Client-side on demand, 3 concurrent builds, cached in memory and rebuilt (stale-while-revalidate) each time the dialog opens, theme-aware, with skeleton/empty/error placeholders. Double-clicking a project name renames it (single click on the name waits 250 ms so it doesn't open the project first).

**Goal:** The project preview/thumbnail in the Projects dialog currently looks weak. Make it an accurate, attractive snapshot.

**Proposed behavior**
- Render the real project content: tables, relationships, sequence diagrams, shapes, arrows, and text, fit to the preview frame with consistent padding.
- Use the same renderer as the canvas, or a shared lightweight static renderer, so the preview matches what the user sees.
- Theme-aware (light/dark) with proper background, rounded corners, and a subtle border.
- Empty projects get a tidy placeholder instead of a blank box.
- Generate thumbnails efficiently: cache and regenerate on save, or lazily on dialog open, and avoid blocking the UI for large projects.

**Open questions**
- Client-side render on demand vs. server-generated and stored thumbnail (stored is faster to list, but needs invalidation).
- Aspect ratio and size for the list vs. grid layouts.

---

## 3. Images and SVGs on the canvas

**Status: implemented.** `image` canvas elements (PNG/JPG/GIF/WebP/SVG) can be added from the dock, dropped onto the canvas, or pasted. Files are stored server-side in `project_images` (max 5 MB), referenced by `fileId`, fetched with the caller's auth/share token, and embedded in project export files and image/PDF exports. SVGs containing active content are rejected on upload and are only ever rendered through `<image>`.

Still open: cropping and opacity-style enhancements, cross-project paste of an image element (the in-app clipboard keeps the source project's `fileId`), and thumbnails in the Projects dialog (section 2).

---

## 4. Formatted, syntax-highlighted code blocks on the canvas

**Status: implemented.** A `code` canvas element (dock button or `C`) stores raw code in `text` and the language in `language` (TypeScript, SQL, JSON, Python, C#, Java, HTML, CSS, Bash, plain text). Drag or click to place; it opens straight into the editor. Tab/Shift+Tab indent and outdent, Enter keeps the indent (and adds a level after an opening bracket), Esc or click-away exits. Highlighting is a small built-in regex tokenizer (`code-highlight.helper.ts`), re-run live while typing, with light/dark palettes chosen from the card's background. It renders as SVG, so it zooms crisply and exports to SVG/PNG/PDF. Copying a lone code block also puts its plain text on the system clipboard.

Decisions: highlighting only (not a full embedded editor); explicit language selection (new blocks inherit the most recent block's language); the card auto-grows while typing but never shrinks under a manual resize (overflow is clipped).

Added after: **Format** (Prettier, lazy-loaded; TS/JS/JSON/HTML/CSS; Shift+Alt+F in the editor), **format to card width** (Format re-flows to the card's current width, making it taller rather than wider), and **`...` elisions** (a line of just `...` renders as an unnumbered `···` gap; inline `foo(...)` is muted; formatting preserves both).

Still open: bracket matching, an option to hide line numbers (always shown for now), and richer language grammars (the tokenizer is not a parser, so nested template strings and embedded languages in HTML are approximate).

---

## 5. Shift while Alt-duplicating snaps to an axis

**Goal:** When duplicating a shape, arrow, or diagram by holding **Alt** and dragging, also holding **Shift** constrains the duplicate to the same horizontal or vertical axis as the original.

**Proposed behavior**
- During an Alt-drag duplicate, if Shift is held, lock movement to the dominant axis: horizontal if |dx| > |dy|, otherwise vertical. The other coordinate stays equal to the original's.
- The lock follows modifier state live. Pressing or releasing Shift mid-drag toggles it, and releasing returns to free movement from the current pointer position.
- Applies to all duplicable element types: tables, sequence diagrams, shapes, text, pen strokes, arrows, and multi-selection (the group moves together, constrained relative to the original group position).
- For arrows with bound ends, constraining applies to the whole arrow's translation. Binding should be preserved or re-evaluated the same way as a normal Alt-duplicate.
- Show the same visual feedback as other drags, optionally with a faint guide line along the locked axis.

**Notes**
- Check how Shift is already used in drag handling (e.g. add-to-selection, proportional resize) to avoid conflicts. Only apply this when Alt-duplicate is active.
- Should be a single undo step, same as a normal Alt-duplicate.

---

## 6. MCP server for AI-assisted diagram creation

**Status: implemented (stdio, core).** `mcp/` workspace (`@devdesigner/mcp`, `npm run build:mcp`): per-user API tokens (`api_tokens` table, SHA-256 hashed, `dd_` prefix, read or read/write scope, per-token rate limit, revoke) created in **Account → API tokens** and sent as `Authorization: Bearer`; the MCP server calls only the REST API. 27 tools (projects, tables/columns/relationships, sequence diagrams, shapes/text/bound arrows, `apply_diagram_spec`, import/export, `auto_layout`, `validate_project`, `generate_sql`), resources (projects, project JSON, DDL) and prompts (`design_database`, `document_schema`). Bulk creation builds an export file (`buildSpecFile` + `layoutGraph` in shared) and goes through `import-content`, so it is one transaction with realtime broadcast. `validateSchema` in shared is now implemented. Later additions: image/SVG tools (`add_image`, slide image items), a shared named palette (`shared/src/palette`: `list_colors`, names accepted everywhere a color is, tables of one relationship group share a header color by default, header text turns dark on pale colors), participant/message/diagram colors and morph tags, `update_participant` / `update_sequence_diagram`. Not done: HTTP/SSE transport, per-project tokens, reviewing/flagging AI changes, single-step undo for bulk applies, natural-language rename tool.

**Goal:** Expose the app as a Model Context Protocol (MCP) server so Claude (or any MCP client) can create and edit diagrams automatically, such as "design a schema for a blog with users, posts, and comments" or "add a sequence diagram of the login flow to this project".

**Proposed behavior**
- A standalone MCP server (stdio for local use such as Claude Desktop/Claude Code, optionally HTTP/SSE for remote) that talks to the existing backend API. It does not touch the database directly, so existing validation, permissions, and realtime broadcast all apply.
- Authentication via a per-user API token (created in account settings, revocable) passed to the MCP server through config or env. Every call acts as that user, and project access is checked server-side exactly as for the UI.
- Changes made through MCP appear live for anyone with the project open, through the existing realtime layer.

**Proposed tools** (names indicative)
- Projects: `list_projects`, `get_project`, `create_project`, `get_project_summary` (compact overview so the model doesn't need the full JSON).
- Schema diagram: `add_table`, `update_table`, `delete_table`, `add_column`, `update_column`, `delete_column`, `add_relationship`, `delete_relationship`.
- Sequence diagrams: `create_sequence_diagram`, `add_participant`, `add_message`, `update_message`, `reorder_messages`.
- Drawing layer: `add_shape`, `add_text`, `add_arrow` (with optional bound element ids), `move_element`, `delete_element`.
- Bulk and structured: `apply_diagram_spec` takes a whole diagram described declaratively (tables, columns, relationships, or participants and messages) and creates it in one atomic call, with auto-layout.
- Import and export: `import_project_json` / `export_project_json`, reusing the existing project export format.
- Helpers: `auto_layout` (arrange elements without overlap), `validate_project` (report dangling relationships and duplicate names).

**Design notes**
- **Auto-layout is essential.** The model can't reasonably pick pixel coordinates, so the server should place new elements itself (grid or layered layout, avoiding existing elements) and accept optional hints like "near table X".
- **Reference by name or stable id.** Let tools address tables and columns by name within a project, returning ids in results so follow-up calls are cheap and unambiguous.
- **Atomic and undo-friendly.** Bulk operations apply in one transaction and, where possible, as a single undoable step for users watching live.
- **Reuse existing entity validation and the export parser/writer** so MCP and UI never diverge. Keep both in sync when new entity types are added (see the project-export-import memory note).
- **Return compact, model-friendly output**: summaries, not full element dumps, plus a clear error message on failure.
- **Safety:** destructive tools (`delete_*`, bulk replace) should be clearly named and may require an explicit `confirm` argument. Rate-limit per token.
- Also consider MCP **resources** (read-only project JSON, schema-as-DDL) and **prompts** (e.g. "design a database for ...", "document this schema").

**Possible follow-ups**
- Generate SQL DDL or ORM models from a diagram, and reverse-engineer a diagram from SQL DDL or a live database connection.
- Natural-language edits ("rename all `user_id` columns to `account_id`") built on the same tools.
- Shipping the server as an npm package, with copy-paste config snippets for Claude Desktop/Claude Code in the app's settings.

**Open questions**
- Local stdio only at first, or hosted HTTP from day one.
- Token scope: all projects vs. per-project tokens, and read-only vs. read/write.
- Whether AI-made changes should be visually flagged or reviewable before they are accepted.

---

## 7. Slides / presentation mode (frames with transitions)

**Status: implemented (core).** Slides dock button (or `F5` to present, `Shift+F5` from the current slide) opens the slide sorter. A slide is a `frame` element with a `slide` config (`order`, `hidden`, `notes`, `transition`), stored as `slideJson` on `elements`; the sequence is the frames that have one, sorted by `order` (`slideSequence` in shared). Reorder by dragging, skip/duplicate/remove/delete per slide, per-slide transition (none, fade, slide + direction, zoom, morph; duration, easing), speaker notes, "apply to all", and a transition preview. Present mode (`app-present-mode`) is full screen, keyboard/click navigation, notes (`N`), timer, and works for view-only guests locally. Slides render through the export SVG builder cropped to the frame, so they match PNG/PDF export. Morph: elements/tables are matched by lineage (`morphId`, copied on duplicate), then identical text, similar text, then same-type nearby shapes (`matchMorphItems`), and glide in position/size/rotation while cross-fading appearance. Everything is ordinary element data, so realtime, undo/redo and export/import (ids remapped) already apply.

Decisions: one sequence per project; membership is by geometric overlap with the frame; morph is automatic plus a "treat as same object" pairing action; default transition is none, with "Apply to all".

Also shipped: **text morph** (matched text elements animate glyph by glyph: shared characters slide, new ones fade in, removed ones fade out; falls back to a cross-fade above ~360 characters), **build steps** (`step` on any element; the Slides panel's Build section reveals selected items on step 1..8, each advance while presenting reveals the next step), **laser while presenting** (`K` or the bar button, shows collaborators' lasers too and relays ours), **follow the presenter** (presenting state rides on the realtime roster entry; others get a "Follow" banner and mirror slide + step), and **PDF/PNG export of the sequence** from the Slides panel (presentation order, skipped slides left out).

Still open: tables and sequence diagrams have no build steps (elements only), multiple named presentations, .pptx export.

**Original goal:** Build PowerPoint-like presentations inside the canvas. Slides are frames placed on the canvas that are linked into an ordered sequence, with transitions between them, including a morph transition that animates changes between slides.

**Proposed behavior**

*Frames and sequence*
- A "Frame" element (own toolbar tool) with a fixed aspect ratio (default 16:9, with other presets like 4:3 and custom) and optional title/background. Anything on the canvas that overlaps a frame belongs to that slide: tables, sequence diagrams, shapes, text, images, code blocks.
- Frames are connected into an ordered sequence. Connections are shown visually as arrows or numbered badges between frames, and are separate from normal arrows.
- Reorder by dragging in a slide-sorter side panel (thumbnails list) or by editing the connection on the canvas. Support add, duplicate, delete, and skip/hide slide.
- Frames can exist on the canvas without being in the sequence (a sequence is an explicit ordered list of frame ids).
- Moving a frame moves its contained elements with it.

*Presenting*
- Present mode goes full screen, fitting the current frame to the viewport, and hides editing UI.
- Next/previous via arrow keys, space, click, and on-screen controls. Esc exits.
- Presenter extras (later): slide counter, speaker notes, timer, and compatibility with the laser tool (section 1).
- Can present from the current slide or from the beginning. Shared/view-only users can present locally, and a "follow the presenter" mode could build on the realtime layer.

*Transitions*
- Per-slide-pair transition setting (the transition into slide N), with duration and easing.
- Types: none, fade, slide (left/right/up/down), zoom, and **morph**.
- Optional default transition applied to all slides.

*Morph transition*
- Matches elements between consecutive slides and animates differences: position, size, rotation, color, opacity, and text changes. Unmatched elements fade in or out.
- **Matching rules:**
  1. Elements explicitly linked by a shared "morph id" (a user can pair them manually).
  2. Duplicated elements keep a lineage id, so copying a slide and editing it morphs naturally. This is the primary mechanism.
  3. Fallback heuristics: same type and the same or similar text content, nearest position.
- **Text morph:** animate text changes smoothly. Preferred approach is a per-character or per-word diff, with unchanged characters sliding to their new positions and added or removed characters fading, instead of a plain crossfade. Also interpolate font size and color.
- Arrows bound to morphing elements follow them during the animation.
- A "morph" preview in the editor so users can check it without entering present mode.

**Implementation notes**
- Data model: `frames` (id, position, size, background, name) and an ordered `slideSequence` of frame ids with a per-slide `transition` config (type, duration, easing, options). Include notes per slide.
- Animation: interpolate between layout snapshots of the two frames' elements, rendered with the canvas renderer or requestAnimationFrame. For text, measure glyph positions to compute diffs and offsets. Do not animate by mutating the real project data.
- Rendering a slide means rendering only the elements within the frame's bounds, clipped, and offset so the frame fills the viewport.
- Reuse the thumbnail/static renderer from the improved project preview (section 2) for the slide-sorter thumbnails.
- Persisted and shared like other project content: realtime sync, undo/redo for frame and sequence changes, and included in project export/import (keep parser and writer in sync, and remap frame ids and lineage ids on import).
- Export to PDF and PNG per slide as a likely follow-up (and possibly .pptx).

**Open questions**
- Is membership by geometric overlap or explicit parenting (explicit is more robust when elements overlap multiple frames).
- Single sequence per project or multiple named presentations per project.
- How far to go with morph matching: automatic only, or a manual pairing UI too.
- Animation of non-text changes (e.g. table column changes, sequence message edits) and what a "morph" means for them.
- Click-to-reveal / step animations within a slide (build steps), or keep to slide-level only at first.

---

## 8. Ghost clones (read-only live mirrors)

**Goal:** A "ghost clone" is like a normal clone, but it is a read-only mirror of its source. Create one shape, table, or diagram, ghost clone it as many times as needed, and any edit to the source propagates to every ghost clone.

**Proposed behavior**

*Creating*
- Context-menu action and shortcut "Ghost clone" on any selected element (tables, sequence diagrams, shapes, text, arrows, images, code blocks, and multi-selection or groups).
- Could also be offered as a modifier on the existing duplicate gesture (e.g. Alt+Ctrl-drag), separate from Alt-drag duplicate and section 5.
- The ghost is placed offset from the source (or where dropped) and is selected after creation.

*Appearance and read-only behavior*
- Rendered with a grayed overlay (reduced saturation/opacity plus a subtle tint) so it is obviously not the real object.
- Shows a small badge or label naming its source (e.g. "Ghost of: users"), with the source's name or type as fallback.
- Clicking the badge selects and pans to the source.
- Content is not editable: no text editing, no column/row edits, no resize of internals, no restyling.
- **Still allowed per instance:** move, delete, z-order, and optionally scale and rotate. These are instance-level transforms, not content. Decide the exact list (see open questions).
- Arrows can bind to ghosts like to any other element, but connections made to a ghost are the ghost's own and don't affect the source.

*Propagation*
- Edits to the source (text, columns, style, size, messages, anything content-related) update all ghosts immediately, including in realtime for collaborators.
- Ghosts render from the source's current data, they don't store a copy. This means no drift and no stale state.

*Deleting a source*
- If the source has ghost clones, deleting it highlights all of its ghosts on the canvas and shows a confirmation toast: e.g. "Deleting this will also delete 3 ghost clones. Delete all?" with **Delete all** and **Cancel**.
- Confirming deletes the source and all ghosts as one undoable step. Cancel leaves everything untouched and clears the highlights.
- Optional extra action in the toast: **Convert ghosts to normal copies**, which keeps the content as independent elements instead of deleting.
- Deleting a ghost on its own never affects the source or other ghosts.

*Other actions*
- "Detach / Make real copy" turns a ghost into a normal independent element with the source's current content.
- "Go to source" (context menu and badge click).
- Ghost of a ghost isn't allowed: ghosting a ghost creates another ghost of the original source.

**Implementation notes**
- Data model: a ghost element stores only `sourceId` plus instance-level transform (x, y, optional scale/rotation, z-order). Content comes from the source at render time. Resolve `sourceId` through the element store so propagation is automatic and cheap.
- The source needs to be able to find its ghosts (index or derived map) for the delete flow and for the "has N ghosts" indicator.
- Delete flow must be handled server-authoritatively for realtime consistency: a source deletion cascades to its ghosts in one operation, and collaborators see the same result.
- Undo/redo: ghost creation, ghost deletion, cascade deletion, and detach are each single steps. Source edits that propagate need no extra undo entries.
- Grouped/compound sources: ghosting a multi-selection makes one ghost container referencing a group, or one ghost per element linked together. Prefer the group approach so source layout is mirrored.
- Rendering: wrap the normal element renderer in a read-only mode, then apply the gray overlay and badge, and disable hit-testing for the internals while keeping the outer bounds selectable.
- Included in project export/import (remap `sourceId`), in the minimap/preview renderer, and in slides. Ghosts of a source in another slide or frame (section 7) are a natural use case.
- Cross-project ghosts are out of scope for now.

**Open questions**
- Which instance-level transforms should be allowed: move only, or also scale/rotate/restyle.
- Whether a ghost of a table should show all columns even when the source is later resized.
- When the source is a sequence diagram or table connected to relationships, whether relationship arrows are mirrored on the ghost or not (probably not, only the element itself).
- Whether view-only users see ghosts and badges the same way (they should).
- Visual treatment of the highlight when a delete is pending, and what happens if some ghosts are off-screen (pan/zoom to fit all, or a minimap highlight).

---

## 9. Slide layouts and templates (masters, placeholders)

**Status: phases 1-3 implemented.** Layouts, repeated items, placeholders, switching layouts by role and MCP support are in. Masters and theme tokens (phase 4) are open.

**Goal:** PowerPoint-style templating for presentations: repeated UI (logo, footer bar, accent shapes, page furniture) defined once and shown under many slides, and empty text boxes ("Click to add title") that new slides start with, for different slide kinds (title, section, body, emphasis, ...).

**Model**
- A **layout** is a slide frame with `slide.layout = true` (plus `slide.layoutName`), stacked in its presentation's spot like any slide but never in the sequence (`presentationSlides` / `presentableSlides` skip it; `presentationLayouts` lists them). Its items are owned by it (`slideId`), so it is authored with the normal canvas tools.
- A slide points at one with `slide.layoutId` (`layoutOf` resolves it within the same presentation). Everything lives in `slideJson`, so no migration.
- **Decorations are rendered by reference**, never copied: editing the layout updates every slide using it. `contentForFrame(..., layoutId)` adds the layout's elements pushed below the slide's own (`LAYOUT_Z_OFFSET`), so thumbnails, present mode and PDF/PNG export include them. On the canvas, the store keeps a shown slide's layout items visible (`hiddenBySlides` / `layoutItemIds`) and the editor draws them beneath, `locked` (click-through, excluded from marquee).
- **Placeholders (phase 2)** are copied: a layout element carries `placeholder: { role, prompt }`; "New slide from layout" copies each into the slide with `placeholderOf: <layout element id>`. Empty copies show the prompt ghosted in the editor and are skipped when presenting/exporting. "Reset to layout" restores geometry and style, keeping the text.

**UI**
- Settings panel, **Layout** tab (next to Transition/Size/Theme/Notes; the panel is 400 wide so the tabs fit on one row): the slide's layout picker (all selected slides), the presentation's layouts as thumbnails ("+ Layout" adds one and shows it, click to edit, delete). While a layout is shown: layout name, "Back to slides", "New slide" (uses it), and for selected text boxes on it a "is a placeholder" checkbox and an optional **style type** (title, subtitle, body, emphasis, caption, other; for theming and for pairing when switching layouts). Any change re-syncs every slide using the layout (`syncLayoutCopies`): new placeholders get empty copies on existing slides, un-marked ones lose theirs. "Reset to layout" shows only when the slide drifted from its layout (`placeholderDrift`: a placeholder moved or restyled, or one deleted; typed text does not count). It resets the selected drifted placeholders, or the whole slide, which also brings deleted placeholders back. Showing a layout opens the tab.
- "New" while a layout is shown creates a slide using it; otherwise the new slide inherits the shown slide's layout. New slides get empty copies of the layout's placeholders (`fillFromLayout` in `slides/layout-placeholders.ts`).
- New slide is a split button in the slide list: plain "New" uses the shown layout (or the shown slide's), the caret picks "Blank slide" or any layout.
- Empty copies are drawn as their layout slot (its size, style and text as the faded prompt) at the copy's own spot; typing into one first stores the slot's current size/style. They are are kept (not deleted) when emptied, and never appear in thumbnails/present/export. Layout placeholders themselves are not repeated under slides.
- Changing a slide's layout runs `switchLayout`: copies pair with the new slots by style type (untyped with untyped) in reading order (`matchPlaceholders` in shared), take the slot's position/size/text style and keep their text; a copy goes back to the slot it was made from first (so switching away and back never duplicates), unpaired filled copies keep their link, empty ones go; unfilled slots get empty copies.
- A slide with no background of its own shows its layout's (canvas via `layoutFills`, pictures via `contentForFrame`).
- Layouts can be duplicated (copy button on the layout card; the copy is named with `nextCopyName`, placeholders included).
- While a layout is shown, its frame gets a dashed accent ring and an "Editing layout · <name>" badge below it (`slideSets().layoutEdit` in the editor), so it is not mistaken for a slide.
- While a layout is open, the slide list keeps the slide you came from highlighted (`lastSlides` in the editor); "New slide" inserts after it and "Back to slides" returns to it.
- Copies follow their slot: moving or restyling a layout placeholder carries along every copy still matching the slot's previous place and look (`slotFollower`, an editor effect; writes are unrecorded so undoing the layout edit replays it). Copies changed on their slide stay put.
- Copies of one layout slot morph into each other (`placeholder:<slot id>` morph key).
- Renaming/deleting/moving a presentation and "size of every slide" include its layouts.
- Storage: `placeholderJson` column on elements (`{ role, prompt?, of? }`, migration `1793000000000-AddElementPlaceholder`); import parser + writer remap `of` and `slide.layoutId`.
- MCP: `list_layouts`; `add_slides` slides take `layout` (name or id) and `fill` ({ role: text | text[] }).

**Phases**
1. Layouts + repeated decorations by reference (done).
2. Placeholders: copies, ghost prompts, hidden when empty, "Reset to layout" (done).
3. Switching layouts by role; MCP `list_layouts` + `add_slides({ layout, fill })` (done). Still open: MCP tools to create layouts / mark placeholders / switch an existing slide's layout, and folding `apply_slide_layout` regions into layouts.
4. Master level (layouts inherit a master's decorations) and theme tokens (named colors/fonts restyling a whole deck).

**Notes / open questions**
- Morph: decorations are the same rows on both slides; check they stay still (no fade) under morph, and give placeholder copies an implicit `placeholder:<role>` lineage so titles morph into titles.
- Animations: layout items should not be animation targets (the Animations tab does not list them, since it does not pass `layoutId`).
- Placeholder copies are fit-to-glyph text, so typing resizes the box to the text rather than keeping the slot's box.
- Alt-drag copying a whole presentation does not copy its layouts yet.
- Layouts are per presentation for now; "copy layouts from another presentation" can come later.
- A layout must sit in its presentation's spot (it is created there); items are not offset if a layout frame were moved elsewhere.

## 10. Presentation themes, standard layouts, auto-fill fields and a theme library

**Status: phases 1-5 implemented** (theme tokens, custom themes, required defaults, standard layout kinds, fields and master, theme switching by layout kind, save-as-theme, theme files, My themes). Phase 6 (sharing layouts between decks, marketplace) is open.

**Goal:** restyle and re-layout a whole deck by switching themes instead of redesigning it. A theme is a set of named colors and fonts plus a set of layouts with fixed names (title, two-column, ...). Content refers to roles and tokens, not exact positions and hex values, so a deck built under one theme can move to another that follows the same structure.

**Model**
- **Tokens.** A color field holds a literal (`#2f6bff`) or a token (`$accent1`). A font field holds a family key (`inter`) or a token (`$heading`). Color tokens: `background, surface, heading, text, muted, accent1-4`. Font tokens: `heading, body`. This needs no schema change because the fields are already strings.
- **Theme** (`SlideTheme` in `shared/src/slides/themes.ts`): `{ id?, name, colors, fonts }`. Stored as `slide.theme` on every frame of the presentation (slides and layouts) so it goes through sync, undo and export/import like any slide setting. `presentationThemes` reads it; the first frame that has one wins. A presentation with no theme uses `DEFAULT_THEME`.
- **Resolution** happens at render time, in one place: `resolveThemedElements` / `resolveThemeElement` swap tokens for values per item's presentation (via its `slideId`, or the frame itself). The stored rows keep the tokens.
- **Layout kinds (phase 2):** a fixed list owned by the app: `title, section, content-1col, content-2col, content-3col, emphasis, quote, image-left, image-right, comparison, blank`. A layout frame gets `slide.layoutKind`. Each theme provides its own version of each kind.
- **Fields (phase 3):** placeholder-like text whose value is computed when drawn: `slideNumber, slideCount, date, presentationTitle, sectionTitle, footer`. They are stored as text with `field: { kind, format }` (`"{n} / {total}"`, date formats or a fixed date). They usually live on a master or layout, so they are defined once and never copied into slides.
- **Master (phase 3):** one per theme, holding what every layout shares (background, footer bar, logo, page number). It is rendered by reference beneath layouts, one z band below `LAYOUT_Z_OFFSET`.

**Phase 1: theme tokens (done)**
- Shared: `themes.ts` (tokens, `BUILT_IN_THEMES`: Default, Midnight, Paper, Ocean, Bold; resolvers) and `SlideConfig.theme`.
- Rendering: the canvas (`shapeViews`), the slide renderer (thumbnails, present mode, morph), image/PDF exports (`exportScope`) and the in-place text editor all draw resolved values. Rich-text runs keep the token in `data-color` and paint the resolved color.
- Text measuring: `fitTextElement` resolves `$heading` / `$body` through a resolver the project store registers (`setThemeFontResolver`), so fit-to-glyph boxes measure in the real face.
- UI: the color picker (`dd-color-swatches`, `deckTheme` input) shows a row of theme swatches above the palette for items on a slide or layout (not for grid cells, whose styles live in the grid JSON). The font menu gets "Heading (theme)" / "Body (theme)". The settings panel has a **Theme** tab with built-in theme cards, per-token color wells and heading/body font selects. Editing a token turns the theme into the deck's own ("<name> (custom)").
- Applying a theme writes it to every frame of the presentation in one undo step, and refits text boxes that use a theme font.
- Server: `SlideThemeDto` on the slide DTO (the whitelist would otherwise drop it). The import parser validates `slide.theme`; the writer already copies it through `...e.slide`.
- MCP: not yet. Colors still go in as palette names or hex.

**Phase 1b: custom themes and required defaults (done)**
- Custom themes: a per-project library (`projects.themesJson`, migration `1793400000000-AddProjectThemes`, `PUT /projects/:id/themes`, realtime `themes.updated`, included in export/import and duplicate). Custom theme ids are `custom-<uuid>`. The Theme tab lists Presets and Custom themes. "New theme" copies the current theme. Editing a color or font while a deck uses a preset copies it into a new custom theme. Editing a custom theme updates it in the library and in every presentation using it. Custom themes can be renamed and deleted; slides keep the deleted theme's look.
- Every presentation has a theme and a default layout (`slide.defaultLayout`, shown as "Blank", filled with `$background`, hidden from the Layout tab's list since it is not edited; it remains a choice in the layout picker and the New menu), and every slide uses a layout. `slides/deck-defaults.ts` (`ensureDeckDefaults`, an editor effect) fills in whatever is missing, without undo steps. The default layout cannot be deleted, a copy of it is an ordinary layout, and the "No layout" and "Blank slide" choices are gone.
- New layouts are filled with `$background` too, so they follow the theme.
- The Default preset follows the app: background `transparent` (no slide fill), surface `surface` and heading/text `theme` (the light/dark sentinels), so un-themed decks look as before. A theme color can be none or a follow-the-app sentinel. A deck on a preset always reads the current preset definition by `id` (`presentationThemes`), so changes to presets reach existing decks.
- The theme color editor uses the standard swatch squares and picker. Font menus group the theme fonts ("Heading", "Body") above the other fonts.

**Phase 2: standard layout kinds plus a starter set (done)**
- `slide.layoutKind` on layout frames. The kinds are `LAYOUT_KINDS` in `shared/src/slides/layout-kinds.ts`: blank, title, section, content, two-column, three-column, comparison, statement and quote. The slide DTO and import parser accept it. The built-in Blank layout is `blank`.
- `STANDARD_LAYOUT_SPECS` builds each kind from theme tokens and the existing placeholder roles. Geometry is in fractions of the slide and font sizes are relative to a 720 px tall slide. Columns repeat `body`, comparison headings use `subtitle`, statements use `emphasis`, and quotes use `emphasis` plus `caption`, so `matchPlaceholders` pairs them in reading order. No new roles were needed.
- The Layout tab has a **Standard** menu ("All standard layouts" or a single kind; `addStandardLayouts` in `slides/standard-layouts.ts`, one undo step, opens the first new layout) and a **Kind** picker on a shown layout. The New-slide menu lists layouts in kind order.
- A new presentation (one with no layouts at all) gets the whole standard set automatically, along with its Blank layout (`ensureDeckDefaults` calls `addStandardLayouts(..., silent)`, with no undo steps). Existing decks that already have layouts are left alone.
- Still open: image placeholders (image-left/right kinds need a media placeholder type), and MCP `add_slides` by kind.

**Phase 3: fields and master (done)**
- Fields are tokens in ordinary text: `{{slide}}`, `{{total}}`, `{{date}}`, `{{title}}` (`shared/src/slides/fields.ts`). They need no schema and survive export/import. They are filled in when slides are drawn: on the canvas (`shownFields` in the editor, numbering as the shown slide), in thumbnails, present mode and exports (`SlideRenderService.fieldsFor`). Numbers count the presentation's shown (not hidden) slides. Layouts and the master show the raw tokens, and so does a text box while it is being typed into.
- Insert field: a `{}` button in the floating toolbar for text on a slide, layout or master ("Slide n of N", slide number, slide count, date, presentation title). While the text is being typed into, it inserts the token at the caret (`RichTextSessionService.insert`); otherwise it appends it.
- Master: a layout frame with `slide.master`, one per presentation, created (empty) by `ensureDeckDefaults`. `presentationLayouts` leaves it out, `presentationMaster` / `masterOf` find it, and `layoutNameOf` names it "Master". Its items draw under every slide and every layout of the deck, one band below layout items (`layoutElements(..., depth 2)`, store `masterItemIds`). The Layout tab shows a Master card first; while it is shown, the badge reads "Editing master (shown on every slide)", and there is no name, kind or New slide. A copy of the master is an ordinary layout.
- Still open: "hide on the title slide" and "start numbering at" options; date formats; fit-to-glyph boxes are sized to the token text, so right-aligned footers should use a fixed-width box.

**Phase 4: theme switching by layout kind (done)**
- A theme can carry its own design per layout kind (`SlideTheme.layouts`, with items as in the standard specs; `themeLayoutItems` falls back to the standard design). Bold (big left-aligned title, section and statement) and Paper (title and content framed by thin rules) have their own. New standard layouts are built in the deck theme's design.
- Switching a deck's theme runs `relayoutForTheme` in the same undo step. Each standard layout whose design differs between the two themes, and that is still exactly as the old design built it, is rebuilt in the new design (same place in the list, same name). Its slides move to it with `switchLayout` (placeholder copies re-pair by role and keep their text), and the old layout is deleted. Layouts someone edited are kept, and the Theme tab says how many.
- Undoing a deleted element now re-creates it under the same id, so the layout, items and placeholder links survive undo. Before this, every element delete-undo gave the element a new id.
- Theme layouts pass through the slide DTO (`@IsObject`) and the import parser as given.
- Still open: theme bundles with their own master, and the overflow check after a switch.

**Phase 5: save-as-theme and sharing across projects (done)**
- **Save deck as theme** (Theme tab): makes a custom theme from the deck's colors and fonts plus the design of each standard layout (one per kind) and the master. These are captured as `element` design items (`captureLayoutItems`): any element type, geometry in fractions of the slide, font sizes and point offsets as at a 720 px tall slide. Uploaded images are left out because they belong to the project. Applying the theme to another deck rebuilds its untouched standard layouts and its master in that design (`relayoutForTheme`, which also handles `SlideTheme.master`).
- Slide frames carry only the theme's tokens and fonts (`themeTokensOnly`). The layout designs live in the project's theme library and are looked up by theme id (the panel's `deckTheme`).
- **Theme files:** Export downloads `<name>.dbtheme.json` (`themeFile`, format `devdesigner-theme` v1). Import reads one (`parseThemeFile` explains what is wrong with a bad file), adds it to the project's custom themes under a new id and applies it to the deck.
- **My themes:** a personal library across projects. Server table `user_themes` (migration `1793500000000-AddUserThemes`) behind `GET/POST/DELETE /me/themes`, owned by the account or by a guest browser's `guest:<id>`, at most 100 themes; saving a theme with the same id replaces the copy. The client uses `UserThemesService`, loaded when the Theme tab opens. "Save current" keeps the deck's theme there (a preset is saved as a copy with its own id). Clicking a saved theme copies it into the project and applies it; × removes it from the library.
- **One Design tab (replaces the Layout and Theme tabs).** It shows, in order: the open layout's or master's controls, or the slide's layout picker and reset buttons; **Theme** (preset cards, then **My themes**, with icon buttons for Save as theme, Export and Import); a collapsed **Customize <theme>** section (name, colors, fonts, Delete); then **Layouts** (Standard, + Layout and the list). Explanations sit behind (i) icons with tooltips instead of hint paragraphs.
- My themes is the personal library plus the project's custom themes, by theme id. Every custom theme is also saved to the personal library: one forked from a preset by a color or font change, edited, made with Save as theme, or imported. That makes it available in all of the owner's projects. × and Delete theme remove it from both places; slides keep its look.
- Save as theme and Export both capture the deck: colors, fonts, each standard layout's design and the master (`captureDeck`).
- Still open: MCP tools (`list_themes`, `apply_theme`, `set_theme_tokens`, `add_slides` by kind, `$token` color arguments); images inside saved layouts; merging custom themes when a project file is imported into an existing project.

**Phase 6: sharing layouts and themes, up to a marketplace (future)**
- **Between presentations in a project:** "Copy layouts from…" in the Layout tab. Pick another presentation, then choose its layouts (or all of them). Copies get new ids, keep `layoutKind` and placeholders, and are re-stacked on this deck. A copied layout whose kind is already here can replace the existing one: slides re-pair through `switchLayout`.
- **Between projects (a "theme pack"):** a portable bundle holding a theme (tokens and fonts), its layouts (frames, items and placeholders, as geometry relative to the slide) and, later, its master. Built on the project export format: export a pack from the Theme tab and import it into any presentation, where it is added to the project's custom themes and its layouts are created. Ids are remapped like project import.
- **Personal library:** save packs to the user's account (a new user-level table), so they appear in every project's Theme tab under "My themes" next to the presets and the project's custom themes.
- **Marketplace (ultimate goal):** a public gallery of layout+theme packs that anyone can browse, preview (rendered title, content and quote slides), and apply to a deck in one click. Publishing a pack from the personal library would need moderation, versioning (a deck keeps the version it applied, with an "update available" prompt that re-applies by layout kind), attribution and licensing. The built-in presets would become first-party packs in the same gallery.
- Depends on phase 4 (switching themes by layout kind), so an applied pack re-flows existing slides instead of only adding layouts.

**Notes / open questions**
- Literal colors on existing content stay literal when the theme changes. Offer "convert matching colors to theme tokens" (exact hex matches to the old theme's tokens) when switching.
- Tables, sequence diagrams and grid cells do not resolve tokens yet (their color fields live in other rows or in JSON).
- `contrastSafe` compares against the app canvas, not the slide background. Themed dark decks may need the guard to use the slide's resolved background.
- Slide size per theme (16:9 vs 4:3) needs a scale step when switching.
- New slides get `slide.theme` from `ensureDeckDefaults`. Renaming or merging presentations with different themes keeps whichever frame comes first.
- Two editors opening a deck that has no default layout at the same moment could both create one (the first one found is used).
- Importing a file into an existing project does not merge its custom themes yet.

---

## Cross-cutting checklist (apply to each feature when implemented)

- Undo/redo integration (where the feature creates or changes persistent elements).
- Realtime collaboration and sharing, including view-only link permissions.
- Project export/import format (keep parser and writer in sync, and remap ids).
- Light/dark theme and the custom design-system components.
- Performance on large projects.
