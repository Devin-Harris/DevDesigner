import type {
   AccessLevel,
   CanvasElementModel,
   ColumnModel,
   PointModel,
   RelationshipModel,
   SchemaModel,
   SlideTheme,
   ViewportModel,
} from '@devdesigner/shared';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Sticky drawing style carried across new elements in a session. */
export interface ElementStyleState {
   strokeColor?: string;
   backgroundColor?: string;
   fillStyle: CanvasElementModel['fillStyle'];
   strokeWidth: number;
   strokeStyle: CanvasElementModel['strokeStyle'];
   opacity: number;
   strokeOpacity?: number;
   fillOpacity?: number;
   fontFamily: string;
   fontSize: number;
   cornerRadius?: number;
   startArrowhead?: CanvasElementModel['startArrowhead'];
   endArrowhead?: CanvasElementModel['endArrowhead'];
}

/** The loaded project, its access, view slots and save status (project-state.feature). */
export interface ProjectCoreState {
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
   loading: boolean;
   error: string | null;
   saveStatus: SaveStatus;
   /** Depth of the element undo/redo stacks, for toolbar button enablement. */
   undoDepth: number;
   redoDepth: number;
   /** Style applied to newly drawn elements; updated as the user restyles (session-sticky). */
   elementStyle: ElementStyleState;
}

/** What is selected, the entered group and pending inline-edit requests (project-selection-state.feature). */
export interface ProjectSelectionState {
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
   /** Transient: a message whose inline label editor should open (toolbar pencil). */
   pendingMessageEditId: string | null;
   /** Transient: a lifeline whose inline label editor should open (toolbar pencil). */
   pendingLifelineEditId: string | null;
}

/** Which slide and presentation the canvas shows (project-slides-state.feature). */
export interface ProjectSlidesState {
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
}

/** The whole ProjectStore state. */
export type ProjectState = ProjectCoreState & ProjectSelectionState & ProjectSlidesState;

/** A reversible operation: closures that reuse the granular store methods. */
export interface HistoryEntry {
   undo: () => void | Promise<void>;
   redo: () => void | Promise<void>;
}

/** A table's scale and position, for scale-gesture undo. */
export interface TableGeometry {
   scale: number;
   x: number;
   y: number;
}

/** A column as it was before removal, with its slot and relationships (for undo). */
export interface ColumnSnapshot {
   tableId: string;
   column: ColumnModel;
   index: number;
   relationships: RelationshipModel[];
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

/** One item's group membership, used to apply and undo (un)grouping. */
export interface GroupAssignment {
   kind: GroupItemKind;
   id: string;
   groupId: string | null;
}

/** What the canvas leaves out because it belongs to a slide that isn't shown. */
export interface SlideHidden {
   elementIds: ReadonlySet<string>;
   tableIds: ReadonlySet<string>;
   diagramIds: ReadonlySet<string>;
}

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
