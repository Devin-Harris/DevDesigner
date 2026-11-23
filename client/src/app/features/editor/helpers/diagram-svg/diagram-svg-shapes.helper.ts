import type { CodeBlockView, ShapeView, TextBlockView } from '../../models/shape-view.model';
import { type Theme, attr, esc } from './diagram-svg-base.helper';

/** Crow's-foot marker defs, colored with the theme connector color. */
export function markerDefs(theme: Theme): string {
   return `<marker id="dd-one" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M11 3 L11 15" fill="none" stroke="${attr(theme.connector)}" stroke-width="1.5" />
  </marker>
  <marker id="dd-many" markerWidth="20" markerHeight="18" refX="17" refY="9" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M3 9 L17 3 M3 9 L17 9 M3 9 L17 15" fill="none" stroke="${attr(theme.connector)}" stroke-width="1.5" />
  </marker>`;
}

/** Render one drawing element (shape/arrow/freehand/text) as SVG. */
export function renderShape(view: ShapeView, imageData: ReadonlyMap<string, string>): string {
   const dash = view.dash ? ` stroke-dasharray="${attr(view.dash)}"` : '';
   const open = `<g${view.transform ? ` transform="${esc(view.transform)}"` : ''} opacity="${attr(view.opacity)}">`;
   const strokeOp = view.strokeOpacity < 1 ? ` stroke-opacity="${attr(view.strokeOpacity)}"` : '';
   const stroke = `stroke="${attr(view.stroke)}" stroke-width="${attr(view.strokeWidth)}"${strokeOp}${dash}`;
   const body: string[] = [];
   if (view.code) {
      body.push(renderCodeBlock(view.code, `fill-opacity="${attr(view.fillOpacity)}" ${stroke}`));
   } else if (view.grid) {
      body.push(renderGridTable(view, dash));
   } else if (view.image) {
      // Embedded as a data: URI so the exported file is self-contained.
      const img = view.image;
      const href = imageData.get(img.fileId);
      if (href) {
         let clip = '';
         if (img.clip) {
            const c = img.clip;
            const outline = c.rect
               ? `<rect x="${attr(c.rect.x)}" y="${attr(c.rect.y)}" width="${attr(c.rect.width)}" height="${attr(c.rect.height)}" rx="${attr(c.rect.rx)}" />`
               : c.ellipse
                 ? `<ellipse cx="${attr(c.ellipse.cx)}" cy="${attr(c.ellipse.cy)}" rx="${attr(c.ellipse.rx)}" ry="${attr(c.ellipse.ry)}" />`
                 : `<polygon points="${attr(c.polygon)}" />`;
            body.push(`<clipPath id="${esc(c.id)}">${outline}</clipPath>`);
            clip = ` clip-path="url(#${esc(c.id)})"`;
         }
         body.push(
            `<image href="${esc(href)}" x="${attr(img.src.x)}" y="${attr(img.src.y)}" ` +
               `width="${attr(img.src.width)}" height="${attr(img.src.height)}" preserveAspectRatio="none"${clip} />`
         );
      }
   } else if (view.rect?.d) {
      body.push(`<path d="${attr(view.rect.d)}" fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} />`);
   } else if (view.rect) {
      body.push(
         `<rect x="${attr(view.rect.x)}" y="${attr(view.rect.y)}" width="${attr(view.rect.width)}" height="${attr(view.rect.height)}" ` +
            `rx="${attr(view.rect.rx)}" fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} />`
      );
   } else if (view.ellipse) {
      body.push(
         `<ellipse cx="${attr(view.ellipse.cx)}" cy="${attr(view.ellipse.cy)}" rx="${attr(view.ellipse.rx)}" ry="${attr(view.ellipse.ry)}" ` +
            `fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} />`
      );
   } else if (view.roundedPath) {
      body.push(`<path d="${attr(view.roundedPath)}" fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} />`);
   } else if (view.polygon) {
      body.push(
         `<polygon points="${attr(view.polygon)}" fill="${attr(view.fill)}" fill-opacity="${attr(view.fillOpacity)}" ${stroke} stroke-linejoin="round" />`
      );
   } else if (view.freehand && view.path) {
      body.push(
         `<path d="${attr(view.path)}" fill="${attr(view.fill)}"${view.strokeOpacity < 1 ? ` fill-opacity="${attr(view.strokeOpacity)}"` : ''} stroke="none" />`
      );
   } else if (view.path) {
      // Arrowheads are tinted per stroke color (a shared theme-colored marker flashed
      // white on colored arrows during morphs and in exports).
      const ms =
         view.markerStart !== 'none' ? ` marker-start="url(#${arrowheadId(view.markerStart, view.markerColor)})"` : '';
      const me =
         view.markerEnd !== 'none' ? ` marker-end="url(#${arrowheadId(view.markerEnd, view.markerColor)})"` : '';
      body.push(
         `<path d="${attr(view.path)}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"${ms}${me} />`
      );
   } else if (view.text) {
      body.push(renderTextBlock(view.text));
   }
   if (view.label) {
      body.push(renderTextBlock(view.label));
   }
   return `${open}${body.join('')}</g>`;
}

