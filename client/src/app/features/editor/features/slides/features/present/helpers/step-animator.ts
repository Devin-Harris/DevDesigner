import type { AnimationGroup, PlannedAnimation, SlideDirection } from '@devdesigner/shared';
import type { RenderedSlide } from '../../../services/slide-render.service';

/** How long undoing a group (stepping back) takes. */
const UNDO_MS = 240;

/** A group's motion plus the time it needs, for the player to wait on. */
export interface PlayedGroup {
   /** Milliseconds until everything has settled. */
   duration: number;
}

type Add = (animation: Animation) => void;

/** The element tagged for an animation target (element, table or sequence diagram). */
function targetNode(svg: SVGSVGElement, id: string): SVGGraphicsElement | null {
   const safe = id.replace(/["\\]/g, '');
   return svg.querySelector<SVGGraphicsElement>(`[data-eid="${safe}"], [data-tid="${safe}"], [data-seq="${safe}"]`);
}

/** The slide's edges in screen px and how many screen px one slide unit is. */
function slideFrame(svg: SVGSVGElement): { left: number; top: number; right: number; bottom: number; scale: number } {
   const m = svg.getScreenCTM();
   const box = svg.viewBox.baseVal;
   const scale = m?.a || 1;
   const left = m?.e ?? 0;
   const top = m?.f ?? 0;
   return { left, top, right: left + box.width * scale, bottom: top + box.height * scale, scale };
}

/** How far (slide units) `el` must move to sit just off the slide on side `dir`. */
function offSlide(svg: SVGSVGElement, el: Element, dir: SlideDirection): { x: number; y: number } {
   const f = slideFrame(svg);
   const r = el.getBoundingClientRect();
   switch (dir) {
      case 'left':
         return { x: -(r.right - f.left) / f.scale, y: 0 };
      case 'right':
         return { x: (f.right - r.left) / f.scale, y: 0 };
      case 'up':
         return { x: 0, y: -(r.bottom - f.top) / f.scale };
      default:
         return { x: 0, y: (f.bottom - r.top) / f.scale };
   }
}

const WIPE_AWAY: Record<SlideDirection, string> = {
   left: 'inset(0 100% 0 0)',
   right: 'inset(0 0 0 100%)',
   up: 'inset(0 0 100% 0)',
   down: 'inset(100% 0 0 0)',
};

/** The frames of an entrance (from "away" to "rest"); an exit plays them backwards. */
function enterFrames(svg: SVGSVGElement, el: SVGGraphicsElement, a: PlannedAnimation['animation']): Keyframe[] {
   const dir = a.direction ?? 'left';
   switch (a.effect) {
      case 'fly': {
         const o = offSlide(svg, el, dir);
         return [{ transform: `translate(${o.x}px, ${o.y}px)` }, { transform: 'translate(0px, 0px)' }];
      }
      case 'wipe':
         return [{ clipPath: WIPE_AWAY[dir] }, { clipPath: 'inset(0 0 0 0)' }];
      case 'zoom':
         el.style.transformBox = 'fill-box';
         el.style.transformOrigin = 'center';
         return [
            { transform: 'scale(0.15)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1 },
         ];
      case 'appear':
      case 'fade':
      default:
         return [{ opacity: 0 }, { opacity: 1 }];
   }
}

/** Fade the connectors of a table with the table's own animation. */
function followConnectors(
   svg: SVGSVGElement,
   slide: RenderedSlide,
   group: AnimationGroup,
   play: (el: Element, frames: Keyframe[], p: PlannedAnimation, easing: string) => void
): void {
   const enters = new Map<string, PlannedAnimation>();
   const exits = new Map<string, PlannedAnimation>();
   for (const p of group.entries) {
      const into = p.animation.kind === 'enter' ? enters : p.animation.kind === 'exit' ? exits : null;
      if (into) {
         into.set(p.animation.target, p);
      }
   }
   if (!enters.size && !exits.size) {
      return;
   }
   for (const [rid, ends] of slide.relationshipEnds) {
      const path = svg.querySelector(`[data-rid="${rid.replace(/["\\]/g, '')}"]`);
      if (!path) {
         continue;
      }
      const entering = ends.map((t) => enters.get(t)).filter((p): p is PlannedAnimation => !!p);
      const exiting = ends.map((t) => exits.get(t)).filter((p): p is PlannedAnimation => !!p);
      if (entering.length) {
         const last = entering.reduce((m, p) => (p.end > m.end ? p : m));
         play(path, [{ opacity: 0 }, { opacity: 1 }], last, 'ease-out');
      } else if (exiting.length) {
         const first = exiting.reduce((m, p) => (p.start < m.start ? p : m));
         play(path, [{ opacity: 1 }, { opacity: 0 }], first, 'ease-in');
      }
   }
}

/**
 * Play one group forward on a live copy of the slide (`svg` is the group's mix picture:
 * everything visible before or after it). Entrances start hidden and move in, exits
 * leave, emphasis pulses. Returns when the last motion ends (ms).
 */
export function playGroup(svg: SVGSVGElement, slide: RenderedSlide, group: AnimationGroup, add: Add): PlayedGroup {
   const run = (el: Element, frames: Keyframe[], p: PlannedAnimation, easing: string): void => {
      const length = p.animation.effect === 'appear' ? 1 : Math.max(1, p.animation.duration);
      add(
         el.animate(frames, {
            duration: length,
            delay: p.start,
            easing: p.animation.effect === 'appear' ? 'steps(1, end)' : easing,
            fill: 'both',
         })
      );
   };
   for (const p of group.entries) {
      const el = targetNode(svg, p.animation.target);
      if (!el) {
         continue;
      }
      const a = p.animation;
      if (a.kind === 'emphasis') {
         el.style.transformBox = 'fill-box';
         el.style.transformOrigin = 'center';
         run(
            el,
            [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.5 }, { transform: 'scale(1)' }],
            p,
            'ease-in-out'
         );
      } else if (a.kind === 'enter') {
         run(el, enterFrames(svg, el, a), p, 'ease-out');
      } else {
         run(el, [...enterFrames(svg, el, a)].reverse(), p, 'ease-in');
      }
   }
   followConnectors(svg, slide, group, run);
   return { duration: group.duration };
}

/**
 * Step back over a group: what it brought in fades out and what it took away fades back,
 * together and quickly (backing up should not replay the show in slow motion).
 */
export function undoGroup(svg: SVGSVGElement, slide: RenderedSlide, group: AnimationGroup, add: Add): PlayedGroup {
   const fade = (el: Element, from: number, to: number): void => {
      add(
         el.animate([{ opacity: from }, { opacity: to }], {
            duration: UNDO_MS,
            easing: 'ease',
            fill: 'both',
         })
      );
   };
   const entered = new Set<string>();
   const left = new Set<string>();
   for (const { animation: a } of group.entries) {
      if (a.kind === 'enter') {
         entered.add(a.target);
      } else if (a.kind === 'exit') {
         left.add(a.target);
      }
   }
   for (const id of entered) {
      const el = targetNode(svg, id);
      if (el) {
         fade(el, 1, 0);
      }
   }
   for (const id of left) {
      const el = targetNode(svg, id);
      if (el) {
         fade(el, 0, 1);
      }
   }
   for (const [rid, ends] of slide.relationshipEnds) {
      const path = svg.querySelector(`[data-rid="${rid.replace(/["\\]/g, '')}"]`);
      if (!path) {
         continue;
      }
      if (ends.some((t) => entered.has(t))) {
         fade(path, 1, 0);
      } else if (ends.some((t) => left.has(t))) {
         fade(path, 0, 1);
      }
   }
   return { duration: UNDO_MS };
}
