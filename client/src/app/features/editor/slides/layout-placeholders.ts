// Slide layouts' placeholders: the text boxes a layout hands to the slides using it.
// A slide holds its own copy of each (`placeholder.of` = the layout element), so
// these helpers create, re-point and reset those copies as ordinary element edits.

import {
  matchPlaceholders,
  type CanvasElementModel,
  type CreateElementDto,
  type UpdateElementDto,
} from '@dbdesigner/shared';
import { elementToCreateDto, type ProjectStore } from '../../../stores/project.store';

type Store = InstanceType<typeof ProjectStore>;

/** The placeholders a layout frame hands out (its text boxes marked as such). */
export function layoutPlaceholders(store: Store, layoutId: string): CanvasElementModel[] {
  return store.elements().filter((e) => e.slideId === layoutId && !!e.placeholder);
}

/** A slide's placeholder copies. */
export function slidePlaceholders(store: Store, slideId: string): CanvasElementModel[] {
  return store.elements().filter((e) => e.slideId === slideId && !!e.placeholder?.of);
}

/** Where a copy sits relative to its slide, matching the slot's place on the layout. */
function moved(slot: CanvasElementModel, layout: CanvasElementModel, slide: CanvasElementModel) {
  return { x: slot.x - layout.x + slide.x, y: slot.y - layout.y + slide.y };
}

/** The look a copy takes from its layout slot (position, size, text style; not the text). */
function slotLook(
  slot: CanvasElementModel,
  layout: CanvasElementModel,
  slide: CanvasElementModel,
): UpdateElementDto {
  return { ...moved(slot, layout, slide), ...slotStyle(slot) };
}

/** A slot's size and text style (what an empty copy always shows). */
export function slotStyle(slot: CanvasElementModel): UpdateElementDto & Partial<CanvasElementModel> {
  return {
    width: slot.width,
    height: slot.height,
    angle: slot.angle,
    strokeColor: slot.strokeColor,
    backgroundColor: slot.backgroundColor,
    opacity: slot.opacity,
    fontSize: slot.fontSize,
    fontFamily: slot.fontFamily,
    bold: slot.bold,
    italic: slot.italic,
    lineHeight: slot.lineHeight,
    wrap: slot.wrap,
    textAlign: slot.textAlign,
    verticalAlign: slot.verticalAlign,
  };
}

/** A fresh, empty copy of a layout slot on a slide. */
function emptyCopy(
  slot: CanvasElementModel,
  layout: CanvasElementModel,
  slide: CanvasElementModel,
): CreateElementDto {
  const base = elementToCreateDto(slot);
  return {
    ...base,
    ...moved(slot, layout, slide),
    zIndex: undefined,
    text: '',
    runs: undefined,
    morphId: undefined,
    step: undefined,
    slideId: slide.id,
    placeholder: { ...slot.placeholder!, of: slot.id },
  } as CreateElementDto;
}

/** Give a new slide an empty copy of each of its layout's placeholders. */
export async function fillFromLayout(
  store: Store,
  slide: CanvasElementModel,
  layout: CanvasElementModel,
): Promise<void> {
  for (const slot of layoutPlaceholders(store, layout.id)) {
    await store.addElement(emptyCopy(slot, layout, slide), false);
  }
}

/**
 * Put a slide on another layout (or none). Its placeholder copies move into the new
 * layout's slots (back to their own slot first, else by style type), keeping their text;
 * filled copies with no slot keep their link, so switching back puts them in place
 * instead of adding a duplicate; empty ones go. Slots nothing filled get an empty copy.
 * Call inside a history batch.
 */
export async function switchLayout(
  store: Store,
  slide: CanvasElementModel,
  layout: CanvasElementModel | null,
): Promise<void> {
  if (!slide.slide) return;
  const { layoutId: _old, ...rest } = slide.slide;
  await store.updateElement(slide.id, { slide: layout ? { ...rest, layoutId: layout.id } : rest });
  const copies = slidePlaceholders(store, slide.id);
  const slots = layout ? layoutPlaceholders(store, layout.id) : [];
  const pairs = matchPlaceholders(copies, slots);
  const filled = new Set(pairs.values());
  for (const c of copies) {
    const slotId = pairs.get(c.id);
    const slot = slotId ? slots.find((s) => s.id === slotId) : undefined;
    if (slot && layout) {
      await store.updateElement(c.id, {
        ...slotLook(slot, layout, slide),
        placeholder: { ...slot.placeholder!, of: slot.id },
      });
    } else if (!(c.text ?? '').trim()) {
      await store.deleteElement(c.id);
    }
  }
  if (layout) {
    for (const slot of slots.filter((s) => !filled.has(s.id))) {
      await store.addElement(emptyCopy(slot, layout, slide), false);
    }
  }
}

