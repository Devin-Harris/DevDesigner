import { isDiffAnimation } from '@devdesigner/shared';
import { slideAtStep, type RenderedSlide } from '../../../services/slide-render.service';
import { playGroup, undoGroup } from './step-animator';
import type { TransitionRunner } from './transition-runner';

/**
 * Move a slide from build step `from` to `to` on `runner`'s overlay. One step forward plays
 * that group's animations (a code block's diff reveal morphs); one back undoes it quickly;
 * a longer jump cross-fades. `urlFor(step)` is the picture of the slide at a step and
 * `commit` applies the final step once the motion has ended. Shared by present mode and
 * the animation preview in the slide panel.
 */
export async function playSlideStep(
   runner: TransitionRunner,
   slide: RenderedSlide,
   from: number,
   to: number,
   urlFor: (step: number) => string,
   commit: () => void
): Promise<void> {
   if (to === from) {
      return;
   }
   if (slide.maxStep > 0 && Math.abs(to - from) === 1) {
      const forward = to > from;
      const k = forward ? to : from;
      const group = slide.plan.groups[k - 1];
      const mix = slide.mixSvgs[k];
      // A code block revealing its diff morphs from the original code to the diff (and
      // back), so the whole step plays as a morph between the two states.
      if (group?.entries.some((e) => isDiffAnimation(e.animation))) {
         await runner.run({
            fromUrl: urlFor(from),
            toUrl: urlFor(to),
            duration: forward ? Math.max(200, group.duration) : 320,
            easing: 'ease-in-out',
            setup: (_out, inc, animate) => animate(inc, [{ opacity: 0 }, { opacity: 1 }]),
            commit,
            morph: { from: slideAtStep(slide, from), to: slideAtStep(slide, to), reversed: !forward },
         });
         return;
      }
      if (group && mix) {
         await runner.run({
            fromUrl: '',
            toUrl: '',
            duration: 0,
            easing: 'linear',
            setup: () => undefined,
            commit,
            live: {
               markup: mix,
               width: slide.width,
               height: slide.height,
               play: (svg, add) => (forward ? playGroup : undoGroup)(svg, slide, group, add).duration,
            },
         });
         return;
      }
   }
   await runner.run({
      fromUrl: urlFor(from),
      toUrl: urlFor(to),
      duration: 280,
      easing: 'ease',
      setup: (_out, inc, animate) => animate(inc, [{ opacity: 0 }, { opacity: 1 }]),
      commit,
   });
}
