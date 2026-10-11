import { Injectable, inject } from '@angular/core';
import { morphTagOf, presentationOf, presentationSlides } from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';

/**
 * Morph tags used on a slide, so the tag fields can offer the previous slide's (a tag
 * only morphs when the next slide repeats it) and keep a tag to one object per slide.
 * Call inside a `computed` so it follows the store.
 */
@Injectable({ providedIn: 'root' })
export class MorphTagSuggestions {
  private readonly store = inject(ProjectStore);

  /** tag -> ids of the objects (elements, diagrams, participants, messages) of `slideId` carrying it. */
  private tagsOn(slideId: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const add = (id: string, morphId: string | undefined): void => {
      const t = morphTagOf(morphId);
      if (t) out.set(t, [...(out.get(t) ?? []), id]);
    };
    for (const e of this.store.elements()) {
      if (e.slideId === slideId) add(e.id, e.morphId);
    }
    const diagrams = new Set<string>();
    for (const d of this.store.sequenceDiagrams()) {
      if (d.slideId === slideId) {
        diagrams.add(d.id);
        add(d.id, d.morphId);
      }
    }
    for (const l of this.store.lifelines()) {
      if (diagrams.has(l.diagramId)) add(l.id, l.morphId);
    }
    for (const m of this.store.sequenceMessages()) {
      if (diagrams.has(m.diagramId)) add(m.id, m.morphId);
    }
    return out;
  }

  /** Distinct tags of the slide preceding `slideId` in its presentation (in drawing order). */
  previousSlideTags(slideId: string | undefined | null): string[] {
    if (!slideId) return [];
    const frames = this.store.slideFrames();
    const frame = frames.find((f) => f.id === slideId);
    if (!frame) return [];
    const slides = presentationSlides(frames, presentationOf(frame));
    const prev = slides[slides.findIndex((f) => f.id === slideId) - 1];
    // Solo tags (MCP-made "never morph" ids) are noise as suggestions.
    return prev ? [...this.tagsOn(prev.id).keys()].filter((t) => !t.startsWith('solo-')) : [];
  }

  /** Tags of `slideId` carried by an object outside `except` (those can't be given again). */
  tagsTakenOn(slideId: string | undefined | null, except: ReadonlySet<string>): string[] {
    if (!slideId) return [];
    return [...this.tagsOn(slideId)]
      .filter(([, ids]) => ids.some((id) => !except.has(id)))
      .map(([tag]) => tag);
  }
}
