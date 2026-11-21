import { SVG_NS, type Side } from '../helpers/morph/morph.model';
import { sanitizeSvgDom } from '../helpers/svg-sanitize.helper';
import type { RenderedSlide } from './slide-render.service';

/** Module-level pieces of morph-stage. */

export const GRID_ID = 'dd-export-grid';

/** Longest text (in characters) that is morphed glyph by glyph; longer just cross-fades. */
export const MAX_CHAR_MORPH = 360;

export function parse(slide: RenderedSlide, gridId: string): Side {
   const text = gridId === GRID_ID ? slide.svg : slide.svg.split(GRID_ID).join(gridId);
   const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
   sanitizeSvgDom(doc.documentElement);
   const root = doc.documentElement as unknown as SVGSVGElement;
   const main = root.querySelector(':scope > g') as SVGGElement | null;
   const items = new Map<string, SVGGElement>();
   const rest: Element[] = [];
   if (main) {
      for (const child of Array.from(main.children)) {
         const id = child.getAttribute('data-eid') ?? child.getAttribute('data-tid');
         if (id && child instanceof SVGGElement) {
            items.set(id, child);
         } else {
            rest.push(child);
         }
      }
   }
   return {
      root,
      main: main ?? (doc.createElementNS(SVG_NS, 'g') as SVGGElement),
      items,
      rest,
   };
}
