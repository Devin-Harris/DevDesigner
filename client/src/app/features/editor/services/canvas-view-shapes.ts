import { computed } from '@angular/core';
import { isEmptyPlaceholder, placeholderPrompt, resolveThemedElements } from '@devdesigner/shared';
import { LAYOUT_Z_OFFSET, sequenceDiagramBox } from '../helpers/frame-contents.helper';
import { elementBox, tableBox } from '../helpers/element-geometry.helper';
import { buildShapeViews, codeDiffActive } from '../helpers/render';
import type { Box } from '../models/geometry.model';
import { dim, lock, variant } from './canvas-view.helpers';
import type { CanvasViewService } from './canvas-view.service';

/** Shape views and group outlines of the canvas view. */
export class CanvasViewShapes {
   constructor(private readonly host: CanvasViewService) {}

   /** Render views for all elements plus any in-progress draft, resolved for the SVG layer. */
   readonly shapeViews = computed(() => {
      const draft = this.host.tools.draft();
      const hide = this.host.focusHidden();
      const shown = hide
         ? this.host.store.elements().filter((e) => !hide.elementIds.has(e.id))
         : this.host.store.elements();
      // A shown slide's layout items draw beneath it, locked.
      const locked = this.host.store.layoutItemIds();
      const editing = this.host.host.editingTextId();
      const looks = this.host.emptyCopyLooks();
      const fills = this.host.layoutFills();
      // Elements draw in array order, so a shown slide's layout items go first (beneath it).
      const ordered = locked.size
         ? [...shown.filter((e) => locked.has(e.id)), ...shown.filter((e) => !locked.has(e.id))]
         : shown;
      const masters = this.host.store.masterItemIds();
      const under = this.host.inheritedOffsets();
      const all = ordered.map((e) => {
         if (locked.has(e.id)) {
            // The master's items sit below the layout's.
            const depth = masters.has(e.id) ? 2 : 1;
            // Drawn where the shown slide is (its layout catches up once a drag settles).
            const d = e.slideId ? under.get(e.slideId) : undefined;
            const at = d ? { x: e.x + d.dx, y: e.y + d.dy } : {};
            return { ...e, ...at, zIndex: e.zIndex - LAYOUT_Z_OFFSET * depth, aboveTables: false };
         }
         const fill = fills.get(e.id);
         if (fill) return { ...e, ...fill };
         // An empty placeholder copy shows its layout slot's text, ghosted (not while typed into).
         const look = looks.get(e.id);
         if (look && e.id !== editing) return { ...look.el, opacity: look.el.opacity * 0.45 };
         if (isEmptyPlaceholder(e) && e.id !== editing) {
            return { ...e, text: placeholderPrompt(e.placeholder!), runs: undefined, opacity: e.opacity * 0.45 };
         }
         return e;
      });
      // Fields ({{slide}}, {{date}}, ...) stay as tokens on the canvas; they fill in when presenting/exporting.
      const filled = all;
      // A diff card being edited shows both sides plain, one under each of its two editors.
      const editedDiff = editing ? filled.find((e) => e.id === editing) : undefined;
      const diffEditingId = editedDiff?.type === 'code' && codeDiffActive(editedDiff) ? editing : null;
      // Deck theme tokens ($accent1, $heading, ...) resolve against each item's presentation.
      const elements = resolveThemedElements(draft ? [...filled, draft] : filled, this.host.store.slideFrames());
      // Depend on the theme so colors re-resolve (and re-contrast) on toggle, and re-measure
      // text once web fonts arrive.
      this.host.theme.dark$();
      this.host.fontMetrics.fontsLoaded$();
      const views = buildShapeViews(
         elements,
         this.host.visibleTables(),
         new Set(this.host.store.selectedElementIds()),
         this.host.themeColors(),
         this.host.messageBoxes(),
         diffEditingId,
         { cache: this.host.shapeViewCache, generation: this.host.fontMetrics.generation }
      );
      // Slide items staged wholly outside their frame (morph entrances/exits) are dimmed:
      // they are part of the slide but never shown when presenting.
      const frames = new Map(this.host.store.slideFrames().map((f) => [f.id, f]));
      const offSlide = new Set(
         elements
            .filter((e) => {
               const f = e.slideId ? frames.get(e.slideId) : undefined;
               if (!f || e.type === 'frame') return false;
               const b = elementBox(e);
               return b.x1 <= f.x || b.x0 >= f.x + f.width || b.y1 <= f.y || b.y0 >= f.y + f.height;
            })
            .map((e) => e.id)
      );
      // Derived copies are memoized per view, so unchanged items keep their object identity.
      const out = offSlide.size
         ? views.map((v) => (offSlide.has(v.id) ? variant(this.host.dimmedViews, v, dim) : v))
         : views;
      return locked.size ? out.map((v) => (locked.has(v.id) ? variant(this.host.lockedViews, v, lock) : v)) : out;
   });

   /** Dashed outlines around selected groups and the group currently entered. */
   readonly groupOutlines$ = computed(() => {
      const groups = this.host.store.groups();
      if (!groups.size) {
         return [];
      }
      const entered = this.host.store.enteredGroupId();
      const selT = new Set(this.host.store.selectedTableIds());
      const selE = new Set(this.host.store.selectedElementIds());
      const selD = new Set(this.host.store.selectedDiagramIds());
      const tables = new Map(this.host.store.tables().map((t) => [t.id, t] as const));
      const elements = new Map(this.host.store.elements().map((e) => [e.id, e] as const));
      const diagrams = new Map(this.host.store.sequenceDiagrams().map((d) => [d.id, d] as const));
      const lifelines = this.host.store.lifelines();
      const messages = this.host.store.sequenceMessages();
      const pad = 8;
      const out: {
         id: string;
         left: number;
         top: number;
         width: number;
         height: number;
         entered: boolean;
      }[] = [];
      for (const [gid, g] of groups) {
         const active =
            gid === entered ||
            g.tableIds.some((id) => selT.has(id)) ||
            g.elementIds.some((id) => selE.has(id)) ||
            g.diagramIds.some((id) => selD.has(id));
         if (!active) {
            continue;
         }
         const boxes: Box[] = [];
         for (const id of g.tableIds) {
            const t = tables.get(id);
            if (t) boxes.push(tableBox(t));
         }
         for (const id of g.elementIds) {
            const e = elements.get(id);
            if (e) boxes.push(elementBox(e));
         }
         for (const id of g.diagramIds) {
            const d = diagrams.get(id);
            const b = d ? sequenceDiagramBox(d, lifelines, messages) : null;
            if (b) boxes.push(b);
         }
         if (!boxes.length) {
            continue;
         }
         const x0 = Math.min(...boxes.map((b) => b.x0)) - pad;
         const y0 = Math.min(...boxes.map((b) => b.y0)) - pad;
         const x1 = Math.max(...boxes.map((b) => b.x1)) + pad;
         const y1 = Math.max(...boxes.map((b) => b.y1)) + pad;
         out.push({
            id: gid,
            left: x0,
            top: y0,
            width: x1 - x0,
            height: y1 - y0,
            entered: gid === entered,
         });
      }
      return out;
   });
}
