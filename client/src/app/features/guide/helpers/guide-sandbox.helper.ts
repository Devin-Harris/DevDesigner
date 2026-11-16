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