/** Render a spreadsheet-style grid table: surface, header tint, cell borders and text. */
export function renderGridTable(view: ShapeView, dash: string): string {
   const g = view.grid!;
   const { rect } = g;
   const out: string[] = [
      `<clipPath id="${esc(g.clipId)}"><rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" ` +
         `height="${attr(rect.height)}" rx="${attr(rect.rx)}" /></clipPath>`,
      `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(rect.height)}" rx="${attr(rect.rx)}" ` +
         `fill="${esc(g.background)}" fill-opacity="${attr(view.fillOpacity)}" stroke="none" />`,
      `<g clip-path="url(#${esc(g.clipId)})">`,
   ];
   if (g.header) {
      const h = g.header;
      out.push(
         `<rect x="${attr(h.x)}" y="${attr(h.y)}" width="${attr(h.width)}" height="${attr(h.height)}" fill="${esc(h.fill)}" fill-opacity="0.12" />`
      );
   }
   for (const f of g.fills) {
      out.push(
         `<rect x="${attr(f.x)}" y="${attr(f.y)}" width="${attr(f.width)}" height="${attr(f.height)}" fill="${esc(f.fill)}" />`
      );
   }
   for (const l of g.lines) {
      out.push(
         `<line x1="${attr(l.x1)}" y1="${attr(l.y1)}" x2="${attr(l.x2)}" y2="${attr(l.y2)}" stroke="${attr(view.stroke)}" ` +
            `stroke-width="${attr(view.strokeWidth * 0.75)}" stroke-opacity="0.55"${dash} />`
      );
   }
   for (const t of g.cells) {
      out.push(renderTextBlock(t));
   }
   out.push('</g>');
   if (g.outline) {
      out.push(
         `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(rect.height)}" rx="${attr(rect.rx)}" ` +
            `fill="none" stroke="${attr(view.stroke)}" stroke-width="${attr(view.strokeWidth)}"${view.strokeOpacity < 1 ? ` stroke-opacity="${attr(view.strokeOpacity)}"` : ''}${dash} />`
      );
   }
   return out.join('');
}

/** Render a code card: surface, line-number gutter and colored tokens, clipped to the card. */
export function renderCodeBlock(c: CodeBlockView, stroke: string): string {
   const { rect } = c;
   const font = `font-size="${attr(c.fontSize)}" font-family="${esc(c.fontFamily)}"`;
   const out: string[] = [
      `<clipPath id="${esc(c.clipId)}"><rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" ` +
         `height="${attr(rect.height)}" rx="${attr(rect.rx)}" /></clipPath>`,
      `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(rect.height)}" ` +
         `rx="${attr(rect.rx)}" fill="${esc(c.background)}" ${stroke} />`,
      `<g clip-path="url(#${esc(c.clipId)})">`,
   ];
   {
      const h = c.header;
      out.push(
         `<rect x="${attr(rect.x)}" y="${attr(rect.y)}" width="${attr(rect.width)}" height="${attr(h.height)}" ` +
            `fill="${attr(h.tint)}" fill-opacity="0.14" />`,
         `<line x1="${attr(rect.x)}" y1="${attr(rect.y + h.height)}" x2="${attr(rect.x + rect.width)}" ` +
            `y2="${attr(rect.y + h.height)}" stroke="${attr(h.tint)}" stroke-opacity="0.35" />`,
         `<text x="${attr(h.x)}" y="${attr(h.y)}" text-anchor="middle" font-size="${attr(h.fontSize)}" ` +
            `font-family="${esc(c.fontFamily)}" fill="${attr(h.color)}">${esc(h.text)}</text>`
      );
      for (const d of h.dots) {
         out.push(`<circle cx="${attr(d.x)}" cy="${attr(d.y)}" r="${attr(d.r)}" fill="${attr(d.color)}" />`);
      }
   }
   for (const b of c.bands ?? []) {
      out.push(
         `<rect data-diff="1" x="${attr(b.x)}" y="${attr(b.y)}" width="${attr(b.width)}" height="${attr(b.height)}" fill="${attr(b.fill)}" />`
      );
   }
   if (c.divider) {
      const d = c.divider;
      out.push(
         `<line data-diff="1" x1="${attr(d.x)}" y1="${attr(d.y1)}" x2="${attr(d.x)}" y2="${attr(d.y2)}" stroke="${attr(d.color)}" stroke-opacity="0.35" />`
      );
   }
   for (const line of c.lines) {
      if (line.oldNumber) {
         out.push(
            `<text x="${attr(line.oldNumber.x)}" y="${attr(line.y)}" text-anchor="end" ${font} fill="${attr(c.numberColor)}">${esc(line.oldNumber.text)}</text>`
         );
      }
      if (line.sign) {
         out.push(
            `<text data-diff="1" x="${attr(line.sign.x)}" y="${attr(line.y)}" ${font} fill="${attr(line.sign.color)}">${esc(line.sign.text)}</text>`
         );
      }
      out.push(
         `<text x="${attr(line.numberX ?? c.numberX)}" y="${attr(line.y)}" text-anchor="end" ${font} fill="${attr(c.numberColor)}">${esc(line.number)}</text>`
      );
      const runs = line.tokens
         .map((t) => `<tspan fill="${attr(t.color)}"${t.italic ? ' font-style="italic"' : ''}>${esc(t.text)}</tspan>`)
         .join('');
      out.push(
         `<text x="${attr(line.textX ?? c.textX)}" y="${attr(line.y)}" xml:space="preserve" style="white-space:pre" ${font}>${runs}</text>`
      );
   }
   out.push('</g>');
   return out.join('');
}

