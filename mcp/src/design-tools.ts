// Presentation design tools: designs (a layout set + a theme), themes (color and font
// tokens) and layout sets, as the editor's Design tab handles them. Records live in the
// project library (PUT /projects/:id/themes, mirrored to the caller's My designs);
// every slide frame of a deck carries the deck's theme tokens plus its design and
// layout set ids. Switching a design rebuilds the deck's layouts from the set and moves
// each slide to the layout of the same kind, keeping its placeholder text. Mirrors
// client/src/app/features/editor/slides (standard-layouts.ts, slides-panel stamp/switchTo).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  BUILT_IN_DESIGNS,
  BUILT_IN_LAYOUT_SETS,
  BUILT_IN_THEMES,
  DEFAULT_DESIGN,
  DEFAULT_LAYOUT_SET,
  DEFAULT_THEME,
  LAYOUT_KINDS,
  LAYOUT_KIND_LABELS,
  PLACEHOLDER_ROLES,
  THEME_COLOR_TOKENS,
  estimateTextSize,
  isBuiltInRecord,
  matchPlaceholders,
  presentationLayouts,
  presentationMaster,
  presentationOf,
  presentationSlides,
  layoutNameOf,
  recordKind,
  themeLayoutItems,
  themeToken,
  themeTokensOnly,
  type CanvasElementModel,
  type LayoutElementProps,
  type LayoutKind,
  type LayoutSpecItem,
  type PlaceholderRole,
  type ProjectGraphResponse,
  type SchemaModel,
  type SlideTheme,
  type UserThemeResponse,
} from '@devdesigner/shared';
import type { DevDesignerApi } from './api';
import { Batch } from './batch';
import { UserError } from './model';
import { resolvePresentation, resolveSlide, slideFrames, type Frame, type ToolFn } from './presentation-tools';

const projectId = z.string().describe('Project id (from list_projects).');
const presentation = z.string().optional().describe('Presentation name (optional when the project has one).');
const confirm = z.literal(true).describe('Must be true. Destructive: confirm the user wants this deleted.');

const colorsSchema = z
  .object(Object.fromEntries(THEME_COLOR_TOKENS.map((k) => [k, z.string().optional()])) as Record<string, z.ZodOptional<z.ZodString>>)
  .partial()
  .describe(
    `Theme colors to change (#hex, or "transparent" for no background): ${THEME_COLOR_TOKENS.join(', ')}. ` +
      '"surface" / "theme" follow the app\'s light/dark mode (fill / text).',
  );
const fontsSchema = z
  .object({ heading: z.string().optional(), body: z.string().optional() })
  .describe('Font family keys: inter, normal, poppins, serif, display, condensed, hand, caveat, marker, code');

const STARTER_KINDS = LAYOUT_KINDS.filter((k) => k !== 'blank');

type Lib = { project: SlideTheme[]; mine: UserThemeResponse[] };

/** What other tool groups use from the design tools. */
export interface DesignHelpers {
  /** Give a presentation a design (name or id; default: the Default design): its theme on every slide and its layouts. */
  applyDesign(projectId: string, presentation: string, design?: string): Promise<{ design: string; theme: string }>;
}

