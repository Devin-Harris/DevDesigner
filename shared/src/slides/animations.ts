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
export const DEFAULT_ANIMATION_DURATION = 300;
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

/** A code block's diff as an animation part: hidden = the original code shows, shown = the diff. */
export const DIFF_PART = 'diff';

/**
 * What an animation shows or hides: the whole target (its id) or one piece of it
 * (`<target>#<part>`). Hidden sets (`hiddenAtStep`) hold these keys.
 */
export function animationKey(a: Pick<SlideAnimation, 'target' | 'part'>): string {
  return a.part ? `${a.target}#${a.part}` : a.target;
}

/** The part of `target` named by a hidden-set key (null when the key is the target itself or another object). */
export function partOfKey(key: string, target: string): string | null {
  return key.startsWith(`${target}#`) ? key.slice(target.length + 1) : null;
}

/** Whether an animation is a code block's diff reveal (always morphs). */
export function isDiffAnimation(a: Pick<SlideAnimation, 'part'>): boolean {
  return a.part === DIFF_PART;
}

/** The paragraph part of the n-th line of a text (`p<n>`). */
export const paragraphPart = (n: number): string => `p${n}`;

/** The paragraph index of a `p<n>` part (null for other parts). */
export function paragraphOfPart(part: string): number | null {
  const m = /^p(\d+)$/.exec(part);
  return m ? Number(m[1]) : null;
}

/** What a slide's objects are made of, for working out their animation pieces and defaults. */
export interface AnimationSource {
  elements: ReadonlyArray<{
    id: string;
    type: string;
    text?: string;
    diffText?: string;
    diffView?: string;
    x: number;
    y: number;
  }>;
  diagrams: ReadonlyArray<{ id: string; originY: number }>;
  messages: ReadonlyArray<{ id: string; diagramId: string; y: number; morphId?: string | null; label?: string }>;
  /**
   * Messages the slide before already shows (`messageKeys` of its messages): the automatic
   * reveal leaves those in place and only brings in the new ones.
   */
  seen?: ReadonlySet<string>;
}

/** Keys a message is recognised by on the next slide: its lineage and its label. */
export function messageKeys(m: { id: string; morphId?: string | null; label?: string }): string[] {
  const keys = [`m:${m.morphId ?? m.id}`];
  const label = m.label?.trim();
  if (label) keys.push(`l:${label}`);
  return keys;
}

/**
 * The pieces each object can be staggered over, in play order: a text's non-empty
 * paragraphs, a sequence diagram's messages (top to bottom).
 */
export function animationParts(src: AnimationSource): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of src.elements) {
    if (e.type !== 'text' || !e.text) continue;
    const parts = e.text
      .split('\n')
      .flatMap((line, i) => (line.trim() ? [paragraphPart(i)] : []));
    if (parts.length) out.set(e.id, parts);
  }
  const byDiagram = new Map<string, Array<{ id: string; y: number }>>();
  for (const m of src.messages) {
    const list = byDiagram.get(m.diagramId) ?? [];
    list.push(m);
    byDiagram.set(m.diagramId, list);
  }
  for (const [id, list] of byDiagram) {
    out.set(
      id,
      [...list].sort((a, b) => a.y - b.y).map((m) => m.id),
    );
  }
  return out;
}

/** Whether a code element shows a diff (and so gets the automatic original -> diff reveal). */
function showsDiff(e: AnimationSource['elements'][number]): boolean {
  return e.type === 'code' && !!e.diffText && !!e.diffView && e.diffView !== 'off';
}

/** Id of an automatic animation (stable, so editing it keeps its row). */
export const autoAnimationId = (target: string): string => `auto-${target}`;

/**
 * The animations objects get without being set up: a code block with a diff shows its
 * original and morphs to the diff on a click; a sequence diagram reveals its messages one
 * click at a time. Skipped for objects in `slide.animationsOff` and objects the explicit
 * list already animates that way (once a default is edited it lives in the list).
 */
