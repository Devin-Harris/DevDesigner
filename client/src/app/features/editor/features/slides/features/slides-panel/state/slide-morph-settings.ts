import { computed } from '@angular/core';
import {
   type CanvasElementModel,
   type MorphBy,
   type SlideConfig,
   type SlideTransition,
   effectiveTransition,
   morphIdForTag,
   morphTagOf,
   presentationOf,
} from '@devdesigner/shared';
import type { SlidesPanelState } from './slides-panel.state';

/** Morph tags, transitions and notes setters for the slides panel. */
export class SlideMorphSettings {
   constructor(private readonly host: SlidesPanelState) {}

   /** Rename the presentation (every one of its slides carries the name). */
   commitRename(input: HTMLInputElement): void {
      const current = this.host.presentation$();
      const name = input.value.trim().slice(0, 120);
      if (!name || name === current || this.host.store.presentations().includes(name)) {
         input.value = current;
         return;
      }
      // Layouts carry the presentation name too.
      const slides = this.host.store.slideFrames().filter((f) => presentationOf(f) === current);
      const shown = this.host.active_$();
      void this.host.store
         .batchHistory(async () => {
            for (const f of slides) {
               if (f.slide) {
                  await this.host.store.updateElement(f.id, { slide: { ...f.slide, presentation: name } });
               }
            }
         })
         // The shown slide and the selection follow the new name.
         .finally(() => (shown ? this.host.store.setActiveSlide(shown) : undefined));
   }

   /**
    * Everything selected that can carry a morph tag: canvas elements plus sequence
    * participants, messages and diagrams (which the element selection doesn't hold).
    */
   readonly tagTargets = computed(() => {
      const out: Array<{
         kind: 'element' | 'table' | 'lifeline' | 'message' | 'diagram';
         id: string;
         morphId?: string;
         slideId?: string;
      }> = this.host.selectedObjects().map((e) => ({
         kind: 'element',
         id: e.id,
         morphId: e.morphId,
         slideId: e.slideId,
      }));
      const tables = new Set(this.host.store.selectedTableIds());
      for (const t of this.host.store.tables()) {
         if (tables.has(t.id)) {
            out.push({ kind: 'table', id: t.id, morphId: t.morphId, slideId: t.slideId });
         }
      }
      const diagrams = new Map(this.host.store.sequenceDiagrams().map((d) => [d.id, d] as const));
      const lifelines = new Set(this.host.store.selectedLifelineIds());
      const messages = new Set(this.host.store.selectedMessageIds());
      const boxes = new Set(this.host.store.selectedDiagramIds());
      for (const l of this.host.store.lifelines()) {
         if (lifelines.has(l.id)) {
            out.push({
               kind: 'lifeline',
               id: l.id,
               morphId: l.morphId,
               slideId: diagrams.get(l.diagramId)?.slideId,
            });
         }
      }
      for (const m of this.host.store.sequenceMessages()) {
         if (messages.has(m.id)) {
            out.push({
               kind: 'message',
               id: m.id,
               morphId: m.morphId,
               slideId: diagrams.get(m.diagramId)?.slideId,
            });
         }
      }
      for (const d of diagrams.values()) {
         if (boxes.has(d.id)) {
            out.push({ kind: 'diagram', id: d.id, morphId: d.morphId, slideId: d.slideId });
         }
      }
      return out;
   });

   /** Split: start both sides from the shared tag. Join: drop both (the shared tag applies). */
   toggleSplit(st: { id: string; split: boolean; in?: string; out?: string }): void {
      const e = this.host.store.elements().find((x) => x.id === st.id);
      if (!e) return;
      const base = e.morphId ?? `tag:solo-${e.id.slice(0, 8)}`;
      void this.host.store.updateElement(
         e.id,
         st.split ? { morphIn: null, morphOut: null } : { morphIn: base, morphOut: base }
      );
   }

   setSplitTag(side: 'in' | 'out', value: string): void {
      const st = this.host.splitTarget$();
      if (!st) return;
      const key = morphIdForTag(value) ?? `tag:solo-${side}-${st.id.slice(0, 8)}`;
      void this.host.store.updateElement(st.id, side === 'in' ? { morphIn: key } : { morphOut: key });
   }

   // ---- edits ----

   toggleHidden(f: CanvasElementModel): void {
      if (!f.slide) {
         return;
      }
      void this.host.store.updateElement(f.id, { slide: { ...f.slide, hidden: !f.slide.hidden } });
   }

   removeFromSequence(f: CanvasElementModel): void {
      void this.host.store.updateElement(f.id, { slide: null });
   }

