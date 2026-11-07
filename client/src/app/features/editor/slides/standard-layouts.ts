import {
  DEFAULT_THEME,
  LAYOUT_KIND_LABELS,
  LAYOUT_KINDS,
  presentationLayouts,
  presentationOf,
  presentationSlides,
  resolveThemeFont,
  themeLayoutItems,
  themeToken,
  type CanvasElementModel,
  type CreateElementDto,
  type LayoutKind,
  type LayoutElementProps,
  type LayoutSpecItem,
  type SlideTheme,
  presentationMaster,
  DEFAULT_LAYOUT_SET,
} from '@dbdesigner/shared';
import type { ProjectStore } from '../../../stores/project.store';
import { fitTextElement } from '../canvas/helpers/text-metrics';
import { switchLayout } from './layout-placeholders';

type Store = InstanceType<typeof ProjectStore>;

/** Every standard kind except Blank (which each deck already has). */
export const STARTER_KINDS = LAYOUT_KINDS.filter((k) => k !== 'blank');

/**
 * How additions are recorded: `history` = one undo step of their own, `silent` = no undo
 * (automatic bookkeeping), `inline` = plain recorded writes for a caller's own batch.
 */
type Mode = 'history' | 'silent' | 'inline';

/**
 * Add standard layouts (one per kind) to the presentation `anchor` belongs to, stacked
 * on it like its other layouts, in the deck theme's design for each kind. Items use
 * theme tokens and placeholder roles, so they restyle with the theme. Returns the new
 * layout ids, in `kinds` order.
 */
export async function addStandardLayouts(
  store: Store,
  anchor: CanvasElementModel,
  kinds: readonly LayoutKind[],
  mode: Mode = 'history',
  themeOverride?: SlideTheme,
  /** For a single layout replacing another: take its place in the list and its name. */
  placeAt?: { order: number; layoutName?: string },
  /** The layout set the new layouts belong to (absent = the deck's current one). */
  layoutSetId?: string,
): Promise<string[]> {
  const name = presentationOf(anchor);
  const theme = themeOverride ?? store.presentationThemes().get(name) ?? DEFAULT_THEME;
  const existing = presentationLayouts(store.slideFrames(), name);
  let order = existing.reduce((m, l) => Math.max(m, l.slide?.order ?? 0), 0);
  const ids: string[] = [];
  const build = async (): Promise<void> => {
    for (const kind of kinds) {
      const items = themeLayoutItems(theme, kind);
      if (!items) continue;
      const id = await addLayoutFrame(store, anchor, theme, mode, {
        order: placeAt ? placeAt.order : ++order,
        name: placeAt?.layoutName ?? LAYOUT_KIND_LABELS[kind],
        kind,
        items,
        layoutSetId,
      });
      if (id) ids.push(id);
    }
  };
  if (mode === 'history') await store.batchHistory(build);
  else await build();
  return ids;
}

/** Add one layout frame (stacked on `anchor`) with `items` drawn on it. Returns its id. */
async function addLayoutFrame(
  store: Store,
  anchor: CanvasElementModel,
  theme: SlideTheme,
  mode: Mode,
  spec: { order: number; name: string; kind?: LayoutKind; items: readonly LayoutSpecItem[]; layoutSetId?: string },
): Promise<string | null> {
  const add = (dto: CreateElementDto): Promise<CanvasElementModel | null> =>
    mode === 'silent' ? store.addElementSilently(dto) : store.addElement(dto, false);
  const { x, y, width: fw, height: fh } = anchor;
  const k = fh / 720;
  const frame = await add({
    type: 'frame',
    x,
    y,
    width: fw,
    height: fh,
    angle: 0,
    strokeColor: anchor.strokeColor,
    // Transparent: the master's background shows through.
    fillStyle: 'none',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 100,
    cornerRadius: 0,
    slide: {
      order: spec.order,
      ...(anchor.slide?.presentation ? { presentation: anchor.slide.presentation } : {}),
      layout: true,
      layoutName: spec.name,
      ...(spec.kind ? { layoutKind: spec.kind } : {}),
      ...(spec.layoutSetId ? { layoutSetId: spec.layoutSetId } : {}),
      ...(anchor.slide?.theme ? { theme: anchor.slide.theme } : {}),
    },
  });
  if (!frame) return null;
  for (const item of spec.items) {
    await add(itemDto(item, frame.id, x, y, fw, k, theme));
  }
  return frame.id;
}

