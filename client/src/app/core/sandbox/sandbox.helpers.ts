import type { ProjectSummary, SchemaModel, TableModel } from '@devdesigner/shared';
import { isColorValue } from '@devdesigner/shared';

/** Project ids served by the sandbox backend instead of the API. */
export const SANDBOX_PREFIX = 'sandbox-';
export const isSandboxId = (id: string | null | undefined): boolean => !!id && id.startsWith(SANDBOX_PREFIX);

export interface SandboxProject {
   project: ProjectSummary;
   schema: SchemaModel;
   /** Uploaded / seeded media: id -> { mimeType, base64 data }. */
   images: Record<string, { mimeType: string; data: string }>;
   /** Served with VIEW access: the editor renders it read-only (home page showcase). */
   viewOnly?: boolean;
}

/** Thrown for a request the sandbox can not satisfy (becomes an HTTP error). */
export class SandboxError extends Error {
   constructor(
      readonly status: number,
      message: string
   ) {
      super(message);
   }
}

export type Dict = Record<string, unknown>;

export const uuid = (): string => crypto.randomUUID();

/**
 * Mirror of the server's @IsColor (security S1.2): every color in a write body
 * (`*Color` / `color` keys at any depth, and a theme's `colors` map) must be a color
 * the server would accept, so sandboxes never hold data the real API refuses.
 */
export function assertColors(value: unknown, path = 'body'): void {
   if (Array.isArray(value)) {
      value.forEach((v, i) => assertColors(v, `${path}[${i}]`));
      return;
   }
   if (!value || typeof value !== 'object') return;
   for (const [key, v] of Object.entries(value as Dict)) {
      const isColorKey = /color$/i.test(key) && typeof v === 'string';
      if (isColorKey && !isColorValue(v)) throw new SandboxError(400, `${path}.${key} must be a color.`);
      if (key === 'colors' && v && typeof v === 'object' && !Array.isArray(v)) {
         for (const [k, c] of Object.entries(v as Dict)) {
            if (!isColorValue(c)) throw new SandboxError(400, `${path}.colors.${k} must be a color.`);
         }
      }
      if (!isColorKey) assertColors(v, `${path}.${key}`);
   }
}

/** Mirror of the server's assertIdsInProject (security S2.3): refs must exist in this sandbox. */
export function assertKnown(ids: unknown[], known: ReadonlyArray<{ id: string }>, what: string): void {
   const have = new Set(known.map((x) => x.id));
   const bad = ids.filter((id): id is string => typeof id === 'string' && id !== '' && !have.has(id));
   if (bad.length) throw new SandboxError(400, `${what} ${bad.join(', ')} is not part of this project.`);
}

/** Shallow patch with the API's semantics: `null` clears a field, `undefined` leaves it. */
export function patch<T extends object>(target: T, dto: Dict, skip: string[] = ['id']): T {
   const out = { ...target } as Dict;
   for (const [k, v] of Object.entries(dto)) {
      if (skip.includes(k) || v === undefined) continue;
      if (v === null || (k === 'morphId' && typeof v === 'string' && !v.trim())) delete out[k];
      else out[k] = v;
   }
   return out as T;
}

export function tablePatch(t: TableModel, b: Dict): TableModel {
   const next = patch(t, b);
   if (b['width'] !== undefined && !((b['width'] as number) > 0)) delete next.width;
   if (b['scale'] !== undefined && (!((b['scale'] as number) > 0) || b['scale'] === 1)) delete next.scale;
   return next;
}
