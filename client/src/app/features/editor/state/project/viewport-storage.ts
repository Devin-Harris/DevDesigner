import type { ViewportModel } from '@devdesigner/shared';

const KEY_PREFIX = 'dd.viewport.';

/**
 * Each participant's pan/zoom is kept in this browser, per project (it is personal view
 * state, not shared). Storage can be unavailable (private mode, blocked site data): reads
 * then return null and writes are dropped.
 */
export function readSavedViewport(projectId: string): ViewportModel | null {
   try {
      const raw = globalThis.localStorage?.getItem(KEY_PREFIX + projectId);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<ViewportModel>;
      return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom! > 0
         ? { x: v.x!, y: v.y!, zoom: v.zoom! }
         : null;
   } catch {
      return null;
   }
}

export function saveViewport(projectId: string, viewport: ViewportModel): void {
   try {
      globalThis.localStorage?.setItem(
         KEY_PREFIX + projectId,
         JSON.stringify({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
      );
   } catch {
      // Storage full or blocked: the view just isn't remembered.
   }
}
