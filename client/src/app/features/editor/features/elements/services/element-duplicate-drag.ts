import type { SequenceStart } from '../../../models/sequence-start.model';
import { type CanvasElementModel, presentationOf, presentationSlides } from '@devdesigner/shared';
import { frameContents } from '../../../helpers/frame-contents.helper';
import type { ElementGestureService } from './element-gesture.service';

/** Alt-drag duplication and frame-carried items for element gestures. */
export class ElementDuplicateDrag {
   constructor(private readonly host: ElementGestureService) {}

   /**
    * Everything fully inside any frame being moved (nested frames included) rides
    * along with it: elements, tables, and the manual routes between carried tables.
    * `extra` adds selected tables / diagrams (members of a mixed-kind group) that
    * move rigidly with the grabbed element. Null when nothing rides along.
    */
   carriedByFrames(
      moving: { has(id: string): boolean },
      extra?: { tableIds: ReadonlySet<string>; diagramIds: ReadonlySet<string> }
   ): {
      elements: Map<string, { x: number; y: number }>;
      tables: Map<string, { x: number; y: number }>;
      waypoints: Map<string, { x: number; y: number }[]>;
      sequences: Map<string, SequenceStart>;
   } | null {
      const all = this.host.store.elements();
      const hasFrame = all.some((e) => e.type === 'frame' && moving.has(e.id));
      if (!hasFrame && !extra?.tableIds.size && !extra?.diagramIds.size) {
         return null;
      }
      const inner = hasFrame
         ? frameContents(
              { has: (id) => moving.has(id) } as ReadonlySet<string>,
              all,
              this.host.store.tables(),
              this.host.store.sequenceDiagrams(),
              this.host.store.lifelines(),
              this.host.store.sequenceMessages(),
              this.host.store.shownSlideIds()
           )
         : {
              elementIds: new Set<string>(),
              tableIds: new Set<string>(),
              diagramIds: new Set<string>(),
           };
      // Selected tables / diagrams (a group of mixed kinds) travel with the element.
      extra?.tableIds.forEach((id) => inner.tableIds.add(id));
      extra?.diagramIds.forEach((id) => inner.diagramIds.add(id));
      const elements = new Map<string, { x: number; y: number }>();
      for (const e of all) {
         if (inner.elementIds.has(e.id)) {
            elements.set(e.id, { x: e.x, y: e.y });
         }
      }
      const tables = new Map<string, { x: number; y: number }>();
      for (const t of this.host.store.tables()) {
         if (inner.tableIds.has(t.id)) {
            tables.set(t.id, { x: t.x, y: t.y });
         }
      }
      const waypoints = new Map<string, { x: number; y: number }[]>();
      if (tables.size) {
         const locs = this.host.canvasView.columnLocations();
         for (const rel of this.host.store.relationships()) {
            const st = locs.get(rel.sourceColumnId)?.table.id;
            const tt = locs.get(rel.targetColumnId)?.table.id;
            if (st && tt && tables.has(st) && tables.has(tt) && rel.waypoints?.length) {
               waypoints.set(
                  rel.id,
                  rel.waypoints.map((w) => ({ ...w }))
               );
            }
         }
      }
      const sequences = new Map<string, SequenceStart>();
      for (const id of inner.diagramIds) {
         const start = this.host.canvasView.sequenceStart(id);
         if (start) {
            sequences.set(id, start);
         }
      }
      return { elements, tables, waypoints, sequences };
   }