   /** Change the transition of the selected slides (the first slide has none). */
   setTransition(patch: Partial<SlideTransition>): void {
      const first = this.host.frames$()[0]?.id;
      const base = this.host.activeSlides$().length
         ? this.host.activeSlides$()
         : this.host.active$()
           ? [this.host.active$()!]
           : [];
      const targets = base.filter((f) => f.slide && f.id !== first);
      if (!targets.length) {
         return;
      }
      void this.host.store.batchHistory(async () => {
         for (const f of targets) {
            const slide: SlideConfig = {
               ...f.slide!,
               transition: { ...effectiveTransition(f.slide), ...patch },
            };
            await this.host.store.updateElement(f.id, { slide });
         }
      });
   }

   readonly pairAnimateBy = [
      { value: 'default', label: 'Default' },
      { value: 'character', label: 'Char' },
      { value: 'word', label: 'Word' },
      { value: 'object', label: 'Object' },
   ];

   /** Set (or with 'default', clear) one object's "animate by" on the active slide. */
   setItemMorphBy(id: string, by: string): void {
      const f = this.host.active$();
      if (!f?.slide) return;
      const t = effectiveTransition(f.slide);
      const { [id]: _old, ...rest } = t.morphByItems ?? {};
      const items = by === 'default' ? rest : { ...rest, [id]: by as MorphBy };
      void this.host.store.updateElement(f.id, {
         slide: { ...f.slide, transition: { ...t, morphByItems: Object.keys(items).length ? items : undefined } },
      });
   }

   setDuration(raw: string): void {
      const ms = Math.min(5000, Math.max(100, Math.round(Number(raw)) || 600));
      this.setTransition({ duration: ms });
   }

   setNotes(value: string): void {
      const a = this.host.active$();
      if (!a?.slide || (a.slide.notes ?? '') === value) {
         return;
      }
      void this.host.store.updateElement(a.id, { slide: { ...a.slide, notes: value || undefined } });
   }

   applyToAll(): void {
      const t = this.host.transition$();
      const frames = this.host.frames$();
      void this.host.store.batchHistory(async () => {
         for (const f of frames) {
            if (f.slide) {
               await this.host.store.updateElement(f.id, { slide: { ...f.slide, transition: { ...t } } });
            }
         }
      });
   }

   /**
    * Tag the selected objects (elements and sequence parts; blank clears it) so only
    * same-tagged objects morph together.
    */
   setMorphTag(value: string): void {
      const morphId = morphIdForTag(value);
      // A placeholder copy whose layout slot is tagged would fall back to that tag when
      // cleared, so clearing gives it its own id instead (an untagged override).
      const slotTag = (id: string): string | undefined => {
         const of = this.host.store.elements().find((e) => e.id === id)?.placeholder?.of;
         const tag = of ? this.host.store.elements().find((p) => p.id === of)?.morphId : undefined;
         return morphTagOf(tag) !== null ? tag : undefined;
      };
      const next = (t: { kind: string; id: string }): string | null =>
         morphId === null && t.kind === 'element' && slotTag(t.id) ? t.id : morphId;
      const targets = this.tagTargets().filter((e) =>
         morphId === null
            ? morphTagOf(e.morphId) !== null || (e.kind === 'element' && !e.morphId && !!slotTag(e.id))
            : e.morphId !== morphId
      );
      if (!targets.length) {
         return;
      }
      void this.host.store.batchHistory(async () => {
         for (const t of targets) {
            if (t.kind === 'element') {
               await this.host.store.updateElement(t.id, { morphId: next(t) });
            } else if (t.kind === 'table') {
               await this.host.store.updateTable(t.id, { morphId: morphId ?? '' });
            } else if (t.kind === 'lifeline') {
               await this.host.store.updateLifeline(t.id, { morphId: morphId ?? '' });
            } else if (t.kind === 'message') {
               await this.host.store.updateMessage(t.id, { morphId: morphId ?? '' });
            } else {
               await this.host.store.updateSequenceConfig(t.id, { morphId: morphId ?? '' });
            }
         }
      });
   }

   /** Make the selected elements one lineage so they morph into each other across slides. */
   pairSelected(): void {
      const ids = new Set(this.host.store.selectedElementIds());
      const picked = this.host.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
      if (picked.length < 2) {
         return;
      }
      const key = picked[0].morphId ?? picked[0].id;
      void this.host.store.batchHistory(async () => {
         for (const e of picked) {
            if ((e.morphId ?? e.id) !== key) {
               await this.host.store.updateElement(e.id, { morphId: key });
            }
         }
      });
   }
}