export function defaultAnimations(
  explicit: readonly SlideAnimation[],
  off: readonly string[] | undefined,
  src: AnimationSource,
): SlideAnimation[] {
  const skip = new Set(off ?? []);
  const diffDone = new Set(explicit.filter(isDiffAnimation).map((a) => a.target));
  const piecesDone = new Set(explicit.filter((a) => a.stagger || (a.part && !isDiffAnimation(a))).map((a) => a.target));
  const out: Array<{ y: number; x: number; a: SlideAnimation }> = [];
  for (const e of src.elements) {
    if (!showsDiff(e) || skip.has(e.id) || diffDone.has(e.id)) continue;
    out.push({
      y: e.y,
      x: e.x,
      a: {
        id: autoAnimationId(e.id),
        target: e.id,
        part: DIFF_PART,
        kind: 'enter',
        effect: 'morph',
        trigger: 'click',
        duration: 300,
        delay: 0,
      },
    });
  }
  const seen = src.seen;
  for (const d of src.diagrams) {
    if (skip.has(d.id) || piecesDone.has(d.id)) continue;
    const mine = src.messages.filter((m) => m.diagramId === d.id);
    const old = seen ? mine.filter((m) => messageKeys(m).some((k) => seen.has(k))).map((m) => m.id) : [];
    // Nothing new since the slide before: nothing to reveal.
    if (mine.length === old.length) continue;
    out.push({
      y: d.originY,
      x: 0,
      a: {
        id: autoAnimationId(d.id),
        target: d.id,
        kind: 'enter',
        effect: 'fade',
        trigger: 'click',
        duration: 300,
        delay: 0,
        stagger: { trigger: 'click', delay: 0, ...(old.length ? { skip: old } : {}) },
      },
    });
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x).map((o) => o.a);
}

/** Whether an animation is one of the automatic ones (not yet saved in the slide's list). */
export function isAutoAnimation(a: Pick<SlideAnimation, 'id'>, explicit: readonly SlideAnimation[]): boolean {
  return a.id.startsWith('auto-') && !explicit.some((e) => e.id === a.id);
}

/**
 * Expand staggered animations into one animation per piece (`parts`: target -> pieces in
 * order). The first piece keeps the animation's trigger and delay; later pieces use the
 * stagger's (pieces in `joined` start with the one before). Animations without pieces
 * stay whole.
 */
