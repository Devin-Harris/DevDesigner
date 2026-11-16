import { patchState, signalStoreFeature, type, withMethods, withProps } from '@ngrx/signals';
import { presentationOf } from '@devdesigner/shared';
import { MIN_SLIDE_ZOOM, slideViewRegion } from '../../../helpers/slide-zoom.helper';
import type { Signal } from '@angular/core';
import type { ProjectInternals } from './project-internals';

type PlacementHost = Pick<ProjectInternals['props'], 'shownSlideIds' | 'slideFrames'> & {
   slideZoom: Signal<Record<string, number>>;
};

/** Where new content lands: the shown slide under a canvas point (`_placement.shownSlideAt`). */
function createPlacement(store: PlacementHost) {
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

   return {
      shownSlideAt,
      setPointerSlide(id: string | null): void {
         pointerSlide = id;
      },
   };
}

export type SlidePlacement = ReturnType<typeof createPlacement>;

/** The slide/presentation shown on the canvas, per-presentation view zoom, and `_placement`. */
export function withProjectSlidesMethods() {
   return signalStoreFeature(
      type<ProjectInternals>(),
      withProps((store) => ({ _placement: createPlacement(store) })),
      withMethods((store) => ({
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
            store._placement.setPointerSlide(id);
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
      }))
   );
}
