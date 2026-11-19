import { signal } from '@angular/core';
import { transitionMorphs, type SlideEasing } from '@devdesigner/shared';
import { MorphStage } from '../../../services/morph-stage';
import { parseSafeSvg } from '../../../helpers/svg-sanitize.helper';
import type { RenderedSlide } from '../../../services/slide-render.service';
import { ease } from '../../../helpers/ease.helper';

/** Lets the transition animate the outgoing and incoming layers. */
export type LayerSetup = (
   out: HTMLElement,
   inc: HTMLElement,
   animate: (el: HTMLElement, frames: Keyframe[]) => void
) => void;

/** Animate the objects of a live slide picture; `play` returns the total length (ms). */
export interface LiveLayer {
   markup: string;
   width: number;
   height: number;
   play: (svg: SVGSVGElement, add: (a: Animation) => void) => number;
}

/** One transition to play. */
export interface LayerRun {
   fromUrl: string;
   toUrl: string;
   duration: number;
   easing: SlideEasing;
   setup: LayerSetup;
   /** Applies the final state (called before the layers are removed). */
   commit: () => void;
   /** Replace the layers with a live morph stage. */
   morph?: { from: RenderedSlide; to: RenderedSlide; reversed?: boolean };
   live?: LiveLayer;
}

/** Unit vector (x, y) the slides travel along for a `slide` transition direction. */
const TRAVEL: Record<string, [number, number]> = {
   left: [-1, 0],
   right: [1, 0],
   up: [0, -1],
   down: [0, 1],
};

/**
 * The layer animation for a fade, slide or zoom transition (`morph` cross-fades whatever
 * the morph stage does not cover). Going back plays the transition reversed.
 */
export function transitionSetup(t: RenderedSlide['transition'], forward: boolean): LayerSetup {
   return (out, inc, animate) => {
      if (t.type === 'fade' || t.type === 'morph') {
         animate(inc, [{ opacity: 0 }, { opacity: 1 }]);
      } else if (t.type === 'slide') {
         // The slides travel in `direction`; coming back, they travel the other way.
         const base = TRAVEL[t.direction ?? 'left'] ?? TRAVEL['left'];
         const [dx, dy] = forward ? base : [-base[0], -base[1]];
         animate(out, [{ transform: 'translate(0, 0)' }, { transform: `translate(${dx * 100}%, ${dy * 100}%)` }]);
         animate(inc, [{ transform: `translate(${-dx * 100}%, ${-dy * 100}%)` }, { transform: 'translate(0, 0)' }]);
      } else {
         // zoom: the new slide grows into place while the old one swells and fades.
         animate(out, [
            { transform: 'scale(1)', opacity: 1 },
            { transform: `scale(${forward ? 1.4 : 0.6})`, opacity: 0 },
         ]);
         animate(inc, [
            { transform: `scale(${forward ? 0.6 : 1.4})`, opacity: 0 },
            { transform: 'scale(1)', opacity: 1 },
         ]);
      }
   };
}

/** Whether moving between two adjacent slides animates at all. */
export function transitionAnimates(t: RenderedSlide['transition']): boolean {
   return (t.type !== 'none' || transitionMorphs(t)) && t.duration > 0;
}

/** A transition layer sized and clipped to a `width` x `height` slide, centred on screen. */
function framedLayer(width: number, height: number): HTMLElement {
   const el = document.createElement('div');
   el.className = 'layer framed';
   el.style.setProperty('--slide-ar', String(width / Math.max(1, height)));
   return el;
}

/**
 * Plays presenter transitions on temporary layers inside `overlay` (never touching
 * project data). One run at a time: starting another, or `cancel()`, jumps the
 * current one to its end state.
 */
export class TransitionRunner {
   /** A transition is playing. */
   readonly busy = signal(false);
   private cancelRun: (() => void) | null = null;
   private seq = 0;

   constructor(private readonly overlay: () => HTMLElement) {}

   /** Finish the running transition now (its end state is committed). */
   cancel(): void {
      this.cancelRun?.();
   }

   run(spec: LayerRun): Promise<void> {
      const { fromUrl, toUrl, duration, easing, setup, commit, morph, live } = spec;
      const overlay = this.overlay();
      overlay.replaceChildren();
      const seq = (this.seq += 1);
      this.busy.set(true);

      return new Promise<void>((resolve) => {
         let raf = 0;
         const animations: Animation[] = [];
         let stage: MorphStage | null = null;
         let done = false;
         const finish = (): void => {
            if (done) return;
            done = true;
            cancelAnimationFrame(raf);
            // A live layer keeps its end state until it is removed, so an object that just left
            // does not flash back for the frames before the committed picture shows.
            for (const a of animations) {
               if (live) a.finish();
               else a.cancel();
            }
            this.cancelRun = null;
            // Show the result first, and only then take the transition layers away, so
            // there is never a frame with neither on screen (the black flash).
            commit();
            this.busy.set(false);
            let cleared = false;
            const clear = (): void => {
               if (cleared) return;
               cleared = true;
               stage?.dispose();
               if (this.seq === seq) overlay.replaceChildren();
            };
            requestAnimationFrame(() => requestAnimationFrame(clear));
            setTimeout(clear, 120);
            resolve();
         };
         this.cancelRun = finish;

         const layer = (url: string): HTMLElement => {
            const el = document.createElement('div');
            el.className = 'layer';
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.draggable = false;
            el.appendChild(img);
            overlay.appendChild(el);
            return el;
         };

         if (live) {
            const host = framedLayer(live.width, live.height);
            const parsed = parseSafeSvg(live.markup);
            if (parsed) host.appendChild(document.importNode(parsed, true));
            overlay.appendChild(host);
            const svg = host.querySelector('svg');
            if (!svg) {
               finish();
               return;
            }
            const total = live.play(svg, (a) => animations.push(a));
            // Settle when every motion has finished (or after the plan's length, if none ran).
            const settled = Promise.allSettled(animations.map((a) => a.finished));
            const timer = setTimeout(finish, total + 400);
            void settled.then(() => {
               clearTimeout(timer);
               finish();
            });
            return;
         }

         if (morph) {
            const s = new MorphStage(morph.from, morph.to, morph.reversed);
            stage = s;
            const host = framedLayer(morph.to.width, morph.to.height);
            host.appendChild(s.svg);
            overlay.appendChild(host);
            void s.prepare().then(() => {
               if (done) return;
               const begin = performance.now();
               const tick = (now: number): void => {
                  const p = Math.min(1, (now - begin) / duration);
                  s.update(ease(easing, p));
                  if (p < 1 && !done) raf = requestAnimationFrame(tick);
                  else finish();
               };
               raf = requestAnimationFrame(tick);
            });
            return;
         }

         const outgoing = layer(fromUrl);
         const incoming = layer(toUrl);
         const animate = (el: HTMLElement, frames: Keyframe[]): void => {
            animations.push(el.animate(frames, { duration, easing, fill: 'both' }));
         };
         setup(outgoing, incoming, animate);
         const last = animations[animations.length - 1];
         if (last) void last.finished.then(finish, finish);
         else finish();
      });
   }
}
