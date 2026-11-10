import type { ProjectExportFile } from '@devdesigner/shared';
import type { SandboxBackendService } from '../../../core/sandbox/sandbox-backend.service';
import { fontStack } from '../../editor/helpers/shape-render.helper';

/** Bump when the seeds change so a session picks up the new examples. */
export const STORAGE_PREFIX = 'dd-guide-sandbox:v5:';

/** Seed project files, bundled as lazy chunks (exported from real projects, see seeds/). */
export const SEEDS: Record<string, () => Promise<{ default: unknown }>> = {
   select: () => import('../seeds/select.json'),
   tables: () => import('../seeds/tables.json'),
   sequence: () => import('../seeds/sequence.json'),
   shapes: () => import('../seeds/shapes.json'),
   text: () => import('../seeds/text.json'),
   draw: () => import('../seeds/draw.json'),
   code: () => import('../seeds/code.json'),
   grid: () => import('../seeds/grid.json'),
   media: () => import('../seeds/media.json'),
   frame: () => import('../seeds/frame.json'),
   laser: () => import('../seeds/laser.json'),
   presentations: () => import('../seeds/presentations.json'),
   export: () => import('../seeds/export.json'),
};

export async function waitForCodeFont(): Promise<void> {
   try {
      const stack = fontStack('code');
      await Promise.race([
         Promise.all([document.fonts.load(`400 14px ${stack}`), document.fonts.ready]),
         new Promise((r) => setTimeout(r, 1500)),
      ]);
   } catch {
      /* measure with whatever is available */
   }
}

export function readStored(seed: string): string | null {
   try {
      return sessionStorage.getItem(STORAGE_PREFIX + seed);
   } catch {
      return null;
   }
}

export function writeStored(seed: string, id: string | null): void {
   try {
      if (id) sessionStorage.setItem(STORAGE_PREFIX + seed, id);
      else sessionStorage.removeItem(STORAGE_PREFIX + seed);
   } catch {
      /* storage blocked: the sandbox is just re-created next time */
   }
}

/**
 * Sandbox project for a seed file: reuses this browser session's copy (by `key`),
 * else builds one from `load()`. View-only sandboxes render read-only.
 */
export async function prepareSandbox(
   sandboxes: SandboxBackendService,
   key: string,
   load: () => Promise<{ default: unknown }>,
   viewOnly = false
): Promise<string> {
   const stored = readStored(key);
   if (stored && sandboxes.exists(stored)) return stored;
   const file = (await load()).default as ProjectExportFile;
   // Code blocks are sized from the measured code font: make sure it has loaded.
   await waitForCodeFont();
   const id = sandboxes.create(structuredClone(file), key, { viewOnly });
   writeStored(key, id);
   return id;
}
