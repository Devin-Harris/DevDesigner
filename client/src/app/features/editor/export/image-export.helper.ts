/**
 * Client-side rasterization and file helpers for diagram export. The vector SVG
 * (see diagram-svg.helper) is the source of truth; PNG is a high-resolution
 * raster of it, and the PDF embeds that raster on a single page. The PDF writer
 * is intentionally dependency-free: it embeds a JPEG via the DCTDecode filter,
 * which needs no in-browser compression library.
 */

/** Trigger a browser download for a Blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download a raw string (SQL, SVG markup) as a text-ish file. */
export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/**
 * Render an SVG string onto a canvas at `scale` device pixels per SVG unit.
 * Resolves with the canvas so callers can produce PNG or JPEG from it. Fills the
 * given background (the theme canvas color) first so exports are never
 * transparent and match the on-screen scheme.
 */
function rasterize(
  svg: string,
  width: number,
  height: number,
  scale: number,
  background: string,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas 2D context is unavailable.'));
      return;
    }
    ctx.fillStyle = background || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to rasterize the diagram SVG.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export produced no data.'))),
      type,
      quality,
    );
  });
}

/** Produce a PNG Blob from the diagram SVG at the given pixel scale (crispness). */
export async function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale = 2,
  background = '#ffffff',
): Promise<Blob> {
  const canvas = await rasterize(svg, width, height, scale, background);
  return canvasToBlob(canvas, 'image/png');
}

/**
 * Produce a single-page PDF Blob embedding the diagram as a JPEG. The page is
 * sized so 1 SVG unit maps to 0.75pt (a 96dpi feel), keeping the document a
 * sensible physical size regardless of diagram scale.
 */
export async function svgToPdfBlob(
  svg: string,
  width: number,
  height: number,
  scale = 2,
  background = '#ffffff',
): Promise<Blob> {
  return pagesToPdfBlob([{ svg, width, height, background }], scale);
}

/** One rendered diagram (or frame): its SVG markup, size in px, and background. */
export interface DiagramImage {
  svg: string;
  width: number;
  height: number;
  background: string;
}

/**
 * Produce a multi-page PDF Blob with one page per image, each page sized to its
 * own image (1 SVG unit = 0.75pt). Same-ratio frames therefore yield same-shape
 * pages, and A4/Letter frame presets land on the real paper size.
 */
export async function pagesToPdfBlob(pages: readonly DiagramImage[], scale = 2): Promise<Blob> {
  const rendered: PdfPage[] = [];
  for (const page of pages) {
    const canvas = await rasterize(page.svg, page.width, page.height, scale, page.background);
    rendered.push({
      jpeg: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92)),
      pxWidth: canvas.width,
      pxHeight: canvas.height,
      pageWidth: +(page.width * 0.75).toFixed(2),
      pageHeight: +(page.height * 0.75).toFixed(2),
    });
  }
  return buildJpegPdf(rendered);
}

export type ImageFormat = 'svg' | 'png' | 'pdf';

/**
 * Build and download the diagram in the requested image format. SVG is written
 * as-is (vector); PNG and PDF are high-resolution rasters of the same SVG on the
 * theme background. One entry point so callers pass only intent and a filename.
 */
export async function exportDiagramImage(
  format: ImageFormat,
  diagram: { svg: string; width: number; height: number; background: string },
  baseName: string,
): Promise<void> {
  const { svg, width, height, background } = diagram;
  if (format === 'svg') {
    downloadText(svg, `${baseName}.svg`, 'image/svg+xml');
    return;
  }
  if (format === 'png') {
    downloadBlob(await svgToPngBlob(svg, width, height, 2, background), `${baseName}.png`);
    return;
  }
  downloadBlob(await svgToPdfBlob(svg, width, height, 2, background), `${baseName}.pdf`);
}

/** Decode a base64 data URL into raw bytes. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Assemble a minimal, valid PDF whose single page shows one JPEG image. Uses a
 * classic cross-reference table with byte-accurate offsets. Kept small and
 * self-contained so no PDF library is needed.
 */
interface PdfPage {
  jpeg: Uint8Array;
  pxWidth: number;
  pxHeight: number;
  pageWidth: number;
  pageHeight: number;
}

function buildJpegPdf(pages: readonly PdfPage[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  // Record the byte offset where the next object begins (for the xref table).
  const markObject = (): void => {
    offsets.push(length);
  };

  push('%PDF-1.4\n');
  push('%\xff\xff\xff\xff\n');

  // 1: Catalog
  markObject();
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages (page i uses objects 3+3i Page, 4+3i Image, 5+3i Contents)
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ');
  markObject();
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pageObj = 3 + 3 * i;
    const imageObj = pageObj + 1;
    const contentObj = pageObj + 2;
    const { jpeg, pxWidth, pxHeight, pageWidth, pageHeight } = page;

    // Page
    markObject();
    push(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );

    // Image XObject (JPEG via DCTDecode)
    markObject();
    push(
      `${imageObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxWidth} /Height ${pxHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    push('\nendstream\nendobj\n');

    // Contents (draw the image to fill the page)
    const contentBytes = encoder.encode(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q\n`);
    markObject();
    push(`${contentObj} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push('endstream\nendobj\n');
  });

  // Cross-reference table.
  const xrefStart = length;
  const objectCount = offsets.length + 1; // +1 for the free object 0
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
