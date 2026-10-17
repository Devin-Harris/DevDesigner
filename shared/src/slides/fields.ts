// Auto-fill fields: tokens inside text ("Slide {{slide}} of {{total}}") that are
// filled in when a slide is drawn, so a footer on a layout or the master numbers every
// slide. Stored as plain text, so they need no schema and survive export/import.

import type { TextRun } from '../models';

export const SLIDE_FIELDS = ['slide', 'total', 'date', 'title'] as const;
export type SlideField = (typeof SLIDE_FIELDS)[number];

export const SLIDE_FIELD_LABELS: Record<SlideField, string> = {
  slide: 'Slide number',
  total: 'Slide count',
  date: 'Date',
  title: 'Presentation title',
};

/** The token text for a field ("{{slide}}"). */
export function fieldToken(field: SlideField): string {
  return `{{${field}}}`;
}

/** What fields fill in for one slide. */
export interface FieldContext {
  slide: string;
  total: string;
  date: string;
  title: string;
}

const FIELD_RE = /\{\{(slide|total|date|title)\}\}/g;

export function hasFields(text: string | undefined): boolean {
  return !!text && text.includes('{{') && new RegExp(FIELD_RE.source).test(text);
}

export function fillFieldText(text: string, ctx: FieldContext): string {
  return text.replace(FIELD_RE, (_, f: SlideField) => ctx[f]);
}

/** An element with its fields filled in (the same object when it has none). */
export function resolveFields<E extends { text?: string; runs?: TextRun[] }>(e: E, ctx: FieldContext): E {
  if (!hasFields(e.text)) return e;
  const runs = e.runs?.map((r) => (hasFields(r.text) ? { ...r, text: fillFieldText(r.text, ctx) } : r));
  return { ...e, text: fillFieldText(e.text!, ctx), ...(runs ? { runs } : {}) };
}

/** The field values for a slide: its number among the shown (not hidden) slides of its deck. */
export function fieldContext(
  slideId: string,
  presentableIds: readonly string[],
  title: string,
  now: Date = new Date(),
): FieldContext {
  const i = presentableIds.indexOf(slideId);
  return {
    slide: i >= 0 ? String(i + 1) : '',
    total: String(presentableIds.length),
    date: now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    title,
  };
}
