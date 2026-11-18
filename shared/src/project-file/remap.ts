// Planning an import: every id in a parsed project file gets a fresh one, every
// cross-reference is rewritten through the id maps, coordinates are shifted, and
// references that no longer resolve are dropped. Pure: the server writer persists
// the result, the guide sandboxes keep it in memory.

import type {
  CanvasElementModel,
  ElementBinding,
  IndexModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '../models';
import { DEFAULT_PRESENTATION } from '../slides';
import { remapMorphByItems } from '../slides/animations';
import { randomId } from './ids';

/** The content of a schema (no viewport / home / themes), as models. */
export type ProjectContent = Omit<SchemaModel, 'viewport' | 'home' | 'notes' | 'themes'>;

/** A world-space point the imported content's top-left corner is moved to. */
export interface ImportAnchor {
  x: number;
  y: number;
}

export interface RemapOptions {
  /** Mints a fresh id (default crypto.randomUUID). */
  newId?: () => string;
  /**
   * Keep every id as written (references are still checked and dangling ones dropped).
   * For mirrors of the same project on two servers (desktop sync), which must share ids.
   */
  keepIds?: boolean;
  /** Translation applied to every world coordinate (default none). */
  dx?: number;
  dy?: number;
  /** Added to every element's zIndex (stack above existing content; see planImportStacking). */
  zShift?: number;
  /** Added to every slide frame's order. */
  slideShift?: number;
  /** Presentation renames (old name -> new name) so an import does not join an existing deck. */
  presentationNames?: ReadonlyMap<string, string>;
  /**
   * New file id for an image element's old `fileId`, or undefined when the file is
   * not available (the element is then dropped). Default: keep the id as written.
   */
  fileOf?: (old: string | undefined) => string | undefined;
  /**
   * Ids already in the target project that unresolved references may keep pointing at
   * (slide ownership, arrow bindings), instead of being dropped.
   */
  linkExisting?: { elementIds: ReadonlySet<string>; tableIds: ReadonlySet<string> };
}

/** Old id -> freshly minted id. Lookups of unknown ids return undefined. */
class IdMap {
  private readonly ids = new Map<string, string>();
  constructor(
    private readonly newId: () => string,
    private readonly keep = false,
  ) {}
  mint(oldId: string): string {
    const id = this.keep ? oldId : this.newId();
    this.ids.set(oldId, id);
    return id;
  }
  get(oldId: string | undefined): string | undefined {
    return oldId === undefined ? undefined : this.ids.get(oldId);
  }
}

/** True when an element survives the import (image elements need their file). */
export function importsElement(e: CanvasElementModel, fileOf?: RemapOptions['fileOf']): boolean {
  return e.type !== 'image' || !fileOf || fileOf(e.fileId) !== undefined;
}

/**
 * Give every id in `schema` a fresh one and rewrite every reference: relationships
 * to columns, indexes to columns (an index whose columns all vanished is dropped),
 * bindings to tables / messages / elements, slide ownership, layouts, animations,
 * placeholders, master overrides, groups (re-minted together) and morph lineage
 * (re-minted as a set; named "tag:" morphs are kept as written).
 */
export function remapProjectIds(schema: ProjectContent, opts: RemapOptions = {}): ProjectContent {
  const mintId = opts.newId ?? randomId;
  /** A fresh id, or the original one when keeping ids. */
  const newId = (old?: string): string => (opts.keepIds && old ? old : mintId());
  const dx = opts.dx ?? 0;
  const dy = opts.dy ?? 0;
  const map = (): IdMap => new IdMap(mintId, opts.keepIds === true);
  const tableIds = map();
  const columnIds = map();
  const elementIds = map();
  const diagramIds = map();
  const lifelineIds = map();
  const messageIds = map();
  const morphIds = map();
  const groupIds = map();
  const group = (old: string | undefined): string | undefined =>
    old === undefined ? undefined : (groupIds.get(old) ?? groupIds.mint(old));
  const slideOf = (old: string | undefined): string | undefined =>
    old === undefined ? undefined : (elementIds.get(old) ?? (opts.linkExisting?.elementIds.has(old) ? old : undefined));

  const sourceElements = schema.elements.filter((e) => importsElement(e, opts.fileOf));
  // Minted up front, because other rows point at them before they are planned:
  // tables, diagrams and elements at their slide frame; a slide's animations at its
  // tables, diagrams and elements; an arrow at a table or a message label.
  for (const e of sourceElements) elementIds.mint(e.id);
  for (const d of schema.sequenceDiagrams) diagramIds.mint(d.id);
  for (const t of schema.tables) tableIds.mint(t.id);
  for (const m of schema.sequenceMessages) messageIds.mint(m.id);
  for (const t of schema.tables) for (const c of t.columns) columnIds.mint(c.id);

  const tables: TableModel[] = schema.tables.map((t) => {
    const own = new Set(t.columns.map((c) => c.id));
    const indexes: IndexModel[] = [];
    for (const ix of t.indexes ?? []) {
      const covered = ix.columnIds.filter((id) => own.has(id)).map((id) => columnIds.get(id)!);
      if (covered.length === 0) continue;
      indexes.push({ id: newId(ix.id), name: ix.name, columnIds: covered, isUnique: ix.isUnique });
    }
    return {
      ...t,
      id: tableIds.get(t.id)!,
      x: t.x + dx,
      y: t.y + dy,
      columns: t.columns.map((c) => ({ ...c, id: columnIds.get(c.id)! })),
      indexes: indexes.length ? indexes : undefined,
      groupId: group(t.groupId),
      slideId: slideOf(t.slideId),
    };
  });

  const relationships: RelationshipModel[] = [];
  for (const r of schema.relationships) {
    const sourceColumnId = columnIds.get(r.sourceColumnId);
    const targetColumnId = columnIds.get(r.targetColumnId);
    if (!sourceColumnId || !targetColumnId) continue;
    const waypoints = r.waypoints?.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    relationships.push({ ...r, id: newId(r.id), sourceColumnId, targetColumnId, waypoints });
  }

  const resolveBinding = (b: ElementBinding | undefined): ElementBinding | undefined => {
    if (!b) return undefined;
    const ids = b.targetKind === 'table' ? tableIds : b.targetKind === 'message' ? messageIds : elementIds;
    const id = ids.get(b.targetId);
    const focus = b.focus ? { focus: b.focus } : {};
    if (id) return { targetKind: b.targetKind, targetId: id, ...focus };
    const keep =
      b.targetKind === 'table'
        ? opts.linkExisting?.tableIds.has(b.targetId)
        : b.targetKind === 'element' && opts.linkExisting?.elementIds.has(b.targetId);
    return keep ? { targetKind: b.targetKind, targetId: b.targetId, ...focus } : undefined;
  };
  const zShift = opts.zShift ?? 0;
  const slideShift = opts.slideShift ?? 0;
  const elements: CanvasElementModel[] = sourceElements.map((e) => ({
    ...e,
    id: elementIds.get(e.id)!,
    fileId: e.type === 'image' || e.type === 'embed' ? (opts.fileOf ? opts.fileOf(e.fileId) : e.fileId) : undefined,
    x: e.x + dx,
    y: e.y + dy,
    zIndex: e.zIndex + zShift,
    startBinding: resolveBinding(e.startBinding),
    endBinding: resolveBinding(e.endBinding),
    groupId: group(e.groupId),
    slideId: slideOf(e.slideId),
    slide:
      e.type === 'frame' && e.slide
        ? {
            ...e.slide,
            presentation:
              opts.presentationNames?.get(e.slide.presentation?.trim() || DEFAULT_PRESENTATION) ??
              e.slide.presentation,
            order: e.slide.order + slideShift,
            // A slide's layout is another frame of the file; drop it if that is missing.
            layoutId: e.slide.layoutId ? elementIds.get(e.slide.layoutId) : undefined,
            transition: e.slide.transition
              ? {
                  ...e.slide.transition,
                  morphByItems: remapMorphByItems(e.slide.transition.morphByItems, elementIds),
                }
              : undefined,
            // Animations follow their objects to the new ids; ones whose object is gone drop.
            animations: e.slide.animations
              ?.map((a) => {
                const target = elementIds.get(a.target) ?? tableIds.get(a.target) ?? diagramIds.get(a.target);
                return target ? { ...a, target } : null;
              })
              .filter((a): a is NonNullable<typeof a> => a !== null),
          }
        : undefined,
    // A slide's placeholder copy points at its layout's element; drop the link if gone.
    placeholder: e.placeholder
      ? { ...e.placeholder, of: e.placeholder.of ? elementIds.get(e.placeholder.of) : undefined }
      : undefined,
    // A slide's or layout's stand-in for a master item; drop the link if it is gone.
    overrides: e.overrides ? elementIds.get(e.overrides) : undefined,
    // Lineage ids are remapped as a set so copies still match each other after import.
    // Named morph tags ("tag:...") are kept as written so slides added by a later import
    // still pair with earlier ones.
    morphId: e.morphId
      ? e.morphId.startsWith('tag:')
        ? e.morphId
        : (morphIds.get(e.morphId) ?? morphIds.mint(e.morphId))
      : undefined,
    // Split tags are named tags (or solo markers) and are kept as written.
    morphIn: e.morphIn,
    morphOut: e.morphOut,
  }));

  const sequenceDiagrams: SequenceDiagramModel[] = schema.sequenceDiagrams.map((d) => ({
    ...d,
    id: diagramIds.get(d.id)!,
    originY: d.originY + dy,
    groupId: group(d.groupId),
    slideId: slideOf(d.slideId),
  }));

  const lifelines: LifelineModel[] = [];
  for (const l of schema.lifelines) {
    const diagramId = diagramIds.get(l.diagramId);
    if (!diagramId) continue;
    lifelines.push({ ...l, id: lifelineIds.mint(l.id), diagramId, x: l.x + dx });
  }

  const sequenceMessages: SequenceMessageModel[] = [];
  for (const m of schema.sequenceMessages) {
    const diagramId = diagramIds.get(m.diagramId);
    const fromLifelineId = lifelineIds.get(m.fromLifelineId);
    const toLifelineId = lifelineIds.get(m.toLifelineId);
    if (!diagramId || !fromLifelineId || !toLifelineId) continue;
    // A message needs two different participants (a break has no arrow, so it may share).
    if (m.style !== 'break' && fromLifelineId === toLifelineId) continue;
    sequenceMessages.push({ ...m, id: messageIds.get(m.id)!, diagramId, fromLifelineId, toLifelineId, y: m.y + dy });
  }

  return { tables, relationships, elements, sequenceDiagrams, lifelines, sequenceMessages };
}

/**
 * Translation that moves the content's top-left corner (smallest x / y across
 * every positioned item) onto `anchor`, preserving the content's own layout.
 * Zero when there is nothing to position.
 */
export function offsetToAnchor(schema: ProjectContent, anchor: ImportAnchor): { dx: number; dy: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of schema.tables) {
    xs.push(t.x);
    ys.push(t.y);
  }
  for (const e of schema.elements) {
    xs.push(e.x);
    ys.push(e.y);
  }
  for (const l of schema.lifelines) xs.push(l.x);
  for (const m of schema.sequenceMessages) ys.push(m.y);
  for (const d of schema.sequenceDiagrams) ys.push(d.originY);
  for (const r of schema.relationships) {
    for (const p of r.waypoints ?? []) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length === 0 || ys.length === 0) return { dx: 0, dy: 0 };
  return { dx: anchor.x - Math.min(...xs), dy: anchor.y - Math.min(...ys) };
}