/** Render a laid-out text block (text element content or a shape label). */
export function renderTextBlock(t: TextBlockView): string {
   const tspans = t.lines
      .map((l) => {
         const inner = l.spans
            ? l.spans
                 .map(
                    (sp) =>
                       `<tspan font-weight="${attr(sp.fontWeight)}" font-style="${attr(sp.fontStyle)}" fill="${attr(sp.color)}"` +
                       `${sp.underline ? ' text-decoration="underline"' : ''}` +
                       `${sp.morph ? ` data-morph="${esc(sp.morph)}"` : ''}>${esc(sp.text)}</tspan>`
                 )
                 .join('')
            : esc(l.text);
         const para = l.para === undefined ? '' : ` data-para="${l.para}"`;
         return `<tspan x="${attr(l.x)}" y="${attr(l.y)}"${para} style="white-space:pre">${inner}</tspan>`;
      })
      .join('');
   return (
      `<text fill="${attr(t.color)}" font-size="${attr(t.fontSize)}" font-family="${esc(t.fontFamily)}" ` +
      `font-weight="${attr(t.fontWeight)}" text-anchor="${attr(t.anchor)}">${tspans}</text>`
   );
}

/** Marker id for an arrowhead type in a stroke color (deterministic, so morph sides share it). */
export function arrowheadId(type: string, color: string | undefined): string {
   return color ? `dd-ah-${type}-${color.replace(/[^a-zA-Z0-9]/g, '_')}` : `dd-ah-${type}`;
}

/** Arrowhead markers: the theme-colored defaults plus one set per arrow stroke color. */
export function arrowheadDefs(theme: Theme, colors: Iterable<string>): string {
   const out = [arrowheadDef(theme.text, '')];
   for (const c of new Set(colors)) {
      out.push(arrowheadDef(c, `-${c.replace(/[^a-zA-Z0-9]/g, '_')}`));
   }
   return out.join('\n');
}

export function arrowheadDef(c: string, suffix: string): string {
   return `<marker id="dd-ah-arrow${suffix}" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M1 1 L9 5 L1 9" fill="none" stroke="${attr(c)}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </marker>
  <marker id="dd-ah-triangle${suffix}" markerWidth="14" markerHeight="14" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M1 1 L10 5 L1 9 Z" fill="${attr(c)}" stroke="${attr(c)}" stroke-linejoin="round" />
  </marker>
  <marker id="dd-ah-dot${suffix}" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto" markerUnits="userSpaceOnUse">
    <circle cx="5" cy="5" r="3.2" fill="${attr(c)}" />
  </marker>
  <marker id="dd-ah-bar${suffix}" markerWidth="10" markerHeight="12" refX="4" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
    <path d="M4 1 L4 11" stroke="${attr(c)}" stroke-width="1.6" stroke-linecap="round" />
  </marker>`;
}