/** Put copies back where (and how) their layout slot is, keeping the text. */
export async function resetToLayout(store: Store, copies: readonly CanvasElementModel[]): Promise<void> {
  const frames = store.slideFrames();
  for (const c of copies) {
    const slot = store.elements().find((e) => e.id === c.placeholder?.of);
    const layout = slot && frames.find((f) => f.id === slot.slideId);
    const slide = frames.find((f) => f.id === c.slideId);
    if (slot && layout && slide) {
      await store.updateElement(c.id, slotLook(slot, layout, slide));
    }
  }
}

/**
 * After a layout's placeholders change: every slide using it gets an empty copy of a
 * slot it lacks, and copies of a slot that is no longer a placeholder go (empty) or
 * become plain text. Call inside a history batch.
 */
export async function syncLayoutCopies(store: Store, layout: CanvasElementModel): Promise<void> {
  const slots = layoutPlaceholders(store, layout.id);
  const slotIds = new Set(slots.map((s) => s.id));
  const owned = new Set(store.elements().filter((e) => e.slideId === layout.id).map((e) => e.id));
  for (const slide of store.slideFrames().filter((f) => f.slide?.layoutId === layout.id)) {
    const copies = slidePlaceholders(store, slide.id);
    const have = new Set(copies.map((c) => c.placeholder!.of));
    for (const c of copies) {
      const of = c.placeholder!.of!;
      if (slotIds.has(of) || !owned.has(of)) continue;
      if ((c.text ?? '').trim()) await store.updateElement(c.id, { placeholder: null });
      else await store.deleteElement(c.id);
    }
    for (const slot of slots.filter((s) => !have.has(s.id))) {
      await store.addElement(emptyCopy(slot, layout, slide), false);
    }
    // A copy keeps its slot's style type and prompt.
    for (const c of copies) {
      const slot = slots.find((s) => s.id === c.placeholder!.of);
      if (slot && (slot.placeholder!.role !== c.placeholder!.role || slot.placeholder!.prompt !== c.placeholder!.prompt)) {
        await store.updateElement(c.id, { placeholder: { ...slot.placeholder!, of: slot.id } });
      }
    }
  }
}

/** How far a slide has drifted from its layout's placeholders. */
export interface PlaceholderDrift {
  /** Copies moved, resized or restyled away from their slot. */
  changed: CanvasElementModel[];
  /** Slots the slide has no copy of (deleted placeholders). */
  missing: CanvasElementModel[];
}

/** Style fields compared for drift (size is left out: text boxes fit their own text). */
const DRIFT_KEYS = [
  'angle', 'strokeColor', 'backgroundColor', 'opacity', 'fontSize', 'fontFamily',
  'bold', 'italic', 'lineHeight', 'textAlign', 'verticalAlign',
] as const;

/** Whether a copy differs from its slot in place or look (not in its text). */
export function copyDrifted(
  copy: CanvasElementModel,
  slot: CanvasElementModel,
  layout: CanvasElementModel,
  slide: CanvasElementModel,
): boolean {
  const at = moved(slot, layout, slide);
  if (Math.abs(copy.x - at.x) > 0.5 || Math.abs(copy.y - at.y) > 0.5) return true;
  // An empty copy is drawn as its slot, so only where it sits counts.
  if (!(copy.text ?? '').trim()) return false;
  return DRIFT_KEYS.some((k) => (copy[k] ?? null) !== (slot[k] ?? null));
}

/** What "Reset to layout" would fix on a slide (null when it is not on a layout). */
export function placeholderDrift(store: Store, slide: CanvasElementModel): PlaceholderDrift | null {
  const layout = store.slideFrames().find((f) => f.id === slide.slide?.layoutId && f.slide?.layout);
  if (!layout) return null;
  const slots = layoutPlaceholders(store, layout.id);
  const copies = slidePlaceholders(store, slide.id);
  const changed = copies.filter((c) => {
    const slot = slots.find((s) => s.id === c.placeholder!.of);
    return !!slot && copyDrifted(c, slot, layout, slide);
  });
  const have = new Set(copies.map((c) => c.placeholder!.of));
  return { changed, missing: slots.filter((s) => !have.has(s.id)) };
}