function itemDto(
  item: LayoutSpecItem,
  frameId: string,
  x: number,
  y: number,
  fw: number,
  k: number,
  theme: SlideTheme,
): CreateElementDto {
  const fh = 720 * k;
  const base = {
    x: Math.round(x + item.x * fw),
    y: Math.round(y + item.y * fh),
    width: Math.round(item.w * fw),
    angle: 0,
    opacity: 100,
    cornerRadius: 0,
    strokeStyle: 'solid' as const,
    slideId: frameId,
  };
  if (item.kind === 'element') {
    // A captured element: geometry from fractions, sizes scaled to this slide.
    const el = item.el;
    return {
      ...el,
      ...base,
      height: Math.max(1, Math.round(item.h * fh)),
      ...(el.fontSize ? { fontSize: Math.round(el.fontSize * k) } : {}),
      ...(el.points ? { points: el.points.map((pt) => ({ x: pt.x * k, y: pt.y * k })) } : {}),
    } as CreateElementDto;
  }
  if (item.kind === 'bar') {
    return {
      ...base,
      type: 'rectangle',
      height: Math.max(2, Math.round(item.h * k)),
      strokeColor: item.color,
      backgroundColor: item.color,
      fillStyle: 'solid',
      strokeWidth: 1,
    };
  }
  const text: CreateElementDto = {
    ...base,
    type: 'text',
    height: 0,
    text: item.prompt,
    fontSize: Math.round(item.size * k),
    fontFamily: themeToken(item.font),
    strokeColor: item.color,
    fillStyle: 'none',
    strokeWidth: 1,
    bold: item.bold,
    italic: item.italic,
    textAlign: item.align ?? 'left',
    wrap: true,
    placeholder: { role: item.role, prompt: item.prompt },
  };
  // Measure in the theme's real face (the frame may be new, so resolve it here).
  const size = fitTextElement({
    ...(text as unknown as CanvasElementModel),
    fontFamily: resolveThemeFont(text.fontFamily, theme),
  });
  return { ...text, height: size.height };
}

/**
 * A layout frame's items as theme design items (fractions of the frame), for "Save as
 * theme". Uploaded images are left out: they belong to this project.
 */
