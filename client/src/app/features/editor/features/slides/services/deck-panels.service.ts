import type { ShapePointerEvent } from '../../canvas/components/canvas-shapes/canvas-shapes.component';
import { EditorToolService } from '../../../services/editor-tool.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { DeckFocusService } from './deck-focus.service';
import { computed, inject, Injectable, linkedSignal } from '@angular/core';
import { layoutNameOf } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import type { Box } from '../../../models/geometry.model';
import { PANEL_FOLDED_W } from '../../../shared/constants/slide-panels.constants';
import { PANEL_GAP } from '../../../shared/constants/slide-panels.constants';
import { PANEL_LIST_W } from '../../../shared/constants/slide-panels.constants';
import { PANEL_MIN_H } from '../../../shared/constants/slide-panels.constants';
import { PANEL_MIN_PAD_PX } from '../../../shared/constants/slide-panels.constants';
import { PANEL_PAD } from '../../../shared/constants/slide-panels.constants';
import { PANEL_RADIUS } from '../../../shared/constants/slide-panels.constants';
import { PANEL_SETTINGS_W } from '../../../shared/constants/slide-panels.constants';
/** What the deck panels reach in sibling sub-features; the editor entry wires it with `connect`. */
export interface DeckPanelsHost {
   readonly elementGestures: { onElementPointerDown(payload: ShapePointerEvent): void };
}

/** Each deck's slide list and settings panels beside its shown slide, the deck outline and deck selection. */
@Injectable()
export class DeckPanelsService {
   private readonly store = inject(ProjectStore);
   private readonly deckFocus = inject(DeckFocusService);
   private readonly tools = inject(EditorToolService);
   private host!: DeckPanelsHost;

   connect(host: DeckPanelsHost): void {
      this.host = host;
   }

   /**
    * The panels are part of the frame's world: laid out in world units (width fixed,
    * height = the frame's) and scaled by the zoom with a CSS transform, so they keep
    * the same proportion to the frame at every zoom. `width`/`height` are the
    * unscaled world size the element is given; `scale` is applied around the top-left.
    */
   /**
    * One block per presentation: its shown slide's frame with the slide list pinned
    * to its left edge, the settings pinned to its right, and a border around all
    * three. Each presentation is a self-contained set at its own spot.
    */
   /** World-space box of each presentation's dashed outline (list + frame + settings, as laid out in slideSets). */
   presentationOutlineBoxes(): { frameId: string; box: Box }[] {
      const gap = PANEL_GAP;
      const zoom = this.store.viewport().zoom;
      const pad = Math.max(PANEL_PAD, PANEL_MIN_PAD_PX / zoom);
      const frames = this.store.slideFrames();
      const shown = this.store.shownByPresentation();
      const settingsW = this.deckFocus.settingsFolded() ? PANEL_FOLDED_W : PANEL_SETTINGS_W;
      return this.store.presentations().flatMap((name) => {
         const f = frames.find((fr) => fr.id === shown.get(name));
         if (!f) return [];
         const y0 = f.y;
         const y1 = f.y + Math.max(f.height, PANEL_MIN_H);
         return [
            {
               frameId: f.id,
               box: {
                  x0: f.x - gap - PANEL_LIST_W - pad,
                  y0: y0 - pad,
                  x1: f.x + f.width + gap + settingsW + pad,
                  y1: y1 + pad,
               },
            },
         ];
      });
   }

   readonly slideSets = computed(() => {
      const v = this.store.viewport();
      const gap = PANEL_GAP;
      const frames = this.store.slideFrames();
      const shown = this.store.shownByPresentation();
      const folded = this.deckFocus.settingsFolded();
      return this.store.presentations().flatMap((name) => {
         const frame = frames.find((f) => f.id === shown.get(name));
         if (!frame) {
            return [];
         }
         const top = frame.y * v.zoom + v.y;
         const height = Math.max(frame.height, PANEL_MIN_H);
         const list = {
            left: (frame.x - PANEL_LIST_W - gap) * v.zoom + v.x,
            top,
            width: PANEL_LIST_W,
            height,
            scale: v.zoom,
         };
         const settings = {
            left: (frame.x + frame.width + gap) * v.zoom + v.x,
            top,
            width: folded ? PANEL_FOLDED_W : PANEL_SETTINGS_W,
            height,
            scale: v.zoom,
         };
         // Padding and corner radius scale with the panels so the outline keeps the same
         // shape at every zoom; only the hairline border stays in screen px, so keep just
         // enough padding for it to clear the panels.
         const pad = Math.max(PANEL_PAD * v.zoom, PANEL_MIN_PAD_PX);
         const radius = PANEL_RADIUS * v.zoom + pad;
         const bottom = top + height * v.zoom;
         return [
            {
               name,
               frameId: frame.id,
               list,
               settings,
               // While a layout is shown, it is ringed and labelled so it is not mistaken for a slide.
               layoutEdit: frame.slide?.layout
                  ? {
                       left: frame.x * v.zoom + v.x,
                       top,
                       width: frame.width * v.zoom,
                       height: frame.height * v.zoom,
                       name: frame.slide.master ? 'Master' : layoutNameOf(frame, frames),
                       master: !!frame.slide.master,
                    }
                  : null,
               outline: {
                  left: list.left - pad,
                  top: top - pad,
                  width: settings.left + settings.width * v.zoom - list.left + pad * 2,
                  height: bottom - top + pad * 2,
                  radius,
               },
            },
         ];
      });
   });

   /**
    * The presentations selected as a whole (outer border clicked, or enclosed by a
    * marquee): drawn with a selected outline, and Delete removes every slide of them.
    */
   readonly selectedSlideSets = linkedSignal<{ ids: string[]; shown: ReadonlyMap<string, string> }, string[]>({
      source: () => ({ ids: this.store.selectedElementIds(), shown: this.store.shownByPresentation() }),
      // Still selected while its shown frame is (a marquee can take it with other items).
      computation: ({ ids, shown }, previous) => {
         const sets = previous?.value ?? [];
         const kept = sets.filter((set) => ids.includes(shown.get(set) ?? ''));
         return kept.length === sets.length ? sets : kept;
      },
   });

   /**
    * Pointer down on a slide set's outer border: select the whole presentation and grab
    * its shown slide frame (it carries its contents; the other slides follow it).
    */
   onSlideBorderDown(name: string, frameId: string, event: PointerEvent): void {
      if (event.button !== 0 || !this.tools.shapesInteractive()) {
         return;
      }
      event.stopPropagation();
      this.store.selectPresentation(name);
      // Grabbing one of several selected presentations moves them all, still selected.
      const sets = this.selectedSlideSets();
      const keep = sets.includes(name) && !PointerGestureService.additive(event);
      this.host.elementGestures.onElementPointerDown({ id: frameId, event });
      this.selectedSlideSets.set(keep ? sets : [name]);
   }

   /** Touching a presentation's panels makes it the selected one (F5, export). */
   selectSlideSet(name: string): void {
      this.store.selectPresentation(name);
   }
}
