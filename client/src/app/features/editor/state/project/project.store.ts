import { isMasterDeletion, overriddenId } from '../../helpers/frame-contents.helper';
import { computed, inject, untracked } from '@angular/core';
import type {
   CreateRelationshipDto,
   BatchUpdateDto,
   CloneItemsDto,
   ProjectExportFile,
   AccessLevel,
   CanvasElementModel,
   ColumnModel,
   CreateColumnDto,
   CreateElementDto,
   CreateIndexDto,
   IndexModel,
   LifelineModel,
   PointModel,
   RelationshipModel,
   RelationshipType,
   SchemaModel,
   SchemaMutation,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
   UpdateColumnDto,
   UpdateElementDto,
   UpdateIndexDto,
   UpdateLifelineDto,
   UpdateRelationshipDto,
   UpdateSequenceDiagramDto,
   UpdateSequenceMessageDto,
   UpdateTableDto,
   ViewportModel,
} from '@devdesigner/shared';
import {
   nextCopyName,
   presentationNames,
   presentationOf,
   presentationSlides,
   presentationLayouts,
   layoutOf,
   masterOf,
   remapAnimations,
   slideSequence,
   presentationThemes,
   resolveThemedElements,
   resolveThemeFont,
   DEFAULT_THEME,
   type SlideTheme,
} from '@devdesigner/shared';
import { MIN_SLIDE_ZOOM, slideViewRegion } from '../../helpers/slide-zoom.helper';
import { setThemeFontResolver } from '../../helpers/text-metrics';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ColumnsApiService } from '../../../../shared/services/columns-api.service';
import { IndexesApiService } from '../../services/indexes-api.service';
import { ElementsApiService } from '../../services/elements-api.service';
import { ProjectsApiService } from '../../../../shared/services/projects-api.service';
import { RelationshipsApiService } from '../../../../shared/services/relationships-api.service';
import { TablesApiService } from '../../../../shared/services/tables-api.service';
import { SequenceApiService } from '../../services/sequence-api.service';
import { ShareLinksApiService } from '../../services/share-links-api.service';
import { ShareSessionService } from '../../../../core/auth/share-session.service';
import { isSandboxId } from '../../../../core/sandbox/sandbox-backend.service';
import { sameItems, sameMap, sameSet } from '../../../../shared/helpers/equality';
import { readSavedViewport, saveViewport } from './viewport-storage';

/**
 * Editor store: the single source of truth for the loaded project's schema,
 * viewport, selection, access mode, and save status (BUILD_INSTRUCTIONS.md
 * section 8.4). Every edit goes through a method that calls the matching
 * granular endpoint and updates local state optimistically; high-frequency
 * changes (drag, pan/zoom, reorder) are debounced and coalesced per entity.
 */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface EditorState {
   projectId: string | null;
   /**
    * The loaded project's content. Its `viewport`, `home` and `themes` are only what the
    * server sent at load: the live values are the `viewport`, `home` and `customThemes`
    * slots, kept apart so panning or a theme save doesn't invalidate everything derived
    * from the content.
    */
   schema: SchemaModel | null;
   /** This participant's pan/zoom (personal; remembered in this browser per project). */
   viewport: ViewportModel;
   /** The project's shared home view, or null when none is set. */
   home: ViewportModel | null;
   /** The project's custom presentation themes (on top of the built-in ones). */
   customThemes: SlideTheme[];
   accessMode: AccessLevel;
   /** True when the project was opened via a /shared/:token link (anonymous mode). */
   shared: boolean;
   selectedTableIds: string[];
   selectedRelationshipIds: string[];
   selectedElementIds: string[];
   selectedLifelineIds: string[];
   selectedMessageIds: string[];
   /** The sequence diagram whose bounding box is selected (null = none). */
   selectedDiagramIds: string[];
   /**
    * The group the user has double-clicked "into": its members select individually
    * instead of as a unit. Reset whenever the selection moves outside that group.
    */
   enteredGroupId: string | null;
   /** The slide shown on the canvas (a frame id); the first slide when unset or stale. */
   activeSlideKey: string | null;
   /** The presentation chosen in the slides panel (a name); the shown slide's when unset or stale. */
   selectedPresentationKey: string | null;
   /** The slide each presentation shows on its own spot (name -> frame id). */
   shownByPresentationKey: Record<string, string>;
   /**
    * View-only zoom of each presentation's shown slide inside its block (name -> scale,
    * 1 = the frame fills the block). Zoomed out, the frame shrinks about its centre and
    * the staging room around it shows. Never saved.
    */
   slideZoom: Record<string, number>;
   /** Transient: a message whose inline label editor should open (toolbar pencil). */
   pendingMessageEditId: string | null;
   /** Transient: a lifeline whose inline label editor should open (toolbar pencil). */
   pendingLifelineEditId: string | null;
   loading: boolean;
   error: string | null;
   saveStatus: SaveStatus;
   /** Depth of the element undo/redo stacks, for toolbar button enablement. */
   undoDepth: number;
   redoDepth: number;
   /** Style applied to newly drawn elements; updated as the user restyles (session-sticky). */
   elementStyle: ElementStyleState;
}

/** Sticky drawing style carried across new elements in a session. */
interface ElementStyleState {
   strokeColor?: string;
   backgroundColor?: string;
   fillStyle: CanvasElementModel['fillStyle'];
   strokeWidth: number;
   strokeStyle: CanvasElementModel['strokeStyle'];
   opacity: number;
   fontFamily: string;
   fontSize: number;
   cornerRadius?: number;
   startArrowhead?: CanvasElementModel['startArrowhead'];
   endArrowhead?: CanvasElementModel['endArrowhead'];
}

/** A reversible element operation: closures that reuse the granular store methods. */
/** A table's scale and position, for scale-gesture undo. */
export interface TableGeometry {
   scale: number;
   x: number;
   y: number;
}

/** A column as it was before removal, with its slot and relationships (for undo). */
interface ColumnSnapshot {
   tableId: string;
   column: ColumnModel;
   index: number;
   relationships: RelationshipModel[];
}

interface HistoryEntry {
   undo: () => void | Promise<void>;
   redo: () => void | Promise<void>;
}

/** Positions that define one sequence diagram's layout (for move/resize undo). */
export interface SequenceLayoutSnapshot {
   lifelineXs: ReadonlyMap<string, number>;
   messageYs: ReadonlyMap<string, number>;
   originY: number;
   rowSpacing: number;
}

/** What a group is made of. Only groups with two or more members are tracked. */
export interface GroupMembers {
   tableIds: string[];
   elementIds: string[];
   diagramIds: string[];
}

export type GroupItemKind = 'table' | 'element' | 'diagram';

/** Index a schema's groups; a group needs two or more members to count. */
function buildGroups(s: SchemaModel | null): ReadonlyMap<string, GroupMembers> {
   const all = new Map<string, GroupMembers>();
   const add = (gid: string | undefined, key: keyof GroupMembers, id: string): void => {
      if (!gid) return;
      let g = all.get(gid);
      if (!g) {
         g = { tableIds: [], elementIds: [], diagramIds: [] };
         all.set(gid, g);
      }
      g[key].push(id);
   };
   for (const t of s?.tables ?? []) add(t.groupId, 'tableIds', t.id);
   for (const e of s?.elements ?? []) add(e.groupId, 'elementIds', e.id);
   for (const d of s?.sequenceDiagrams ?? []) add(d.groupId, 'diagramIds', d.id);
   for (const [gid, g] of all) {
      if (g.tableIds.length + g.elementIds.length + g.diagramIds.length < 2) all.delete(gid);
   }
   return all;
}

const sameMembers = (a: GroupMembers, b: GroupMembers): boolean =>
   sameItems(a.tableIds, b.tableIds) && sameItems(a.elementIds, b.elementIds) && sameItems(a.diagramIds, b.diagramIds);

/** What the canvas leaves out because it belongs to a slide that isn't shown. */
interface SlideHidden {
   elementIds: ReadonlySet<string>;
   tableIds: ReadonlySet<string>;
   diagramIds: ReadonlySet<string>;
}

const sameHidden = (a: SlideHidden | null, b: SlideHidden | null): boolean =>
   a === b ||
   (!!a &&
      !!b &&
      sameSet(a.elementIds, b.elementIds) &&
      sameSet(a.tableIds, b.tableIds) &&
      sameSet(a.diagramIds, b.diagramIds));

/** A live (local-only) shift of one sequence diagram from where its drag started. */
export interface SequenceShift {
   diagramId: string;
   startXs: ReadonlyMap<string, number>;
   dx: number;
   startOriginY: number;
   dy: number;
   startRows: ReadonlyMap<string, number>;
}

/** Everything one drag frame moves, applied by `moveItemsLocal` as a single state write. */
export interface ItemMoves {
   elements?: ReadonlyMap<string, PointModel>;
   tables?: ReadonlyMap<string, PointModel>;
   /** Relationship id -> its new waypoints. */
   waypoints?: ReadonlyMap<string, PointModel[]>;
   sequences?: readonly SequenceShift[];
}

function shiftSequenceIn(s: SchemaModel, shift: SequenceShift): SchemaModel {
   const { diagramId, startXs, dx, startOriginY, dy, startRows } = shift;
   const d = s.sequenceDiagrams.find((x) => x.id === diagramId);
   const base = startOriginY + dy + (d?.headerHeight ?? 42);
   const gap = d?.rowSpacing ?? 48;
   return {
      ...s,
      lifelines: s.lifelines.map((l) => (l.diagramId === diagramId ? { ...l, x: (startXs.get(l.id) ?? l.x) + dx } : l)),
      sequenceMessages: s.sequenceMessages.map((m) =>
         m.diagramId === diagramId && startRows.has(m.id) ? { ...m, y: base + gap * (startRows.get(m.id) ?? 1) } : m
      ),
      sequenceDiagrams: s.sequenceDiagrams.map((x) => (x.id === diagramId ? { ...x, originY: startOriginY + dy } : x)),
   };
}

/** Move many rows in one pass per collection; rows already in place keep their identity. */
function applyItemMoves(s: SchemaModel, moves: ItemMoves): SchemaModel {
   let next = s;
   const at = <T extends { id: string; x: number; y: number }>(rows: T[], to?: ReadonlyMap<string, PointModel>): T[] =>
      to?.size
         ? rows.map((r) => {
              const p = to.get(r.id);
              return p && (p.x !== r.x || p.y !== r.y) ? { ...r, x: p.x, y: p.y } : r;
           })
         : rows;
   if (moves.elements?.size) next = { ...next, elements: at(next.elements, moves.elements) };
   if (moves.tables?.size) next = { ...next, tables: at(next.tables, moves.tables) };
   const wps = moves.waypoints;
   if (wps?.size) {
      next = {
         ...next,
         relationships: next.relationships.map((r) => (wps.has(r.id) ? { ...r, waypoints: wps.get(r.id) } : r)),
      };
   }
   for (const shift of moves.sequences ?? []) next = shiftSequenceIn(next, shift);
   return next;
}

/** One item's group membership, used to apply and undo (un)grouping. */
interface GroupAssignment {
   kind: GroupItemKind;
   id: string;
   groupId: string | null;
}

const DEFAULT_VIEWPORT: ViewportModel = { x: 0, y: 0, zoom: 1 };
/** How long pan/zoom must settle before it is written to this browser's storage. */
const VIEWPORT_SAVE_MS = 1000;

/** The view slots for a freshly loaded project: this browser's last view of it, else the server's. */
function viewSlotsOf(projectId: string, schema: SchemaModel): Pick<EditorState, 'viewport' | 'home' | 'customThemes'> {
   return {
      viewport: (!isSandboxId(projectId) && readSavedViewport(projectId)) || schema.viewport || DEFAULT_VIEWPORT,
      home: schema.home ?? null,
      customThemes: schema.themes ?? [],
   };
}

/** Header colors assigned round-robin to new tables so the canvas reads clearly. */
const TABLE_PALETTE = ['#e5484d', '#f5a623', '#12b76a', '#0ea5e9', '#2f6bff', '#7c5cff', '#ec4899', '#64748b'];

const initialState: EditorState = {
   projectId: null,
   schema: null,
   viewport: DEFAULT_VIEWPORT,
   home: null,
   customThemes: [],
   accessMode: 'VIEW',
   shared: false,
   selectedTableIds: [],
   selectedRelationshipIds: [],
   selectedElementIds: [],
   selectedLifelineIds: [],
   selectedMessageIds: [],
   selectedDiagramIds: [],
   enteredGroupId: null,
   activeSlideKey: null,
   selectedPresentationKey: null,
   shownByPresentationKey: {},
   slideZoom: {},
   pendingMessageEditId: null,
   pendingLifelineEditId: null,
   loading: false,
   error: null,
   saveStatus: 'idle',
   undoDepth: 0,
   redoDepth: 0,
   elementStyle: {
      fillStyle: 'none',
      strokeWidth: 2,
      strokeStyle: 'solid',
      opacity: 100,
      fontFamily: 'hand',
      fontSize: 20,
   },
};

/** Build a create DTO from an existing element (for undo/redo re-creation). */
export function elementToCreateDto(e: CanvasElementModel): CreateElementDto {
   return {
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      angle: e.angle,
      strokeColor: e.strokeColor,
      backgroundColor: e.backgroundColor,
      fillStyle: e.fillStyle,
      strokeWidth: e.strokeWidth,
      strokeStyle: e.strokeStyle,
      opacity: e.opacity,
      zIndex: e.zIndex,
      cornerRadius: e.cornerRadius,
      ellipticCorners: e.ellipticCorners,
      elbow: e.elbow,
      clipContent: e.clipContent,
      points: e.points,
      text: e.text,
      fontSize: e.fontSize,
      fontFamily: e.fontFamily,
      bold: e.bold,
      aboveTables: e.aboveTables,
      italic: e.italic,
      lineHeight: e.lineHeight,
      wrap: e.wrap,
      runs: e.runs,
      textAlign: e.textAlign,
      verticalAlign: e.verticalAlign,
      startBinding: e.startBinding,
      endBinding: e.endBinding,
      startArrowhead: e.startArrowhead,
      endArrowhead: e.endArrowhead,
      curvature: e.curvature,
      fileId: e.fileId,
      language: e.language,
      fileName: e.fileName,
      diffText: e.diffText,
      diffView: e.diffView,
      diffSplit: e.diffSplit,
      diffShowWhitespace: e.diffShowWhitespace,
      expandedHeight: e.expandedHeight,
      slide: e.slide,
      placeholder: e.placeholder,
      overrides: e.overrides,
      morphId: e.morphId,
      morphIn: e.morphIn,
      morphOut: e.morphOut,
      step: e.step,
      slideId: e.slideId,
   };
}

function messageOf(err: unknown): string {
   if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: unknown }).message);
   }
   return 'Something went wrong.';
}

/**
 * Drop any line/arrow bindings that point at a now-deleted target (a table or
 * element), so a bound endpoint reverts to its stored point instead of dangling.
 * Mirrors the server-side integrity rule so remote peers converge identically.
 */
function clearBindingsTo(elements: readonly CanvasElementModel[], targetId: string): CanvasElementModel[] {
   return elements.map((e) => {
      const startHit = e.startBinding?.targetId === targetId;
      const endHit = e.endBinding?.targetId === targetId;
      if (!startHit && !endHit) {
         return e;
      }
      return {
         ...e,
         startBinding: startHit ? undefined : e.startBinding,
         endBinding: endHit ? undefined : e.endBinding,
      };
   });
}

/** Generate a unique default table name like table_1, table_2, ... */
function uniqueTableName(tables: readonly TableModel[]): string {
   const names = new Set(tables.map((t) => t.name));
   let i = tables.length + 1;
   let name = `table_${i}`;
   while (names.has(name)) {
      i += 1;
      name = `table_${i}`;
   }
   return name;
}

