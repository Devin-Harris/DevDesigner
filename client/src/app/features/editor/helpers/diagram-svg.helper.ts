import type { CanvasElementModel, RelationshipModel, TableModel } from '@devdesigner/shared';
import { tableBox } from './node-metrics.helper';
import { computeConnectors } from './connectors.helper';
import { messageLabelBoxes } from './message-box.helper';
import { buildShapeViews } from './render';
import { elementBox } from './element-geometry.helper';
import { PADDING, attr, esc, readTheme } from './diagram-svg/diagram-svg-base.helper';
import { renderTable } from './diagram-svg/diagram-svg-table.helper';
import { arrowheadDefs, markerDefs, renderShape } from './diagram-svg/diagram-svg-shapes.helper';
import { type SequenceExportData, renderSequence } from './diagram-svg/diagram-svg-sequence.helper';

/**
 * Build a standalone vector SVG of the diagram that mirrors the on-screen canvas
 * exactly: it reads the app's live theme tokens (the --dd-* CSS custom
 * properties) so the export matches the active light or dark scheme, and it
 * reproduces the real node, chip, type-pill, connector, and grid styling. Table
 * geometry and connector routing reuse the same canvas helpers, so the export
 * lines up pixel-for-pixel with what the user sees.
 */

export interface DiagramSvg {
   svg: string;
   width: number;
   height: number;
   /** Canvas background color, so PNG/PDF backgrounds match the theme. */
   background: string;
   /** The drawing alone (no defs/background), in the same coordinates as `svg`'s content group. */
   body: string;
   /** The exported frame's fill, when it has one. */
   pageColor?: string;
}

/**
 * Compose the full diagram SVG for the given tables and relationships. Pass a
 * subset (e.g. the marquee selection) to export just those; connectors are drawn
 * only when both endpoints are present. Returns the markup, pixel dimensions,
 * and background color.
 */
