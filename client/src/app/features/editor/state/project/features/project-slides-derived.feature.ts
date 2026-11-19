import { computed, untracked } from '@angular/core';
import { signalStoreFeature, type, withComputed } from '@ngrx/signals';
import {
   DEFAULT_THEME,
   layoutOf,
   masterOf,
   presentationLayouts,
   presentationNames,
   presentationOf,
   presentationSlides,
   presentationThemes,
   resolveThemeFont,
   slideSequence,
} from '@devdesigner/shared';
import { isMasterDeletion, overriddenId } from '../../../helpers/frame-contents.helper';
import { setThemeFontResolver } from '../../../helpers/text-metrics';
import { sameItems, sameMap, sameSet } from '../../../../../shared/helpers/equality';
import type { ProjectState, SlideHidden } from '../models/project-state.model';

const sameHidden = (a: SlideHidden | null, b: SlideHidden | null): boolean =>
   a === b ||
   (!!a &&
      !!b &&
      sameSet(a.elementIds, b.elementIds) &&
      sameSet(a.tableIds, b.tableIds) &&
      sameSet(a.diagramIds, b.diagramIds));

/**
 * Slides and presentations derived from the schema: the deck order, the selected presentation,
 * the slide each presentation shows, layout/master items under it and what the canvas hides.
 */