   /** Add freshly created copies (inside a duplicated frame) to the running drag. */
   attachCarried(elementIds: string[], tableIds: string[], diagramIds: string[]): void {
      const g = this.host.elementGesture;
      if (!g?.others) {
         return;
      }
      for (const id of elementIds) {
         const e = this.host.store.elements().find((x) => x.id === id);
         if (e) {
            g.others.set(id, { x: e.x, y: e.y });
         }
      }
      g.tables = new Map(
         this.host.store
            .tables()
            .filter((t) => tableIds.includes(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }])
      );
      g.sequences = new Map(
         diagramIds
            .map((id) => [id, this.host.canvasView.sequenceStart(id)] as const)
            .filter((e): e is readonly [string, SequenceStart] => !!e[1])
      );
   }

   /**
    * Switch an in-progress move (element or table drag) into a duplicate-drag: put
    * the originals back where the drag began, clone the selection in place, and
    * carry on dragging the copies from the same pointer origin. Works when Alt is
    * held at pointer-down or pressed part-way through the drag.
    */
   async duplicateAndDrag(): Promise<void> {
      const kind = this.host.gesture.mode;
      if (this.host.gesture.dragCopied || (kind !== 'element' && kind !== 'node') || !this.host.store.canEdit()) {
         return;
      }
      this.host.gesture.dragCopied = true;
      const grabbedElement = this.host.elementGesture?.id ?? null;
      const grabbedTable = this.host.gesture.dragTableId;
      if (kind === 'element') {
         const g = this.host.elementGesture;
         this.host.store.moveItemsLocal({
            elements: g?.others,
            tables: g?.tables,
            waypoints: g?.waypoints,
            sequences: [...(g?.sequences ?? [])].map(([id, seq]) => ({
               diagramId: id,
               startXs: seq.xs,
               dx: 0,
               startOriginY: seq.originY,
               dy: 0,
               startRows: seq.rows,
            })),
         });
      } else {
         this.host.store.moveItemsLocal({
            tables: this.host.gesture.multiDragStart,
            waypoints: new Map([...this.host.gesture.waypointDragStart].map(([relId, start]) => [relId, start.wp])),
            ...this.host.nodeExtrasMoves(0, 0),
         });
      }
      this.host.gesture.mode = 'duplicating';
      let resume: (() => void) | null = null;
      let created: string[] = [];
      const selectedIds = this.host.store.selectedElementIds();
      const slideNames =
         kind === 'element'
            ? [
                 ...new Set(
                    this.host.store
                       .slideFrames()
                       .filter((f) => selectedIds.includes(f.id))
                       .map((f) => presentationOf(f))
                 ),
              ]
            : [];
      if (slideNames.length) {
         // Alt-dragging presentations' slides copies each whole presentation: every slide
         // with its contents, under a new name, dragged off as one set. Anything else
         // selected is copied alongside.
         // The originals were put back above; bring their other (hidden) slides back with
         // them now, before copies exist that the catch-up could mistake for their own slides.
         this.host.host.syncSlideMoves();
         const copied = new Set<string>();
         const allCopies = new Map<string, CanvasElementModel>();
         const tableCopies: string[] = [];
         const sequenceCopies: string[] = [];
         const selectedCopies: string[] = [];
         const names: string[] = [];
         for (const presentation of slideNames) {
            const frames = presentationSlides(this.host.store.slideFrames(), presentation);
            const frameIds = new Set(frames.map((f) => f.id));
            const inner = frameContents(
               frameIds,
               this.host.store.elements(),
               this.host.store.tables(),
               this.host.store.sequenceDiagrams(),
               this.host.store.lifelines(),
               this.host.store.sequenceMessages(),
               this.host.store.shownSlideIds()
            );
            const name = this.host.host.newPresentationName();
            names.push(name);
            const sources = this.host.store.elements().filter((e) => frameIds.has(e.id) || inner.elementIds.has(e.id));
            sources.forEach((e) => copied.add(e.id));
            // One optimistic clone per presentation: the copies show at once.
            const cloned = this.host.store.cloneItems(inner.tableIds, inner.diagramIds, sources, 0, 0, {
               presentation: name,
            });
            cloned.copies.forEach((c, id) => allCopies.set(id, c));
            tableCopies.push(...cloned.tables.values());
            sequenceCopies.push(...cloned.diagrams.values());
            const shown = frames.find((f) => selectedIds.includes(f.id));
            const shownCopy = shown && cloned.copies.get(shown.id);
            if (shownCopy) {
               this.host.store.setActiveSlide(shownCopy.id);
               selectedCopies.push(shownCopy.id);
            }
         }
         // The rest of the selection (not part of a copied presentation) is copied too.
         const rest = new Set(selectedIds.filter((id) => !copied.has(id)));
         if (rest.size) {
            const inner = this.carriedByFrames(rest);
            const sources = this.host.store.elements().filter((e) => rest.has(e.id) || inner?.elements.has(e.id));
            const cloned = this.host.store.cloneItems(
               new Set(inner?.tables.keys() ?? []),
               new Set(inner?.sequences.keys() ?? []),
               sources,
               0,
               0
            );
            cloned.copies.forEach((c, id) => allCopies.set(id, c));
            tableCopies.push(...cloned.tables.values());
            sequenceCopies.push(...cloned.diagrams.values());
            for (const id of rest) {
               const c = cloned.copies.get(id);
               if (c) selectedCopies.push(c.id);
            }
         }
         created = [...allCopies.values()].map((c) => c.id);
         const grabbed =
            (grabbedElement && allCopies.get(grabbedElement)) ||
            allCopies.get(selectedIds.find((id) => allCopies.has(id)) ?? '');
         if (grabbed) {
            resume = () => {
               this.host.store.setSelection([], [], selectedCopies);
               // Record where the copied slides start, so the release catches the hidden ones up
               // (as in a plain slide drag) instead of moving every slide on each pointer move.
               for (const c of allCopies.values()) {
                  if (c.type === 'frame' && c.slide) {
                     this.host.host.slideBounds.set(c.id, { x: c.x, y: c.y, w: c.width, h: c.height });
                  }
               }
               this.host.beginElementDrag(grabbed);
               // Only what's on the shown slides (and the rest of the selection) rides along.
               const g = this.host.elementGesture;
               const carried = g?.others && this.carriedByFrames(g.others);
               if (g?.others && carried) {
                  for (const [id, pos] of carried.elements) g.others.set(id, pos);
                  g.tables = carried.tables;
                  g.waypoints = carried.waypoints;
                  g.sequences = carried.sequences;
               }
               this.host.host.selectedSlideSets.set(names);
            };
         }
      } else if (kind === 'element') {
         const selected = new Set(this.host.store.selectedElementIds());
         // Duplicating a frame duplicates what's inside it too (tables, sequence
         // diagrams, and elements), and the copies travel with the copied frame.
         const inner = this.carriedByFrames(selected);
         // One optimistic clone of selected + inner items: shows at once, one undo step,
         // bindings between copies remap and a copied slide's contents follow its copy.
         const sources = this.host.store.elements().filter((e) => selected.has(e.id) || inner?.elements.has(e.id));
         const cloned = this.host.store.cloneItems(
            new Set(inner?.tables.keys() ?? []),
            new Set(inner?.sequences.keys() ?? []),
            sources,
            0,
            0
         );
         const copies = cloned.copies;
         const tableCopies = [...cloned.tables.values()];
         const sequenceCopies = [...cloned.diagrams.values()];
         created = [...copies.values()].map((c) => c.id);
         // An Alt-dragged slide becomes the one shown (only one slide is on the canvas).
         const slideCopy = [...copies.values()].find((c) => c.type === 'frame' && c.slide);
         if (slideCopy) {
            this.host.store.setActiveSlide(slideCopy.id);
         }
         const grabbed = (grabbedElement && copies.get(grabbedElement)) || [...copies.values()][0];
         if (grabbed) {
            const innerElementCopies = [...(inner?.elements.keys() ?? [])]
               .map((id) => copies.get(id)?.id)
               .filter((id): id is string => !!id);
            resume = () => {
               // Select only what was selected; the inner copies ride along as carried content.
               const selectedCopies = [...selected].map((id) => copies.get(id)?.id).filter((id): id is string => !!id);
               this.host.store.setSelection([], [], selectedCopies);
               this.host.beginElementDrag(grabbed);
               this.attachCarried(innerElementCopies, tableCopies, sequenceCopies);
            };
         }
      } else {
         const cloned = this.host.store.cloneItems(
            new Set(this.host.store.selectedTableIds()),
            new Set(),
            [],
            0,
            0,
            // Only selected relationships between the copied tables are copied.
            { relationshipIds: new Set(this.host.store.selectedRelationshipIds()) }
         );
         const ids = cloned.tables;
         created = [...ids.values()];
         const relCopies = cloned.relationships;
         this.host.store.setSelection(created, relCopies, []);
         const grabbed = (grabbedTable && ids.get(grabbedTable)) || created[0];
         if (grabbed) {
            resume = () => this.host.host.beginNodeDrag(grabbed);
         }
      }
      if (this.host.gesture.mode !== 'duplicating' || !resume) {
         // Nothing was copied (or the gesture was cancelled meanwhile).
         this.host.gesture.releasedWhileDuplicating = false;
         if (this.host.gesture.mode === 'duplicating') {
            this.host.gesture.mode = 'idle';
            this.host.gesture.gestureActive.set(false);
         }
         return;
      }
      // The snap targets were taken with the originals moving: now they stay put and
      // the copies move, so measure against them afresh.
      this.host.snap.smartBase = null;
      resume();
      if (this.host.gesture.lastPointer) {
         this.host.host.handlePointerMove(this.host.gesture.lastPointer);
      }
      if (this.host.gesture.releasedWhileDuplicating) {
         // The button was let go before the copies existed: land them where it was dropped.
         this.host.gesture.releasedWhileDuplicating = false;
         this.host.host.onPointerUp();
      }
   }
}