export const ProjectStore = signalStore(
   { providedIn: 'root' },
   withState(initialState),
   withComputed(
      ({
         schema,
         selectedTableIds,
         selectedRelationshipIds,
         selectedElementIds,
         selectedLifelineIds,
         selectedMessageIds,
         selectedDiagramIds,
         accessMode,
         activeSlideKey,
         selectedPresentationKey,
         shownByPresentationKey,
         undoDepth,
         redoDepth,
      }) => {
         const slideFrames = computed(
            () => slideSequence((schema()?.elements ?? []).filter((e) => e.type === 'frame')),
            { equal: sameItems }
         );
         const presentations = computed(() => presentationNames(slideFrames()), { equal: sameItems });
         const presentation = computed<string | null>(() => {
            const names = presentations();
            const picked = selectedPresentationKey();
            if (picked && names.includes(picked)) {
               return picked;
            }
            const frames = slideFrames();
            const shown = frames.find((f) => f.id === activeSlideKey()) ?? frames[0];
            return shown ? presentationOf(shown) : null;
         });
         /** The slide each presentation shows (its chosen one if it still exists, else its first). */
         const shownByPresentation = computed(
            () => {
               const picked = shownByPresentationKey();
               const frames = slideFrames();
               const out = new Map<string, string>();
               for (const name of presentations()) {
                  // A layout can be shown too (to edit it); it stacks in the same spot.
                  const slides = presentationSlides(frames, name);
                  const all = frames.filter((f) => presentationOf(f) === name);
                  const hit = all.find((f) => f.id === picked[name]) ?? slides[0] ?? all[0];
                  if (hit) {
                     out.set(name, hit.id);
                  }
               }
               return out as ReadonlyMap<string, string>;
            },
            { equal: sameMap }
         );
         const shownSlideIds = computed(() => new Set(shownByPresentation().values()) as ReadonlySet<string>, {
            equal: sameSet,
         });
         /** Layout frames drawn under a shown slide (and not shown themselves). */
         const layoutsUnderShown = computed(
            () => {
               const frames = slideFrames();
               const shown = shownSlideIds();
               const out = new Set<string>();
               for (const f of frames) {
                  if (!shown.has(f.id)) continue;
                  const l = layoutOf(f, frames);
                  if (l && !shown.has(l.id)) out.add(l.id);
                  // The master is drawn under every slide and layout of its deck.
                  const m = masterOf(f, frames);
                  if (m && !shown.has(m.id)) out.add(m.id);
               }
               return out as ReadonlySet<string>;
            },
            { equal: sameSet }
         );
         const themes = computed(() => presentationThemes(schema()?.elements ?? []), { equal: sameMap });
         /** Live groups (two or more members) and each member's group, built in one pass. */
         const groupIndex = computed(
            () => {
               const groups = buildGroups(schema());
               const byItem = new Map<string, string>();
               for (const [gid, g] of groups) {
                  [...g.tableIds, ...g.elementIds, ...g.diagramIds].forEach((id) => byItem.set(id, gid));
               }
               return { groups, byItem: byItem as ReadonlyMap<string, string> };
            },
            { equal: (a, b) => sameMap(a.groups, b.groups, sameMembers) }
         );
         // Text measuring resolves `$heading` / `$body` against the item's deck theme.
         setThemeFontResolver((el) => {
            const frames = untracked(slideFrames);
            const f = frames.find((x) => x.id === el.id) ?? frames.find((x) => x.id === el.slideId);
            return resolveThemeFont(el.fontFamily, (f && untracked(themes).get(presentationOf(f))) || DEFAULT_THEME);
         });
         return {
            slideFrames,
            /** The presentations in the project (names), in order of first appearance. */
            presentations,
            /** The selected presentation: the one the slides panel, F5 and the PDF export act on. */
            presentation,
            /** The slides of the selected presentation, in order (skipped ones included). */
            presentationFrames: computed(() => presentationSlides(slideFrames(), presentation()), { equal: sameItems }),
            /** The layouts of the selected presentation. */
            presentationLayoutFrames: computed(() => presentationLayouts(slideFrames(), presentation()), {
               equal: sameItems,
            }),
            /**
             * Elements of a layout drawn under a shown slide: on the canvas, but locked (they
             * are edited by showing the layout itself).
             */
            /** Master items drawn under a shown slide or layout (stacked below layout items). */
            masterItemIds: computed(
               () => {
                  const masters = new Set(
                     slideFrames()
                        .filter((f) => f.slide?.master)
                        .map((f) => f.id)
                  );
                  return new Set(
                     masters.size
                        ? (schema()?.elements ?? [])
                             .filter((e) => !!e.slideId && masters.has(e.slideId))
                             .map((e) => e.id)
                        : []
                  ) as ReadonlySet<string>;
               },
               { equal: sameSet }
            ),
            layoutItemIds: computed(
               () => {
                  const under = layoutsUnderShown();
                  return new Set(
                     under.size
                        ? (schema()?.elements ?? [])
                             .filter((e) => !!e.slideId && under.has(e.slideId) && !e.placeholder)
                             .map((e) => e.id)
                        : []
                  ) as ReadonlySet<string>;
               },
               { equal: sameSet }
            ),
            tables: computed(() => schema()?.tables ?? []),
            relationships: computed(() => schema()?.relationships ?? []),
            /**
             * Column ids that participate in any relationship. A non-PK column in this
             * set is a foreign key (the table node shows it a link glyph); a PK in it is
             * still shown as a key. Kept as a Set for O(1) per-row lookup.
             */
            foreignKeyColumnIds: computed(
               () => {
                  const ids = new Set<string>();
                  for (const r of schema()?.relationships ?? []) {
                     ids.add(r.sourceColumnId);
                     ids.add(r.targetColumnId);
                  }
                  return ids as ReadonlySet<string>;
               },
               { equal: sameSet }
            ),
            elements: computed(() => schema()?.elements ?? []),
            /** Elements with theme tokens (`$accent1`, `$heading`) resolved per presentation: what renderers draw. */
            themedElements: computed(() => resolveThemedElements(schema()?.elements ?? [])),
            /** Each presentation's theme (name -> theme); presentations without one use the default. */
            presentationThemes: themes,
            /** The slide each presentation shows on the canvas (name -> frame id). */
            shownByPresentation,
            /** The slides shown on the canvas: one per presentation. */
            shownSlideIds,
            /** The slide shown for the selected presentation (where new content goes). */
            activeSlideId: computed(() => {
               const name = presentation();
               return (name ? shownByPresentation().get(name) : undefined) ?? null;
            }),
            /**
             * What the canvas leaves out because it belongs to another slide. Each
             * presentation stacks its slides in one spot and only its shown slide is drawn;
             * things with no slide are shown always.
             */
            hiddenBySlides: computed(
               () => {
                  const elements = schema()?.elements ?? [];
                  const shown = shownSlideIds();
                  if (!shown.size) {
                     return null;
                  }
                  // The layouts under shown slides stay on the canvas (drawn locked, beneath).
                  const under = layoutsUnderShown();
                  const elementIds = new Set<string>();
                  for (const e of elements) {
                     if (
                        e.type === 'frame'
                           ? !!e.slide && !shown.has(e.id)
                           : !!e.slideId && !shown.has(e.slideId) && !(under.has(e.slideId) && !e.placeholder)
                     ) {
                        elementIds.add(e.id);
                     }
                  }
                  // Master items a shown slide (or its layout) replaces with its own stand-in; a
                  // slide's stand-in also hides its layout's.
                  const bySlide = new Set<string>();
                  const byLayout = new Set<string>();
                  for (const e of elements) {
                     const of = overriddenId(e);
                     if (!of || !e.slideId) continue;
                     // A deletion marker is never drawn itself.
                     if (isMasterDeletion(e)) elementIds.add(e.id);
                     if (shown.has(e.slideId)) bySlide.add(of);
                     else if (under.has(e.slideId)) byLayout.add(of);
                  }
                  if (bySlide.size || byLayout.size) {
                     for (const e of elements) {
                        if (
                           bySlide.has(e.id) ||
                           byLayout.has(e.id) ||
                           (e.overrides && e.slideId && under.has(e.slideId) && bySlide.has(overriddenId(e)!))
                        ) {
                           elementIds.add(e.id);
                        }
                     }
                  }
                  const tableIds = new Set<string>();
                  for (const t of schema()?.tables ?? []) {
                     if (t.slideId && !shown.has(t.slideId)) {
                        tableIds.add(t.id);
                     }
                  }
                  const diagramIds = new Set<string>();
                  for (const d of schema()?.sequenceDiagrams ?? []) {
                     if (d.slideId && !shown.has(d.slideId)) {
                        diagramIds.add(d.id);
                     }
                  }
                  return { elementIds, tableIds, diagramIds } as SlideHidden;
               },
               { equal: sameHidden }
            ),
            /** The single selected table (only when exactly one is selected), for the inspector. */
            selectedTable: computed(() => {
               const ids = selectedTableIds();
               return ids.length === 1 ? (schema()?.tables.find((t) => t.id === ids[0]) ?? null) : null;
            }),
            selectedRelationship: computed(() => {
               const ids = selectedRelationshipIds();
               return ids.length === 1 ? (schema()?.relationships.find((r) => r.id === ids[0]) ?? null) : null;
            }),
            /** The single selected element (only when exactly one is selected), for the inspector. */
            selectedElement: computed(() => {
               const ids = selectedElementIds();
               return ids.length === 1 ? (schema()?.elements.find((e) => e.id === ids[0]) ?? null) : null;
            }),
            // ---- Sequence diagrams ----
            sequenceDiagrams: computed(() => schema()?.sequenceDiagrams ?? []),
            lifelines: computed(() => schema()?.lifelines ?? []),
            sequenceMessages: computed(() => schema()?.sequenceMessages ?? []),
            selectedLifeline: computed(() => {
               const ids = selectedLifelineIds();
               return ids.length === 1 ? (schema()?.lifelines.find((l) => l.id === ids[0]) ?? null) : null;
            }),
            selectedMessage: computed(() => {
               const ids = selectedMessageIds();
               return ids.length === 1 ? (schema()?.sequenceMessages.find((m) => m.id === ids[0]) ?? null) : null;
            }),
            /** The selected diagram (its bounding box), for the inspector. */
            selectedDiagram: computed(() => {
               const ids = selectedDiagramIds();
               const id = ids.length === 1 ? ids[0] : null;
               return id ? (schema()?.sequenceDiagrams.find((d) => d.id === id) ?? null) : null;
            }),
            /** The single selected diagram id (null when none or several are selected). */
            selectedDiagramId: computed(() => (selectedDiagramIds().length === 1 ? selectedDiagramIds()[0] : null)),
            /** True when any sequence diagram's box is selected. */
            sequenceSelected: computed(() => selectedDiagramIds().length > 0),
            /** Live groups (two or more members) keyed by group id. */
            groups: computed(() => groupIndex().groups),
            /** Item id (table / element / diagram) -> the live group it belongs to. */
            groupByItem: computed(() => groupIndex().byItem),
            canEdit: computed(() => accessMode() !== 'VIEW'),
            canUndo: computed(() => undoDepth() > 0),
            canRedo: computed(() => redoDepth() > 0),
         };
      }
   ),
   withMethods(
      (
         store,
         projectsApi = inject(ProjectsApiService),
         tablesApi = inject(TablesApiService),
         columnsApi = inject(ColumnsApiService),
         indexesApi = inject(IndexesApiService),
         relationshipsApi = inject(RelationshipsApiService),
         elementsApi = inject(ElementsApiService),
         sequenceApi = inject(SequenceApiService),
         shareLinksApi = inject(ShareLinksApiService),
         shareSession = inject(ShareSessionService),
         snackBar = inject(MatSnackBar)
      ) => {
         const timers = new Map<string, ReturnType<typeof setTimeout>>();
         const timerFns = new Map<string, () => void>();

         /** The last pan/zoom not yet written to this browser's storage. */
         let pendingViewport: { projectId: string; viewport: ViewportModel } | null = null;
         function flushViewport(): void {
            if (!pendingViewport) return;
            saveViewport(pendingViewport.projectId, pendingViewport.viewport);
            pendingViewport = null;
         }
         // Leaving the page mid-debounce still keeps the view.
         globalThis.addEventListener?.('pagehide', flushViewport);

         // Element undo/redo. Entries reuse the granular element methods so an undo is
         // itself a persisted, broadcast mutation (collaboration-safe). Remote edits
         // and the undo/redo application itself never push new entries.
         const undoStack: HistoryEntry[] = [];
         const redoStack: HistoryEntry[] = [];
         let applyingHistory = false;

         function syncHistoryDepth(): void {
            patchState(store, { undoDepth: undoStack.length, redoDepth: redoStack.length });
         }

         // While a batch is open, pushed entries are collected and recorded as one
         // undo step (e.g. deleting a multi-selection).
         let historyBatch: HistoryEntry[] | null = null;

         function pushHistory(entry: HistoryEntry): void {
            if (applyingHistory) {
               return;
            }
            if (historyBatch) {
               historyBatch.push(entry);
               return;
            }
            undoStack.push(entry);
            redoStack.length = 0;
            syncHistoryDepth();
         }

         async function runHistory(action: () => void | Promise<void>): Promise<void> {
            applyingHistory = true;
            try {
               await action();
            } finally {
               applyingHistory = false;
            }
         }

         /** While applying a batch of remote changes: the working schema, written once at the end. */
         let pendingSchema: SchemaModel | null = null;

         function setSchema(updater: (schema: SchemaModel) => SchemaModel): void {
            if (pendingSchema) {
               pendingSchema = updater(pendingSchema);
               return;
            }
            const current = store.schema();
            if (current) {
               patchState(store, { schema: updater(current) });
            }
         }

         function mapTable(tableId: string, fn: (table: TableModel) => TableModel): void {
            setSchema((s) => ({
               ...s,
               tables: s.tables.map((t) => (t.id === tableId ? fn(t) : t)),
            }));
         }

         function mapLifeline(id: string, fn: (l: LifelineModel) => LifelineModel): void {
            setSchema((s) => ({
               ...s,
               lifelines: s.lifelines.map((l) => (l.id === id ? fn(l) : l)),
            }));
         }

         function mapMessage(id: string, fn: (m: SequenceMessageModel) => SequenceMessageModel): void {
            setSchema((s) => ({
               ...s,
               sequenceMessages: s.sequenceMessages.map((m) => (m.id === id ? fn(m) : m)),
            }));
         }

         function mapDiagram(id: string, fn: (d: SequenceDiagramModel) => SequenceDiagramModel): void {
            setSchema((s) => ({
               ...s,
               sequenceDiagrams: s.sequenceDiagrams.map((d) => (d.id === id ? fn(d) : d)),
            }));
         }

         function mapElement(elementId: string, fn: (element: CanvasElementModel) => CanvasElementModel): void {
            setSchema((s) => ({
               ...s,
               elements: s.elements.map((e) => (e.id === elementId ? fn(e) : e)),
            }));
         }

         // Raw element operations (persist + local update, no history). Both the
         // public methods and the undo/redo closures build on these.
         /**
          * The zoomed-out slide the pointer is over (set by the editor), or null. A zoomed
          * slide's items live in its own coordinates, which overlap the canvas around its
          * block, so only the pointer can tell which space a new item's point is in.
          */
         let pointerSlide: string | null = null;

         /**
          * The shown slide a new item at a canvas point joins: the zoomed slide under the
          * pointer (anywhere in what it shows, staging room included), else the shown,
          * unzoomed slide whose frame covers the point.
          */
         function shownSlideAt(x: number, y: number): string | undefined {
            const shown = store.shownSlideIds();
            const zoom = store.slideZoom();
            const frames = store.slideFrames().filter((f) => shown.has(f.id));
            if (pointerSlide) {
               const f = frames.find((x) => x.id === pointerSlide);
               const b = f && slideViewRegion(f, zoom[presentationOf(f)] ?? 1);
               return b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 ? f.id : undefined;
            }
            return frames.find(
               (f) => !zoom[presentationOf(f)] && x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height
            )?.id;
         }

         async function createElementRaw(dto: CreateElementDto): Promise<CanvasElementModel | null> {
            const projectId = store.projectId();
            if (!projectId) {
               return null;
            }
            // New content drawn on a presentation's shown slide joins that slide.
            const withSlide: CreateElementDto =
               dto.slideId || dto.type === 'frame'
                  ? dto
                  : {
                       ...dto,
                       slideId: shownSlideAt(dto.x + dto.width / 2, dto.y + dto.height / 2),
                    };
            // The id is generated here so the element shows (and can be moved, edited
            // or deleted) at once; those follow-ups queue behind the create request.
            const id = dto.id ?? crypto.randomUUID();
            const zIndex =
               withSlide.zIndex ?? (store.schema()?.elements ?? []).reduce((m, e) => Math.max(m, e.zIndex + 1), 0);
            const body: CreateElementDto = { ...withSlide, id, zIndex };
            const local = { angle: 0, ...body, id, zIndex } as CanvasElementModel;
            setSchema((s) => ({ ...s, elements: [...s.elements, local] }));
            const key = `element:${id}`;
            void enqueue(key, () => runSave(() => firstValueFrom(elementsApi.create(projectId, body))))
               .then((created) => {
                  // Local edits made since (staged or in flight) are newer than this copy.
                  if (!queueSettling(key) || isStaged('elements', id)) return;
                  mapElement(id, () => created);
               })
               .catch(() => {
                  failedCreates.add(id);
                  setSchema((s) => ({
                     ...s,
                     elements: clearBindingsTo(
                        s.elements.filter((e) => e.id !== id),
                        id
                     ),
                  }));
                  patchState(store, {
                     selectedElementIds: store.selectedElementIds().filter((x) => x !== id),
                  });
                  notifyFailure('add the element');
               });
            return local;
         }

         /** Local-first element patch; the save is merged and debounced per element. */
         async function updateElementRaw(elementId: string, patch: UpdateElementDto): Promise<void> {
            stage('elements', elementId, patch);
            mapElement(elementId, (e) => {
               const { startBinding, endBinding, ...rest } = patch;
               const next = { ...e, ...(rest as Partial<CanvasElementModel>) };
               if ('startBinding' in patch) next.startBinding = startBinding ?? undefined;
               if ('endBinding' in patch) next.endBinding = endBinding ?? undefined;
               return next;
            });
         }

         /** Local-first delete; the request is queued and the element restored if it fails. */
         async function deleteElementRaw(elementId: string): Promise<boolean> {
            if (failedCreates.has(elementId)) {
               return false;
            }
            flushTimers(`pos:elem:${elementId}`, `pts:elem:${elementId}`, `patch:elem:${elementId}`);
            void optimistic(
               `element:${elementId}`,
               () => {
                  setSchema((s) => ({
                     ...s,
                     elements: clearBindingsTo(
                        s.elements.filter((e) => e.id !== elementId),
                        elementId
                     ),
                  }));
                  patchState(store, {
                     selectedElementIds: store.selectedElementIds().filter((id) => id !== elementId),
                  });
               },
               () => firstValueFrom(elementsApi.remove(elementId)),
               'delete the element'
            );
            return true;
         }

         /** Capture the current values of the keys a patch will change (for undo). */
         function captureBefore(element: CanvasElementModel, patch: UpdateElementDto): UpdateElementDto {
            const before: Record<string, unknown> = {};
            for (const key of Object.keys(patch)) {
               if (
                  key === 'startBinding' ||
                  key === 'endBinding' ||
                  key === 'slide' ||
                  key === 'runs' ||
                  key === 'morphId' ||
                  key === 'step' ||
                  key === 'slideId' ||
                  key === 'expandedHeight' ||
                  key === 'diffText' ||
                  key === 'media'
               ) {
                  before[key] = element[key] ?? null;
               } else if (key === 'fileName') {
                  before[key] = element.fileName ?? '';
               } else {
                  before[key] = (element as unknown as Record<string, unknown>)[key];
               }
            }
            return before as UpdateElementDto;
         }

         // ---- Groups ----

         interface Sel {
            tableIds: string[];
            elementIds: string[];
            diagramIds: string[];
         }

         function currentSel(): Sel {
            return {
               tableIds: [...store.selectedTableIds()],
               elementIds: [...store.selectedElementIds()],
               diagramIds: [...store.selectedDiagramIds()],
            };
         }

         /**
          * Grow a selection to whole groups (the group being edited excepted) and work
          * out which group stays entered: only one the selection still touches.
          */
         function resolveGroups(sel: Sel): { sel: Sel; entered: string | null } {
            const byItem = store.groupByItem();
            const groups = store.groups();
            const gids = new Set<string>();
            for (const id of [...sel.tableIds, ...sel.elementIds, ...sel.diagramIds]) {
               const g = byItem.get(id);
               if (g) gids.add(g);
            }
            let entered = store.enteredGroupId();
            if (entered && !gids.has(entered)) entered = null;
            const t = new Set(sel.tableIds);
            const e = new Set(sel.elementIds);
            const d = new Set(sel.diagramIds);
            for (const gid of gids) {
               const m = groups.get(gid);
               if (!m || gid === entered) continue;
               m.tableIds.forEach((i) => t.add(i));
               m.elementIds.forEach((i) => e.add(i));
               m.diagramIds.forEach((i) => d.add(i));
            }
            return { sel: { tableIds: [...t], elementIds: [...e], diagramIds: [...d] }, entered };
         }

         /** Replace the selection with `sel` (grown to whole groups), clearing other kinds. */
         function applySelection(sel: Sel): void {
            const r = resolveGroups(sel);
            patchState(store, {
               selectedTableIds: r.sel.tableIds,
               selectedElementIds: r.sel.elementIds,
               selectedDiagramIds: r.sel.diagramIds,
               selectedRelationshipIds: [],
               selectedLifelineIds: [],
               selectedMessageIds: [],
               enteredGroupId: r.entered,
            });
         }

         const KIND_KEY: Record<GroupItemKind, keyof Sel> = {
            table: 'tableIds',
            element: 'elementIds',
            diagram: 'diagramIds',
         };

         /** Shift/ctrl-toggle one item; a grouped item toggles its whole group. */
         function toggleItem(kind: GroupItemKind, id: string): void {
            const cur = currentSel();
            const key = KIND_KEY[kind];
            const gid = store.groupByItem().get(id);
            const entered = store.enteredGroupId();
            const single: Sel = { tableIds: [], elementIds: [], diagramIds: [] };
            single[key] = [id];
            const unit: Sel = gid && gid !== entered ? (store.groups().get(gid) as Sel) : single;
            const on = !cur[key].includes(id);
            const next: Sel = { tableIds: [], elementIds: [], diagramIds: [] };
            for (const k of ['tableIds', 'elementIds', 'diagramIds'] as const) {
               next[k] = on ? [...new Set([...cur[k], ...unit[k]])] : cur[k].filter((x) => !unit[k].includes(x));
            }
            const byItem = store.groupByItem();
            const stillEntered =
               !!entered &&
               [...next.tableIds, ...next.elementIds, ...next.diagramIds].some((x) => byItem.get(x) === entered);
            patchState(store, {
               selectedTableIds: next.tableIds,
               selectedElementIds: next.elementIds,
               selectedDiagramIds: next.diagramIds,
               selectedLifelineIds: [],
               selectedMessageIds: [],
               enteredGroupId: stillEntered ? entered : null,
            });
         }

         /** The raw (persisted) group id of an item, whether or not the group is live. */
         function rawGroupId(kind: GroupItemKind, id: string): string | null {
            const s = store.schema();
            if (!s) return null;
            const g =
               kind === 'table'
                  ? s.tables.find((x) => x.id === id)?.groupId
                  : kind === 'element'
                    ? s.elements.find((x) => x.id === id)?.groupId
                    : s.sequenceDiagrams.find((x) => x.id === id)?.groupId;
            return g ?? null;
         }

         /** Apply group membership locally, then persist each item (no history). */
         async function applyGroupAssignments(list: GroupAssignment[]): Promise<void> {
            const projectId = store.projectId();
            for (const a of list) {
               const value = a.groupId ?? undefined;
               if (a.kind === 'table') mapTable(a.id, (t) => ({ ...t, groupId: value }));
               else if (a.kind === 'element') mapElement(a.id, (e) => ({ ...e, groupId: value }));
               else mapDiagram(a.id, (d) => ({ ...d, groupId: value }));
            }
            await Promise.all(
               list.map((a) => {
                  const patch = { groupId: a.groupId };
                  if (a.kind === 'table') {
                     return runSave(() => firstValueFrom(tablesApi.update(a.id, patch)));
                  }
                  if (a.kind === 'element') {
                     return runSave(() => firstValueFrom(elementsApi.update(a.id, patch)));
                  }
                  return projectId
                     ? runSave(() => firstValueFrom(sequenceApi.updateDiagram(projectId, a.id, patch)))
                     : Promise.resolve();
               })
            );
         }

         /** Keep the entered group only when the diagram being selected belongs to it. */
         function enteredFor(diagramId: string | undefined): string | null {
            const entered = store.enteredGroupId();
            return entered && diagramId && store.groupByItem().get(diagramId) === entered ? entered : null;
         }

         function selectedItems(): { kind: GroupItemKind; id: string }[] {
            const sel = currentSel();
            return [
               ...sel.tableIds.map((id) => ({ kind: 'table' as const, id })),
               ...sel.elementIds.map((id) => ({ kind: 'element' as const, id })),
               ...sel.diagramIds.map((id) => ({ kind: 'diagram' as const, id })),
            ];
         }

         async function setGroups(before: GroupAssignment[], after: GroupAssignment[]): Promise<void> {
            pushHistory({
               undo: () => applyGroupAssignments(before),
               redo: () => applyGroupAssignments(after),
            });
            await applyGroupAssignments(after);
         }

         let savesInFlight = 0;
         let saveFailed = false;

         async function runSave<T>(action: () => Promise<T>): Promise<T> {
            savesInFlight++;
            patchState(store, { saveStatus: 'saving' });
            try {
               return await action();
            } catch (err) {
               saveFailed = true;
               throw err;
            } finally {
               savesInFlight--;
               if (!savesInFlight) {
                  patchState(store, { saveStatus: saveFailed ? 'error' : 'saved' });
                  saveFailed = false;
               }
            }
         }

         // ---- Optimistic writes ----
         // Deletes and moves apply to the local schema immediately; the request is
         // queued per entity (so a move, an edit and a delete of the same row reach the
         // server in order) and the local change is rolled back if the server rejects it.
         const queues = new Map<string, Promise<unknown>>();
         // All writes chain here (a staged batch, a delete and a create of the same
         // row must land in order); `queues` only tracks per-row pending work.
         let writeChain: Promise<unknown> = Promise.resolve();
         // Optimistically created elements the server rejected; later queued ops on
         // them fail too, and their rollbacks must not bring them back.
         const failedCreates = new Set<string>();
         const queueDepth = new Map<string, number>();

         function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
            const run = writeChain.catch(() => undefined).then(fn);
            const tail = run.catch(() => undefined);
            writeChain = tail;
            queues.set(key, tail);
            queueDepth.set(key, (queueDepth.get(key) ?? 0) + 1);
            void tail.then(() => {
               const depth = (queueDepth.get(key) ?? 1) - 1;
               if (depth) {
                  queueDepth.set(key, depth);
               } else {
                  queueDepth.delete(key);
                  queues.delete(key);
               }
            });
            return run;
         }

         /** True when no request other than the one now finishing is queued for `key`. */
         function queueSettling(key: string): boolean {
            return (queueDepth.get(key) ?? 0) <= 1;
         }

         type Collection =
            'tables' | 'relationships' | 'elements' | 'sequenceDiagrams' | 'lifelines' | 'sequenceMessages';
         const COLLECTIONS: Collection[] = [
            'tables',
            'relationships',
            'elements',
            'sequenceDiagrams',
            'lifelines',
            'sequenceMessages',
         ];
         type Row = { id: string };

         /**
          * Snapshot the schema before a local change. The returned `seal` diffs the
          * snapshot against the current schema and returns a rollback that restores
          * the rows the change touched (re-inserting removed ones at their old index),
          * leaving unrelated rows alone. `onlyId` limits it to one row, reverted only
          * while it still exists (a move must not resurrect a since-deleted row).
          */
         function checkpoint(onlyId?: string): () => () => void {
            const before = store.schema();
            return () => {
               const after = store.schema();
               if (!before || !after || before === after) {
                  return () => undefined;
               }
               const reverts = COLLECTIONS.map((k) => {
                  const prev = before[k] as Row[];
                  const done = after[k] as Row[];
                  const doneById = new Map(done.map((r) => [r.id, r]));
                  const rows =
                     prev === done
                        ? []
                        : prev
                             .map((row, index) => ({ row, index }))
                             .filter(
                                ({ row }) =>
                                   doneById.get(row.id) !== row &&
                                   (!onlyId || (row.id === onlyId && doneById.has(row.id)))
                             );
                  return { k, rows };
               }).filter((r) => r.rows.length);
               return () =>
                  setSchema((s) => {
                     let next = s;
                     for (const { k, rows } of reverts) {
                        const cur = [...(next[k] as Row[])];
                        for (const { row, index } of rows) {
                           const at = cur.findIndex((r) => r.id === row.id);
                           if (at >= 0) cur[at] = row;
                           else if (!onlyId && !failedCreates.has(row.id))
                              cur.splice(Math.min(index, cur.length), 0, row);
                        }
                        next = { ...next, [k]: cur };
                     }
                     return next;
                  });
            };
         }

         function notifyFailure(what: string): void {
            snackBar.open(`Couldn't ${what}; the change was reverted.`, 'Dismiss', { duration: 5000 });
         }

         /**
          * Apply `apply` locally now, then persist through the entity's queue. On
          * failure the local change is rolled back and the user told; resolves to
          * `{ value }` on success, `null` on failure.
          */
         async function optimistic<T>(
            queueKey: string,
            apply: () => void,
            persist: () => Promise<T>,
            what: string
         ): Promise<{ value: T } | null> {
            const seal = checkpoint();
            apply();
            const rollback = seal();
            try {
               return { value: await enqueue(queueKey, () => runSave(persist)) };
            } catch {
               rollback();
               notifyFailure(what);
               return null;
            }
         }

         /** Send (instead of waiting out) pending debounced saves, e.g. before a delete. */
         function flushTimers(...keys: string[]): void {
            for (const key of ['batch', ...keys]) {
               const handle = timers.get(key);
               const fn = timerFns.get(key);
               if (handle && fn) {
                  clearTimeout(handle);
                  timers.delete(key);
                  timerFns.delete(key);
                  fn();
               }
            }
         }

         // Checkpoints for debounced saves, sealed when the save fires: a rejected
         // save restores the row to its state before the window's first local change.
         const debouncedCheckpoints = new Map<string, () => () => void>();

         /** Debounced optimistic save whose request is built (`take`) when the window closes. */
         function debouncedCommit(
            key: string,
            queueKey: string,
            rowId: string,
            take: () => () => Promise<unknown>,
            what: string,
            ms: number
         ): void {
            if (!debouncedCheckpoints.has(key)) {
               debouncedCheckpoints.set(key, checkpoint(rowId));
            }
            debounce(
               key,
               () => {
                  const seal = debouncedCheckpoints.get(key);
                  debouncedCheckpoints.delete(key);
                  const rollback = seal ? seal() : () => undefined;
                  const persist = take();
                  void enqueue(queueKey, () => runSave(persist)).catch(() => {
                     rollback();
                     notifyFailure(what);
                  });
               },
               ms
            );
         }

         // Field patches waiting out their debounce window, merged per row.
         const pendingPatches = new Map<string, Record<string, unknown>>();

         /**
          * Local-first edit: the caller has already applied `patch` to the local model
          * (or does so right after); rapid patches to the same row are merged and sent
          * as one request once edits pause. A rejected request restores the row.
          */
         function commitPatch<P extends object>(
            key: string,
            queueKey: string,
            rowId: string,
            patch: P,
            send: (merged: P) => Promise<unknown>,
            what: string,
            ms = 300
         ): void {
            pendingPatches.set(key, { ...(pendingPatches.get(key) ?? {}), ...patch });
            debouncedCommit(
               key,
               queueKey,
               rowId,
               () => {
                  const merged = (pendingPatches.get(key) ?? {}) as P;
                  pendingPatches.delete(key);
                  return () => send(merged);
               },
               what,
               ms
            );
         }

         // ---- Staged batch ----
         // Moves and field edits are staged here, merged per row, and sent as ONE
         // atomic PATCH /projects/:id/batch once edits pause, so dragging a diagram
         // (its participants, messages, tables and shapes) is a single request. A
         // rejected batch restores every row it carried.
         type BatchSection = 'tables' | 'elements' | 'diagrams' | 'lifelines' | 'messages' | 'relationships';
         const BATCH_SECTIONS: BatchSection[] = [
            'tables',
            'elements',
            'diagrams',
            'lifelines',
            'messages',
            'relationships',
         ];
         const staged = new Map<BatchSection, Map<string, Record<string, unknown>>>(
            BATCH_SECTIONS.map((k) => [k, new Map()])
         );
         const stagedCheckpoints = new Map<string, () => () => void>();

         /** True while a row has edits staged but not yet sent. */
         function isStaged(section: BatchSection, id: string): boolean {
            return staged.get(section)!.has(id);
         }

         /** Stage a patch for a row. Call BEFORE applying it locally (checkpoints the row). */
         function stage(section: BatchSection, id: string, patch: object, ms = 400): void {
            const ck = `${section}:${id}`;
            if (!stagedCheckpoints.has(ck)) {
               stagedCheckpoints.set(ck, checkpoint(id));
            }
            const rows = staged.get(section)!;
            rows.set(id, { ...(rows.get(id) ?? {}), ...patch });
            debounce('batch', flushBatch, ms);
         }

         function flushBatch(): void {
            const projectId = store.projectId();
            const body: BatchUpdateDto = {};
            let count = 0;
            for (const section of BATCH_SECTIONS) {
               const rows = staged.get(section)!;
               if (rows.size) {
                  (body as Record<string, unknown>)[section] = [...rows].map(([id, p]) => ({ id, ...p }));
                  count += rows.size;
                  rows.clear();
               }
            }
            const rollbacks = [...stagedCheckpoints.values()].map((seal) => seal());
            stagedCheckpoints.clear();
            if (!count || !projectId) {
               return;
            }
            void enqueue('batch', () => runSave(() => firstValueFrom(projectsApi.batch(projectId, body)))).catch(() => {
               rollbacks.forEach((rollback) => rollback());
               notifyFailure('save your changes');
            });
         }

         function patchTableLocal(tableId: string, patch: UpdateTableDto): void {
            stage('tables', tableId, patch);
            mapTable(tableId, (t) => ({ ...t, ...(patch as Partial<TableModel>) }));
         }

         function patchDiagramLocal(diagramId: string, patch: UpdateSequenceDiagramDto): void {
            stage('diagrams', diagramId, patch);
            mapDiagram(diagramId, (d) => ({ ...d, ...(patch as Partial<SequenceDiagramModel>) }));
         }

         // ---- Sequence undo/redo ----
         // Undoing a delete re-creates the row with a NEW server id, so history entries
         // refer to rows by their original id and resolve it through this alias chain.
         const idAlias = new Map<string, string>();
         function rid(id: string): string {
            let cur = id;
            for (let i = 0; i < 50 && idAlias.has(cur); i++) cur = idAlias.get(cur)!;
            return cur;
         }
         function aliasTo(oldId: string, newId: string): void {
            idAlias.set(rid(oldId), newId);
            idAlias.set(oldId, newId);
         }

         // ---- Column undo/redo ----
         // A re-created column gets a new id; history refers to the original id via rid().
         function captureColumn(tableId: string, columnId: string): ColumnSnapshot | null {
            const table = store.tables().find((t) => t.id === tableId);
            const index = table?.columns.findIndex((c) => c.id === columnId) ?? -1;
            if (!table || index < 0) return null;
            const relationships = (store.schema()?.relationships ?? []).filter(
               (r) => r.sourceColumnId === columnId || r.targetColumnId === columnId
            );
            return { tableId, column: { ...table.columns[index] }, index, relationships };
         }

         async function removeColumnRaw(tableId: string, columnId: string): Promise<void> {
            flushTimers(`reorder:${tableId}`, `patch:col:${columnId}`);
            await optimistic(
               `table:${tableId}`,
               () => {
                  mapTable(tableId, (t) => ({
                     ...t,
                     columns: t.columns.filter((c) => c.id !== columnId),
                  }));
                  // The server cascades the column's relationships; mirror that locally.
                  setSchema((s) => ({
                     ...s,
                     relationships: s.relationships.filter(
                        (r) => r.sourceColumnId !== columnId && r.targetColumnId !== columnId
                     ),
                  }));
               },
               () => firstValueFrom(columnsApi.remove(columnId)),
               'delete the column'
            );
         }

         async function restoreColumn(snap: ColumnSnapshot): Promise<void> {
            const projectId = store.projectId();
            const { tableId, column: col } = snap;
            if (!projectId || !store.tables().some((t) => t.id === tableId)) return;
            const created = await runSave(() =>
               firstValueFrom(
                  columnsApi.create(tableId, {
                     name: col.name,
                     dataType: col.dataType,
                     isPrimaryKey: col.isPrimaryKey,
                     isNullable: col.isNullable,
                     isUnique: col.isUnique,
                     isAutoIncrement: col.isAutoIncrement,
                     isUnsigned: col.isUnsigned,
                     defaultValue: col.defaultValue,
                  })
               )
            );
            let restored = created;
            if (col.note) {
               restored = { ...created, note: col.note };
               void runSave(() => firstValueFrom(columnsApi.update(created.id, { note: col.note })));
            }
            aliasTo(col.id, created.id);
            let order: string[] = [];
            mapTable(tableId, (t) => {
               const columns = [...t.columns];
               const at = snap.index < 0 ? columns.length : Math.min(snap.index, columns.length);
               columns.splice(at, 0, restored);
               order = columns.map((c) => c.id);
               return { ...t, columns };
            });
            if (snap.index >= 0 && order[order.length - 1] !== created.id) {
               await runSave(() => firstValueFrom(columnsApi.reorder(tableId, { orderedColumnIds: order })));
            }
            for (const rel of snap.relationships) {
               const sourceColumnId = rid(rel.sourceColumnId);
               const targetColumnId = rid(rel.targetColumnId);
               const exists =
                  store.tables().some((t) => t.columns.some((c) => c.id === sourceColumnId)) &&
                  store.tables().some((t) => t.columns.some((c) => c.id === targetColumnId));
               if (!exists) continue;
               let rc = await runSave(() =>
                  firstValueFrom(
                     relationshipsApi.create(projectId, {
                        sourceColumnId,
                        targetColumnId,
                        type: rel.type,
                        onDelete: rel.onDelete,
                        onUpdate: rel.onUpdate,
                        sourceSide: rel.sourceSide,
                        targetSide: rel.targetSide,
                        autoRoute: rel.autoRoute,
                     })
                  )
               );
               if (rel.waypoints?.length) {
                  const waypoints = rel.waypoints.map((w) => ({ ...w }));
                  rc = await runSave(() => firstValueFrom(relationshipsApi.update(rc.id, { waypoints })));
               }
               setSchema((s) => ({ ...s, relationships: [...s.relationships, rc] }));
            }
         }

         type SeqKind = 'message' | 'lifeline' | 'diagram';
         interface SeqSnapshot {
            kind: SeqKind;
            diagram?: SequenceDiagramModel;
            lifelines: LifelineModel[];
            messages: SequenceMessageModel[];
         }

         function captureSeq(kind: SeqKind, id: string): SeqSnapshot | null {
            const s = store.schema();
            if (!s) return null;
            if (kind === 'message') {
               const m = s.sequenceMessages.find((x) => x.id === id);
               return m ? { kind, lifelines: [], messages: [{ ...m }] } : null;
            }
            if (kind === 'lifeline') {
               const l = s.lifelines.find((x) => x.id === id);
               if (!l) return null;
               return {
                  kind,
                  lifelines: [{ ...l }],
                  messages: s.sequenceMessages
                     .filter((m) => m.fromLifelineId === id || m.toLifelineId === id)
                     .map((m) => ({ ...m })),
               };
            }
            const d = s.sequenceDiagrams.find((x) => x.id === id);
            if (!d) return null;
            return {
               kind,
               diagram: { ...d },
               lifelines: s.lifelines.filter((l) => l.diagramId === id).map((l) => ({ ...l })),
               messages: s.sequenceMessages.filter((m) => m.diagramId === id).map((m) => ({ ...m })),
            };
         }

         function seqRootId(snap: SeqSnapshot): string {
            return snap.kind === 'diagram'
               ? snap.diagram!.id
               : snap.kind === 'lifeline'
                 ? snap.lifelines[0].id
                 : snap.messages[0].id;
         }

         async function createMessageRaw(m: SequenceMessageModel): Promise<void> {
            const projectId = store.projectId();
            if (!projectId) return;
            const copy = await runSave(() =>
               firstValueFrom(
                  sequenceApi.createMessage(projectId, {
                     diagramId: rid(m.diagramId),
                     fromLifelineId: rid(m.fromLifelineId),
                     toLifelineId: rid(m.toLifelineId),
                     label: m.label,
                     y: m.y,
                     style: m.style,
                     direction: m.direction,
                     arrowhead: m.arrowhead,
                     color: m.color,
                     wrap: m.wrap,
                     morphId: m.morphId,
                  })
               )
            );
            aliasTo(m.id, copy.id);
            setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
         }

         async function createLifelineRaw(l: LifelineModel): Promise<void> {
            const projectId = store.projectId();
            if (!projectId) return;
            const copy = await runSave(() =>
               firstValueFrom(
                  sequenceApi.createLifeline(projectId, {
                     diagramId: rid(l.diagramId),
                     label: l.label,
                     color: l.color,
                     lineColor: l.lineColor,
                     strokeColor: l.strokeColor,
                     textColor: l.textColor,
                     morphId: l.morphId,
                     x: l.x,
                     width: l.width,
                     order: l.order,
                  })
               )
            );
            aliasTo(l.id, copy.id);
            setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
         }

         async function restoreSeq(snap: SeqSnapshot): Promise<void> {
            const projectId = store.projectId();
            if (!projectId) return;
            if (snap.diagram) {
               const d = snap.diagram;
               const copy = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createDiagram(projectId, {
                        originY: d.originY,
                        lifelineSpacing: d.lifelineSpacing,
                        rowSpacing: d.rowSpacing,
                        headerHeight: d.headerHeight,
                        backgroundColor: d.backgroundColor,
                        title: d.title,
                        morphId: d.morphId,
                        zIndex: d.zIndex,
                        slideId: d.slideId,
                     })
                  )
               );
               aliasTo(d.id, copy.id);
               setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, copy] }));
            }
            for (const l of [...snap.lifelines].sort((a, b) => a.order - b.order)) {
               await createLifelineRaw(l);
            }
            for (const m of snap.messages) {
               await createMessageRaw(m);
            }
         }

         /** Optimistic delete; resolves false (rows restored) when the server rejects it. */
         async function removeSeq(kind: SeqKind, id: string): Promise<boolean> {
            const projectId = store.projectId();
            if (!projectId) return false;
            if (kind === 'message') {
               flushTimers(`msgpos:${id}`, `patch:message:${id}`);
               void optimistic(
                  `message:${id}`,
                  () => {
                     setSchema((s) => ({
                        ...s,
                        sequenceMessages: s.sequenceMessages.filter((m) => m.id !== id),
                     }));
                     patchState(store, {
                        selectedMessageIds: store.selectedMessageIds().filter((x) => x !== id),
                     });
                  },
                  () => firstValueFrom(sequenceApi.deleteMessage(projectId, id)),
                  'delete the message'
               );
               return true;
            }
            if (kind === 'lifeline') {
               flushTimers(`llpos:${id}`, `patch:lifeline:${id}`);
               void optimistic(
                  `lifeline:${id}`,
                  () => {
                     setSchema((s) => ({
                        ...s,
                        lifelines: s.lifelines.filter((l) => l.id !== id),
                        sequenceMessages: s.sequenceMessages.filter(
                           (m) => m.fromLifelineId !== id && m.toLifelineId !== id
                        ),
                     }));
                     patchState(store, {
                        selectedLifelineIds: store.selectedLifelineIds().filter((x) => x !== id),
                     });
                  },
                  () => firstValueFrom(sequenceApi.deleteLifeline(projectId, id)),
                  'delete the participant'
               );
               return true;
            }
            flushTimers(`patch:diagram:${id}`);
            void optimistic(
               `diagram:${id}`,
               () => {
                  setSchema((s) => ({
                     ...s,
                     sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== id),
                     lifelines: s.lifelines.filter((l) => l.diagramId !== id),
                     sequenceMessages: s.sequenceMessages.filter((m) => m.diagramId !== id),
                  }));
                  patchState(store, {
                     selectedDiagramIds: store.selectedDiagramIds().filter((x) => x !== id),
                     selectedLifelineIds: [],
                     selectedMessageIds: [],
                  });
               },
               () => firstValueFrom(sequenceApi.deleteDiagram(projectId, id)),
               'delete the sequence diagram'
            );
            return true;
         }

         /** Undo = remove it again; redo = bring it back (state re-captured at undo time). */
         function recordSeqCreate(kind: SeqKind, id: string): void {
            let snap = captureSeq(kind, id);
            if (!snap) return;
            pushHistory({
               undo: async () => {
                  snap = captureSeq(kind, rid(id)) ?? snap;
                  await removeSeq(kind, rid(id));
               },
               redo: () => restoreSeq(snap!),
            });
         }

         /** Undo = bring the deleted rows back; redo = delete them again. */
         function recordSeqDelete(snap: SeqSnapshot): void {
            const id = seqRootId(snap);
            pushHistory({
               undo: () => restoreSeq(snap),
               redo: async () => {
                  await removeSeq(snap.kind, rid(id));
               },
            });
         }

         /** Pick the patched keys from a model (missing values become '' so they can be cleared). */
         function pickKeys(model: object, keys: string[]): Record<string, unknown> {
            const src = model as Record<string, unknown>;
            return Object.fromEntries(keys.map((k) => [k, src[k] ?? '']));
         }
         function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
            return Object.keys(a).every((k) => a[k] === b[k]);
         }
         function resolveRefs(patch: Record<string, unknown>): Record<string, unknown> {
            const out = { ...patch };
            for (const k of ['fromLifelineId', 'toLifelineId']) {
               if (typeof out[k] === 'string') out[k] = rid(out[k] as string);
            }
            return out;
         }

         function debounce(key: string, fn: () => void, ms = 500): void {
            const existing = timers.get(key);
            if (existing) {
               clearTimeout(existing);
            }
            timerFns.set(key, fn);
            timers.set(
               key,
               setTimeout(() => {
                  timers.delete(key);
                  timerFns.delete(key);
                  fn();
               }, ms)
            );
         }

         return {
            async load(projectId: string): Promise<void> {
               // Owner/anonymous-open load: never carry a share token from a prior visit.
               shareSession.setToken(null);
               patchState(store, {
                  loading: true,
                  error: null,
                  projectId,
                  shared: false,
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
               });
               try {
                  const graph = await firstValueFrom(projectsApi.getGraph(projectId));
                  patchState(store, {
                     schema: graph.schema,
                     ...viewSlotsOf(projectId, graph.schema),
                     accessMode: graph.accessLevel,
                     loading: false,
                  });
               } catch (err) {
                  patchState(store, { loading: false, error: messageOf(err), schema: null });
               }
            },

            /** Open a project from a /shared/:token link (no account). */
            async loadShared(token: string): Promise<void> {
               shareSession.setToken(token);
               patchState(store, {
                  loading: true,
                  error: null,
                  shared: true,
                  projectId: null,
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
               });
               try {
                  const graph = await firstValueFrom(shareLinksApi.getShared(token));
                  patchState(store, {
                     projectId: graph.project.id,
                     schema: graph.schema,
                     ...viewSlotsOf(graph.project.id, graph.schema),
                     accessMode: graph.accessLevel,
                     loading: false,
                  });
               } catch (err) {
                  patchState(store, { loading: false, error: messageOf(err), schema: null });
               }
            },

            /**
             * Apply a schema change broadcast from another participant. Patches local
             * state only (the change is already persisted server-side) and never calls
             * an endpoint. Cascades that the DB performs (deleting a table removes its
             * columns and dependent relationships) are mirrored here.
             */
            /**
             * Apply many remote changes (one batch/import/clone request) as ONE state update,
             * so derived views recompute once instead of once per change.
             */
            applyRemoteBatch(mutations: readonly SchemaMutation[]): void {
               const current = store.schema();
               if (!current || pendingSchema) {
                  for (const m of mutations) this.applyRemote(m);
                  return;
               }
               pendingSchema = current;
               try {
                  for (const m of mutations) this.applyRemote(m);
               } finally {
                  const next = pendingSchema;
                  pendingSchema = null;
                  if (next !== current) patchState(store, { schema: next });
               }
            },

            applyRemote(mutation: SchemaMutation): void {
               switch (mutation.kind) {
                  case 'table.created':
                     setSchema((s) =>
                        s.tables.some((t) => t.id === mutation.table.id)
                           ? s
                           : { ...s, tables: [...s.tables, mutation.table] }
                     );
                     break;
                  case 'table.updated':
                     mapTable(mutation.table.id, () => mutation.table);
                     break;
                  case 'table.moved':
                     mapTable(mutation.tableId, (t) => ({ ...t, x: mutation.x, y: mutation.y }));
                     break;
                  case 'table.deleted':
                     setSchema((s) => {
                        const removed = s.tables.find((t) => t.id === mutation.tableId);
                        const columnIds = new Set((removed?.columns ?? []).map((c) => c.id));
                        return {
                           ...s,
                           tables: s.tables.filter((t) => t.id !== mutation.tableId),
                           relationships: s.relationships.filter(
                              (r) => !columnIds.has(r.sourceColumnId) && !columnIds.has(r.targetColumnId)
                           ),
                           // A bound arrow attached to this table reverts to its stored point.
                           elements: clearBindingsTo(s.elements, mutation.tableId),
                        };
                     });
                     break;
                  case 'column.created':
                     mapTable(mutation.tableId, (t) =>
                        t.columns.some((c) => c.id === mutation.column.id)
                           ? t
                           : { ...t, columns: [...t.columns, mutation.column] }
                     );
                     break;
                  case 'column.updated':
                     mapTable(mutation.tableId, (t) => ({
                        ...t,
                        columns: t.columns.map((c) => (c.id === mutation.column.id ? mutation.column : c)),
                     }));
                     break;
                  case 'column.deleted':
                     setSchema((s) => ({
                        ...s,
                        tables: s.tables.map((t) =>
                           t.id === mutation.tableId
                              ? { ...t, columns: t.columns.filter((c) => c.id !== mutation.columnId) }
                              : t
                        ),
                        relationships: s.relationships.filter(
                           (r) => r.sourceColumnId !== mutation.columnId && r.targetColumnId !== mutation.columnId
                        ),
                     }));
                     break;
                  case 'column.reordered':
                     mapTable(mutation.tableId, (t) => {
                        const byId = new Map(t.columns.map((c) => [c.id, c]));
                        const columns = mutation.orderedColumnIds
                           .map((id) => byId.get(id))
                           .filter((c): c is ColumnModel => Boolean(c));
                        return { ...t, columns };
                     });
                     break;
                  case 'index.created':
                     mapTable(mutation.tableId, (t) => {
                        const existing = t.indexes ?? [];
                        return existing.some((i) => i.id === mutation.index.id)
                           ? t
                           : { ...t, indexes: [...existing, mutation.index] };
                     });
                     break;
                  case 'index.updated':
                     mapTable(mutation.tableId, (t) => ({
                        ...t,
                        indexes: (t.indexes ?? []).map((i) => (i.id === mutation.index.id ? mutation.index : i)),
                     }));
                     break;
                  case 'index.deleted':
                     mapTable(mutation.tableId, (t) => ({
                        ...t,
                        indexes: (t.indexes ?? []).filter((i) => i.id !== mutation.indexId),
                     }));
                     break;
                  case 'index.reordered':
                     mapTable(mutation.tableId, (t) => {
                        const byId = new Map((t.indexes ?? []).map((i) => [i.id, i]));
                        const indexes = mutation.orderedIndexIds
                           .map((id) => byId.get(id))
                           .filter((i): i is IndexModel => Boolean(i));
                        return { ...t, indexes };
                     });
                     break;
                  case 'relationship.created':
                     setSchema((s) =>
                        s.relationships.some((r) => r.id === mutation.relationship.id)
                           ? s
                           : { ...s, relationships: [...s.relationships, mutation.relationship] }
                     );
                     break;
                  case 'relationship.updated':
                     setSchema((s) => ({
                        ...s,
                        relationships: s.relationships.map((r) =>
                           r.id === mutation.relationship.id ? mutation.relationship : r
                        ),
                     }));
                     break;
                  case 'relationship.deleted':
                     setSchema((s) => ({
                        ...s,
                        relationships: s.relationships.filter((r) => r.id !== mutation.relationshipId),
                     }));
                     break;
                  case 'element.created':
                     setSchema((s) =>
                        s.elements.some((e) => e.id === mutation.element.id)
                           ? s
                           : { ...s, elements: [...s.elements, mutation.element] }
                     );
                     break;
                  case 'element.updated':
                     setSchema((s) => {
                        const prev = s.elements.find((e) => e.id === mutation.element.id);
                        const elements = s.elements.map((e) => (e.id === mutation.element.id ? mutation.element : e));
                        // Elements draw in array order: a restack (new zIndex) re-sorts them.
                        const restacked = !!prev && prev.zIndex !== mutation.element.zIndex;
                        return { ...s, elements: restacked ? elements.sort((a, b) => a.zIndex - b.zIndex) : elements };
                     });
                     break;
                  case 'element.moved':
                     mapElement(mutation.elementId, (e) => ({
                        ...e,
                        ...(mutation.x !== undefined ? { x: mutation.x } : {}),
                        ...(mutation.y !== undefined ? { y: mutation.y } : {}),
                        ...(mutation.points !== undefined ? { points: mutation.points } : {}),
                     }));
                     break;
                  case 'element.deleted':
                     setSchema((s) => ({
                        ...s,
                        elements: clearBindingsTo(
                           s.elements.filter((e) => e.id !== mutation.elementId),
                           mutation.elementId
                        ),
                     }));
                     break;
                  case 'element.reordered':
                     setSchema((s) => {
                        const byId = new Map(s.elements.map((e) => [e.id, e]));
                        const ordered = mutation.orderedElementIds
                           .map((id, index) => {
                              const el = byId.get(id);
                              return el ? { ...el, zIndex: index } : undefined;
                           })
                           .filter((e): e is CanvasElementModel => Boolean(e));
                        // Keep any elements not named in the order (defensive) at the end.
                        const named = new Set(mutation.orderedElementIds);
                        const rest = s.elements.filter((e) => !named.has(e.id));
                        return { ...s, elements: [...ordered, ...rest] };
                     });
                     break;
                  case 'sequenceDiagram.created':
                     setSchema((s) =>
                        s.sequenceDiagrams.some((d) => d.id === mutation.diagram.id)
                           ? s
                           : { ...s, sequenceDiagrams: [...s.sequenceDiagrams, mutation.diagram] }
                     );
                     break;
                  case 'sequenceDiagram.updated':
                     mapDiagram(mutation.diagram.id, () => mutation.diagram);
                     break;
                  case 'sequenceDiagram.deleted':
                     setSchema((s) => ({
                        ...s,
                        sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== mutation.diagramId),
                        lifelines: s.lifelines.filter((l) => l.diagramId !== mutation.diagramId),
                        sequenceMessages: s.sequenceMessages.filter((m) => m.diagramId !== mutation.diagramId),
                     }));
                     break;
                  case 'lifeline.created':
                     setSchema((s) =>
                        s.lifelines.some((l) => l.id === mutation.lifeline.id)
                           ? s
                           : { ...s, lifelines: [...s.lifelines, mutation.lifeline] }
                     );
                     break;
                  case 'lifeline.updated':
                     mapLifeline(mutation.lifeline.id, () => mutation.lifeline);
                     break;
                  case 'lifeline.moved':
                     mapLifeline(mutation.lifelineId, (l) => ({ ...l, x: mutation.x }));
                     break;
                  case 'lifeline.deleted':
                     setSchema((s) => ({
                        ...s,
                        lifelines: s.lifelines.filter((l) => l.id !== mutation.lifelineId),
                        sequenceMessages: s.sequenceMessages.filter(
                           (m) => m.fromLifelineId !== mutation.lifelineId && m.toLifelineId !== mutation.lifelineId
                        ),
                     }));
                     break;
                  case 'message.created':
                     setSchema((s) =>
                        s.sequenceMessages.some((m) => m.id === mutation.message.id)
                           ? s
                           : { ...s, sequenceMessages: [...s.sequenceMessages, mutation.message] }
                     );
                     break;
                  case 'message.updated':
                     mapMessage(mutation.message.id, () => mutation.message);
                     break;
                  case 'message.moved':
                     mapMessage(mutation.messageId, (m) => ({ ...m, y: mutation.y }));
                     break;
                  case 'message.deleted':
                     setSchema((s) => ({
                        ...s,
                        sequenceMessages: s.sequenceMessages.filter((m) => m.id !== mutation.messageId),
                     }));
                     break;
                  case 'home.updated':
                     patchState(store, { home: mutation.home ?? null });
                     break;
                  case 'themes.updated':
                     patchState(store, { customThemes: mutation.themes });
                     break;
               }
            },

            /** Replace the project's custom theme library (shared with collaborators). */
            async setCustomThemes(themes: SlideTheme[]): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               patchState(store, { customThemes: themes });
               await runSave(() => firstValueFrom(projectsApi.updateThemes(projectId, { themes })));
            },

            /** Save (or clear, with null) the shared home view that reset-view returns to. */
            async setHome(home: ViewportModel | null): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               patchState(store, { home });
               await runSave(() => firstValueFrom(projectsApi.updateHome(projectId, { home })));
            },

            /** Select a table (or its whole group). additive (ctrl/shift) toggles it within the set. */
            selectTable(tableId: string, additive = false): void {
               if (!additive) {
                  applySelection({ tableIds: [tableId], elementIds: [], diagramIds: [] });
                  return;
               }
               toggleItem('table', tableId);
            },

            selectRelationship(relationshipId: string, additive = false): void {
               if (!additive) {
                  patchState(store, { selectedRelationshipIds: [relationshipId], selectedTableIds: [] });
                  return;
               }
               const current = store.selectedRelationshipIds();
               patchState(store, {
                  selectedRelationshipIds: current.includes(relationshipId)
                     ? current.filter((id) => id !== relationshipId)
                     : [...current, relationshipId],
               });
            },

            /** Select an element (or its whole group). additive (ctrl/shift) toggles it in the set. */
            selectElement(elementId: string, additive = false): void {
               if (!additive) {
                  applySelection({ tableIds: [], elementIds: [elementId], diagramIds: [] });
                  return;
               }
               toggleItem('element', elementId);
            },

            setSelection(
               tableIds: string[],
               relationshipIds: string[],
               elementIds: string[] = [],
               messageIds: string[] = [],
               lifelineIds: string[] = [],
               diagramIds: string[] = []
            ): void {
               // A message/lifeline of a grouped (not entered) diagram selects the diagram.
               const byItem = store.groupByItem();
               const entered = store.enteredGroupId();
               const s = store.schema();
               const diagrams = new Set(diagramIds);
               const lockedDiagram = (id: string | undefined): boolean => {
                  const gid = id ? byItem.get(id) : undefined;
                  return !!id && !!gid && gid !== entered;
               };
               const looseMessages = messageIds.filter((id) => {
                  const d = s?.sequenceMessages.find((m) => m.id === id)?.diagramId;
                  if (!lockedDiagram(d)) return true;
                  diagrams.add(d!);
                  return false;
               });
               const looseLifelines = lifelineIds.filter((id) => {
                  const d = s?.lifelines.find((l) => l.id === id)?.diagramId;
                  if (!lockedDiagram(d)) return true;
                  diagrams.add(d!);
                  return false;
               });
               const r = resolveGroups({ tableIds, elementIds, diagramIds: [...diagrams] });
               patchState(store, {
                  selectedTableIds: r.sel.tableIds,
                  selectedRelationshipIds: relationshipIds,
                  selectedElementIds: r.sel.elementIds,
                  selectedMessageIds: looseMessages,
                  selectedLifelineIds: looseLifelines,
                  selectedDiagramIds: r.sel.diagramIds,
                  enteredGroupId: r.entered,
               });
            },

            clearSelection(): void {
               patchState(store, {
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
                  enteredGroupId: null,
               });
            },

            // ================= Groups =================

            /** The live group an item belongs to (null when ungrouped). */
            groupIdOf(id: string): string | null {
               return store.groupByItem().get(id) ?? null;
            },

            /**
             * Step into an item's group: select just that item, leaving its siblings
             * individually selectable. No-op for an ungrouped item.
             */
            enterGroup(kind: GroupItemKind, id: string): void {
               const gid = store.groupByItem().get(id);
               if (!gid) return;
               patchState(store, {
                  selectedTableIds: kind === 'table' ? [id] : [],
                  selectedElementIds: kind === 'element' ? [id] : [],
                  selectedDiagramIds: kind === 'diagram' ? [id] : [],
                  selectedRelationshipIds: [],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  enteredGroupId: gid,
               });
            },

            /** Group the selected tables, elements and diagrams (existing groups merge in). */
            async groupSelection(): Promise<void> {
               const items = selectedItems();
               const byItem = store.groupByItem();
               const units = new Set(items.map((i) => byItem.get(i.id) ?? i.id));
               if (units.size < 2) return;
               const groupId = crypto.randomUUID();
               const before = items.map((i) => ({ ...i, groupId: rawGroupId(i.kind, i.id) }));
               const after = items.map((i) => ({ ...i, groupId }));
               patchState(store, { enteredGroupId: null });
               await setGroups(before, after);
            },

            /** Dissolve every group the selection touches; the items stay selected. */
            async ungroupSelection(): Promise<void> {
               const byItem = store.groupByItem();
               const groups = store.groups();
               const gids = new Set<string>();
               for (const i of selectedItems()) {
                  const g = byItem.get(i.id);
                  if (g) gids.add(g);
               }
               if (!gids.size) return;
               const members: { kind: GroupItemKind; id: string }[] = [];
               for (const gid of gids) {
                  const m = groups.get(gid);
                  if (!m) continue;
                  m.tableIds.forEach((id) => members.push({ kind: 'table', id }));
                  m.elementIds.forEach((id) => members.push({ kind: 'element', id }));
                  m.diagramIds.forEach((id) => members.push({ kind: 'diagram', id }));
               }
               const before = members.map((i) => ({ ...i, groupId: rawGroupId(i.kind, i.id) }));
               const after = members.map((i) => ({ ...i, groupId: null }));
               patchState(store, { enteredGroupId: null });
               await setGroups(before, after);
            },

            // ================= Sequence diagrams =================

            /** Select one sequence diagram (its bounding box, or its whole group). */
            selectSequence(diagramId: string): void {
               applySelection({ tableIds: [], elementIds: [], diagramIds: [diagramId] });
            },

            /** Add/remove a diagram (or its whole group) from the multi-selection. */
            toggleSequence(diagramId: string): void {
               patchState(store, { selectedRelationshipIds: [] });
               toggleItem('diagram', diagramId);
            },

            /** Positions of a diagram's lifelines/rows, captured at the start of a group move. */
            sequenceDiagramSnapshot(diagramId: string): {
               diagramId: string;
               startXs: Map<string, number>;
               startOriginY: number;
               startRows: Map<string, number>;
            } | null {
               const s = store.schema();
               const d = s?.sequenceDiagrams.find((x) => x.id === diagramId);
               if (!s || !d) return null;
               const base = d.originY + d.headerHeight;
               return {
                  diagramId,
                  startXs: new Map(s.lifelines.filter((l) => l.diagramId === diagramId).map((l) => [l.id, l.x])),
                  startOriginY: d.originY,
                  startRows: new Map(
                     s.sequenceMessages
                        .filter((m) => m.diagramId === diagramId)
                        .map((m) => [m.id, Math.max(1, Math.round((m.y - base) / d.rowSpacing))])
                  ),
               };
            },

            selectLifeline(lifelineId: string): void {
               patchState(store, {
                  selectedLifelineIds: [lifelineId],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  enteredGroupId: enteredFor(store.schema()?.lifelines.find((l) => l.id === lifelineId)?.diagramId),
               });
            },

            selectMessage(messageId: string): void {
               patchState(store, {
                  selectedMessageIds: [messageId],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  enteredGroupId: enteredFor(
                     store.schema()?.sequenceMessages.find((m) => m.id === messageId)?.diagramId
                  ),
               });
            },

            /** Add/remove one message from the message selection (shift/ctrl-click). */
            toggleMessage(messageId: string): void {
               const current = store.selectedMessageIds();
               patchState(store, {
                  selectedMessageIds: current.includes(messageId)
                     ? current.filter((id) => id !== messageId)
                     : [...current, messageId],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
                  enteredGroupId: enteredFor(
                     store.schema()?.sequenceMessages.find((m) => m.id === messageId)?.diagramId
                  ),
               });
            },

            /** Ask the canvas to open a message's inline label editor (toolbar pencil). */
            requestMessageEdit(messageId: string): void {
               patchState(store, { pendingMessageEditId: messageId });
            },
            clearMessageEditRequest(): void {
               patchState(store, { pendingMessageEditId: null });
            },

            /** Ask the canvas to open a lifeline's inline label editor (toolbar pencil). */
            requestLifelineEdit(lifelineId: string): void {
               patchState(store, { pendingLifelineEditId: lifelineId });
            },
            clearLifelineEditRequest(): void {
               patchState(store, { pendingLifelineEditId: null });
            },

            /** Drop a NEW sequence diagram at (x, y): its own group + two participants + a message. */
            async addSequenceStarter(x: number, y: number): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const diagram = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createDiagram(projectId, {
                        originY: y,
                        slideId: shownSlideAt(x, y),
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, diagram] }));
               const spacing = diagram.lifelineSpacing;
               const a = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId: diagram.id,
                        label: 'Participant 1',
                        x,
                        width: 120,
                        order: 0,
                        color: TABLE_PALETTE[0],
                     })
                  )
               );
               const b = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId: diagram.id,
                        label: 'Participant 2',
                        x: x + spacing,
                        width: 120,
                        order: 1,
                        color: TABLE_PALETTE[1],
                     })
                  )
               );
               // Seed one message so the diagram reads as a sequence immediately.
               const m = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createMessage(projectId, {
                        diagramId: diagram.id,
                        fromLifelineId: a.id,
                        toLifelineId: b.id,
                        y: y + diagram.headerHeight + diagram.rowSpacing,
                        style: 'solid',
                        direction: 'forward',
                        arrowhead: 'arrow',
                     })
                  )
               );
               setSchema((s) => ({
                  ...s,
                  lifelines: [...s.lifelines, a, b],
                  sequenceMessages: [...s.sequenceMessages, m],
               }));
               patchState(store, {
                  selectedDiagramIds: [diagram.id],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
               });
               recordSeqCreate('diagram', diagram.id);
            },

            /** Add a participant column to a diagram, on the given side of its spread. */
            /**
             * Add a participant. `at` is the insert position in left-to-right order
             * (0 = before the first, n = after the last); later participants slide
             * right by one spacing to make room.
             */
            async addLifeline(diagramId: string, at: number): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const diagram = store.sequenceDiagrams().find((d) => d.id === diagramId);
               const lls = store
                  .lifelines()
                  .filter((l) => l.diagramId === diagramId)
                  .sort((a, b) => a.x - b.x);
               const spacing = diagram?.lifelineSpacing ?? 160;
               const order = lls.length;
               const index = Math.max(0, Math.min(at, lls.length));
               let x = 0;
               const shifted: { id: string; from: number; to: number }[] = [];
               if (lls.length) {
                  if (index === 0) {
                     x = lls[0].x - spacing;
                  } else {
                     x = lls[index - 1].x + spacing;
                     for (const l of lls.slice(index)) {
                        const nx = l.x + spacing;
                        shifted.push({ id: l.id, from: l.x, to: nx });
                        mapLifeline(l.id, (m) => ({ ...m, x: nx }));
                        debounce(`llpos:${l.id}`, () => {
                           void runSave(() => firstValueFrom(sequenceApi.moveLifeline(projectId, l.id, { x: nx })));
                        });
                     }
                  }
               }
               const created = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId,
                        label: `Participant ${order + 1}`,
                        x,
                        width: 120,
                        order,
                        color: TABLE_PALETTE[order % TABLE_PALETTE.length],
                     })
                  )
               );
               setSchema((s) => ({ ...s, lifelines: [...s.lifelines, created] }));
               patchState(store, {
                  selectedLifelineIds: [created.id],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
               });
               let snap = captureSeq('lifeline', created.id);
               if (snap) {
                  pushHistory({
                     undo: async () => {
                        snap = captureSeq('lifeline', rid(created.id)) ?? snap;
                        await removeSeq('lifeline', rid(created.id));
                        shifted.forEach((s) => this.moveLifeline(rid(s.id), s.from));
                     },
                     redo: async () => {
                        await restoreSeq(snap!);
                        shifted.forEach((s) => this.moveLifeline(rid(s.id), s.to));
                     },
                  });
               }
            },

            async updateLifeline(
               lifelineId: string,
               patch: UpdateLifelineDto,
               /** Values to restore on undo when the local model was already changed live (drag). */
               prev?: UpdateLifelineDto
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const keys = Object.keys(patch);
               const current = store.lifelines().find((l) => l.id === lifelineId);
               const before = prev ? (prev as Record<string, unknown>) : current ? pickKeys(current, keys) : null;
               stage('lifelines', lifelineId, patch);
               mapLifeline(lifelineId, (l) => ({ ...l, ...(patch as Partial<LifelineModel>) }));
               const after = pickKeys({ ...current, ...patch }, keys);
               if (before && !sameValues(before, after)) {
                  pushHistory({
                     undo: () => this.updateLifeline(rid(lifelineId), before as UpdateLifelineDto),
                     redo: () => this.updateLifeline(rid(lifelineId), after as UpdateLifelineDto),
                  });
               }
            },

            /** Optimistic horizontal move; the position PATCH is debounced per lifeline. */
            moveLifeline(lifelineId: string, x: number): void {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               stage('lifelines', lifelineId, { x });
               mapLifeline(lifelineId, (l) => ({ ...l, x }));
            },

            /** Live (local-only) header width while dragging its edge; persist via updateLifeline. */
            setLifelineWidthLocal(lifelineId: string, width: number): void {
               mapLifeline(lifelineId, (l) => ({ ...l, width }));
            },

            async deleteLifeline(lifelineId: string): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const snap = captureSeq('lifeline', lifelineId);
               if ((await removeSeq('lifeline', lifelineId)) && snap) recordSeqDelete(snap);
            },

            /**
             * Create a message between two lifelines. `atY` is the world-y where the
             * connection was drawn; it snaps to the nearest row of the grid. Multiple
             * messages may share a row (simultaneous messages). Without `atY` it goes
             * on the row after the lowest existing one.
             */
            async addMessage(
               diagramId: string,
               fromLifelineId: string,
               toLifelineId: string,
               atY?: number
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               if (fromLifelineId === toLifelineId) {
                  return; // a message needs two different participants
               }
               const diagram = store.sequenceDiagrams().find((d) => d.id === diagramId);
               if (!diagram) {
                  return;
               }
               const base = diagram.originY + diagram.headerHeight;
               const gap = diagram.rowSpacing;
               const rowOf = (y: number) => Math.max(1, Math.round((y - base) / gap));
               const msgs = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
               const row = atY != null ? rowOf(atY) : msgs.length ? Math.max(...msgs.map((m) => rowOf(m.y))) + 1 : 1;
               const y = base + gap * row;
               const created = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createMessage(projectId, {
                        diagramId,
                        fromLifelineId,
                        toLifelineId,
                        y,
                        style: 'solid',
                        direction: 'forward',
                        arrowhead: 'arrow',
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, created] }));
               patchState(store, {
                  selectedMessageIds: [created.id],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
               });
               recordSeqCreate('message', created.id);
            },

            /**
             * Clone a whole sequence diagram (config, participants, messages) offset by
             * (dx, dy) and select the copy. Returns the new diagram id.
             */
            async duplicateSequence(diagramId: string, dx = 0, dy = 0): Promise<string | null> {
               const projectId = store.projectId();
               const src = store.sequenceDiagrams().find((d) => d.id === diagramId);
               if (!projectId || !src) {
                  return null;
               }
               const diagram = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createDiagram(projectId, {
                        originY: src.originY + dy,
                        lifelineSpacing: src.lifelineSpacing,
                        rowSpacing: src.rowSpacing,
                        headerHeight: src.headerHeight,
                        backgroundColor: src.backgroundColor,
                        title: src.title,
                        morphId: src.morphId,
                        zIndex: src.zIndex,
                        slideId: src.slideId,
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, diagram] }));
               patchState(store, {
                  selectedDiagramIds: [diagram.id],
                  selectedLifelineIds: [],
                  selectedMessageIds: [],
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
                  selectedElementIds: [],
               });
               const idMap = new Map<string, string>();
               const lifelines = store
                  .lifelines()
                  .filter((l) => l.diagramId === diagramId)
                  .sort((a, b) => a.order - b.order);
               for (const l of lifelines) {
                  const copy = await runSave(() =>
                     firstValueFrom(
                        sequenceApi.createLifeline(projectId, {
                           diagramId: diagram.id,
                           label: l.label,
                           color: l.color,
                           lineColor: l.lineColor,
                           strokeColor: l.strokeColor,
                           textColor: l.textColor,
                           morphId: l.morphId,
                           x: l.x + dx,
                           width: l.width,
                           order: l.order,
                        })
                     )
                  );
                  idMap.set(l.id, copy.id);
                  setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
               }
               const messages = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
               for (const m of messages) {
                  const from = idMap.get(m.fromLifelineId);
                  const to = idMap.get(m.toLifelineId);
                  if (!from || !to) {
                     continue;
                  }
                  const copy = await runSave(() =>
                     firstValueFrom(
                        sequenceApi.createMessage(projectId, {
                           diagramId: diagram.id,
                           fromLifelineId: from,
                           toLifelineId: to,
                           label: m.label,
                           y: m.y + dy,
                           style: m.style,
                           direction: m.direction,
                           arrowhead: m.arrowhead,
                           color: m.color,
                           wrap: m.wrap,
                           morphId: m.morphId,
                        })
                     )
                  );
                  setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
               }
               recordSeqCreate('diagram', diagram.id);
               return diagram.id;
            },

            /** Clone one participant column (same diagram, label and color) and select it. */
            async duplicateLifeline(lifelineId: string, dx = 0): Promise<string | null> {
               const projectId = store.projectId();
               const src = store.lifelines().find((l) => l.id === lifelineId);
               if (!projectId || !src) {
                  return null;
               }
               const order = store.lifelines().filter((l) => l.diagramId === src.diagramId).length;
               const copy = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createLifeline(projectId, {
                        diagramId: src.diagramId,
                        label: src.label,
                        color: src.color,
                        lineColor: src.lineColor,
                        strokeColor: src.strokeColor,
                        textColor: src.textColor,
                        morphId: src.morphId,
                        x: src.x + dx,
                        width: src.width,
                        order,
                     })
                  )
               );
               setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
               patchState(store, {
                  selectedLifelineIds: [copy.id],
                  selectedMessageIds: [],
                  selectedDiagramIds: [],
               });
               recordSeqCreate('lifeline', copy.id);
               return copy.id;
            },

            /** Clone one message (same endpoints, style and row) and select it. */
            async duplicateMessage(messageId: string, dy = 0): Promise<string | null> {
               const projectId = store.projectId();
               const src = store.sequenceMessages().find((m) => m.id === messageId);
               if (!projectId || !src) {
                  return null;
               }
               const copy = await runSave(() =>
                  firstValueFrom(
                     sequenceApi.createMessage(projectId, {
                        diagramId: src.diagramId,
                        fromLifelineId: src.fromLifelineId,
                        toLifelineId: src.toLifelineId,
                        label: src.label,
                        y: src.y + dy,
                        style: src.style,
                        direction: src.direction,
                        arrowhead: src.arrowhead,
                        color: src.color,
                        wrap: src.wrap,
                     })
                  )
               );
               setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
               patchState(store, {
                  selectedMessageIds: [copy.id],
                  selectedLifelineIds: [],
                  selectedDiagramIds: [],
               });
               recordSeqCreate('message', copy.id);
               return copy.id;
            },

            /** Delete one sequence diagram and all its participants + messages. */
            async deleteSequence(diagramId: string): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const snap = captureSeq('diagram', diagramId);
               if ((await removeSeq('diagram', diagramId)) && snap) recordSeqDelete(snap);
            },

            async updateMessage(messageId: string, patch: UpdateSequenceMessageDto): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const keys = Object.keys(patch);
               const current = store.sequenceMessages().find((m) => m.id === messageId);
               const before = current ? pickKeys(current, keys) : null;
               stage('messages', messageId, patch);
               mapMessage(messageId, (m) => ({ ...m, ...(patch as Partial<SequenceMessageModel>) }));
               const after = pickKeys({ ...current, ...patch }, keys);
               if (before && !sameValues(before, after)) {
                  pushHistory({
                     undo: () => this.updateMessage(rid(messageId), resolveRefs(before) as UpdateSequenceMessageDto),
                     redo: () => this.updateMessage(rid(messageId), resolveRefs(after) as UpdateSequenceMessageDto),
                  });
               }
            },

            /** Optimistic vertical move; the position PATCH is debounced per message. */
            moveMessage(messageId: string, y: number): void {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               stage('messages', messageId, { y });
               mapMessage(messageId, (m) => ({ ...m, y }));
            },

            async deleteMessage(messageId: string): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const snap = captureSeq('message', messageId);
               if ((await removeSeq('message', messageId)) && snap) recordSeqDelete(snap);
            },

            /** Update one diagram's layout config (spacing / origin), persisted. */
            async updateSequenceConfig(diagramId: string, patch: UpdateSequenceDiagramDto): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               // Move/resize gestures record their own layout step; only the appearance
               // settings are recorded here.
               const keys = Object.keys(patch).filter((k) =>
                  ['backgroundColor', 'borderColor', 'lifelineSpacing', 'headerHeight', 'title', 'morphId'].includes(k)
               );
               const current = store.sequenceDiagrams().find((d) => d.id === diagramId);
               const before = current && keys.length ? pickKeys(current, keys) : null;
               patchDiagramLocal(diagramId, patch);
               const after = before ? pickKeys({ ...current, ...patch }, keys) : null;
               if (before && after && !sameValues(before, after)) {
                  pushHistory({
                     undo: () => this.updateSequenceConfig(rid(diagramId), before as UpdateSequenceDiagramDto),
                     redo: () => this.updateSequenceConfig(rid(diagramId), after as UpdateSequenceDiagramDto),
                  });
               }
            },

            /** Record a completed diagram move/resize (already applied) so it can be undone. */
            recordSequenceLayout(
               diagramId: string,
               before: SequenceLayoutSnapshot,
               after: SequenceLayoutSnapshot
            ): void {
               const apply = (snap: SequenceLayoutSnapshot): void => {
                  for (const [id, x] of snap.lifelineXs) {
                     this.moveLifeline(id, x);
                  }
                  for (const [id, y] of snap.messageYs) {
                     this.moveMessage(id, y);
                  }
                  void this.updateSequenceConfig(diagramId, {
                     rowSpacing: snap.rowSpacing,
                     originY: snap.originY,
                  });
               };
               pushHistory({ undo: () => apply(before), redo: () => apply(after) });
            },

            /**
             * Live (local-only) shift of one diagram: every lifeline's x plus the row
             * origin, and every message moves with it (kept on its row via `startRows`),
             * so the diagram translates as a whole. Persist on drag end.
             */
            shiftSequence(
               diagramId: string,
               startXs: ReadonlyMap<string, number>,
               dx: number,
               startOriginY: number,
               dy: number,
               startRows: ReadonlyMap<string, number>
            ): void {
               setSchema((s) => shiftSequenceIn(s, { diagramId, startXs, dx, startOriginY, dy, startRows }));
            },

            /**
             * Move elements, tables, relationship waypoints and sequence diagrams together:
             * one state write per drag frame (one pass per collection) instead of one per
             * item. Element/table/waypoint rows are staged for the batch save like
             * `moveElement`/`moveTable`/`setWaypoints`; sequence shifts stay local (persist
             * them when the gesture ends).
             */
            moveItemsLocal(moves: ItemMoves): void {
               for (const [id, p] of moves.elements ?? []) stage('elements', id, { x: p.x, y: p.y });
               for (const [id, p] of moves.tables ?? []) stage('tables', id, { x: p.x, y: p.y });
               for (const [id, waypoints] of moves.waypoints ?? []) stage('relationships', id, { waypoints });
               setSchema((s) => applyItemMoves(s, moves));
            },

            /**
             * Live (local-only) resize of one diagram: each lifeline's x is scaled
             * around `anchorX` by `scaleX`, the vertical size is set via `rowSpacing` +
             * `originY`, and messages are re-spaced to keep their rows. Persist on end.
             */
            resizeSequenceTo(
               diagramId: string,
               startXs: ReadonlyMap<string, number>,
               anchorX: number,
               scaleX: number,
               rowSpacing: number,
               originY: number,
               startRows: ReadonlyMap<string, number>
            ): void {
               setSchema((s) => {
                  const d = s.sequenceDiagrams.find((x) => x.id === diagramId);
                  const base = originY + (d?.headerHeight ?? 42);
                  return {
                     ...s,
                     lifelines: s.lifelines.map((l) =>
                        l.diagramId === diagramId
                           ? { ...l, x: anchorX + ((startXs.get(l.id) ?? l.x) - anchorX) * scaleX }
                           : l
                     ),
                     sequenceMessages: s.sequenceMessages.map((m) =>
                        m.diagramId === diagramId && startRows.has(m.id)
                           ? { ...m, y: base + rowSpacing * (startRows.get(m.id) ?? 1) }
                           : m
                     ),
                     sequenceDiagrams: s.sequenceDiagrams.map((x) =>
                        x.id === diagramId ? { ...x, rowSpacing, originY } : x
                     ),
                  };
               });
            },

            async addTable(x: number, y: number): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const name = uniqueTableName(store.tables());
               const color = TABLE_PALETTE[store.tables().length % TABLE_PALETTE.length];
               const created = await runSave(() =>
                  firstValueFrom(
                     tablesApi.create(projectId, {
                        name,
                        x,
                        y,
                        color,
                        slideId: shownSlideAt(x, y),
                     })
                  )
               );
               setSchema((s) => ({ ...s, tables: [...s.tables, created] }));
               patchState(store, { selectedTableIds: [created.id], selectedRelationshipIds: [] });
            },

            /** Optimistic local move; the position PATCH is debounced per table. */
            moveTable(tableId: string, x: number, y: number): void {
               stage('tables', tableId, { x, y });
               mapTable(tableId, (t) => ({ ...t, x, y }));
            },

            /** Live (local-only) scale while dragging a corner; persist via updateTable. */
            setTableScaleLocal(tableId: string, scale: number | undefined): void {
               mapTable(tableId, (t) => ({ ...t, scale }));
            },

            async updateTable(tableId: string, patch: UpdateTableDto): Promise<void> {
               patchTableLocal(tableId, patch);
            },

            async deleteTable(tableId: string): Promise<void> {
               flushTimers(`pos:${tableId}`, `patch:table:${tableId}`);
               await optimistic(
                  `table:${tableId}`,
                  () => {
                     setSchema((s) => ({ ...s, tables: s.tables.filter((t) => t.id !== tableId) }));
                     patchState(store, {
                        selectedTableIds: store.selectedTableIds().filter((id) => id !== tableId),
                     });
                  },
                  () => firstValueFrom(tablesApi.remove(tableId)),
                  'delete the table'
               );
            },

            /** Duplicate a table (offset copy) with all its columns; selects the copy. */
            async duplicateTable(
               tableId: string,
               dx = 40,
               dy = 40,
               select = true,
               waitForColumns = true,
               columnMap?: Map<string, string>
            ): Promise<string | null> {
               const projectId = store.projectId();
               const source = store.tables().find((t) => t.id === tableId);
               if (!projectId || !source) {
                  return null;
               }
               const created = await runSave(() =>
                  firstValueFrom(
                     tablesApi.create(projectId, {
                        name: source.name,
                        x: source.x + dx,
                        y: source.y + dy,
                        color: source.color ?? undefined,
                        slideId: source.slideId,
                        morphId: source.morphId,
                     })
                  )
               );
               // Show the copy as soon as the table exists; columns stream in after, so
               // an Alt-drag can grab it immediately instead of waiting on N round trips.
               setSchema((s) => ({ ...s, tables: [...s.tables, created] }));
               if (source.scale && source.scale !== 1) {
                  mapTable(created.id, (t) => ({ ...t, scale: source.scale }));
                  void tablesApi.update(created.id, { scale: source.scale }).subscribe();
               }
               if (select) {
                  patchState(store, {
                     selectedTableIds: [created.id],
                     selectedRelationshipIds: [],
                     selectedElementIds: [],
                  });
               }
               const fillColumns = (async () => {
                  for (const col of source.columns) {
                     const newCol = await firstValueFrom(
                        columnsApi.create(created.id, {
                           name: col.name,
                           dataType: col.dataType,
                           isPrimaryKey: col.isPrimaryKey,
                           isNullable: col.isNullable,
                           isUnique: col.isUnique,
                           isAutoIncrement: col.isAutoIncrement,
                        })
                     );
                     columnMap?.set(col.id, newCol.id);
                     mapTable(created.id, (t) => ({ ...t, columns: [...t.columns, newCol] }));
                  }
               })();
               if (waitForColumns) {
                  await fillColumns;
               } else {
                  void fillColumns;
               }
               return created.id;
            },

            /** Record a finished table scale gesture (scale + position, already applied). */
            recordTableScale(changes: { id: string; before: TableGeometry; after: TableGeometry }[]): void {
               const moved = changes.filter(
                  (c) => c.before.scale !== c.after.scale || c.before.x !== c.after.x || c.before.y !== c.after.y
               );
               if (!moved.length) return;
               const apply = (which: 'before' | 'after'): void => {
                  for (const c of moved) {
                     const g = c[which];
                     if (store.tables().some((t) => t.id === c.id)) {
                        patchTableLocal(c.id, { scale: g.scale });
                        this.moveTable(c.id, g.x, g.y);
                     }
                  }
               };
               pushHistory({ undo: () => apply('before'), redo: () => apply('after') });
            },

            async addColumn(tableId: string, dto: CreateColumnDto): Promise<void> {
               const created = await runSave(() => firstValueFrom(columnsApi.create(tableId, dto)));
               mapTable(tableId, (t) => ({ ...t, columns: [...t.columns, created] }));
               const snap: ColumnSnapshot = { tableId, column: created, index: -1, relationships: [] };
               pushHistory({
                  undo: async () => {
                     const s = captureColumn(tableId, rid(created.id));
                     if (s) Object.assign(snap, s, { column: { ...s.column, id: created.id } });
                     await removeColumnRaw(tableId, rid(created.id));
                  },
                  redo: () => restoreColumn(snap),
               });
            },

            async updateColumn(tableId: string, columnId: string, patch: UpdateColumnDto): Promise<void> {
               commitPatch(
                  `patch:col:${columnId}`,
                  `table:${tableId}`,
                  tableId,
                  patch,
                  (p) => firstValueFrom(columnsApi.update(columnId, p)),
                  'save the column'
               );
               mapTable(tableId, (t) => ({
                  ...t,
                  columns: t.columns.map((c) => (c.id === columnId ? { ...c, ...(patch as Partial<ColumnModel>) } : c)),
               }));
            },

            async deleteColumn(tableId: string, columnId: string): Promise<void> {
               const snap = captureColumn(tableId, columnId);
               await removeColumnRaw(tableId, columnId);
               if (
                  !snap ||
                  store
                     .tables()
                     .find((t) => t.id === tableId)
                     ?.columns.some((c) => c.id === columnId)
               ) {
                  return; // rolled back
               }
               pushHistory({
                  undo: () => restoreColumn(snap),
                  redo: async () => {
                     const s = captureColumn(tableId, rid(columnId));
                     if (s) Object.assign(snap, s, { column: { ...s.column, id: columnId } });
                     await removeColumnRaw(tableId, rid(columnId));
                  },
               });
            },

            /** Reorder columns optimistically; persist the new order (debounced). */
            reorderColumns(tableId: string, orderedColumnIds: string[]): void {
               mapTable(tableId, (t) => {
                  const byId = new Map(t.columns.map((c) => [c.id, c]));
                  const columns = orderedColumnIds
                     .map((id) => byId.get(id))
                     .filter((c): c is ColumnModel => Boolean(c));
                  return { ...t, columns };
               });
               debounce(`reorder:${tableId}`, () => {
                  void runSave(() => firstValueFrom(columnsApi.reorder(tableId, { orderedColumnIds })));
               });
            },

            async addIndex(tableId: string, dto: CreateIndexDto): Promise<void> {
               const created = await runSave(() => firstValueFrom(indexesApi.create(tableId, dto)));
               mapTable(tableId, (t) => ({ ...t, indexes: [...(t.indexes ?? []), created] }));
            },

            async updateIndex(tableId: string, indexId: string, patch: UpdateIndexDto): Promise<void> {
               commitPatch(
                  `patch:index:${indexId}`,
                  `table:${tableId}`,
                  tableId,
                  patch,
                  (p) => firstValueFrom(indexesApi.update(indexId, p)),
                  'save the index'
               );
               mapTable(tableId, (t) => ({
                  ...t,
                  indexes: (t.indexes ?? []).map((i) => (i.id === indexId ? ({ ...i, ...patch } as typeof i) : i)),
               }));
            },

            async deleteIndex(tableId: string, indexId: string): Promise<void> {
               flushTimers(`patch:index:${indexId}`);
               await optimistic(
                  `table:${tableId}`,
                  () =>
                     mapTable(tableId, (t) => ({
                        ...t,
                        indexes: (t.indexes ?? []).filter((i) => i.id !== indexId),
                     })),
                  () => firstValueFrom(indexesApi.remove(indexId)),
                  'delete the index'
               );
            },

            /**
             * Pan/zoom. Personal view state: remembered in this browser per project (debounced),
             * never sent to the server. Guide sandboxes keep it in their local stand-in backend.
             */
            setViewport(x: number, y: number, zoom: number): void {
               const viewport = { x, y, zoom };
               patchState(store, { viewport });
               const projectId = store.projectId();
               if (!projectId || !store.schema()) {
                  return;
               }
               if (isSandboxId(projectId)) {
                  debounce('viewport', () => {
                     void runSave(() =>
                        firstValueFrom(projectsApi.updateViewport(projectId, { viewportX: x, viewportY: y, zoom }))
                     );
                  });
                  return;
               }
               pendingViewport = { projectId, viewport };
               debounce('viewport', flushViewport, VIEWPORT_SAVE_MS);
            },

            async addRelationship(
               sourceColumnId: string,
               targetColumnId: string,
               type: RelationshipType = 'ONE_TO_MANY',
               routing: Pick<CreateRelationshipDto, 'sourceSide' | 'targetSide' | 'autoRoute'> = {}
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const created = await runSave(() =>
                  firstValueFrom(
                     relationshipsApi.create(projectId, {
                        sourceColumnId,
                        targetColumnId,
                        type,
                        ...routing,
                     })
                  )
               );
               setSchema((s) => ({ ...s, relationships: [...s.relationships, created] }));
               patchState(store, { selectedRelationshipIds: [created.id], selectedTableIds: [] });
            },

            /**
             * Clone relationships onto cloned tables. `columnMap` maps original column
             * ids to their copies; only relationships with both endpoints mapped are
             * cloned. Returns the new relationship ids.
             */
            async duplicateRelationships(
               sources: RelationshipModel[],
               columnMap: Map<string, string>
            ): Promise<string[]> {
               const projectId = store.projectId();
               if (!projectId) {
                  return [];
               }
               const ids: string[] = [];
               for (const rel of sources) {
                  const sourceColumnId = columnMap.get(rel.sourceColumnId);
                  const targetColumnId = columnMap.get(rel.targetColumnId);
                  if (!sourceColumnId || !targetColumnId) {
                     continue;
                  }
                  let created = await runSave(() =>
                     firstValueFrom(
                        relationshipsApi.create(projectId, {
                           sourceColumnId,
                           targetColumnId,
                           type: rel.type,
                           onDelete: rel.onDelete,
                           onUpdate: rel.onUpdate,
                           sourceSide: rel.sourceSide,
                           targetSide: rel.targetSide,
                           autoRoute: rel.autoRoute,
                        })
                     )
                  );
                  if (rel.waypoints?.length) {
                     const waypoints = rel.waypoints.map((w) => ({ ...w }));
                     created = await runSave(() => firstValueFrom(relationshipsApi.update(created.id, { waypoints })));
                  }
                  setSchema((s) => ({ ...s, relationships: [...s.relationships, created] }));
                  ids.push(created.id);
               }
               return ids;
            },

            async updateRelationship(id: string, patch: UpdateRelationshipDto): Promise<void> {
               if (patch.sourceColumnId !== undefined || patch.targetColumnId !== undefined) {
                  commitPatch(
                     `patch:rel:${id}`,
                     `rel:${id}`,
                     id,
                     patch,
                     (p) => firstValueFrom(relationshipsApi.update(id, p)),
                     'save the relationship'
                  );
               } else {
                  stage('relationships', id, patch);
               }
               setSchema((s) => ({
                  ...s,
                  relationships: s.relationships.map((r: RelationshipModel) =>
                     r.id === id ? ({ ...r, ...patch } as RelationshipModel) : r
                  ),
               }));
            },

            /** Optimistic local routing; the waypoints PATCH is debounced per relationship. */
            setWaypoints(id: string, waypoints: PointModel[]): void {
               stage('relationships', id, { waypoints });
               setSchema((s) => ({
                  ...s,
                  relationships: s.relationships.map((r: RelationshipModel) => (r.id === id ? { ...r, waypoints } : r)),
               }));
            },

            async deleteRelationship(id: string): Promise<void> {
               flushTimers(`wp:${id}`, `patch:rel:${id}`);
               await optimistic(
                  `rel:${id}`,
                  () => {
                     setSchema((s) => ({
                        ...s,
                        relationships: s.relationships.filter((r: RelationshipModel) => r.id !== id),
                     }));
                     patchState(store, {
                        selectedRelationshipIds: store.selectedRelationshipIds().filter((rid) => rid !== id),
                     });
                  },
                  () => firstValueFrom(relationshipsApi.remove(id)),
                  'delete the relationship'
               );
            },

            // --- Canvas elements (excalidraw-style drawing layer) ---

            /** Update the sticky style applied to subsequently drawn elements. */
            /** Persist an element patch without an undo step (automatic bookkeeping). */
            async patchElementSilently(elementId: string, patch: UpdateElementDto): Promise<void> {
               await updateElementRaw(elementId, patch);
            },

            /**
             * Put things on a slide without recording undo steps: used to adopt content
             * that was dropped or moved into the shown slide's frame.
             */
            async assignSlide(
               items: { elements: string[]; tables: string[]; diagrams: string[] },
               slideId: string | null
            ): Promise<void> {
               const projectId = store.projectId();
               for (const id of items.elements) {
                  void updateElementRaw(id, { slideId });
               }
               for (const id of items.tables) {
                  patchTableLocal(id, { slideId });
               }
               if (projectId) {
                  for (const id of items.diagrams) {
                     patchDiagramLocal(id, { slideId });
                  }
               }
            },

            /** Choose which slide is shown on the canvas. */
            setActiveSlide(id: string | null): void {
               // Showing a slide also selects the presentation it belongs to.
               const frame = id ? store.slideFrames().find((f) => f.id === id) : undefined;
               patchState(store, {
                  activeSlideKey: id,
                  ...(frame
                     ? {
                          selectedPresentationKey: presentationOf(frame),
                          shownByPresentationKey: {
                             ...store.shownByPresentationKey(),
                             [presentationOf(frame)]: frame.id,
                          },
                       }
                     : {}),
               });
            },

            /** The zoomed-out slide under the pointer (see `shownSlideAt`). */
            setPointerSlide(id: string | null): void {
               pointerSlide = id;
            },

            /** Zoom a presentation's slide view inside its block (view state, not saved). */
            setSlideZoom(name: string, scale: number): void {
               const s = Math.min(1, Math.max(MIN_SLIDE_ZOOM, scale));
               const { [name]: _old, ...rest } = store.slideZoom();
               patchState(store, { slideZoom: s >= 0.999 ? rest : { ...rest, [name]: s } });
            },

            /** Make a presentation the selected one (F5, export); it keeps the slide it shows. */
            selectPresentation(name: string): void {
               if (store.presentation() === name) {
                  return;
               }
               patchState(store, {
                  selectedPresentationKey: name,
                  activeSlideKey: store.shownByPresentation().get(name) ?? store.activeSlideKey(),
               });
            },

            setElementStyle(patch: Partial<ElementStyleState>): void {
               patchState(store, { elementStyle: { ...store.elementStyle(), ...patch } });
            },

            /** Create an element without an undo step or selection (automatic bookkeeping). */
            async addElementSilently(dto: CreateElementDto): Promise<CanvasElementModel | null> {
               return createElementRaw(dto);
            },

            /** Delete an element without an undo step (automatic bookkeeping). */
            async deleteElementSilently(elementId: string): Promise<void> {
               await deleteElementRaw(elementId);
            },

            /** Create an element and persist it. Selects it unless `select` is false. */
            async addElement(dto: CreateElementDto, select = true): Promise<CanvasElementModel | null> {
               const created = await createElementRaw(dto);
               if (!created) {
                  return null;
               }
               if (select) {
                  patchState(store, {
                     selectedElementIds: [created.id],
                     selectedTableIds: [],
                     selectedRelationshipIds: [],
                  });
               }
               // Undo removes it; redo re-creates from the creation snapshot (new id).
               const ref = { id: created.id };
               pushHistory({
                  undo: async () => {
                     await deleteElementRaw(ref.id);
                  },
                  redo: async () => {
                     const again = await createElementRaw(elementToCreateDto(created));
                     if (again) {
                        ref.id = again.id;
                     }
                  },
               });
               return created;
            },

            /**
             * Clone tables (with the relationships between them), sequence diagrams and
             * elements by (dx, dy) as ONE optimistic write: every copy gets a client id and
             * shows at once, a single POST /clone persists them in one transaction (all
             * copies are removed again if it fails), and one undo step removes them.
             * Content of a copied slide belongs to the copied slide. `presentation` moves
             * copied slides into that presentation (keeping their order). Relationships
             * between copied tables are copied too (only `relationshipIds` when given).
             */
            cloneItems(
               tableIds: ReadonlySet<string>,
               diagramIds: ReadonlySet<string>,
               sources: readonly CanvasElementModel[],
               dx: number,
               dy: number,
               opts: { presentation?: string; relationshipIds?: ReadonlySet<string> } = {}
            ): {
               copies: Map<string, CanvasElementModel>;
               tables: Map<string, string>;
               diagrams: Map<string, string>;
               relationships: string[];
            } {
               const { presentation, relationshipIds } = opts;
               const projectId = store.projectId();
               const schema = store.schema();
               const empty = { copies: new Map(), tables: new Map(), diagrams: new Map(), relationships: [] };
               if (!projectId || !schema) {
                  return empty;
               }
               const uid = () => crypto.randomUUID();
               // Every copied row's id, keyed by its source id (elements, tables, diagrams, children).
               const copyOf = new Map<string, string>();
               for (const e of sources) copyOf.set(e.id, uid());
               const srcTables = schema.tables.filter((t) => tableIds.has(t.id));
               const srcDiagrams = schema.sequenceDiagrams.filter((d) => diagramIds.has(d.id));
               for (const t of srcTables) copyOf.set(t.id, uid());
               for (const d of srcDiagrams) copyOf.set(d.id, uid());
               const ownerOf = (slideId: string | undefined): string | null =>
                  slideId ? (copyOf.get(slideId) ?? slideId) : null;
               const body: CloneItemsDto = {
                  dx,
                  dy,
                  tables: [],
                  relationships: [],
                  diagrams: [],
                  elements: [],
               };
               const tables: TableModel[] = [];
               const columnMap = new Map<string, string>();
               for (const t of srcTables) {
                  const columns: Record<string, string> = {};
                  const indexes: Record<string, string> = {};
                  const cols = t.columns.map((c) => {
                     columns[c.id] = uid();
                     columnMap.set(c.id, columns[c.id]);
                     return { ...c, id: columns[c.id] };
                  });
                  const idx = (t.indexes ?? []).map((x) => {
                     indexes[x.id] = uid();
                     return {
                        ...x,
                        id: indexes[x.id],
                        columnIds: x.columnIds.map((c) => columnMap.get(c) ?? c),
                     };
                  });
                  const id = copyOf.get(t.id)!;
                  const slideId = ownerOf(t.slideId);
                  body.tables!.push({ sourceId: t.id, id, slideId, columns, indexes });
                  tables.push({
                     ...t,
                     id,
                     x: t.x + dx,
                     y: t.y + dy,
                     groupId: undefined,
                     slideId: slideId ?? undefined,
                     columns: cols,
                     indexes: idx,
                  });
               }
               const relationships: RelationshipModel[] = [];
               for (const r of schema.relationships) {
                  const sourceColumnId = columnMap.get(r.sourceColumnId);
                  const targetColumnId = columnMap.get(r.targetColumnId);
                  if (!sourceColumnId || !targetColumnId) continue;
                  if (relationshipIds && !relationshipIds.has(r.id)) continue;
                  const id = uid();
                  body.relationships!.push({ sourceId: r.id, id });
                  relationships.push({
                     ...r,
                     id,
                     sourceColumnId,
                     targetColumnId,
                     waypoints: r.waypoints?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                  });
               }
               const diagrams: SequenceDiagramModel[] = [];
               const lifelines: LifelineModel[] = [];
               const messages: SequenceMessageModel[] = [];
               for (const d of srcDiagrams) {
                  const id = copyOf.get(d.id)!;
                  const slideId = ownerOf(d.slideId);
                  const lifelineIds: Record<string, string> = {};
                  const messageIds: Record<string, string> = {};
                  for (const l of schema.lifelines.filter((x) => x.diagramId === d.id)) {
                     lifelineIds[l.id] = uid();
                     lifelines.push({ ...l, id: lifelineIds[l.id], diagramId: id, x: l.x + dx });
                  }
                  for (const m of schema.sequenceMessages.filter((x) => x.diagramId === d.id)) {
                     const from = lifelineIds[m.fromLifelineId];
                     const to = lifelineIds[m.toLifelineId];
                     if (!from || !to) continue;
                     messageIds[m.id] = uid();
                     messages.push({
                        ...m,
                        id: messageIds[m.id],
                        diagramId: id,
                        fromLifelineId: from,
                        toLifelineId: to,
                        y: m.y + dy,
                     });
                  }
                  body.diagrams!.push({
                     sourceId: d.id,
                     id,
                     slideId,
                     lifelines: lifelineIds,
                     messages: messageIds,
                  });
                  diagrams.push({
                     ...d,
                     id,
                     originY: d.originY + dy,
                     groupId: undefined,
                     slideId: slideId ?? undefined,
                  });
               }
               // Bindings follow copied targets; bindings to anything else are dropped.
               const remap = (b: CanvasElementModel['startBinding']) =>
                  b && copyOf.has(b.targetId) ? { ...b, targetId: copyOf.get(b.targetId)! } : null;
               const frameNames = schema.elements
                  .filter((e) => e.type === 'frame' && e.text)
                  .map((e) => e.text as string);
               const baseZ = schema.elements.reduce((m, e) => Math.max(m, e.zIndex + 1), 0);
               const ordered = [...sources].sort((a, b) => a.zIndex - b.zIndex);
               const copies = new Map<string, CanvasElementModel>();
               for (const [i, src] of ordered.entries()) {
                  const id = copyOf.get(src.id)!;
                  const slide = src.slide
                     ? {
                          ...src.slide,
                          ...(presentation !== undefined ? { presentation } : { order: src.slide.order + 0.01 }),
                          ...(src.slide.animations?.length
                             ? { animations: remapAnimations(src.slide.animations, copyOf) }
                             : {}),
                       }
                     : undefined;
                  const text =
                     src.type === 'frame' && src.text && !src.slide ? nextCopyName(src.text, frameNames) : src.text;
                  const copy: CanvasElementModel = {
                     ...src,
                     id,
                     x: src.x + dx,
                     y: src.y + dy,
                     zIndex: baseZ + i,
                     groupId: undefined,
                     // Copies share their source's lineage so they morph with it.
                     morphId: src.morphId ?? src.id,
                     slideId: src.type === 'frame' ? undefined : (ownerOf(src.slideId) ?? undefined),
                     slide,
                     text,
                     startBinding: remap(src.startBinding) ?? undefined,
                     endBinding: remap(src.endBinding) ?? undefined,
                  };
                  copies.set(src.id, copy);
                  body.elements!.push({
                     sourceId: src.id,
                     id,
                     slideId: copy.slideId ?? null,
                     slide: slide ?? null,
                     morphId: copy.morphId ?? null,
                     zIndex: copy.zIndex,
                     text: copy.text ?? null,
                     startBinding: copy.startBinding ?? null,
                     endBinding: copy.endBinding ?? null,
                  });
               }
               const created = {
                  tables,
                  relationships,
                  sequenceDiagrams: diagrams,
                  lifelines,
                  sequenceMessages: messages,
                  elements: [...copies.values()],
               };
               const ids = {
                  tables: tables.map((t) => t.id),
                  relationships: relationships.map((r) => r.id),
                  diagrams: diagrams.map((d) => d.id),
                  elements: created.elements.map((e) => e.id),
               };
               const add = () =>
                  setSchema((s) => ({
                     ...s,
                     tables: [...s.tables, ...created.tables],
                     relationships: [...s.relationships, ...created.relationships],
                     sequenceDiagrams: [...s.sequenceDiagrams, ...created.sequenceDiagrams],
                     lifelines: [...s.lifelines, ...created.lifelines],
                     sequenceMessages: [...s.sequenceMessages, ...created.sequenceMessages],
                     elements: [...s.elements, ...created.elements],
                  }));
               const remove = () => {
                  const gone = new Set([...ids.tables, ...ids.relationships, ...ids.diagrams, ...ids.elements]);
                  setSchema((s) => ({
                     ...s,
                     tables: s.tables.filter((t) => !gone.has(t.id)),
                     relationships: s.relationships.filter((r) => !gone.has(r.id)),
                     sequenceDiagrams: s.sequenceDiagrams.filter((d) => !gone.has(d.id)),
                     lifelines: s.lifelines.filter((l) => !gone.has(l.diagramId)),
                     sequenceMessages: s.sequenceMessages.filter((m) => !gone.has(m.diagramId)),
                     elements: s.elements.filter((e) => !gone.has(e.id)),
                  }));
                  patchState(store, {
                     selectedElementIds: store.selectedElementIds().filter((x) => !gone.has(x)),
                     selectedTableIds: store.selectedTableIds().filter((x) => !gone.has(x)),
                     selectedDiagramIds: store.selectedDiagramIds().filter((x) => !gone.has(x)),
                  });
               };
               const persist = () => {
                  add();
                  void enqueue('clone', () => runSave(() => firstValueFrom(projectsApi.clone(projectId, body)))).catch(
                     () => {
                        remove();
                        notifyFailure('copy those items');
                     }
                  );
               };
               persist();
               pushHistory({
                  undo: async () => {
                     flushTimers('batch');
                     remove();
                     void enqueue('clone', () =>
                        runSave(() =>
                           firstValueFrom(
                              projectsApi.batch(projectId, {
                                 deletes: {
                                    elements: ids.elements,
                                    relationships: ids.relationships,
                                    diagrams: ids.diagrams,
                                    tables: ids.tables,
                                 },
                              })
                           )
                        )
                     ).catch(() => notifyFailure('undo the copy'));
                  },
                  redo: async () => persist(),
               });
               return {
                  copies,
                  tables: new Map(srcTables.map((t) => [t.id, copyOf.get(t.id)!])),
                  diagrams: new Map(srcDiagrams.map((d) => [d.id, copyOf.get(d.id)!])),
                  relationships: ids.relationships,
               };
            },

            /**
             * Clone elements (copy/paste, Alt-drag) offset by (dx, dy) and select the
             * copies. Bindings to elements that were also cloned are remapped to their
             * copies; bindings to anything else are dropped so a copied arrow keeps its
             * own geometry. One undo step removes every copy.
             */
            async duplicateElements(
               sources: CanvasElementModel[],
               dx: number,
               dy: number
            ): Promise<Map<string, CanvasElementModel>> {
               if (!sources.length) {
                  return new Map();
               }
               // Frames first, so what belongs to a copied slide can be pointed at its copy.
               const ordered = [...sources].sort(
                  (a, b) => (b.type === 'frame' ? 1 : 0) - (a.type === 'frame' ? 1 : 0) || a.zIndex - b.zIndex
               );
               const idMap = new Map<string, string>();
               const copiesBySource = new Map<string, CanvasElementModel>();
               const created: CanvasElementModel[] = [];
               const baseZ = store.elements().length;
               for (const src of ordered) {
                  const dto = elementToCreateDto(src);
                  const remap = (b: CanvasElementModel['startBinding']) =>
                     b && b.targetKind === 'element' && idMap.has(b.targetId)
                        ? { ...b, targetId: idMap.get(b.targetId)! }
                        : null;
                  const copy = await createElementRaw({
                     ...dto,
                     // Copies share their source's lineage so they morph with it, and a
                     // copied slide lands right after its source in the sequence.
                     morphId: src.morphId ?? src.id,
                     slideId: src.slideId && idMap.has(src.slideId) ? idMap.get(src.slideId) : src.slideId,
                     // A copied plain frame counts its name up ("Page 2" -> "Page 3"); slides are
                     // named by their order instead.
                     text:
                        src.type === 'frame' && src.text && !src.slide
                           ? nextCopyName(
                                src.text,
                                store
                                   .elements()
                                   .filter((e) => e.type === 'frame' && e.text)
                                   .map((e) => e.text as string)
                             )
                           : dto.text,
                     slide: src.slide ? { ...src.slide, order: src.slide.order + 0.01 } : undefined,
                     x: src.x + dx,
                     y: src.y + dy,
                     zIndex: baseZ + created.length,
                     startBinding: remap(src.startBinding),
                     endBinding: remap(src.endBinding),
                  });
                  if (copy) {
                     idMap.set(src.id, copy.id);
                     copiesBySource.set(src.id, copy);
                     created.push(copy);
                  }
               }
               if (!created.length) {
                  return copiesBySource;
               }
               patchState(store, {
                  selectedElementIds: created.map((c) => c.id),
                  selectedTableIds: [],
                  selectedRelationshipIds: [],
               });
               const refs = created.map((c) => ({ id: c.id, snapshot: c }));
               pushHistory({
                  undo: async () => {
                     for (const r of refs) {
                        await deleteElementRaw(r.id);
                     }
                  },
                  redo: async () => {
                     for (const r of refs) {
                        const again = await createElementRaw(elementToCreateDto(r.snapshot));
                        if (again) {
                           r.id = again.id;
                        }
                     }
                  },
               });
               return copiesBySource;
            },

            async updateElement(elementId: string, patch: UpdateElementDto): Promise<void> {
               const current = store.schema()?.elements.find((e) => e.id === elementId);
               const before = current ? captureBefore(current, patch) : null;
               await updateElementRaw(elementId, patch);
               if (before) {
                  pushHistory({
                     undo: () => updateElementRaw(elementId, before),
                     redo: () => updateElementRaw(elementId, patch),
                  });
               }
            },

            /**
             * Persist a geometry change made live (resize/rotate/endpoint) and record it
             * for undo. The element already holds `after` locally; `before` is its state
             * at gesture start.
             */
            async commitElementGeometry(
               elementId: string,
               before: UpdateElementDto,
               after: UpdateElementDto
            ): Promise<void> {
               await updateElementRaw(elementId, after);
               pushHistory({
                  undo: () => updateElementRaw(elementId, before),
                  redo: () => updateElementRaw(elementId, after),
               });
            },

            /** Record a completed drag (already persisted) so it can be undone. */
            recordElementMove(moves: { id: string; from: PointModel; to: PointModel }[]): void {
               if (!moves.length) {
                  return;
               }
               const to = (pick: (m: (typeof moves)[number]) => PointModel) =>
                  this.moveItemsLocal({ elements: new Map(moves.map((m) => [m.id, pick(m)])) });
               pushHistory({ undo: () => to((m) => m.from), redo: () => to((m) => m.to) });
            },

            /** Run `fn`, recording everything it does as a single undo step. */
            async batchHistory(fn: () => Promise<unknown>): Promise<void> {
               if (historyBatch) {
                  await fn();
                  return;
               }
               const batch: HistoryEntry[] = [];
               historyBatch = batch;
               try {
                  await fn();
               } finally {
                  historyBatch = null;
               }
               if (!batch.length) return;
               if (batch.length === 1) {
                  pushHistory(batch[0]);
                  return;
               }
               pushHistory({
                  undo: async () => {
                     for (const e of [...batch].reverse()) await e.undo();
                  },
                  redo: async () => {
                     for (const e of batch) await e.redo();
                  },
               });
            },

            /** Record a finished drag of message rows (already applied) for undo/redo. */
            recordMessageMoves(moves: { id: string; from: number; to: number }[]): void {
               if (!moves.length) return;
               pushHistory({
                  undo: () => moves.forEach((m) => this.moveMessage(rid(m.id), m.from)),
                  redo: () => moves.forEach((m) => this.moveMessage(rid(m.id), m.to)),
               });
            },

            /** Record a finished horizontal drag of a participant for undo/redo. */
            recordLifelineMove(id: string, from: number, to: number): void {
               pushHistory({
                  undo: () => this.moveLifeline(rid(id), from),
                  redo: () => this.moveLifeline(rid(id), to),
               });
            },

            /** Undo the most recent element operation (no-op when the stack is empty). */
            undoElement(): void {
               const entry = undoStack.pop();
               if (!entry) {
                  return;
               }
               redoStack.push(entry);
               syncHistoryDepth();
               void runHistory(() => entry.undo());
            },

            redoElement(): void {
               const entry = redoStack.pop();
               if (!entry) {
                  return;
               }
               undoStack.push(entry);
               syncHistoryDepth();
               void runHistory(() => entry.redo());
            },

            /**
             * Optimistic local-only merge, no persistence. Used for live feedback during
             * a resize/rotate/endpoint gesture; the editor persists once on pointer-up.
             */
            patchElementLocal(
               elementId: string,
               patch: Partial<Omit<CanvasElementModel, 'startBinding' | 'endBinding'>> & {
                  startBinding?: CanvasElementModel['startBinding'] | null;
                  endBinding?: CanvasElementModel['endBinding'] | null;
               }
            ): void {
               mapElement(elementId, (e) => {
                  const { startBinding, endBinding, ...rest } = patch;
                  const next: CanvasElementModel = { ...e, ...rest };
                  // A binding key present in the patch sets it; null clears it.
                  if ('startBinding' in patch) {
                     next.startBinding = startBinding ?? undefined;
                  }
                  if ('endBinding' in patch) {
                     next.endBinding = endBinding ?? undefined;
                  }
                  return next;
               });
            },

            /** Optimistic local move; the position PATCH is debounced per element. */
            moveElement(elementId: string, x: number, y: number): void {
               stage('elements', elementId, { x, y });
               mapElement(elementId, (e) => ({ ...e, x, y }));
            },

            /** Optimistic local reshape (vertices); the position PATCH is debounced. */
            setElementPoints(elementId: string, points: PointModel[]): void {
               stage('elements', elementId, { points });
               mapElement(elementId, (e) => ({ ...e, points }));
            },

            async deleteElement(elementId: string): Promise<void> {
               const snapshot = store.schema()?.elements.find((e) => e.id === elementId);
               if ((await deleteElementRaw(elementId)) && snapshot) {
                  // Undo re-creates it under the same id, so whatever points at it (a slide's
                  // layout, items on a frame, placeholder copies) still does; redo deletes it.
                  const ref = { id: elementId };
                  pushHistory({
                     undo: async () => {
                        if (store.schema()?.elements.some((e) => e.id === ref.id)) return;
                        const again = await createElementRaw({ ...elementToCreateDto(snapshot), id: ref.id });
                        if (again) {
                           ref.id = again.id;
                        }
                     },
                     redo: async () => {
                        await deleteElementRaw(ref.id);
                     },
                  });
               }
            },

            /** Reorder element stacking optimistically; persist the new order (debounced). */
            reorderElements(orderedElementIds: string[]): void {
               const before = new Map(store.elements().map((e) => [e.id, e.zIndex]));
               setSchema((s) => {
                  const byId = new Map(s.elements.map((e) => [e.id, e]));
                  const ordered = orderedElementIds
                     .map((id, index) => {
                        const el = byId.get(id);
                        return el ? { ...el, zIndex: index } : undefined;
                     })
                     .filter((e): e is CanvasElementModel => Boolean(e));
                  const named = new Set(orderedElementIds);
                  const rest = s.elements.filter((e) => !named.has(e.id));
                  return { ...s, elements: [...ordered, ...rest] };
               });
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               // Only the rows whose index changed go out, in the staged batch with other edits.
               orderedElementIds.forEach((id, zIndex) => {
                  const was = before.get(id);
                  if (was !== undefined && was !== zIndex) stage('elements', id, { zIndex });
               });
            },

            /**
             * Re-stack the selected elements and sequence diagrams together: all the way
             * to the front/back, or one step past the next item they visually overlap.
             * Diagrams sit between elements via a fractional zIndex (see
             * SequenceDiagramModel.zIndex), so both kinds share one ordering.
             */
            arrangeSelection(op: 'front' | 'back' | 'forward' | 'backward'): void {
               const elements = store.elements();
               const selEls = new Set(store.selectedElementIds());
               const selDiagrams = new Set(store.selectedDiagramIds());
               if (!store.canEdit() || (selEls.size === 0 && selDiagrams.size === 0)) {
                  return;
               }
               type Item = { id: string; diagram: boolean; cls: 'frame' | 'line' | 'content' };
               const diagrams = [...store.sequenceDiagrams()].sort((a, b) => a.zIndex - b.zIndex);
               const items: Item[] = [];
               let di = 0;
               const pushDiagramsBelow = (z: number): void => {
                  while (di < diagrams.length && diagrams[di].zIndex < z) {
                     items.push({ id: diagrams[di].id, diagram: true, cls: 'content' });
                     di++;
                  }
               };
               for (const e of elements) {
                  pushDiagramsBelow(e.zIndex);
                  items.push({
                     id: e.id,
                     diagram: false,
                     cls: e.type === 'frame' ? 'frame' : e.type === 'line' || e.type === 'arrow' ? 'line' : 'content',
                  });
               }
               pushDiagramsBelow(Infinity);

               const isSel = (it: Item): boolean => (it.diagram ? selDiagrams : selEls).has(it.id);
               let next = items;
               if (op === 'front') {
                  next = [...items.filter((i) => !isSel(i)), ...items.filter(isSel)];
               } else if (op === 'back') {
                  next = [...items.filter(isSel), ...items.filter((i) => !isSel(i))];
               } else {
                  const step = op === 'forward' ? 1 : -1;
                  next = [...items];
                  const order = next.map((_, i) => i);
                  if (step === 1) order.reverse();
                  for (const i of order) {
                     const it = next[i];
                     if (!isSel(it)) continue;
                     // Hop to the nearest neighbor it visually overlaps (same layer class).
                     let j = i + step;
                     while (j >= 0 && j < next.length && next[j].cls !== it.cls) j += step;
                     if (j < 0 || j >= next.length || isSel(next[j])) continue;
                     next.splice(i, 1);
                     next.splice(j, 0, it);
                  }
               }

               // Elements take plain indices; each diagram sits just above the element
               // before it. The very top (above every element) also clears table nodes.
               const orderedIds = next.filter((i) => !i.diagram).map((i) => i.id);
               const total = orderedIds.length;
               let before = 0;
               let slot = 0;
               const changes: Array<{ id: string; zIndex: number }> = [];
               for (const it of next) {
                  if (!it.diagram) {
                     before++;
                     slot = 0;
                     continue;
                  }
                  if (total === 0 && !isSel(it)) continue;
                  // With no elements to rank against, only the direction tells front from back.
                  const atBottom = total > 0 ? before === 0 : op === 'back' || op === 'backward';
                  const base = atBottom ? -1 : Math.max(before, 1) - 0.5;
                  const z = base + slot * 0.001;
                  slot++;
                  const cur = diagrams.find((d) => d.id === it.id);
                  if (cur && cur.zIndex !== z) changes.push({ id: it.id, zIndex: z });
               }

               // Content elements pass the ERD table nodes at the extremes: to the front
               // (or forward from the top of the under-tables stack) lifts them above the
               // tables; to the back (or backward from the bottom of the above stack) drops them.
               const byId = new Map(elements.map((e) => [e.id, e]));
               const content = next.filter((i) => !i.diagram && i.cls === 'content');
               const above = (it: Item): boolean => !!byId.get(it.id)?.aboveTables;
               content.forEach((it, idx) => {
                  if (!isSel(it)) return;
                  const cur = above(it);
                  let want = cur;
                  if (op === 'front') want = true;
                  else if (op === 'back') want = false;
                  else if (op === 'forward' && !cur) want = !content.slice(idx + 1).some((o) => !isSel(o) && !above(o));
                  else if (op === 'backward' && cur) want = content.slice(0, idx).some((o) => !isSel(o) && above(o));
                  if (want !== cur) void this.updateElement(it.id, { aboveTables: want });
               });

               const currentIds = elements.map((e) => e.id);
               if (orderedIds.some((id, i) => id !== currentIds[i])) {
                  this.reorderElements(orderedIds);
               }
               const projectId = store.projectId();
               for (const c of changes) {
                  mapDiagram(c.id, (d) => ({ ...d, zIndex: c.zIndex }));
                  if (projectId) {
                     void runSave(() =>
                        firstValueFrom(sequenceApi.updateDiagram(projectId, c.id, { zIndex: c.zIndex }))
                     );
                  }
               }
            },
         };
      }
   ),
   withMethods((store, projectsApi = inject(ProjectsApiService)) => ({
      /**
       * Merge an exported project file into the open project. The server persists
       * and broadcasts the additions and returns them; they are applied here exactly
       * like a collaborator's changes, then selected so they can be moved as a unit.
       */
      async importFile(file: unknown, anchor: { x: number; y: number }): Promise<number> {
         const projectId = store.projectId();
         if (!projectId) {
            throw new Error('No project is open.');
         }
         const { mutations } = await firstValueFrom(
            projectsApi.importInto(projectId, { file: file as ProjectExportFile, anchor })
         );
         const tableIds: string[] = [];
         const elementIds: string[] = [];
         const diagramIds: string[] = [];
         store.applyRemoteBatch(mutations);
         for (const mutation of mutations) {
            if (mutation.kind === 'table.created') tableIds.push(mutation.table.id);
            else if (mutation.kind === 'element.created') elementIds.push(mutation.element.id);
            else if (mutation.kind === 'sequenceDiagram.created') diagramIds.push(mutation.diagram.id);
         }
         store.setSelection(tableIds, [], elementIds, [], [], diagramIds);
         return mutations.length;
      },
   }))
);