export function withProjectSlidesDerived() {
   return signalStoreFeature(
      { state: type<ProjectState>() },
      withComputed(({ schema, activeSlideKey, selectedPresentationKey, shownByPresentationKey }) => {
         const slideFrames = computed(
            () => slideSequence((schema()?.elements ?? []).filter((e) => e.type === 'frame')),
            { equal: sameItems }
         );
         const presentations = computed(() => presentationNames(slideFrames()), { equal: sameItems });
         const presentation = computed<string | null>(() => {
            const names = presentations();
            const picked = selectedPresentationKey();
            if (picked && names.includes(picked)) {
               return picked;
            }
            const frames = slideFrames();
            const shown = frames.find((f) => f.id === activeSlideKey()) ?? frames[0];
            return shown ? presentationOf(shown) : null;
         });
         /** The slide each presentation shows (its chosen one if it still exists, else its first). */
         const shownByPresentation = computed(
            () => {
               const picked = shownByPresentationKey();
               const frames = slideFrames();
               const out = new Map<string, string>();
               for (const name of presentations()) {
                  // A layout can be shown too (to edit it); it stacks in the same spot.
                  const slides = presentationSlides(frames, name);
                  const all = frames.filter((f) => presentationOf(f) === name);
                  const hit = all.find((f) => f.id === picked[name]) ?? slides[0] ?? all[0];
                  if (hit) {
                     out.set(name, hit.id);
                  }
               }
               return out as ReadonlyMap<string, string>;
            },
            { equal: sameMap }
         );
         const shownSlideIds = computed(() => new Set(shownByPresentation().values()) as ReadonlySet<string>, {
            equal: sameSet,
         });
         /** Layout frames drawn under a shown slide (and not shown themselves). */
         const layoutsUnderShown = computed(
            () => {
               const frames = slideFrames();
               const shown = shownSlideIds();
               const out = new Set<string>();
               for (const f of frames) {
                  if (!shown.has(f.id)) continue;
                  const l = layoutOf(f, frames);
                  if (l && !shown.has(l.id)) out.add(l.id);
                  // The master is drawn under every slide and layout of its deck.
                  const m = masterOf(f, frames);
                  if (m && !shown.has(m.id)) out.add(m.id);
               }
               return out as ReadonlySet<string>;
            },
            { equal: sameSet }
         );
         const themes = computed(() => presentationThemes(schema()?.elements ?? []), { equal: sameMap });
         /** Live groups (two or more members) and each member's group, built in one pass. */
         // Text measuring resolves `$heading` / `$body` against the item's deck theme.
         setThemeFontResolver((el) => {
            const frames = untracked(slideFrames);
            const f = frames.find((x) => x.id === el.id) ?? frames.find((x) => x.id === el.slideId);
            return resolveThemeFont(el.fontFamily, (f && untracked(themes).get(presentationOf(f))) || DEFAULT_THEME);
         });
         return {
            slideFrames,
            /** The presentations in the project (names), in order of first appearance. */
            presentations,
            /** The selected presentation: the one the slides panel, F5 and the PDF export act on. */
            presentation,
            /** The slides of the selected presentation, in order (skipped ones included). */
            presentationFrames: computed(() => presentationSlides(slideFrames(), presentation()), { equal: sameItems }),
            /** The layouts of the selected presentation. */
            presentationLayoutFrames: computed(() => presentationLayouts(slideFrames(), presentation()), {
               equal: sameItems,
            }),
            /**
             * Elements of a layout drawn under a shown slide: on the canvas, but locked (they
             * are edited by showing the layout itself).
             */
            /** Master items drawn under a shown slide or layout (stacked below layout items). */
            masterItemIds: computed(
               () => {
                  const masters = new Set(
                     slideFrames()
                        .filter((f) => f.slide?.master)
                        .map((f) => f.id)
                  );
                  return new Set(
                     masters.size
                        ? (schema()?.elements ?? [])
                             .filter((e) => !!e.slideId && masters.has(e.slideId))
                             .map((e) => e.id)
                        : []
                  ) as ReadonlySet<string>;
               },
               { equal: sameSet }
            ),
            layoutItemIds: computed(
               () => {
                  const under = layoutsUnderShown();
                  return new Set(
                     under.size
                        ? (schema()?.elements ?? [])
                             .filter((e) => !!e.slideId && under.has(e.slideId) && !e.placeholder)
                             .map((e) => e.id)
                        : []
                  ) as ReadonlySet<string>;
               },
               { equal: sameSet }
            ),
            /** Each presentation's theme (name -> theme); presentations without one use the default. */
            presentationThemes: themes,
            /** The slide each presentation shows on the canvas (name -> frame id). */
            shownByPresentation,
            /** The slides shown on the canvas: one per presentation. */
            shownSlideIds,
            /** The slide shown for the selected presentation (where new content goes). */
            activeSlideId: computed(() => {
               const name = presentation();
               return (name ? shownByPresentation().get(name) : undefined) ?? null;
            }),
            /**
             * What the canvas leaves out because it belongs to another slide. Each
             * presentation stacks its slides in one spot and only its shown slide is drawn;
             * things with no slide are shown always.
             */
            hiddenBySlides: computed(
               () => {
                  const elements = schema()?.elements ?? [];
                  const shown = shownSlideIds();
                  if (!shown.size) {
                     return null;
                  }
                  // The layouts under shown slides stay on the canvas (drawn locked, beneath).
                  const under = layoutsUnderShown();
                  const elementIds = new Set<string>();
                  for (const e of elements) {
                     if (
                        e.type === 'frame'
                           ? !!e.slide && !shown.has(e.id)
                           : !!e.slideId && !shown.has(e.slideId) && !(under.has(e.slideId) && !e.placeholder)
                     ) {
                        elementIds.add(e.id);
                     }
                  }
                  // Master items a shown slide (or its layout) replaces with its own stand-in; a
                  // slide's stand-in also hides its layout's.
                  const bySlide = new Set<string>();
                  const byLayout = new Set<string>();
                  for (const e of elements) {
                     const of = overriddenId(e);
                     if (!of || !e.slideId) continue;
                     // A deletion marker is never drawn itself.
                     if (isMasterDeletion(e)) elementIds.add(e.id);
                     if (shown.has(e.slideId)) bySlide.add(of);
                     else if (under.has(e.slideId)) byLayout.add(of);
                  }
                  if (bySlide.size || byLayout.size) {
                     for (const e of elements) {
                        if (
                           bySlide.has(e.id) ||
                           byLayout.has(e.id) ||
                           (e.overrides && e.slideId && under.has(e.slideId) && bySlide.has(overriddenId(e)!))
                        ) {
                           elementIds.add(e.id);
                        }
                     }
                  }
                  const tableIds = new Set<string>();
                  for (const t of schema()?.tables ?? []) {
                     if (t.slideId && !shown.has(t.slideId)) {
                        tableIds.add(t.id);
                     }
                  }
                  const diagramIds = new Set<string>();
                  for (const d of schema()?.sequenceDiagrams ?? []) {
                     if (d.slideId && !shown.has(d.slideId)) {
                        diagramIds.add(d.id);
                     }
                  }
                  return { elementIds, tableIds, diagramIds } satisfies SlideHidden;
               },
               { equal: sameHidden }
            ),
            /** The single selected table (only when exactly one is selected), for the inspector. */
         };
      })
   );
}
