// Object animations on a slide (PowerPoint-style animation pane). Pure functions over
// plain data: turn the ordered list into click groups with start times, work out what
// is visible after each group, and migrate the old per-element build `step`.

import type { SlideAnimation, SlideConfig } from '../models';
import {
  SLIDE_ANIMATION_EFFECTS_BY_KIND,
  type SlideAnimationEffect,
  type SlideAnimationKind,
  type SlideDirection,
} from '../enums';

/** Most animations one slide may carry. */
export const MAX_SLIDE_ANIMATIONS = 200;
export const DEFAULT_ANIMATION_DURATION = 500;
export const MAX_ANIMATION_DURATION = 10_000;
export const MAX_ANIMATION_DELAY = 30_000;

/** Effects that travel from / to a side of the slide. */
export const DIRECTIONAL_EFFECTS: ReadonlySet<SlideAnimationEffect> = new Set(['fly', 'wipe']);

export function newAnimationId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** A fresh animation of `target`: by default a fade-in that waits for a click. */
export function newAnimation(
  target: string,
  patch: Partial<Omit<SlideAnimation, 'id' | 'target'>> = {},
): SlideAnimation {
  return {
    id: newAnimationId(),
    target,
    kind: 'enter',
    effect: 'fade',
    trigger: 'click',
    duration: DEFAULT_ANIMATION_DURATION,
    delay: 0,
    ...patch,
  };
}

/** The effect to use when the kind changes and the current effect no longer applies. */
export function effectFor(kind: SlideAnimationKind, effect: SlideAnimationEffect): SlideAnimationEffect {
  const allowed = SLIDE_ANIMATION_EFFECTS_BY_KIND[kind];
  return allowed.includes(effect) ? effect : allowed[0];
}

/** One animation with its start/end (ms) relative to the moment its group begins. */
export interface PlannedAnimation {
  animation: SlideAnimation;
  start: number;
  end: number;
}

/** What one advance of the presentation plays (or, for the first, what plays by itself). */
export interface AnimationGroup {
  /** True for the leading group that has no click: it plays when the slide appears. */
  auto: boolean;
  entries: PlannedAnimation[];
  /** Milliseconds until the last entry has finished. */
  duration: number;
}

export interface AnimationPlan {
  groups: AnimationGroup[];
  /** Targets that are not on the slide before anything has played (their first animation enters). */
  initialHidden: ReadonlySet<string>;
}

const motionLength = (a: SlideAnimation): number => (a.effect === 'appear' ? 0 : a.duration);

/**
 * Group the list into steps. A `click` animation opens a new group; `with` starts when the
 * animation before it starts, `after` when that one ends (each plus its own delay).
 * Animations whose target is not in `valid` are skipped.
 */
export function planAnimations(
  animations: readonly SlideAnimation[],
  valid?: ReadonlySet<string>,
): AnimationPlan {
  const groups: AnimationGroup[] = [];
  const firstKind = new Map<string, SlideAnimationKind>();
  let prev: PlannedAnimation | null = null;
  for (const a of animations) {
    if (valid && !valid.has(a.target)) {
      continue;
    }
    if (!firstKind.has(a.target)) {
      firstKind.set(a.target, a.kind);
    }
    let group = groups[groups.length - 1];
    if (a.trigger === 'click' || !group) {
      group = { auto: a.trigger !== 'click', entries: [], duration: 0 };
      groups.push(group);
      prev = null;
    }
    const base = !prev || a.trigger === 'click' ? 0 : a.trigger === 'with' ? prev.start : prev.end;
    const start = base + Math.max(0, a.delay);
    const planned: PlannedAnimation = { animation: a, start, end: start + motionLength(a) };
    group.entries.push(planned);
    group.duration = Math.max(group.duration, planned.end);
    prev = planned;
  }
  const initialHidden = new Set<string>();
  for (const [target, kind] of firstKind) {
    if (kind === 'enter') {
      initialHidden.add(target);
    }
  }
  return { groups, initialHidden };
}

/**
 * Targets hidden after `step` groups have played (0 = before anything). Entrances reveal,
 * exits hide; emphasis changes nothing.
 */
export function hiddenAtStep(plan: AnimationPlan, step: number): Set<string> {
  const hidden = new Set(plan.initialHidden);
  const n = Math.min(Math.max(0, step), plan.groups.length);
  for (let i = 0; i < n; i += 1) {
    for (const { animation: a } of plan.groups[i].entries) {
      if (a.kind === 'enter') {
        hidden.delete(a.target);
      } else if (a.kind === 'exit') {
        hidden.add(a.target);
      }
    }
  }
  return hidden;
}

/** An item that can carry the old build step (an element). */
export interface LegacyStepItem {
  id: string;
  step?: number | null;
  x: number;
  y: number;
}

/**
 * The animations a slide has from the old per-element build step: each step number is one
 * click, in order; items within a step fade in together.
 */
export function legacyAnimations(items: readonly LegacyStepItem[]): SlideAnimation[] {
  const stepped = items
    .filter((i) => (i.step ?? 0) > 0)
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0) || a.y - b.y || a.x - b.x);
  const out: SlideAnimation[] = [];
  let last = -1;
  for (const i of stepped) {
    const click = i.step !== last;
    last = i.step ?? 0;
    out.push({
      id: `legacy-${i.id}`,
      target: i.id,
      kind: 'enter',
      effect: 'fade',
      trigger: click ? 'click' : 'with',
      duration: 400,
      delay: 0,
    });
  }
  return out;
}

/** The slide's animations: its own list, or the ones its elements' old build steps imply. */
export function slideAnimations(
  slide: SlideConfig | undefined,
  items: readonly LegacyStepItem[],
): SlideAnimation[] {
  return slide?.animations ?? legacyAnimations(items);
}

/** Re-point animations at copied objects (`idMap`: source id -> copy id); others are dropped. */
export function remapAnimations(
  animations: readonly SlideAnimation[],
  idMap: ReadonlyMap<string, string>,
): SlideAnimation[] {
  const out: SlideAnimation[] = [];
  for (const a of animations) {
    const target = idMap.get(a.target);
    if (target) {
      out.push({ ...a, target });
    }
  }
  return out;
}

/** Clamp durations/delays and drop settings that do not apply to the effect. */
export function normalizeAnimations(list: readonly SlideAnimation[]): SlideAnimation[] {
  return list.map((a) => {
    const duration = Math.min(MAX_ANIMATION_DURATION, Math.max(0, Math.round(a.duration)));
    const delay = Math.min(MAX_ANIMATION_DELAY, Math.max(0, Math.round(a.delay)));
    const direction: SlideDirection | undefined = DIRECTIONAL_EFFECTS.has(a.effect)
      ? (a.direction ?? 'left')
      : undefined;
    return { ...a, effect: effectFor(a.kind, a.effect), duration, delay, direction };
  });
}

/** Whether a slide's entrance morphs the objects it shares with the slide before it. */
export function transitionMorphs(t: { type: string; morph?: boolean } | undefined | null): boolean {
  // Every transition morphs the objects two slides share, except None (a plain cut).
  return !!t && t.type !== 'none';
}

/** Per-object "animate by" settings re-keyed to copied ids (entries whose object is gone drop). */
export function remapMorphByItems<T>(
  items: Readonly<Record<string, T>> | undefined,
  idMap: { get(id: string): string | undefined },
): Record<string, T> | undefined {
  if (!items) return undefined;
  const out: Record<string, T> = {};
  for (const [id, v] of Object.entries(items)) {
    const to = idMap.get(id);
    if (to) out[to] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
