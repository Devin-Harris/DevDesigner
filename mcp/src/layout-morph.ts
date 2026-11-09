// Shared morph tags across a presentation's layouts (pure): placeholders pair by role,
// repeated look-alike items (accent bars, logos, matching boxes) pair by kind, so a
// slide on one layout morphs sensibly into a slide on another.

import type { CanvasElementModel } from '@devdesigner/shared';

interface FrameLike {
  id: string;
  x: number;
  y: number;
}

export interface LayoutTagPlan {
  elementId: string;
  tag: string;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'item';

/** Thin horizontal / vertical bars are their own kind; anything else is a box. */
function shapeClass(e: CanvasElementModel): string {
  if (e.type === 'line' || e.type === 'arrow') return e.width >= e.height ? 'hline' : 'vline';
  if (e.height <= 12 && e.width >= e.height * 3) return 'bar';
  if (e.width <= 12 && e.height >= e.width * 3) return 'vbar';
  return 'box';
}

/** What makes two layout items "the same thing": type, look and (for text/images) content. */
function signature(e: CanvasElementModel): string {
  const content =
    e.type === 'image' ? (e.fileId ?? '') : e.type === 'text' ? (e.text ?? '').trim().toLowerCase() : '';
  return [e.type, shapeClass(e), e.strokeColor ?? '', e.backgroundColor ?? '', content].join('|');
}

const readingOrder = (a: CanvasElementModel, b: CanvasElementModel): number => a.y - b.y || a.x - b.x;

export function planLayoutMorphTags(
  elements: readonly CanvasElementModel[],
  layouts: readonly FrameLike[],
  opts: { placeholders: boolean; items: boolean },
): LayoutTagPlan[] {
  const out: LayoutTagPlan[] = [];
  const onLayout = (l: FrameLike): CanvasElementModel[] =>
    elements.filter((e) => e.slideId === l.id && e.type !== 'frame').sort(readingOrder);

  if (opts.placeholders) {
    for (const l of layouts) {
      const seen = new Map<string, number>();
      for (const e of onLayout(l).filter((x) => !!x.placeholder)) {
        const role = e.placeholder!.role ?? 'text';
        const n = (seen.get(role) ?? 0) + 1;
        seen.set(role, n);
        out.push({ elementId: e.id, tag: n === 1 ? `layout-${role}` : `layout-${role}-${n}` });
      }
    }
  }

  if (opts.items) {
    // Per layout: its items grouped by signature, in reading order.
    const groups = layouts.map((l) => {
      const m = new Map<string, CanvasElementModel[]>();
      for (const e of onLayout(l).filter((x) => !x.placeholder)) {
        const s = signature(e);
        m.set(s, [...(m.get(s) ?? []), e]);
      }
      return m;
    });
    const sigs = [...new Set(groups.flatMap((g) => [...g.keys()]))];
    let kind = 0;
    for (const s of sigs) {
      // Only kinds found on two or more layouts are worth a shared tag.
      if (groups.filter((g) => g.has(s)).length < 2) continue;
      kind += 1;
      const sample = groups.find((g) => g.has(s))!.get(s)![0];
      const base =
        sample.type === 'text' && sample.text?.trim()
          ? `layout-text-${slug(sample.text)}`
          : `layout-${sample.type}-${shapeClass(sample)}-${kind}`;
      for (const g of groups) {
        g.get(s)?.forEach((e, i) => out.push({ elementId: e.id, tag: i === 0 ? base : `${base}-${i + 1}` }));
      }
    }
  }
  return out;
}
