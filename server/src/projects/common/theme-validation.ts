import {
  LAYOUT_KINDS,
  MAX_THEME_DESIGN_BYTES,
  PLACEHOLDER_ROLES,
  TEXT_ALIGNS,
  isColorValue,
} from '@devdesigner/shared';
import type { ClassConstructor } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

/**
 * Validation for the free-form parts of a slide theme (security M-4 / S2.2): the
 * per-kind `layouts`, the `master` items and the `extraLayouts`. These used to be
 * stored "as given"; they are rendered as slide elements for every collaborator, so
 * each item is now checked like a real element. Shared by the theme DTOs and the
 * project-file import parser. Every function returns an error message or null.
 */

/** Most items one layout / the master may hold. */
export const MAX_LAYOUT_ITEMS = 500;
/** Most extra layouts per theme. */
export const MAX_EXTRA_LAYOUTS = 100;
/** Serialized size cap for each of layouts / master / extraLayouts (shared with the import parser). */
export { MAX_THEME_DESIGN_BYTES };

/** Element fields a layout item's `el` must not carry (geometry and identity live outside). */
const OMITTED_EL_KEYS = ['id', 'x', 'y', 'width', 'height', 'slideId', 'slide', 'zIndex', 'fileId', 'startBinding', 'endBinding'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

let elementDto: ClassConstructor<object> | undefined;
/** Loaded lazily: the element DTO module itself imports the slide/theme DTOs that use this file. */
function createElementDto(): ClassConstructor<object> {
  if (!elementDto) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    elementDto = (require('../canvas/elements/dto/create-element.dto') as { CreateElementDto: ClassConstructor<object> })
      .CreateElementDto;
  }
  return elementDto;
}

function elementPropsError(el: unknown, path: string): string | null {
  if (!isObj(el)) return `${path} must be an object`;
  const bad = OMITTED_EL_KEYS.find((k) => k in el);
  if (bad) return `${path}.${bad} is not allowed on a layout item`;
  // Same rules as POST /elements, with neutral geometry (layout items carry their own).
  const dto = plainToInstance(createElementDto(), { ...el, x: 0, y: 0, width: 1, height: 1 });
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (!errors.length) return null;
  const first = errors[0];
  const detail = Object.values(first.constraints ?? {})[0] ?? `${first.property} is invalid`;
  return `${path}: ${detail}`;
}

/** One layout item (`text`, `bar` or a captured `element`). */
export function layoutItemError(item: unknown, path: string): string | null {
  if (!isObj(item)) return `${path} must be an object`;
  for (const k of ['x', 'y', 'w']) if (!finite(item[k])) return `${path}.${k} must be a number`;
  switch (item['kind']) {
    case 'text': {
      const allowed = ['kind', 'role', 'prompt', 'x', 'y', 'w', 'size', 'font', 'color', 'bold', 'italic', 'align'];
      const extra = Object.keys(item).find((k) => !allowed.includes(k));
      if (extra) return `${path}.${extra} is not allowed`;
      if (!(PLACEHOLDER_ROLES as readonly unknown[]).includes(item['role'])) return `${path}.role is invalid`;
      if (typeof item['prompt'] !== 'string' || item['prompt'].length > 200) return `${path}.prompt must be text (200)`;
      if (!finite(item['size'])) return `${path}.size must be a number`;
      if (item['font'] !== 'heading' && item['font'] !== 'body') return `${path}.font must be heading or body`;
      if (!isColorValue(item['color'])) return `${path}.color must be a color`;
      for (const k of ['bold', 'italic']) {
        if (item[k] !== undefined && typeof item[k] !== 'boolean') return `${path}.${k} must be a boolean`;
      }
      if (item['align'] !== undefined && !(TEXT_ALIGNS as readonly unknown[]).includes(item['align'])) {
        return `${path}.align is invalid`;
      }
      return null;
    }
    case 'bar': {
      const extra = Object.keys(item).find((k) => !['kind', 'x', 'y', 'w', 'h', 'color'].includes(k));
      if (extra) return `${path}.${extra} is not allowed`;
      if (!finite(item['h'])) return `${path}.h must be a number`;
      return isColorValue(item['color']) ? null : `${path}.color must be a color`;
    }
    case 'element': {
      const extra = Object.keys(item).find((k) => !['kind', 'x', 'y', 'w', 'h', 'el'].includes(k));
      if (extra) return `${path}.${extra} is not allowed`;
      if (!finite(item['h'])) return `${path}.h must be a number`;
      return elementPropsError(item['el'], `${path}.el`);
    }
    default:
      return `${path}.kind must be text, bar or element`;
  }
}

export function layoutItemsError(items: unknown, path: string): string | null {
  if (!Array.isArray(items)) return `${path} must be an array`;
  if (items.length > MAX_LAYOUT_ITEMS) return `${path} holds at most ${MAX_LAYOUT_ITEMS} items`;
  for (const [i, item] of items.entries()) {
    const error = layoutItemError(item, `${path}[${i}]`);
    if (error) return error;
  }
  return null;
}

export function themeLayoutsError(layouts: unknown, path: string): string | null {
  if (!isObj(layouts)) return `${path} must be an object`;
  for (const [kind, items] of Object.entries(layouts)) {
    if (!(LAYOUT_KINDS as readonly string[]).includes(kind)) return `${path}.${kind} is not a layout kind`;
    const error = layoutItemsError(items, `${path}.${kind}`);
    if (error) return error;
  }
  return null;
}

export function extraLayoutsError(layouts: unknown, path: string): string | null {
  if (!Array.isArray(layouts)) return `${path} must be an array`;
  if (layouts.length > MAX_EXTRA_LAYOUTS) return `${path} holds at most ${MAX_EXTRA_LAYOUTS} layouts`;
  for (const [i, layout] of layouts.entries()) {
    const p = `${path}[${i}]`;
    if (!isObj(layout)) return `${p} must be an object`;
    const extra = Object.keys(layout).find((k) => k !== 'name' && k !== 'items');
    if (extra) return `${p}.${extra} is not allowed`;
    if (typeof layout['name'] !== 'string' || layout['name'].length > 120) return `${p}.name must be text (120)`;
    const error = layoutItemsError(layout['items'], `${p}.items`);
    if (error) return error;
  }
  return null;
}