export function captureLayoutItems(frame: CanvasElementModel, elements: readonly CanvasElementModel[]): LayoutSpecItem[] {
  const k = frame.height / 720;
  return elements
    .filter((e) => e.slideId === frame.id && !e.fileId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((e): LayoutSpecItem => {
      const {
        id: _id, x, y, width, height, slideId: _s, slide: _sl, zIndex: _z, fileId: _f,
        startBinding: _sb, endBinding: _eb, groupId: _g, morphId: _m, step: _st, ...rest
      } = e as CanvasElementModel & { groupId?: string };
      const el = {
        ...rest,
        ...(e.fontSize ? { fontSize: e.fontSize / k } : {}),
        ...(e.points ? { points: e.points.map((pt) => ({ x: pt.x / k, y: pt.y / k })) } : {}),
      } as LayoutElementProps;
      return {
        kind: 'element',
        x: (x - frame.x) / frame.width,
        y: (y - frame.y) / frame.height,
        w: width / frame.width,
        h: height / frame.height,
        el,
      };
    });
}

/** A deck's layouts other than Blank (the master included). */
export function deckLayouts(store: Store, presentation: string): CanvasElementModel[] {
  return presentationLayouts(store.slideFrames(), presentation).filter((l) => !l.slide?.defaultLayout);
}

/**
 * A layout from a layout set the deck no longer uses, kept because slides still use it.
 * Untagged layouts belong to the deck's set; Blank and the master never are foreign.
 */
export function isForeignLayout(layout: CanvasElementModel, setId: string): boolean {
  if (!layout.slide?.layout || layout.slide.defaultLayout || layout.slide.master) return false;
  const tag = layout.slide.layoutSetId;
  return !!tag && tag !== setId;
}

/** The deck's layouts (those of its set `setId`) and master as layout set content. */
export function captureLayoutSet(
  store: Store,
  presentation: string,
  setId: string,
): Pick<SlideTheme, 'layouts' | 'extraLayouts' | 'master'> {
  const elements = store.elements();
  const layouts: NonNullable<SlideTheme['layouts']> = {};
  const extraLayouts: NonNullable<SlideTheme['extraLayouts']> = [];
  for (const l of presentationLayouts(store.slideFrames(), presentation)) {
    if (l.slide?.defaultLayout || isForeignLayout(l, setId)) continue;
    const kind = l.slide?.layoutKind;
    if (kind && kind !== 'blank') {
      if (!layouts[kind]) layouts[kind] = captureLayoutItems(l, elements);
    } else if (!kind) {
      extraLayouts.push({ name: l.slide?.layoutName?.trim() || 'Layout', items: captureLayoutItems(l, elements) });
    }
  }
  const master = presentationMaster(store.slideFrames(), presentation);
  return { layouts, extraLayouts, master: master ? captureLayoutItems(master, elements) : [] };
}

/** The standard kinds a set holds: Default has every one, a saved set the ones it saved. */
function setKinds(set: SlideTheme): LayoutKind[] {
  if (set.id === DEFAULT_LAYOUT_SET.id) return [...STARTER_KINDS];
  return (Object.keys(set.layouts ?? {}) as LayoutKind[]).filter((k) => k !== 'blank');
}

/**
 * Give a deck the layouts of `set` in place of those of its current set `fromSetId`:
 * the set's layouts are added (or reused when the deck still has them from before),
 * slides move to the matching one (same kind, or same name for the set's own layouts),
 * and the old layouts are removed once nothing uses them. A layout still in use with no
 * match stays (flagged as foreign). The master takes the set's items. Call inside a batch.
 */
export async function applyLayoutSet(
  store: Store,
  presentation: string,
  fromSetId: string,
  set: SlideTheme,
  theme: SlideTheme,
): Promise<{ kept: number; replaced: Map<string, string> }> {
  const toId = set.id ?? DEFAULT_LAYOUT_SET.id!;
  const replaced = new Map<string, string>();
  let kept = 0;
  const layoutsNow = (): CanvasElementModel[] => deckLayouts(store, presentation).filter((l) => !l.slide?.master);
  // Untagged layouts belong to the outgoing set: say so, so the two stay told apart.
  for (const l of layoutsNow()) {
    if (!l.slide?.layoutSetId) await store.updateElement(l.id, { slide: { ...l.slide!, layoutSetId: fromSetId } });
  }
  const old = layoutsNow().filter((l) => l.slide?.layoutSetId !== toId);
  const mine = layoutsNow().filter((l) => l.slide?.layoutSetId === toId);
  const anchor = presentationLayouts(store.slideFrames(), presentation)[0];
  // The set's layouts take the places right after Blank, in the set's own order.
  const blank = presentationLayouts(store.slideFrames(), presentation).find((l) => l.slide?.defaultLayout);
  let order = blank?.slide?.order ?? Math.min(0, ...layoutsNow().map((l) => l.slide?.order ?? 0)) - 1;
  const place = async (l: CanvasElementModel, at: number): Promise<void> => {
    if (l.slide && l.slide.order !== at) await store.updateElement(l.id, { slide: { ...l.slide, order: at } });
  };
  const byKind = new Map<LayoutKind, CanvasElementModel>();
  const byName = new Map<string, CanvasElementModel>();
  const find = (id: string | null): CanvasElementModel | undefined =>
    id ? store.slideFrames().find((f) => f.id === id) : undefined;
  if (anchor) {
    for (const kind of setKinds(set)) {
      const have = mine.find((l) => l.slide?.layoutKind === kind);
      if (have) {
        byKind.set(kind, have);
        await place(have, ++order);
        continue;
      }
      const items = themeLayoutItems(set, kind);
      if (!items) continue;
      const made = find(
        await addLayoutFrame(store, anchor, theme, 'inline', {
          order: ++order,
          name: LAYOUT_KIND_LABELS[kind],
          kind,
          items,
          layoutSetId: toId,
        }),
      );
      if (made) byKind.set(kind, made);
    }
    for (const extra of set.extraLayouts ?? []) {
      const have = mine.find((l) => !l.slide?.layoutKind && l.slide?.layoutName === extra.name);
      if (have) {
        byName.set(extra.name, have);
        await place(have, ++order);
        continue;
      }
      const made = find(
        await addLayoutFrame(store, anchor, theme, 'inline', {
          order: ++order,
          name: extra.name,
          items: extra.items,
          layoutSetId: toId,
        }),
      );
      if (made) byName.set(extra.name, made);
    }
  }
  for (const layout of old) {
    const kind = layout.slide?.layoutKind;
    const target = kind ? byKind.get(kind) : byName.get(layout.slide?.layoutName ?? '');
    if (target) {
      replaced.set(layout.id, target.id);
      for (const slide of presentationSlides(store.slideFrames(), presentation)) {
        if (slide.slide?.layoutId === layout.id) await switchLayout(store, slide, target);
      }
    }
    if (presentationSlides(store.slideFrames(), presentation).some((f) => f.slide?.layoutId === layout.id)) {
      kept++;
      continue;
    }
    for (const e of store.elements().filter((x) => x.slideId === layout.id)) await store.deleteElement(e.id);
    await store.deleteElement(layout.id);
  }
  // Layouts kept from before (still used by slides) follow the set's.
  const ours = new Set([...byKind.values(), ...byName.values()].map((l) => l.id));
  const others = layoutsNow()
    .filter((l) => !ours.has(l.id))
    .sort((a, b) => (a.slide?.order ?? 0) - (b.slide?.order ?? 0));
  for (const l of others) await place(l, ++order);
  // The master takes the set's items.
  const master = presentationMaster(store.slideFrames(), presentation);
  if (master) {
    for (const e of store.elements().filter((x) => x.slideId === master.id)) await store.deleteElement(e.id);
    const k = master.height / 720;
    for (const item of set.master ?? []) {
      await store.addElement(itemDto(item, master.id, master.x, master.y, master.width, k, theme), false);
    }
  }
  return { kept, replaced };
}
