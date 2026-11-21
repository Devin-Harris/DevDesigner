import {
   messageKeys,
   presentationOf,
   presentationSlides,
   type AnimationSource,
   type CanvasElementModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
} from '@devdesigner/shared';

/** What the animation logic needs from the project (a ProjectStore snapshot). */
export interface AnimationProject {
   elements: readonly CanvasElementModel[];
   diagrams: readonly SequenceDiagramModel[];
   messages: readonly SequenceMessageModel[];
   slideFrames: readonly CanvasElementModel[];
}

/**
 * The objects a slide OWNS, as the animation logic reads them (pieces, automatic
 * animations). Free canvas content and layout / master items never animate on their own,
 * and the slide before's messages are passed as `seen` so the automatic message reveal
 * only brings in what is new.
 */
export function slideAnimationSource(frame: CanvasElementModel, project: AnimationProject): AnimationSource {
   const diagrams = project.diagrams.filter((d) => d.slideId === frame.id);
   const ids = new Set(diagrams.map((d) => d.id));
   return {
      elements: project.elements.filter((e) => e.slideId === frame.id && e.type !== 'frame'),
      diagrams,
      messages: project.messages.filter((m) => ids.has(m.diagramId)),
      seen: previousSlideMessages(frame, project),
   };
}

/** Message keys (`messageKeys`) of the slide before `frame` in its presentation. */
function previousSlideMessages(frame: CanvasElementModel, project: AnimationProject): Set<string> | undefined {
   if (!frame.slide || frame.slide.layout) {
      return undefined;
   }
   const deck = presentationSlides(project.slideFrames, presentationOf(frame));
   const at = deck.findIndex((f) => f.id === frame.id);
   const prev = at > 0 ? deck[at - 1] : null;
   if (!prev) {
      return undefined;
   }
   const prevDiagrams = new Set(project.diagrams.filter((d) => d.slideId === prev.id).map((d) => d.id));
   const out = new Set<string>();
   for (const m of project.messages) {
      if (prevDiagrams.has(m.diagramId)) {
         for (const k of messageKeys(m)) out.add(k);
      }
   }
   return out;
}