export function registerDesignTools(tool: ToolFn, api: DevDesignerApi): DesignHelpers {
  const graph = (id: string): Promise<ProjectGraphResponse> => api.get<ProjectGraphResponse>(`/projects/${id}`);

  // ---- Library ------------------------------------------------------------------

  const loadLib = async (schema: SchemaModel): Promise<Lib> => {
    let mine: UserThemeResponse[] = [];
    try {
      mine = await api.get<UserThemeResponse[]>('/me/themes');
    } catch {
      // My designs is optional (e.g. a token without a personal library)
    }
    return { project: [...(schema.themes ?? [])], mine };
  };
  /** Custom records: the project's, then the rest of My designs. */
  const customs = (lib: Lib): SlideTheme[] => {
    const ids = new Set(lib.project.map((r) => r.id));
    return [...lib.project, ...lib.mine.map((m) => m.theme).filter((t) => !ids.has(t.id))];
  };
  const allRecords = (lib: Lib): SlideTheme[] => [...BUILT_IN_THEMES, ...BUILT_IN_LAYOUT_SETS, ...BUILT_IN_DESIGNS, ...customs(lib)];
  const byId = (lib: Lib, id: string | undefined): SlideTheme | undefined =>
    id ? allRecords(lib).find((r) => r.id === id) : undefined;
  const find = (lib: Lib, kind: 'theme' | 'design', ref: string): SlideTheme => {
    const pool = allRecords(lib).filter((r) => recordKind(r) === kind);
    const hit = pool.find((r) => r.id === ref) ?? pool.find((r) => r.name.toLowerCase() === ref.trim().toLowerCase());
    if (!hit) throw new UserError(`No ${kind} "${ref}". ${kind === 'theme' ? 'Themes' : 'Designs'}: ${pool.map((r) => r.name).join(', ')}.`);
    return hit;
  };
  const freshName = (lib: Lib, base: string): string => {
    const taken = new Set(allRecords(lib).map((r) => r.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  };
  const newId = (): string => `custom-${randomUUID()}`;

  /** Add or replace custom records in the project and My designs, and drop `remove`. */
  const saveRecords = async (pid: string, lib: Lib, upserts: SlideTheme[], remove: string[] = []): Promise<void> => {
    const ids = new Set([...upserts.map((u) => u.id), ...remove]);
    const themes = [...lib.project.filter((r) => !ids.has(r.id)), ...upserts];
    await api.put(`/projects/${pid}/themes`, { themes });
    lib.project = themes;
    for (const u of upserts) {
      try {
        await api.post('/me/themes', { theme: u });
      } catch {
        // best-effort, like the editor
      }
    }
    for (const id of remove) {
      const row = lib.mine.find((m) => m.theme.id === id);
      if (row) await api.delete(`/me/themes/${row.id}`).catch(() => undefined);
    }
  };

  // ---- A deck's state -------------------------------------------------------------

  const deckOf = (schema: SchemaModel, name: string): Frame[] => slideFrames(schema).filter((f) => presentationOf(f) === name);
  const deckState = (lib: Lib, frames: Frame[]) => {
    const t = frames.find((f) => f.slide.theme?.designId)?.slide.theme ?? frames.find((f) => f.slide.theme)?.slide.theme;
    const theme = t ? { ...t } : themeTokensOnly(DEFAULT_THEME);
    const design = byId(lib, t?.designId) ?? DEFAULT_DESIGN;
    const set = byId(lib, t?.layoutsId ?? design.layoutsId) ?? DEFAULT_LAYOUT_SET;
    return { theme, design, set };
  };

  /** Put the theme (tokens) and design/set refs on every frame of the deck (and on other decks using an edited theme). */
  const stamp = (batch: Batch, schema: SchemaModel, name: string, theme: SlideTheme, designId: string, layoutsId: string, everywhere = false): void => {
    const tokens = themeTokensOnly(theme);
    for (const f of slideFrames(schema)) {
      let next: SlideTheme | null = null;
      if (presentationOf(f) === name) next = { ...tokens, designId, layoutsId };
      else if (everywhere && theme.id && f.slide.theme?.id === theme.id) {
        next = { ...tokens, designId: f.slide.theme.designId, layoutsId: f.slide.theme.layoutsId };
      }
      if (next) batch.set('elements', f.id, { slide: { ...(batch.get('elements', f.id)?.slide as object ?? f.slide), theme: next } });
    }
  };

  // ---- Layout frames ----------------------------------------------------------------

  const frameDto = (anchor: Frame, slide: Record<string, unknown>, fill: boolean) => ({
    type: 'frame',
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
    angle: 0,
    strokeColor: anchor.strokeColor,
    ...(fill ? { backgroundColor: themeToken('background'), fillStyle: 'solid' } : { fillStyle: 'none' }),
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 100,
    cornerRadius: 0,
    slide: { ...(anchor.slide.presentation ? { presentation: anchor.slide.presentation } : {}), layout: true, ...slide },
  });

  /** A layout item as an element on a frame at (x, y), fw wide, k = frame height / 720. */
  const itemDto = (item: LayoutSpecItem, frameId: string, x: number, y: number, fw: number, k: number): Record<string, unknown> => {
    const fh = 720 * k;
    const base = {
      x: Math.round(x + item.x * fw),
      y: Math.round(y + item.y * fh),
      width: Math.round(item.w * fw),
      angle: 0,
      opacity: 100,
      cornerRadius: 0,
      strokeStyle: 'solid',
      slideId: frameId,
    };
    if (item.kind === 'element') {
      const el = item.el;
      return {
        // The element keeps its own opacity and corner radius; only its place is the default.
        ...base,
        ...el,
        x: base.x,
        y: base.y,
        width: base.width,
        slideId: frameId,
        height: Math.max(1, Math.round(item.h * fh)),
        ...(el.fontSize ? { fontSize: Math.round(el.fontSize * k) } : {}),
        ...(el.points ? { points: el.points.map((pt) => ({ x: pt.x * k, y: pt.y * k })) } : {}),
      };
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
    const fontSize = Math.round(item.size * k);
    return {
      ...base,
      type: 'text',
      height: estimateTextSize(item.prompt, fontSize).height,
      text: item.prompt,
      fontSize,
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
  };

  const addLayoutFrame = async (
    pid: string,
    anchor: Frame,
    spec: { order: number; name: string; kind?: LayoutKind; items: readonly LayoutSpecItem[]; layoutSetId: string; theme: SlideTheme },
  ): Promise<string> => {
    const frame = await api.post<CanvasElementModel>(
      `/projects/${pid}/elements`,
      frameDto(anchor, {
        order: spec.order,
        layoutName: spec.name,
        ...(spec.kind ? { layoutKind: spec.kind } : {}),
        layoutSetId: spec.layoutSetId,
        theme: spec.theme,
      }, true),
    );
    const k = anchor.height / 720;
    for (const item of spec.items) await api.post(`/projects/${pid}/elements`, itemDto(item, frame.id, anchor.x, anchor.y, anchor.width, k));
    return frame.id;
  };

  /** A layout frame's items as design items (fractions of the frame), for copying a deck's layouts into a new set. */
  const captureItems = (frame: CanvasElementModel, elements: readonly CanvasElementModel[]): LayoutSpecItem[] => {
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
        return { kind: 'element', x: (x - frame.x) / frame.width, y: (y - frame.y) / frame.height, w: width / frame.width, h: height / frame.height, el };
      });
  };
  const isForeign = (l: Frame, setId: string): boolean =>
    !!l.slide.layout && !l.slide.defaultLayout && !l.slide.master && !!l.slide.layoutSetId && l.slide.layoutSetId !== setId;
  const captureSet = (schema: SchemaModel, name: string, setId: string): Pick<SlideTheme, 'layouts' | 'extraLayouts' | 'master'> => {
    const frames = slideFrames(schema);
    const layouts: NonNullable<SlideTheme['layouts']> = {};
    const extraLayouts: NonNullable<SlideTheme['extraLayouts']> = [];
    for (const l of presentationLayouts(frames, name)) {
      if (l.slide.defaultLayout || l.slide.master || isForeign(l, setId)) continue;
      const kind = l.slide.layoutKind;
      if (kind && kind !== 'blank') layouts[kind] ??= captureItems(l, schema.elements);
      else if (!kind) extraLayouts.push({ name: l.slide.layoutName?.trim() || 'Layout', items: captureItems(l, schema.elements) });
    }
    const master = presentationMaster(frames, name);
    return { layouts, extraLayouts, master: master ? captureItems(master, schema.elements) : [] };
  };
  const setKinds = (set: SlideTheme): LayoutKind[] =>
    set.id === DEFAULT_LAYOUT_SET.id ? [...STARTER_KINDS] : (Object.keys(set.layouts ?? {}) as LayoutKind[]).filter((k) => k !== 'blank');

  /** Give a deck that was never opened in the editor its Blank layout and Master (as the editor does on open). */
  const ensureDeckFrames = async (pid: string, name: string, theme: SlideTheme): Promise<void> => {
    const deck = deckOf((await graph(pid)).schema, name);
    const slides = deck.filter((f) => !f.slide.layout);
    if (!slides.length) return;
    const layouts = deck.filter((f) => f.slide.layout);
    const low = layouts.reduce((m, l) => Math.min(m, l.slide.order ?? 0), 0);
    let blank = layouts.find((l) => l.slide.defaultLayout);
    if (!blank) {
      blank = await api.post<Frame>(
        `/projects/${pid}/elements`,
        frameDto(slides[0], { order: low - 1, layoutName: 'Blank', defaultLayout: true, layoutKind: 'blank', theme }, true),
      );
    }
    if (!deck.some((f) => f.slide.master)) {
      await api.post(`/projects/${pid}/elements`, frameDto(slides[0], { order: low - 2, layoutName: 'Master', master: true, theme }, false));
    }
    const batch = new Batch();
    const ids = new Set([...layouts.map((l) => l.id), blank.id]);
    for (const f of slides) if (!f.slide.layoutId || !ids.has(f.slide.layoutId)) batch.set('elements', f.id, { slide: { ...f.slide, layoutId: blank.id } });
    await batch.send(api, pid);
  };

  /** Move a slide to `layout`, re-pairing its placeholder copies by role (text kept). */
  const switchSlideLayout = async (pid: string, schema: SchemaModel, slide: Frame, layout: Frame | null, batch: Batch): Promise<void> => {
    const { layoutId: _old, ...rest } = slide.slide;
    batch.set('elements', slide.id, { slide: layout ? { ...rest, layoutId: layout.id } : rest });
    const copies = schema.elements.filter((e) => e.slideId === slide.id && !!e.placeholder?.of);
    const slots = layout ? schema.elements.filter((e) => e.slideId === layout.id && !!e.placeholder) : [];
    const pairs = matchPlaceholders(copies, slots);
    const filled = new Set(pairs.values());
    const at = (s: CanvasElementModel) => ({ x: s.x - layout!.x + slide.x, y: s.y - layout!.y + slide.y });
    for (const c of copies) {
      const slot = slots.find((s) => s.id === pairs.get(c.id));
      if (slot && layout) {
        batch.set('elements', c.id, {
          ...at(slot),
          width: slot.width, height: slot.height, angle: slot.angle, strokeColor: slot.strokeColor,
          backgroundColor: slot.backgroundColor, opacity: slot.opacity, fontSize: slot.fontSize,
          fontFamily: slot.fontFamily, bold: slot.bold, italic: slot.italic, lineHeight: slot.lineHeight,
          wrap: slot.wrap, textAlign: slot.textAlign, verticalAlign: slot.verticalAlign,
          placeholder: { ...slot.placeholder!, of: slot.id },
        });
      } else if (!(c.text ?? '').trim()) batch.delete('elements', c.id);
    }
    if (!layout) return;
    for (const slot of slots.filter((s) => !filled.has(s.id))) {
      const { id: _i, zIndex: _z, groupId: _g, morphId: _m, step: _s, runs: _r, slideId: _sl, slide: _sc, ...look } =
        slot as CanvasElementModel & { groupId?: string };
      await api.post(`/projects/${pid}/elements`, { ...look, ...at(slot), text: '', slideId: slide.id, placeholder: { ...slot.placeholder, of: slot.id } });
    }
  };

  /**
   * Give the deck the layouts of `set` in place of those of `fromSetId` (editor's applyLayoutSet):
   * add the set's layouts (reusing ones the deck already has), move slides to the same kind
   * (or name), remove old layouts nothing uses, and put the set's items on the master.
   */
  const applyLayoutSet = async (pid: string, name: string, fromSetId: string, set: SlideTheme, theme: SlideTheme): Promise<number> => {
    const toId = set.id ?? DEFAULT_LAYOUT_SET.id!;
    let schema = (await graph(pid)).schema;
    const layoutsNow = (s: SchemaModel) => presentationLayouts(slideFrames(s), name).filter((l) => !l.slide.defaultLayout && !l.slide.master);
    const tag = new Batch();
    for (const l of layoutsNow(schema)) if (!l.slide.layoutSetId) tag.set('elements', l.id, { slide: { ...l.slide, layoutSetId: fromSetId } });
    if (await tag.send(api, pid)) schema = (await graph(pid)).schema;
    const old = layoutsNow(schema).filter((l) => l.slide.layoutSetId !== toId);
    const mine = layoutsNow(schema).filter((l) => l.slide.layoutSetId === toId);
    const frames = slideFrames(schema);
    const anchor = presentationLayouts(frames, name)[0] ?? deckOf(schema, name)[0];
    const blank = presentationLayouts(frames, name).find((l) => l.slide.defaultLayout);
    let order = blank?.slide.order ?? Math.min(0, ...layoutsNow(schema).map((l) => l.slide.order ?? 0)) - 1;
    const orders = new Map<string, number>();
    const byKind = new Map<LayoutKind, string>();
    const byName = new Map<string, string>();
    const frameTheme = { ...themeTokensOnly(theme), designId: theme.designId, layoutsId: toId };
    if (anchor) {
      for (const kind of setKinds(set)) {
        const have = mine.find((l) => l.slide.layoutKind === kind);
        if (have) {
          byKind.set(kind, have.id);
          orders.set(have.id, ++order);
          continue;
        }
        const items = themeLayoutItems(set, kind);
        if (!items) continue;
        byKind.set(kind, await addLayoutFrame(pid, anchor, { order: ++order, name: LAYOUT_KIND_LABELS[kind], kind, items, layoutSetId: toId, theme: frameTheme }));
      }
      for (const extra of set.extraLayouts ?? []) {
        const have = mine.find((l) => !l.slide.layoutKind && l.slide.layoutName === extra.name);
        if (have) {
          byName.set(extra.name, have.id);
          orders.set(have.id, ++order);
          continue;
        }
        byName.set(extra.name, await addLayoutFrame(pid, anchor, { order: ++order, name: extra.name, items: extra.items, layoutSetId: toId, theme: frameTheme }));
      }
    }
    schema = (await graph(pid)).schema;
    const now = () => slideFrames(schema);
    const batch = new Batch();
    let kept = 0;
    for (const layout of old) {
      const kind = layout.slide.layoutKind;
      const targetId = kind ? byKind.get(kind) : byName.get(layout.slide.layoutName ?? '');
      const target = targetId ? now().find((f) => f.id === targetId) ?? null : null;
      const users = presentationSlides(now(), name).filter((s) => s.slide.layoutId === layout.id);
      if (target) for (const s of users) await switchSlideLayout(pid, schema, s, target, batch);
      if (users.length && !target) {
        kept++;
        continue;
      }
      for (const e of schema.elements.filter((x) => x.slideId === layout.id)) batch.delete('elements', e.id);
      batch.delete('elements', layout.id);
    }
    const ours = new Set([...byKind.values(), ...byName.values()]);
    const removed = new Set(old.map((l) => l.id));
    for (const l of layoutsNow(schema).filter((l) => !ours.has(l.id) && !removed.has(l.id)).sort((a, b) => (a.slide.order ?? 0) - (b.slide.order ?? 0))) {
      orders.set(l.id, ++order);
    }
    for (const [id, at] of orders) {
      const f = now().find((x) => x.id === id);
      if (f && f.slide.order !== at) batch.set('elements', id, { slide: { ...f.slide, order: at } });
    }
    const master = presentationMaster(now(), name);
    if (master) for (const e of schema.elements.filter((x) => x.slideId === master.id)) batch.delete('elements', e.id);
    await batch.send(api, pid);
    if (master) {
      const k = master.height / 720;
      for (const item of set.master ?? []) await api.post(`/projects/${pid}/elements`, itemDto(item, master.id, master.x, master.y, master.width, k));
    }
    return kept;
  };

  /** Switch the deck to a design (its layout set and theme). */
  const switchTo = async (pid: string, name: string, lib: Lib, design: SlideTheme, set: SlideTheme, theme: SlideTheme): Promise<{ kept: number }> => {
    const cur = deckState(lib, deckOf((await graph(pid)).schema, name));
    const tokens = themeTokensOnly(theme);
    await ensureDeckFrames(pid, name, { ...tokens, designId: design.id, layoutsId: set.id });
    const stampBatch = new Batch();
    stamp(stampBatch, (await graph(pid)).schema, name, tokens, design.id!, set.id!);
    await stampBatch.send(api, pid);
    let kept = 0;
    const schema = (await graph(pid)).schema;
    const hasSetLayouts = presentationLayouts(slideFrames(schema), name).some((l) => !l.slide.defaultLayout && !l.slide.master);
    if (set.id !== cur.set.id || !hasSetLayouts) {
      kept = await applyLayoutSet(pid, name, cur.set.id!, set, { ...tokens, designId: design.id });
    }
    return { kept };
  };

  const describe = (r: SlideTheme) => ({ id: r.id, name: r.name, builtIn: isBuiltInRecord(r.id) });

  // ---- Tools --------------------------------------------------------------------------

  tool(
    'list_designs',
    'List the presentation designs (built-in and custom) and themes, and which design, theme and layouts a presentation uses. A design is a set of slide layouts plus a theme; built-in designs (Default, Sidebar, Centered, Banner on the Default theme; Spotlight, Editorial, Split, Frame with their own themes) all offer the same layout kinds, so switching between them keeps every slide.',
    { projectId, presentation },
    { readOnly: true },
    async ({ projectId: pid, presentation: p }) => {
      const { schema } = await graph(pid);
      const lib = await loadLib(schema);
      const records = allRecords(lib);
      const designs = records.filter((r) => recordKind(r) === 'design');
      const themes = records.filter((r) => recordKind(r) === 'theme');
      let current: object | undefined;
      if (slideFrames(schema).length) {
        const name = resolvePresentation(schema, p);
        const st = deckState(lib, deckOf(schema, name));
        current = {
          presentation: name,
          design: describe(st.design),
          theme: { ...describe(st.theme), colors: st.theme.colors, fonts: st.theme.fonts },
          layoutSet: describe(st.set),
          layouts: presentationLayouts(slideFrames(schema), name).map((l) => ({ id: l.id, name: layoutNameOf(l, slideFrames(schema)), kind: l.slide.layoutKind ?? null })),
        };
      }
      return {
        current,
        designs: designs.map((d) => ({ ...describe(d), theme: byId(lib, d.themeId)?.name, layouts: byId(lib, d.layoutsId)?.name })),
        themes: themes.map((t) => ({ ...describe(t), colors: t.colors, fonts: t.fonts })),
        layoutKinds: LAYOUT_KINDS.map((k) => ({ kind: k, label: LAYOUT_KIND_LABELS[k] })),
      };
    },
  );

  tool(
    'set_presentation_design',
    "Switch a presentation to a design (name or id from list_designs): its layouts replace the deck's and its theme restyles every slide. Each slide moves to the new layout of the same kind and keeps its text; layouts with no match stay while slides use them.",
    { projectId, presentation, design: z.string().describe('Design name or id.') },
    {},
    async ({ projectId: pid, presentation: p, design }) => {
      const { schema } = await graph(pid);
      const name = resolvePresentation(schema, p);
      const lib = await loadLib(schema);
      const target = find(lib, 'design', design);
      const set = byId(lib, target.layoutsId) ?? DEFAULT_LAYOUT_SET;
      const theme = byId(lib, target.themeId) ?? DEFAULT_THEME;
      const { kept } = await switchTo(pid, name, lib, target, set, theme);
      return {
        presentation: name,
        design: target.name,
        theme: theme.name,
        ...(kept ? { note: `${kept} layout(s) not in this design are kept for the slides that use them.` } : {}),
      };
    },
  );

  tool(
    'set_presentation_theme',
    "Give a presentation a theme (name or id), and/or change its colors and fonts. Changing colors/fonts of a built-in theme saves a custom copy (and a custom design using it, when the design is built-in); a custom theme is edited in place, restyling every deck that uses it. Slide content that uses theme tokens ($accent1, $heading, ...) restyles automatically.",
    {
      projectId,
      presentation,
      theme: z.string().optional().describe('Theme name or id to switch to first.'),
      colors: colorsSchema.optional(),
      fonts: fontsSchema.optional(),
      name: z.string().optional().describe('Name for the custom theme (new copies default to "<theme> custom").'),
    },
    {},
    async ({ projectId: pid, presentation: p, theme: themeRef, colors, fonts, name: newName }) => {
      const { schema } = await graph(pid);
      const name = resolvePresentation(schema, p);
      const lib = await loadLib(schema);
      const st = deckState(lib, deckOf(schema, name));
      let theme = themeRef ? themeTokensOnly(find(lib, 'theme', themeRef)) : st.theme;
      let design = st.design;
      const designCustom = !isBuiltInRecord(design.id);
      const editing = !!(colors || fonts || newName);
      let everywhere = false;
      const upserts: SlideTheme[] = [];
      if (editing) {
        const patch: Partial<SlideTheme> = {
          ...(colors ? { colors: { ...theme.colors, ...(colors as Record<string, string>) } as SlideTheme['colors'] } : {}),
          ...(fonts ? { fonts: { ...theme.fonts, ...fonts } as SlideTheme['fonts'] } : {}),
          ...(newName ? { name: newName } : {}),
        };
        const custom = !isBuiltInRecord(theme.id) && customs(lib).some((r) => r.id === theme.id);
        everywhere = custom;
        theme = custom
          ? { ...themeTokensOnly(theme), kind: 'theme', ...patch }
          : { ...themeTokensOnly(theme), kind: 'theme', id: newId(), name: newName ?? freshName(lib, `${theme.name} custom`), ...patch };
        upserts.push(theme);
      }
      if (!designCustom && (editing || theme.id !== DEFAULT_THEME.id)) {
        design = { ...themeTokensOnly(DEFAULT_THEME), kind: 'design', id: newId(), name: freshName(lib, `${design.name} custom`), themeId: theme.id, layoutsId: st.set.id };
        upserts.push(design);
      } else if (designCustom && design.themeId !== theme.id) {
        design = { ...design, themeId: theme.id };
        upserts.push(design);
      }
      if (upserts.length) await saveRecords(pid, lib, upserts);
      const batch = new Batch();
      stamp(batch, schema, name, theme, design.id!, st.set.id!, everywhere);
      await batch.send(api, pid);
      return { presentation: name, theme: { id: theme.id, name: theme.name, colors: theme.colors, fonts: theme.fonts }, design: design.name };
    },
  );

  tool(
    'create_design',
    "Save the presentation's current design as a new custom design (a copy of its layouts, master and theme) and switch the deck to it, so its layouts and theme can be changed without touching the original.",
    { projectId, presentation, name: z.string().optional().describe('Design name (default "<design> copy").') },
    {},
    async ({ projectId: pid, presentation: p, name: designName }) => {
      const { schema } = await graph(pid);
      const name = resolvePresentation(schema, p);
      const lib = await loadLib(schema);
      const st = deckState(lib, deckOf(schema, name));
      const dn = designName ?? freshName(lib, `${st.design.name} copy`);
      const theme: SlideTheme = { ...themeTokensOnly(st.theme), kind: 'theme', id: newId(), name: freshName(lib, `${st.theme.name} copy`) };
      const hasLayouts = presentationLayouts(slideFrames(schema), name).some((l) => !l.slide.defaultLayout && !l.slide.master);
      const content = hasLayouts ? captureSet(schema, name, st.set.id!) : { layouts: st.set.layouts, extraLayouts: st.set.extraLayouts, master: st.set.master };
      const set: SlideTheme = { ...themeTokensOnly(DEFAULT_THEME), kind: 'layouts', id: newId(), name: `${dn} layouts`, ...content };
      if (!hasLayouts && st.set.id === DEFAULT_LAYOUT_SET.id) {
        set.layouts = Object.fromEntries(STARTER_KINDS.map((k) => [k, themeLayoutItems(DEFAULT_LAYOUT_SET, k)!]));
      }
      const design: SlideTheme = { ...themeTokensOnly(DEFAULT_THEME), kind: 'design', id: newId(), name: dn, themeId: theme.id, layoutsId: set.id };
      await saveRecords(pid, lib, [theme, set, design]);
      if (hasLayouts) {
        const batch = new Batch();
        for (const l of presentationLayouts(slideFrames(schema), name)) {
          if (l.slide.defaultLayout || l.slide.master || isForeign(l, st.set.id!) || !l.slide.layoutSetId) continue;
          batch.set('elements', l.id, { slide: { ...l.slide, layoutSetId: set.id } });
        }
        await batch.send(api, pid);
        const s2 = new Batch();
        stamp(s2, (await graph(pid)).schema, name, theme, design.id!, set.id!);
        await s2.send(api, pid);
      } else {
        await switchTo(pid, name, lib, design, set, theme);
      }
      return { presentation: name, design: { id: design.id, name: design.name }, theme: theme.name };
    },
  );

  tool(
    'rename_design_or_theme',
    'Rename a custom design or theme (built-ins cannot be renamed).',
    { projectId, kind: z.enum(['design', 'theme']), ref: z.string().describe('Its current name or id.'), name: z.string().min(1) },
    { idempotent: true },
    async ({ projectId: pid, kind, ref, name: newName }) => {
      const { schema } = await graph(pid);
      const lib = await loadLib(schema);
      const rec = find(lib, kind, ref);
      if (isBuiltInRecord(rec.id)) throw new UserError(`"${rec.name}" is built in; only custom ${kind}s can be renamed.`);
      const renamed = { ...rec, name: newName.trim() };
      await saveRecords(pid, lib, [renamed]);
      if (kind === 'theme') {
        // Slide frames carry their theme's name too.
        const batch = new Batch();
        for (const f of slideFrames(schema)) {
          if (f.slide.theme?.id === rec.id) batch.set('elements', f.id, { slide: { ...f.slide, theme: { ...f.slide.theme, name: renamed.name } } });
        }
        await batch.send(api, pid);
      }
      return { kind, id: rec.id, name: renamed.name };
    },
  );

  tool(
    'delete_design_or_theme',
    'Delete a custom design or theme. Presentations using it move to the one listed just above it (or below, when it is first), as in the editor.',
    { projectId, kind: z.enum(['design', 'theme']), ref: z.string().describe('Name or id.'), confirm },
    { destructive: true },
    async ({ projectId: pid, kind, ref }) => {
      const { schema } = await graph(pid);
      const lib = await loadLib(schema);
      const rec = find(lib, kind, ref);
      if (isBuiltInRecord(rec.id)) throw new UserError(`"${rec.name}" is built in and cannot be deleted.`);
      const list = allRecords(lib).filter((r) => recordKind(r) === kind);
      const i = list.findIndex((r) => r.id === rec.id);
      const next = list[i - 1] ?? list[i + 1] ?? (kind === 'design' ? DEFAULT_DESIGN : DEFAULT_THEME);
      const decks = [...new Set(slideFrames(schema).map((f) => presentationOf(f)))].filter((n) =>
        deckOf(schema, n).some((f) => (kind === 'design' ? f.slide.theme?.designId : f.slide.theme?.id) === rec.id),
      );
      const remove = [rec.id!];
      for (const name of decks) {
        const st = deckState(lib, deckOf((await graph(pid)).schema, name));
        if (kind === 'design') {
          const set = byId(lib, next.layoutsId) ?? DEFAULT_LAYOUT_SET;
          const theme = next.id === DEFAULT_DESIGN.id ? st.theme : byId(lib, next.themeId) ?? DEFAULT_THEME;
          await switchTo(pid, name, lib, next, set, theme);
        } else {
          const b = new Batch();
          stamp(b, (await graph(pid)).schema, name, themeTokensOnly(next), st.design.id!, st.set.id!);
          await b.send(api, pid);
        }
      }
      if (kind === 'design') {
        const setId = rec.layoutsId;
        const shared = customs(lib).some((r) => r.id !== rec.id && recordKind(r) === 'design' && r.layoutsId === setId);
        if (setId && !shared && !isBuiltInRecord(setId)) remove.push(setId);
      } else {
        const users = customs(lib).filter((r) => recordKind(r) === 'design' && r.themeId === rec.id);
        if (users.length) await saveRecords(pid, lib, users.map((d) => ({ ...d, themeId: next.id })));
      }
      await saveRecords(pid, lib, [], remove);
      return { deleted: rec.name, movedTo: next.name, presentations: decks };
    },
  );

  /** A full theme from a base theme plus the given colors/fonts. */
  const buildTheme = (lib: Lib, spec: { name?: string; base?: string; colors?: Record<string, string | undefined>; fonts?: { heading?: string; body?: string } }): SlideTheme => {
    const base = spec.base ? find(lib, 'theme', spec.base) : DEFAULT_THEME;
    const given = Object.fromEntries(Object.entries(spec.colors ?? {}).filter(([, v]) => v !== undefined)) as Record<string, string>;
    return {
      ...themeTokensOnly(base),
      kind: 'theme',
      id: newId(),
      name: spec.name?.trim() || freshName(lib, `${base.name} custom`),
      colors: { ...base.colors, ...given } as SlideTheme['colors'],
      fonts: { ...base.fonts, ...Object.fromEntries(Object.entries(spec.fonts ?? {}).filter(([, v]) => v)) } as SlideTheme['fonts'],
    };
  };

  tool(
    'create_theme',
    'Create a custom theme (colors and fonts). Unset colors/fonts come from `base` (default: the Default theme). Optionally apply it to a presentation right away (as set_presentation_theme would).',
    {
      projectId,
      name: z.string().min(1),
      base: z.string().optional().describe('Theme name or id to start from.'),
      colors: colorsSchema.optional(),
      fonts: fontsSchema.optional(),
      applyTo: z.string().optional().describe('A presentation to switch to this theme.'),
    },
    {},
    async ({ projectId: pid, name, base, colors, fonts, applyTo }) => {
      const { schema } = await graph(pid);
      const lib = await loadLib(schema);
      const theme = buildTheme(lib, { name, base, colors: colors as Record<string, string>, fonts });
      const upserts: SlideTheme[] = [theme];
      let design: SlideTheme | undefined;
      let deck: string | undefined;
      let st: ReturnType<typeof deckState> | undefined;
      if (applyTo) {
        deck = resolvePresentation(schema, applyTo);
        st = deckState(lib, deckOf(schema, deck));
        design = isBuiltInRecord(st.design.id)
          ? { ...themeTokensOnly(DEFAULT_THEME), kind: 'design', id: newId(), name: freshName(lib, `${st.design.name} custom`), themeId: theme.id, layoutsId: st.set.id }
          : { ...st.design, themeId: theme.id };
        upserts.push(design);
      }
      await saveRecords(pid, lib, upserts);
      if (deck && design && st) {
        const b = new Batch();
        stamp(b, schema, deck, theme, design.id!, st.set.id!);
        await b.send(api, pid);
      }
      return { theme: { id: theme.id, name: theme.name, colors: theme.colors, fonts: theme.fonts }, ...(deck ? { appliedTo: deck, design: design!.name } : {}) };
    },
  );

  // Layout items as the AI writes them. Geometry: fractions of the slide (0-1).
  const textItem = z.object({
    kind: z.literal('text'),
    role: z.enum(PLACEHOLDER_ROLES as unknown as [string, ...string[]]).describe('Placeholder role: slides fill it (title, subtitle, body, emphasis, caption, other). Keep the same roles per kind across designs so slides carry over.'),
    prompt: z.string().optional().describe('Ghost text shown while empty (default "Click to add <role>").'),
    x: z.number(), y: z.number(), w: z.number(),
    size: z.number().describe('Font size in px at a 720px-tall slide (titles ~40-60, body ~22).'),
    font: z.enum(['heading', 'body']).optional(),
    color: z.string().optional().describe('Theme token like $heading, $text, $muted, $accent1, or #hex. Default $heading for title/emphasis, else $text.'),
    bold: z.boolean().optional(), italic: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  });
  const labelItem = z.object({
    kind: z.literal('label'),
    text: z.string().describe('Fixed text drawn on every slide using the layout (e.g. a footer). Fields like {{slide}} / {{title}} fill in per slide.'),
    x: z.number(), y: z.number(), w: z.number(),
    size: z.number(),
    font: z.enum(['heading', 'body']).optional(),
    color: z.string().optional(),
    bold: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  });
  const barItem = z.object({
    kind: z.literal('bar'),
    x: z.number(), y: z.number(), w: z.number(),
    h: z.number().describe('Height in px at a 720px-tall slide (720 = full height).'),
    color: z.string().describe('Theme token ($accent1, $surface, ...) or #hex.'),
  });
  const shapeItem = z.object({
    kind: z.literal('shape'),
    shape: z.enum(['rectangle', 'ellipse', 'diamond', 'triangle']),
    x: z.number(), y: z.number(), w: z.number(),
    h: z.number().describe('Fraction of the slide height.'),
    fill: z.string().optional().describe('Token or #hex; omit for no fill.'),
    stroke: z.string().optional().describe('Token or #hex; omit for no outline.'),
    strokeWidth: z.number().optional(),
    cornerRadius: z.number().optional(),
    opacity: z.number().min(0).max(100).optional(),
  });
  const itemSchema = z.discriminatedUnion('kind', [textItem, labelItem, barItem, shapeItem]);
  type AiItem = z.infer<typeof itemSchema>;

  const toSpecItem = (i: AiItem): LayoutSpecItem => {
    if (i.kind === 'text') {
      const role = i.role as PlaceholderRole;
      const strong = i.role === 'title' || i.role === 'emphasis';
      return {
        kind: 'text', role, prompt: i.prompt ?? `Click to add ${i.role === 'other' ? 'text' : i.role}`,
        x: i.x, y: i.y, w: i.w, size: i.size, font: i.font ?? (strong ? 'heading' : 'body'),
        color: i.color ?? (strong ? '$heading' : '$text'), bold: i.bold, italic: i.italic, align: i.align,
      };
    }
    if (i.kind === 'bar') return { kind: 'bar', x: i.x, y: i.y, w: i.w, h: i.h, color: i.color };
    if (i.kind === 'label') {
      return {
        kind: 'element', x: i.x, y: i.y, w: i.w, h: estimateTextSize(i.text, i.size).height / 720,
        el: {
          type: 'text', text: i.text, fontSize: i.size, fontFamily: themeToken(i.font ?? 'body'), strokeColor: i.color ?? '$muted',
          fillStyle: 'none', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, angle: 0, cornerRadius: 0,
          bold: i.bold, textAlign: i.align ?? 'left', wrap: true,
        } as LayoutElementProps,
      };
    }
    return {
      kind: 'element', x: i.x, y: i.y, w: i.w, h: i.h,
      el: {
        type: i.shape, strokeColor: i.stroke ?? i.fill ?? '$accent1', backgroundColor: i.fill ?? 'transparent',
        fillStyle: i.fill ? 'solid' : 'none', strokeWidth: i.stroke ? (i.strokeWidth ?? 2) : 0, strokeStyle: 'solid',
        opacity: i.opacity ?? 100, angle: 0, cornerRadius: i.cornerRadius ?? 0,
      } as LayoutElementProps,
    };
  };

  tool(
    'create_design_from_spec',
    'Create a custom design from scratch: its slide layouts (per standard kind), a master drawn under every slide, extra named layouts, and its theme (an existing one or a new one). Kinds you leave out come from `baseDesign` (default: Default), so the design always offers every kind and decks switch to and from it cleanly. Optionally apply it to a presentation. Use theme tokens ($accent1, $surface, $heading, ...) for colors so the layouts follow the theme. Check the result with render_preview.',
    {
      projectId,
      name: z.string().min(1),
      baseDesign: z.string().optional().describe('Design whose layouts fill the kinds you do not give.'),
      theme: z
        .union([
          z.string().describe('An existing theme name or id.'),
          z.object({ name: z.string().optional(), base: z.string().optional(), colors: colorsSchema.optional(), fonts: fontsSchema.optional() }).describe('A new theme.'),
        ])
        .optional()
        .describe("Default: the base design's theme."),
      layouts: z
        .record(z.enum(STARTER_KINDS as unknown as [string, ...string[]]), z.array(itemSchema))
        .optional()
        .describe(`Items per layout kind: ${STARTER_KINDS.join(', ')}.`),
      master: z.array(itemSchema).optional().describe('Items drawn under every slide (e.g. a logo bar, footer). Omit to keep the base design\'s master.'),
      extraLayouts: z.array(z.object({ name: z.string(), items: z.array(itemSchema) })).optional().describe('Additional layouts that are not a standard kind.'),
      applyTo: z.string().optional().describe('A presentation to switch to this design.'),
    },
    {},
    async ({ projectId: pid, name, baseDesign, theme: themeArg, layouts, master, extraLayouts, applyTo }) => {
      const { schema } = await graph(pid);
      const lib = await loadLib(schema);
      const base = baseDesign ? find(lib, 'design', baseDesign) : DEFAULT_DESIGN;
      const baseSet = byId(lib, base.layoutsId) ?? DEFAULT_LAYOUT_SET;
      const upserts: SlideTheme[] = [];
      let theme: SlideTheme;
      if (typeof themeArg === 'string') theme = find(lib, 'theme', themeArg);
      else if (themeArg) {
        theme = buildTheme(lib, { ...themeArg, name: themeArg.name ?? `${name} theme`, colors: themeArg.colors as Record<string, string> });
        upserts.push(theme);
      } else theme = byId(lib, base.themeId) ?? DEFAULT_THEME;
      const kinds = Object.fromEntries(
        STARTER_KINDS.map((k) => [k, (layouts?.[k] as AiItem[] | undefined)?.map(toSpecItem) ?? themeLayoutItems(baseSet, k)!]),
      ) as SlideTheme['layouts'];
      const set: SlideTheme = {
        ...themeTokensOnly(DEFAULT_THEME), kind: 'layouts', id: newId(), name: `${name} layouts`,
        layouts: kinds,
        master: master ? master.map(toSpecItem) : baseSet.master,
        extraLayouts: extraLayouts ? extraLayouts.map((x) => ({ name: x.name, items: x.items.map(toSpecItem) })) : baseSet.extraLayouts,
      };
      const design: SlideTheme = { ...themeTokensOnly(DEFAULT_THEME), kind: 'design', id: newId(), name: freshName(lib, name), themeId: theme.id, layoutsId: set.id };
      upserts.push(set, design);
      await saveRecords(pid, lib, upserts);
      let applied: object = {};
      if (applyTo) {
        const deck = resolvePresentation(schema, applyTo);
        const { kept } = await switchTo(pid, deck, lib, design, set, themeTokensOnly(theme));
        applied = { appliedTo: deck, ...(kept ? { note: `${kept} old layout(s) kept for slides that use them.` } : {}) };
      }
      return { design: { id: design.id, name: design.name }, theme: theme.name, layoutsGiven: Object.keys(layouts ?? {}), ...applied };
    },
  );

  tool(
    'set_slide_layout',
    "Put an existing slide on another of its presentation's layouts (name or id from list_layouts). Its placeholder text moves into the new layout's placeholders of the same role; empty placeholders it lacks are added, and empty ones with no match are removed.",
    {
      projectId,
      presentation,
      slide: z.string().describe('Slide id, or 1-based number (with `presentation`).'),
      layout: z.string().describe('Layout name or id.'),
    },
    { idempotent: true },
    async ({ projectId: pid, presentation: p, slide, layout }) => {
      const { schema } = await graph(pid);
      const frame = resolveSlide(schema, slide, p);
      const name = presentationOf(frame);
      const frames = slideFrames(schema);
      const all = presentationLayouts(frames, name);
      const target = all.find((l) => l.id === layout) ?? all.find((l) => layoutNameOf(l, frames).toLowerCase() === layout.trim().toLowerCase());
      if (!target) throw new UserError(`No layout "${layout}" in "${name}". Layouts: ${all.map((l) => layoutNameOf(l, frames)).join(', ') || 'none'}.`);
      if (target.slide.master) throw new UserError('The master is drawn under every slide; it is not a layout to put a slide on.');
      const batch = new Batch();
      await switchSlideLayout(pid, schema, frame, target, batch);
      await batch.send(api, pid);
      return { slide: frame.id, layout: layoutNameOf(target, frames) };
    },
  );

  return {
    applyDesign: async (pid, name, design) => {
      const lib = await loadLib((await graph(pid)).schema);
      const target = design ? find(lib, 'design', design) : DEFAULT_DESIGN;
      const set = byId(lib, target.layoutsId) ?? DEFAULT_LAYOUT_SET;
      const theme = byId(lib, target.themeId) ?? DEFAULT_THEME;
      await switchTo(pid, name, lib, target, set, theme);
      return { design: target.name ?? 'Default', theme: theme.name ?? 'Default' };
    },
  };

}