export function buildDiagramSvg(
   tables: readonly TableModel[],
   relationships: readonly RelationshipModel[],
   elements: readonly CanvasElementModel[] = [],
   sequences: SequenceExportData = { diagrams: [], lifelines: [], messages: [] },
   crop?: { x: number; y: number; width: number; height: number; frameId?: string; pageColor?: string },
   /** fileId -> `data:` URI for each image element (see ElementImagesService.dataUrl). */
   imageData: ReadonlyMap<string, string> = new Map()
): DiagramSvg {
   const { theme, dispose } = readTheme();
   try {
      const frameBoxes = elements.filter((e) => e.type === 'frame').map(elementBox);
      // The frame being exported: its fill is the page's background, so it is drawn
      // (without outline or name) even though the frame itself is not content.
      const pageFrame = crop
         ? elements.find((e) =>
              crop.frameId ? e.id === crop.frameId : e.type === 'frame' && e.x === crop.x && e.y === crop.y
           )
         : undefined;
      if (crop) {
         // A frame export shows exactly the frame's area; the frames themselves
         // (their outlines and names) are page furniture, not content.
         elements = elements.filter((e) => e.type !== 'frame');
      }
      const pageView = pageFrame
         ? buildShapeViews([pageFrame], [], new Set<string>(), {
              canvasBg: theme.canvasBg,
              text: theme.text,
              surface: theme.surface,
           })[0]
         : undefined;
      const pageFill =
         pageView && pageView.rect && pageView.fill !== 'none'
            ? `<rect x="${attr(pageView.rect.x)}" y="${attr(pageView.rect.y)}" width="${attr(pageView.rect.width)}" ` +
              `height="${attr(pageView.rect.height)}" fill="${attr(pageView.fill)}" fill-opacity="${attr(pageView.fillOpacity)}" ` +
              `opacity="${attr(pageView.opacity)}" />`
            : '';
      // Frames are gone from `elements` by now, so tell the contrast guard what the items
      // sit on: the page's fill, not the app's canvas (dark text must not flip on a white
      // slide in dark mode).
      const pageColor = crop?.pageColor ?? (pageView?.rect && pageView.fill !== 'none' ? pageView.fill : undefined);
      const connectors = computeConnectors(tables, relationships, new Set<string>(), frameBoxes);
      const shapeViews = buildShapeViews(
         elements,
         tables,
         new Set<string>(),
         {
            canvasBg: pageColor ?? theme.canvasBg,
            text: theme.text,
            surface: theme.surface,
         },
         messageLabelBoxes(sequences.diagrams, sequences.lifelines, sequences.messages)
      );

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const extend = (x: number, y: number): void => {
         minX = Math.min(minX, x);
         minY = Math.min(minY, y);
         maxX = Math.max(maxX, x);
         maxY = Math.max(maxY, y);
      };

      for (const table of tables) {
         const box = tableBox(table);
         extend(box.x0, box.y0);
         extend(box.x1, box.y1);
      }
      for (const connector of connectors) {
         for (const point of connector.routePoints) {
            extend(point.x, point.y);
         }
      }
      for (const element of elements) {
         const box = elementBox(element);
         extend(box.x0, box.y0);
         extend(box.x1, box.y1);
      }
      const sequenceSvgs: Array<{ z: number; svg: string }> = [];
      for (const diagram of sequences.diagrams) {
         const laid = renderSequence(diagram, sequences.lifelines, sequences.messages, theme, sequences);
         if (laid) {
            extend(laid.box.x0, laid.box.y0);
            extend(laid.box.x1, laid.box.y1);
            sequenceSvgs.push({ z: diagram.zIndex, svg: `<g data-seq="${esc(diagram.id)}">${laid.svg}</g>` });
         }
      }

      if (!Number.isFinite(minX)) {
         minX = 0;
         minY = 0;
         maxX = 400;
         maxY = 200;
      }

      // Cropped: the canvas is the frame itself (no padding), so the output keeps
      // the frame's exact size and aspect ratio. Otherwise fit the content + padding.
      const pad = crop ? 0 : PADDING;
      const originX = crop ? crop.x : minX;
      const originY = crop ? crop.y : minY;
      const width = crop ? Math.round(crop.width) : Math.ceil(maxX - minX) + PADDING * 2;
      const height = crop ? Math.round(crop.height) : Math.ceil(maxY - minY) + PADDING * 2;
      const shiftX = pad - originX;
      const shiftY = pad - originY;

      const edges = connectors
         .map(
            (c) =>
               `<path data-rid="${esc(c.id)}" d="${attr(c.d)}" fill="none" stroke="${attr(theme.connector)}" stroke-width="1.75" ` +
               `marker-start="${attr(c.markerStart)}" marker-end="${attr(c.markerEnd)}" />`
         )
         .join('\n');

      // Each table / element sits in a tagged group so presentation mode can pick
      // items out of a slide's SVG and animate them (the morph transition).
      const nodes = tables.map((t) => `<g data-tid="${esc(t.id)}">${renderTable(t, theme)}</g>`).join('\n');
      // Stacking mirrors the canvas: connectors, frames, then drawing elements with
      // sequence diagrams interleaved by zIndex, table nodes, any diagram above
      // every element, and finally lines/arrows.
      const elementZ = new Map(elements.map((e) => [e.id, e.zIndex]));
      const maxZ = elements.reduce((m, e) => (e.type === 'frame' ? m : Math.max(m, e.zIndex)), -Infinity);
      const shapeSvg = (v: (typeof shapeViews)[number]): string =>
         v.frameClip
            ? `<clipPath id="fclip-${esc(v.id)}"><rect x="${attr(v.frameClip.x)}" y="${attr(v.frameClip.y)}" width="${attr(v.frameClip.width)}" height="${attr(v.frameClip.height)}" /></clipPath>` +
              `<g data-eid="${esc(v.id)}" clip-path="url(#fclip-${esc(v.id)})">${renderShape(v, imageData)}</g>`
            : `<g data-eid="${esc(v.id)}">${renderShape(v, imageData)}</g>`;
      const isLine = (v: (typeof shapeViews)[number]): boolean => v.type === 'line' || v.type === 'arrow';
      const frameShapes = shapeViews.filter((v) => v.type === 'frame').map(shapeSvg);
      const lineShapes = shapeViews.filter(isLine).map(shapeSvg);
      const stacked: Array<{ z: number; svg: string }> = [
         ...shapeViews
            .filter((v) => v.type !== 'frame' && !isLine(v))
            .map((v) => ({ z: elementZ.get(v.id) ?? Infinity, svg: shapeSvg(v) })),
         ...sequenceSvgs.filter((d) => d.z <= maxZ),
      ].sort((a, b) => a.z - b.z);
      const topDiagrams = sequenceSvgs.filter((d) => d.z > maxZ).sort((a, b) => a.z - b.z);

      const stack = [
         pageFill,
         edges,
         frameShapes.join('\n'),
         stacked.map((i) => i.svg).join('\n'),
         nodes,
         topDiagrams.map((i) => i.svg).join('\n'),
         lineShapes.join('\n'),
      ].join('\n');

      // Hachure fills reference a per-element <pattern>; without it they render blank.
      const hatchDefs = [...shapeViews, ...(pageView ? [pageView] : [])]
         .filter((v) => v.hatch)
         .map(
            (v) =>
               `<pattern id="${esc(v.hatch!.id)}" width="7" height="7" patternUnits="userSpaceOnUse" ` +
               `patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${attr(v.hatch!.color)}" stroke-width="1.3" /></pattern>`
         )
         .join('');

      const body = stack;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${attr(width)}" height="${attr(height)}" viewBox="0 0 ${attr(width)} ${attr(height)}">
<defs>
  <pattern id="dd-export-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="translate(${attr(shiftX % 24)}, ${attr(shiftY % 24)})">
    <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${attr(theme.gridLine)}" stroke-width="1" />
  </pattern>
  ${markerDefs(theme)}
  ${arrowheadDefs(
     theme,
     shapeViews
        .filter((v) => v.markerStart !== 'none' || v.markerEnd !== 'none')
        .map((v) => v.markerColor)
        .filter(Boolean)
  )}
  ${hatchDefs}
</defs>
<rect x="0" y="0" width="${attr(width)}" height="${attr(height)}" fill="${attr(theme.canvasBg)}" />
<rect x="0" y="0" width="${attr(width)}" height="${attr(height)}" fill="url(#dd-export-grid)" />
<g transform="translate(${attr(shiftX)}, ${attr(shiftY)})">
${stack}
</g>
</svg>`;

      return { svg, width, height, background: theme.canvasBg, body, pageColor };
   } finally {
      dispose();
   }
}
export { sequenceBounds, type SequenceBox, type SequenceExportData } from './diagram-svg/diagram-svg-sequence.helper';
