import {
   DEFAULT_THEME,
   presentationNames,
   presentationOf,
   themeToken,
   type CanvasElementModel,
} from '@devdesigner/shared';
import type { ProjectStore } from '../../../stores/project.store';
import { addStandardLayouts, STARTER_KINDS } from './standard-layouts';

type Store = InstanceType<typeof ProjectStore>;

let running = false;

/**
 * Every presentation has a theme and a default layout, and every slide uses a layout,
 * so theme changes reach slides made ad hoc too. Missing pieces are filled in without
 * undo steps: the Default theme on its frames, a "Blank" layout (filled with
 * the theme background) and that layout on slides without one. A deck with no layouts
 * at all (a new one) also gets the standard layout set.
 */
export async function ensureDeckDefaults(store: Store, frameStroke: string): Promise<void> {
   if (running || !store.canEdit()) return;
   running = true;
   try {
      const frames = store.slideFrames();
      for (const name of presentationNames(frames)) {
         const mine = frames.filter((f) => presentationOf(f) === name);
         const slides = mine.filter((f) => !f.slide?.layout);
         if (!slides.length) continue;
         const layouts = mine.filter((f) => f.slide?.layout);
         // Keep the deck's design and layout set refs (a built-in theme lookup drops them).
         const refs = mine.find((f) => f.slide?.theme?.designId)?.slide?.theme;
         const theme = {
            ...(store.presentationThemes().get(name) ?? structuredClone(DEFAULT_THEME)),
            ...(refs ? { designId: refs.designId, layoutsId: refs.layoutsId } : {}),
         };
         let def: CanvasElementModel | null | undefined = layouts.find((l) => l.slide?.defaultLayout);
         // A brand-new deck (no layouts at all) also gets the standard layout set.
         const starter = !layouts.length;
         if (!def) {
            const first = slides[0];
            def = await store.addElementSilently({
               type: 'frame',
               x: first.x,
               y: first.y,
               width: first.width,
               height: first.height,
               angle: 0,
               strokeColor: first.strokeColor ?? frameStroke,
               fillStyle: 'none',
               strokeWidth: 1.5,
               strokeStyle: 'solid',
               opacity: 100,
               cornerRadius: 0,
               slide: {
                  order: layouts.reduce((m, l) => Math.min(m, l.slide?.order ?? 0), 0) - 1,
                  ...(first.slide?.presentation ? { presentation: first.slide.presentation } : {}),
                  layout: true,
                  layoutName: 'Blank',
                  defaultLayout: true,
                  layoutKind: 'blank',
                  theme,
               },
            });
            if (!def) continue;
         }
         if (!mine.some((f) => f.slide?.master)) {
            const first = slides[0];
            await store.addElementSilently({
               type: 'frame',
               x: first.x,
               y: first.y,
               width: first.width,
               height: first.height,
               angle: 0,
               strokeColor: first.strokeColor ?? frameStroke,
               // The master holds the deck background; slides and layouts show it through.
               backgroundColor: themeToken('background'),
               fillStyle: 'solid',
               strokeWidth: 1.5,
               strokeStyle: 'solid',
               opacity: 100,
               cornerRadius: 0,
               slide: {
                  order: layouts.reduce((m, l) => Math.min(m, l.slide?.order ?? 0), 0) - 2,
                  ...(first.slide?.presentation ? { presentation: first.slide.presentation } : {}),
                  layout: true,
                  layoutName: 'Master',
                  master: true,
                  masterBackground: true,
                  theme,
               },
            });
         }
         // Older decks: the background lived on each layout and the master had none.
         // Move it to the master so the master is the layer below every layout.
         const master = mine.find((f) => f.slide?.master);
         // Runs once per deck (flagged on the master), even if the master already has a fill.
         if (master?.slide && !master.slide.masterBackground) {
            const bg = themeToken('background');
            for (const l of layouts) {
               if (!l.slide?.master && l.fillStyle !== 'none' && l.backgroundColor === bg) {
                  await store.patchElementSilently(l.id, { fillStyle: 'none' });
               }
            }
            await store.patchElementSilently(master.id, {
               ...(master.fillStyle === 'none' ? { backgroundColor: bg, fillStyle: 'solid' as const } : {}),
               slide: { ...master.slide, masterBackground: true },
            });
         }
         if (starter) {
            await addStandardLayouts(
               store,
               { ...slides[0], slide: { ...slides[0].slide!, theme } },
               STARTER_KINDS,
               'silent'
            );
         }
         if (def.slide && def.slide.layoutKind !== 'blank') {
            await store.patchElementSilently(def.id, { slide: { ...def.slide, layoutKind: 'blank' } });
         }
         const layoutIds = new Set([...layouts.map((l) => l.id), def.id]);
         for (const f of mine) {
            if (!f.slide) continue;
            const needsTheme = !f.slide.theme;
            const needsLayout = !f.slide.layout && !(f.slide.layoutId && layoutIds.has(f.slide.layoutId));
            if (needsTheme || needsLayout) {
               await store.patchElementSilently(f.id, {
                  slide: { ...f.slide, ...(needsTheme ? { theme } : {}), ...(needsLayout ? { layoutId: def.id } : {}) },
               });
            }
         }
      }
   } finally {
      running = false;
   }
}