export function expandStagger(
  animations: readonly SlideAnimation[],
  parts: ReadonlyMap<string, readonly string[]> | undefined,
): SlideAnimation[] {
  const out: SlideAnimation[] = [];
  for (const a of animations) {
    const skipped = new Set(a.stagger?.skip ?? []);
    const pieces = a.stagger && !a.part ? parts?.get(a.target)?.filter((p) => !skipped.has(p)) : undefined;
    if (!a.stagger || !pieces?.length) {
      out.push(a.stagger ? { ...a, stagger: undefined } : a);
      continue;
    }
    const joined = new Set(a.stagger.joined ?? []);
    pieces.forEach((part, i) => {
      const first = i === 0;
      out.push({
        ...a,
        id: `${a.id}:${part}`,
        part,
        stagger: undefined,
        // Later pieces either wait for a click or start `delay` ms after the piece before
        // STARTED (the gap is start-to-start, never stretched by the duration).
        trigger: first ? a.trigger : joined.has(part) || a.stagger!.trigger !== 'click' ? 'with' : 'click',
        delay: first ? a.delay : joined.has(part) || a.stagger!.trigger === 'click' ? 0 : a.stagger!.delay,
      });
    });
  }
  return out;
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
 * Animations whose target is not in `valid` are skipped; staggered ones are first split
 * into their pieces (`parts`, see `animationParts`).
 */
export function planAnimations(
  animations: readonly SlideAnimation[],
  valid?: ReadonlySet<string>,
  parts?: ReadonlyMap<string, readonly string[]>,
): AnimationPlan {
  const groups: AnimationGroup[] = [];
  const firstKind = new Map<string, SlideAnimationKind>();
  let prev: PlannedAnimation | null = null;
  let prevWhole: { start: number; end: number } | null = null;
  let prevRow: string | null = null;
  for (const a of expandStagger(animations, parts)) {
    if (valid && !valid.has(a.target)) {
      continue;
    }
    const key = animationKey(a);
    if (!firstKind.has(key)) {
      firstKind.set(key, a.kind);
    }
    let group = groups[groups.length - 1];
    if (a.trigger === 'click' || !group) {
      group = { auto: a.trigger !== 'click', entries: [], duration: 0 };
      groups.push(group);
      prev = null;
      prevWhole = null;
      prevRow = null;
    }
    // Pieces of one staggered animation follow each other; the next animation times itself
    // against the whole of it (with = when its first piece starts, after = when its last ends).
    const rowId = a.part && a.id.endsWith(`:${a.part}`) ? a.id.slice(0, -a.part.length - 1) : a.id;
    const samePiece = !!prev && prevRow === rowId;
    const ref = samePiece ? prev : prevWhole;
    const base =
      !ref || a.trigger === 'click' ? 0 : a.trigger === 'with' ? ref.start : ref.end;
    const start = base + Math.max(0, a.delay);
    const planned: PlannedAnimation = { animation: a, start, end: start + motionLength(a) };
    group.entries.push(planned);
    group.duration = Math.max(group.duration, planned.end);
    if (!samePiece) {
      prevWhole = { start: planned.start, end: planned.end };
    } else {
      prevWhole = { start: prevWhole!.start, end: Math.max(prevWhole!.end, planned.end) };
    }
    prev = planned;
    prevRow = rowId;
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
        hidden.delete(animationKey(a));
      } else if (a.kind === 'exit') {
        hidden.add(animationKey(a));
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

/**
 * The slide's animations: its own list (or the ones its elements' old build steps imply),
 * followed by the automatic ones of its objects (`src`, see `defaultAnimations`).
 */
export function slideAnimations(
  slide: SlideConfig | undefined,
  items: readonly LegacyStepItem[],
  src?: AnimationSource,
): SlideAnimation[] {
  const own = slide?.animations ?? legacyAnimations(items);
  return src ? [...own, ...defaultAnimations(own, slide?.animationsOff, src)] : own;
}

/** Re-point animations at copied objects (`idMap`: source id -> copy id); others are dropped. */
export function remapAnimations(
  animations: readonly SlideAnimation[],
  idMap: { get(id: string): string | undefined },
): SlideAnimation[] {
  const out: SlideAnimation[] = [];
  for (const a of animations) {
    const target = idMap.get(a.target);
    if (!target) {
      continue;
    }
    // Message pieces are ids too; paragraph / diff pieces are not.
    const part = a.part ? (idMap.get(a.part) ?? a.part) : undefined;
    const joined = a.stagger?.joined?.map((j) => idMap.get(j) ?? j);
    const skip = a.stagger?.skip?.map((j) => idMap.get(j) ?? j);
    out.push({
      ...a,
      target,
      ...(part ? { part } : {}),
      ...(a.stagger ? { stagger: { ...a.stagger, ...(joined ? { joined } : {}), ...(skip ? { skip } : {}) } } : {}),
      // An automatic animation's id names its object: follow the copy.
      ...(a.id === autoAnimationId(a.target) ? { id: autoAnimationId(target) } : {}),
    });
  }
  return out;
}

/** Clamp durations/delays and drop settings that do not apply to the effect. */
export function normalizeAnimations(list: readonly SlideAnimation[]): SlideAnimation[] {
  return list.map((a) => {
    const duration = Math.min(MAX_ANIMATION_DURATION, Math.max(0, Math.round(a.duration)));
    const delay = Math.min(MAX_ANIMATION_DELAY, Math.max(0, Math.round(a.delay)));
    // A diff reveal always morphs; nothing else does.
    const kind: SlideAnimationKind = isDiffAnimation(a) && a.kind === 'emphasis' ? 'enter' : a.kind;
    const effect = isDiffAnimation(a)
      ? 'morph'
      : effectFor(kind, a.effect === 'morph' ? 'fade' : a.effect);
    const direction: SlideDirection | undefined = DIRECTIONAL_EFFECTS.has(effect)
      ? (a.direction ?? 'left')
      : undefined;
    const stagger = a.stagger
      ? {
          trigger: a.stagger.trigger,
          delay: Math.min(MAX_ANIMATION_DELAY, Math.max(0, Math.round(a.stagger.delay))),
          ...(a.stagger.joined?.length ? { joined: [...new Set(a.stagger.joined)] } : {}),
          ...(a.stagger.skip?.length ? { skip: [...new Set(a.stagger.skip)] } : {}),
        }
      : undefined;
    const out: SlideAnimation = { ...a, kind, effect, duration, delay, direction };
    if (stagger) out.stagger = stagger;
    else delete out.stagger;
    if (!a.part) delete out.part;
    return out;
  });
}

/** Whether a slide's entrance morphs the objects it shares with the slide before it. */
export function transitionMorphs(t: { type: string; morph?: boolean; pairs?: boolean } | undefined | null): boolean {
  return morphMode(t) !== 'none';
}

/**
 * What a transition pairs for its morph: Auto ('morph') pairs automatically (look-alikes,
 * copies, tags); Fade / Slide / Zoom morph only the pairs you made (tags, pair links),
 * unless that is switched off; None never morphs.
 */
export function morphMode(t: { type: string; pairs?: boolean } | undefined | null): 'auto' | 'mine' | 'none' {
  if (!t || t.type === 'none') return 'none';
  if (t.type === 'morph') return 'auto';
  return t.pairs === false ? 'none' : 'mine';
}

/** Keep only pairs made by hand: both ends carry the same user tag (not a solo/cut tag). */
export function onlyYourPairs<T extends { key: string; keyIn?: string; keyOut?: string }>(
  from: readonly T[],
  to: readonly T[],
  pairs: ReadonlyArray<[number, number]>,
  reversed = false,
): Array<[number, number]> {
  return pairs.filter(([i, j]) => {
    const a = (reversed ? from[i].keyIn : from[i].keyOut) ?? from[i].key;
    const b = (reversed ? to[j].keyOut : to[j].keyIn) ?? to[j].key;
    return a === b && a.startsWith('tag:') && !/^tag:(solo|cut)-/.test(a);
  });
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