/** Put a slide's placeholders back as its layout has them (text kept, deleted ones back). */
export async function resetSlideToLayout(
  store: Store,
  slide: CanvasElementModel,
  only?: ReadonlySet<string>,
): Promise<void> {
  const drift = placeholderDrift(store, slide);
  const layout = store.slideFrames().find((f) => f.id === slide.slide?.layoutId);
  if (!drift || !layout) return;
  await resetToLayout(store, only ? drift.changed.filter((c) => only.has(c.id)) : drift.changed);
  if (!only) {
    for (const slot of drift.missing) await store.addElement(emptyCopy(slot, layout, slide), false);
  }
}

/** A layout slot as remembered for "follow": its place within its layout and its look. */
interface SlotSnapshot {
  rx: number;
  ry: number;
  look: Record<string, unknown>;
}

function snapshotOf(slot: CanvasElementModel, layout: CanvasElementModel): SlotSnapshot {
  const look: Record<string, unknown> = {};
  for (const k of DRIFT_KEYS) look[k] = slot[k] ?? null;
  return { rx: slot.x - layout.x, ry: slot.y - layout.y, look };
}

/**
 * Copies follow their layout slot until changed on the slide: build a function to run
 * whenever elements change. When a slot moves or is restyled on its layout, each copy
 * that still matched the slot's previous place and look takes the new ones (filled
 * copies keep their text). Writes are unrecorded: undoing the slot change replays it.
 */
export function slotFollower(store: Store): () => void {
  let known = new Map<string, SlotSnapshot>();
  let first = true;
  return () => {
    const frames = store.slideFrames();
    const layouts = new Map(frames.filter((f) => f.slide?.layout).map((f) => [f.id, f] as const));
    const next = new Map<string, SlotSnapshot>();
    const changed: { slot: CanvasElementModel; layout: CanvasElementModel; was: SlotSnapshot }[] = [];
    for (const e of store.elements()) {
      const layout = e.placeholder && !e.placeholder.of && e.slideId ? layouts.get(e.slideId) : undefined;
      if (!layout) continue;
      const snap = snapshotOf(e, layout);
      next.set(e.id, snap);
      const was = known.get(e.id);
      if (was && (was.rx !== snap.rx || was.ry !== snap.ry || DRIFT_KEYS.some((k) => was.look[k] !== snap.look[k]))) {
        changed.push({ slot: e, layout, was });
      }
    }
    known = next;
    if (first || !changed.length || !store.canEdit()) {
      first = false;
      return;
    }
    const slides = new Map(frames.map((f) => [f.id, f] as const));
    for (const { slot, layout, was } of changed) {
      for (const c of store.elements()) {
        const slide = c.placeholder?.of === slot.id && c.slideId ? slides.get(c.slideId) : undefined;
        if (!slide) continue;
        const untouched =
          Math.abs(c.x - slide.x - was.rx) <= 0.5 &&
          Math.abs(c.y - slide.y - was.ry) <= 0.5 &&
          (!(c.text ?? '').trim() || DRIFT_KEYS.every((k) => (c[k] ?? null) === was.look[k]));
        if (untouched) void store.patchElementSilently(c.id, slotLook(slot, layout, slide));
      }
    }
  };
}

/**
 * A slide's empty placeholders as they look in the editor: drawn as their layout slot
 * (its text, size and style, faded) at the copy's spot. Used for slide thumbnails;
 * presenting and exports leave them out. `sources` are the rows they are drawn from.
 */
export function placeholderGhosts(
  slideId: string,
  elements: readonly CanvasElementModel[],
): { ghosts: CanvasElementModel[]; sources: CanvasElementModel[] } {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  const ghosts: CanvasElementModel[] = [];
  const sources: CanvasElementModel[] = [];
  for (const e of elements) {
    const slot = e.slideId === slideId && e.placeholder?.of ? byId.get(e.placeholder.of) : undefined;
    if (!slot || (e.text ?? '').trim()) continue;
    sources.push(e, slot);
    ghosts.push({
      ...e,
      ...(slotStyle(slot) as Partial<CanvasElementModel>),
      text: slot.text,
      runs: slot.runs,
      opacity: e.opacity * 0.45,
    });
  }
  return { ghosts, sources };
}