/** What the target project already holds, for stacking an import above it. */
export interface ExistingContent {
  /** Highest element zIndex in the project (undefined / null when it has none). */
  maxZIndex?: number | null;
  /** The project's slide frames' slide configs (order + presentation name). */
  slides: ReadonlyArray<{ order?: number; presentation?: string } | null>;
}

/**
 * How to merge imported elements into an existing project: elements stack above
 * the existing ones, slides go after the existing slides, and a presentation whose
 * name is taken becomes "<name> (copy)" unless `joinPresentations`.
 */
export function planImportStacking(
  elements: readonly CanvasElementModel[],
  existing: ExistingContent,
  joinPresentations = false,
): { zShift: number; slideShift: number; presentationNames: Map<string, string> } {
  const presentationNames = new Map<string, string>();
  let zShift = 0;
  if (elements.length) {
    const lowest = Math.min(...elements.map((e) => e.zIndex));
    zShift = (existing.maxZIndex ?? -1) + 1 - lowest;
  }
  let slideShift = 0;
  if (elements.some((e) => e.slide)) {
    let top = -1;
    const taken = new Set<string>();
    for (const o of existing.slides) {
      if (typeof o?.order === 'number') top = Math.max(top, o.order);
      if (o) taken.add(o.presentation?.trim() || DEFAULT_PRESENTATION);
    }
    for (const e of elements) {
      if (!e.slide) continue;
      const name = e.slide.presentation?.trim() || DEFAULT_PRESENTATION;
      if (joinPresentations || presentationNames.has(name) || !taken.has(name)) continue;
      let n = 1;
      let next = `${name} (copy)`;
      while (taken.has(next)) next = `${name} (copy ${++n})`;
      taken.add(next);
      presentationNames.set(name, next);
    }
    const lowest = Math.min(...elements.filter((e) => e.slide).map((e) => e.slide!.order));
    slideShift = top + 1 - lowest;
  }
  return { zShift, slideShift, presentationNames };
}
